/**
 * Module dịch trang — giữ layout bằng cách dịch theo khối DOM (p, h1, li…).
 *
 * API: window.StoryTranslator
 *  - translatePage(targetLang)
 *  - restoreOriginal() / toggleOriginal()
 *  - isTranslated() / isTranslateWanted()
 *  - startAutoTranslateObserver()
 */
(function () {
  "use strict";

  /** element → { html or text, mode } */
  var originalMap = new Map();
  var translatedEls = [];
  var showingOriginal = false;
  var isBusy = false;
  var abortFlag = false;
  var translateWanted = false;
  var dailyCharsKey = "sr-translate-chars-" + new Date().toISOString().slice(0, 10);
  var autoObs = null;
  var observerTimer = null;

  function getDailyChars() {
    try {
      return parseInt(localStorage.getItem(dailyCharsKey) || "0", 10) || 0;
    } catch (e) {
      return 0;
    }
  }
  function addDailyChars(n) {
    try {
      localStorage.setItem(dailyCharsKey, String(getDailyChars() + n));
    } catch (e) {}
  }

  function getTranslateRoot() {
    var sels = [
      // nguontruyen / wordpress novel
      ".chapter-c",
      "#chapter-content",
      ".box-chap",
      ".content-chapter",
      ".chapter-content",
      "#chapterContent",
      ".reading-content",
      ".text-left",
      "div.entry-content",
      "article .entry-content",
      // webnovel / orv
      "article",
      "main",
      ".cha-words",
      ".cha-content",
      ".prose",
      ".post-content",
      "#content",
      "[class*='chapter-content']",
      "[class*='chapter_content']",
      "[class*='reader']",
    ];
    var best = null;
    var bestLen = 0;
    for (var i = 0; i < sels.length; i++) {
      var nodes = document.querySelectorAll(sels[i]);
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (el.closest && el.closest("[id^='sr-']")) continue;
        var len = ((el.innerText || "").trim()).length;
        if (len > bestLen && len > 80) {
          bestLen = len;
          best = el;
        }
      }
    }
    return best || document.body;
  }

  /**
   * Các khối hiển thị — mỗi khối = 1 đơn vị dịch → giữ khoảng cách/layout.
   * Không lấy div lồng nhau (chỉ leaf-ish block).
   */
  function collectBlocks(root) {
    root = root || getTranslateRoot();
    var sel =
      "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, pre, dt, dd, summary";
    var list = [];
    var seen = new Set();
    root.querySelectorAll(sel).forEach(function (el) {
      if (el.closest && el.closest("[id^='sr-']")) return;
      if (seen.has(el)) return;
      var text = (el.innerText || "").trim();
      if (text.length < 3) return;
      if (text.length < 8 && /next|prev|menu|share/i.test(text)) return;
      seen.add(el);
      list.push(el);
    });

    // webnovel.com: .cha-words / đoạn trong chapter mới load
    try {
      document
        .querySelectorAll(
          ".cha-words, .cha-content, [class*='cha-words'], [class*='cha-paragraph'], .chapter_content p, .cha-words div"
        )
        .forEach(function (el) {
          if (el.closest && el.closest("[id^='sr-']")) return;
          if (seen.has(el)) return;
          // Bỏ container lớn đã có p con trong list
          if (el.querySelector && el.querySelector("p") && el.matches(".cha-words, .cha-content")) {
            return;
          }
          var text = (el.innerText || "").trim();
          if (text.length < 8) return;
          if (text.length > 5000) return;
          seen.add(el);
          list.push(el);
        });
    } catch (eWn) {}


    // Fallback: khối text dài (nguontruyen hay 1 div + <br>)
    if (list.length < 3) {
      root.querySelectorAll("div").forEach(function (el) {
        if (el.closest && el.closest("[id^='sr-']")) return;
        if (seen.has(el)) return;
        if (el.querySelector(sel)) return;
        var text = (el.innerText || "").trim();
        if (text.length < 40) return;
        // 1 khối lớn: tách theo đoạn \n\n nếu quá dài
        if (text.length > 80) {
          seen.add(el);
          list.push(el);
        }
      });
    }
    // Nếu chỉ 1 khối rất dài — vẫn dịch được (translateLong cắt chunk)
    return list;
  }

  function guessSourceLang(sample) {
    var s = sample || "";
    var cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    var vi = (
      s.match(
        /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi
      ) || []
    ).length;
    if (cjk > 10) return "zh-CN";
    if (vi > 15) return "vi";
    return "en";
  }

  function translateChunk(text, langpair) {
    return new Promise(function (resolve, reject) {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        reject(new Error("Extension context invalidated — F5 trang sau khi Reload extension"));
        return;
      }
      try {
        chrome.runtime.sendMessage(
          { type: "MYMEMORY_TRANSLATE", text: text, langpair: langpair },
          function (resp) {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (resp && resp.ok && resp.translatedText != null) {
              resolve(String(resp.translatedText));
            } else {
              reject(new Error((resp && resp.error) || "translate failed"));
            }
          }
        );
      } catch (e) {
        reject(new Error(String(e && e.message ? e.message : e)));
      }
    });
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  /**
   * Dịch text dài: cắt ≤450, ghép lại bằng khoảng trắng (giữ trong 1 khối).
   */
  async function translateLong(text, langpair) {
    if (text.length <= 450) {
      addDailyChars(text.length);
      return await translateChunk(text, langpair);
    }
    var parts = [];
    for (var p = 0; p < text.length; p += 450) {
      if (p > 0) await sleep(40);
      var slice = text.slice(p, p + 450);
      parts.push(await translateChunk(slice, langpair));
      addDailyChars(slice.length);
    }
    return parts.join(" ");
  }

  /**
   * Gán bản dịch vào element mà KHÔNG phá cấu trúc con nếu có thể:
   * - Không có element con → textContent
   * - Có con → chỉ thay text node lá (tuần tự), không gộp
   */
  function applyTranslationToEl(el, translated) {
    if (!el.children || el.children.length === 0) {
      el.textContent = translated;
      return;
    }
    // Có child (a, strong…): thay toàn bộ textContent sẽ mất style —
    // chấp nhận mất style inline để giữ block layout (quan trọng hơn)
    el.textContent = translated;
  }

  async function translatePage(targetLang) {
    if (isBusy) {
      window.StoryReaderUI?.toast?.("Đang dịch…");
      return false;
    }
    targetLang = targetLang || localStorage.getItem("sr-target-lang") || "vi";
    isBusy = true;
    abortFlag = false;
    try {
      try {
        window.__srWasSpeakingBeforeTranslate = !!(
          window.StoryTTS &&
          (window.StoryTTS.isSpeaking?.() ||
            document.querySelector("#sr-panel-play.sr-playing"))
        );
      } catch (eW) {
        window.__srWasSpeakingBeforeTranslate = false;
      }
      var host = (location.hostname || "").toLowerCase();
      var knownManga =
        /kagane|nettruyen|truyenqq|truyentranh|mangadex|webtoon|asura|newtruyen|comick|manhwa|manhua/.test(
          host
        );

      // Chỉ site manga mới OCR-only. Truyện chữ → dịch text.
      var blocks = collectBlocks();
      var textLen = 0;
      blocks.forEach(function (b) {
        textLen += ((b.innerText || "").trim()).length;
      });

      var bigImgs = 0;
      try {
        document.querySelectorAll("img").forEach(function (img) {
          if (img.closest && img.closest("[id^='sr-']")) return;
          var w = Math.max(
            img.naturalWidth || 0,
            img.width || 0,
            img.clientWidth || 0
          );
          var h = Math.max(
            img.naturalHeight || 0,
            img.height || 0,
            img.clientHeight || 0
          );
          if (w >= 200 && h >= 200) bigImgs++;
        });
      } catch (e0) {}

      // Manga host HOẶC (≥3 ảnh lớn VÀ rất ít chữ)
      var isManga = knownManga || (bigImgs >= 3 && textLen < 200);

      if (isManga && window.StoryImageTranslate) {
        window.StoryReaderUI?.toast?.("Truyện tranh — OCR ảnh…", 15000);
        try {
          var n = await window.StoryImageTranslate.translateInRoot(null, {
            loose: true,
            silent: false,
          });
          translateWanted = true;
          try {
            sessionStorage.setItem("sr-translate-wanted", "1");
          } catch (e1) {}
          if (n > 0) return true;
          window.StoryReaderUI?.toast?.(
            "OCR chưa đọc được chữ trong ảnh. Thử cuộn để ảnh hiện rõ rồi dịch lại.",
            4500
          );
        } catch (e2) {
          console.warn("[Translate] manga OCR", e2);
          window.StoryReaderUI?.toast?.("OCR lỗi: " + (e2.message || e2), 4000);
        }
        return false;
      }

      if (!blocks.length) {
        window.StoryReaderUI?.toast?.("Không tìm thấy đoạn để dịch");
        return false;
      }

      // Lưu HTML gốc để hoàn tác (giữ layout khi restore)
      translatedEls = [];
      blocks.forEach(function (el) {
        if (!originalMap.has(el)) {
          originalMap.set(el, el.innerHTML);
        }
        translatedEls.push(el);
      });

      var sample = blocks
        .slice(0, 5)
        .map(function (el) {
          return el.innerText;
        })
        .join(" ");
      var source = guessSourceLang(sample);
      if (source === targetLang) {
        source = source === "vi" ? "en" : source;
      }
      var langpair = source + "|" + targetLang;

      window.StoryReaderUI?.toast?.(
        "Đang dịch 0/" + blocks.length + " đoạn…",
        60000
      );

      var okCount = 0;
      var failCount = 0;

      for (var i = 0; i < blocks.length; i++) {
        var el = blocks[i];
        var text = (el.innerText || "").trim();
        if (text.length < 3) continue;
        if (abortFlag) break;
        try {
          var out = await translateLong(text, langpair);
          applyTranslationToEl(el, out);
          okCount++;
        } catch (err) {
          failCount++;
          console.warn("[Translate] block fail", err);
          if (String(err.message || err).indexOf("invalidated") !== -1) {
            abortFlag = true;
            window.StoryReaderUI?.toast?.(
              "Extension đã Reload — F5 trang rồi dịch lại",
              5000
            );
            break;
          }
        }
        if ((i + 1) % 3 === 0 || i + 1 === blocks.length) {
          window.StoryReaderUI?.toast?.(
            "Đang dịch " +
              (i + 1) +
              "/" +
              blocks.length +
              (failCount ? " (lỗi:" + failCount + ")" : "") +
              "…",
            60000
          );
        }
        await sleep(25);
      }

      // OCR ảnh trong cùng nút Dịch trang (im lặng nếu fail / không có ảnh)
      if (!abortFlag) {
        try {
          if (window.StoryImageTranslate) {
            await window.StoryImageTranslate.translateInRoot(null, {
              loose: true,
              silent: true,
            });
          }
        } catch (e) {
          console.warn("[Translate] OCR skip", e);
        }
      }

      showingOriginal = false;
      translateWanted = true;
      try {
        sessionStorage.setItem("sr-translate-wanted", "1");
      } catch (e) {}
      startAutoTranslateObserver();

      var msg =
        okCount === 0
          ? "Dịch thất bại (rate-limit). Thử lại sau."
          : "✓ Đã dịch " +
            okCount +
            "/" +
            blocks.length +
            " đoạn → " +
            targetLang +
            (failCount ? " (" + failCount + " lỗi)" : "");
      window.StoryReaderUI?.toast?.(msg, 4500);

      // Đang nghe → đọc tiếp bằng bản dịch
      try {
        var wasOn =
          window.StoryTTS &&
          (window.StoryTTS.isSpeaking?.() ||
            document.getElementById("sr-panel-play")?.classList.contains("sr-playing"));
        if (wasOn || window.__srWasSpeakingBeforeTranslate) {
          window.__srWasSpeakingBeforeTranslate = false;
          window.StoryTTS?.stop?.();
          setTimeout(function () {
            window.StoryTTS?.startFromPage?.();
          }, 400);
        }
      } catch (eR) {}

      return okCount > 0;
    } catch (err) {
      console.warn("[Translate]", err);
      window.StoryReaderUI?.toast?.("Dịch lỗi: " + (err.message || err));
      return false;
    } finally {
      isBusy = false;
    }
  }

  function clearTranslateWanted() {
    translateWanted = false;
    showingOriginal = true;
    try {
      sessionStorage.removeItem("sr-translate-wanted");
    } catch (e) {}
    stopAutoTranslateObserver();
  }

  function restoreOriginal() {
    translatedEls.forEach(function (el) {
      if (originalMap.has(el)) {
        try {
          el.innerHTML = originalMap.get(el);
        } catch (e) {}
      }
    });
    clearTranslateWanted();
    // Dừng TTS đang đọc bản dịch + xóa hàng đợi cũ
    try {
      window.StoryTTS?.stop?.();
    } catch (e) {}
    window.StoryReaderUI?.toast?.("Đã hiện bản gốc (tắt tự dịch)", 2500);
  }

  async function showTranslated() {
    // Dịch lại từ bản gốc đã lưu
    translatedEls.forEach(function (el) {
      if (originalMap.has(el)) {
        try {
          el.innerHTML = originalMap.get(el);
        } catch (e) {}
      }
    });
    showingOriginal = false;
    return translatePage(localStorage.getItem("sr-target-lang") || "vi");
  }

  function toggleOriginal() {
    if (!translatedEls.length) {
      window.StoryReaderUI?.toast?.("Chưa dịch trang nào");
      return;
    }
    if (showingOriginal) showTranslated();
    else restoreOriginal();
  }

  function isTranslated() {
    return translatedEls.length > 0 && !showingOriginal;
  }
  function isTranslateWanted() {
    try {
      return translateWanted || sessionStorage.getItem("sr-translate-wanted") === "1";
    } catch (e) {
      return translateWanted;
    }
  }

  /**
   * Dịch các khối mới (chapter load thêm trên webnovel).
   * Trả về Promise<number> — số đoạn đã dịch.
   */
  function translateNewBlocksOnly() {
    if (!isTranslateWanted()) return Promise.resolve(0);
    var blocks = collectBlocks();
    var fresh = blocks.filter(function (el) {
      return !originalMap.has(el);
    });
    if (!fresh.length) return Promise.resolve(0);
    if (isBusy) {
      // Chờ lượt đang chạy xong rồi thử lại
      return new Promise(function (resolve) {
        setTimeout(function () {
          translateNewBlocksOnly().then(resolve);
        }, 1200);
      });
    }

    isBusy = true;
    return (async function () {
      try {
        var targetLang = localStorage.getItem("sr-target-lang") || "vi";
        var sample = fresh
          .slice(0, 4)
          .map(function (el) {
            return el.innerText;
          })
          .join(" ");
        var source = guessSourceLang(sample);
        if (source === targetLang) source = source === "vi" ? "en" : source;
        var langpair = source + "|" + targetLang;
        var ok = 0;
        console.log("[Translate] auto +" + fresh.length + " khối mới");
        for (var i = 0; i < fresh.length; i++) {
          var el = fresh[i];
          var text = (el.innerText || "").trim();
          if (text.length < 3) continue;
          originalMap.set(el, el.innerHTML);
          translatedEls.push(el);
          try {
            var out = await translateLong(text, langpair);
            applyTranslationToEl(el, out);
            ok++;
          } catch (e) {
            console.warn("[Translate] auto", e);
          }
          await sleep(25);
        }
        if (ok) {
          window.StoryReaderUI?.toast?.("✓ Tự dịch +" + ok + " đoạn mới", 2500);
        }
        return ok;
      } finally {
        isBusy = false;
      }
    })();
  }

  function stopAutoTranslateObserver() {
    if (autoObs) {
      try {
        autoObs.disconnect();
      } catch (e) {}
      autoObs = null;
    }
    clearTimeout(observerTimer);
    try {
      clearInterval(window.__srTrPoll);
    } catch (e) {}
  }

  function startAutoTranslateObserver() {
    if (autoObs) return;
    autoObs = new MutationObserver(function () {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(function () {
        translateNewBlocksOnly();
      }, 600);
    });
    try {
      autoObs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}

    var lastH = document.documentElement.scrollHeight;
    var lastCha = 0;
    try {
      lastCha = document.querySelectorAll(".cha-words, .cha-content").length;
    } catch (e0) {}
    clearInterval(window.__srTrPoll);
    window.__srTrPoll = setInterval(function () {
      if (!isTranslateWanted()) return;
      var h = document.documentElement.scrollHeight;
      var cha = 0;
      try {
        cha = document.querySelectorAll(".cha-words, .cha-content").length;
      } catch (e1) {}
      if (h > lastH + 80 || cha > lastCha) {
        lastH = h;
        lastCha = cha;
        translateNewBlocksOnly();
      }
    }, 1200);

    if (!window.__srTrScrollBound) {
      window.__srTrScrollBound = true;
      window.addEventListener(
        "scroll",
        function () {
          if (!isTranslateWanted()) return;
          clearTimeout(window.__srTrScrollT);
          window.__srTrScrollT = setTimeout(function () {
            if (
              window.scrollY + window.innerHeight >
              document.documentElement.scrollHeight - 900
            ) {
              translateNewBlocksOnly();
            }
          }, 500);
        },
        { passive: true }
      );
    }
  }

  function abort() {
    abortFlag = true;
    isBusy = false;
    window.StoryReaderUI?.toast?.("Đã dừng dịch", 2000);
  }

  window.StoryTranslator = {
    translatePage: translatePage,
    restoreOriginal: restoreOriginal,
    toggleOriginal: toggleOriginal,
    isTranslated: isTranslated,
    isTranslateWanted: isTranslateWanted,
    startAutoTranslateObserver: startAutoTranslateObserver,
    collectBlocks: collectBlocks,
    translateNewBlocksOnly: translateNewBlocksOnly,
    abort: abort,
    clearTranslateWanted: clearTranslateWanted,
  };

  // Giữ cờ qua next chương (user đã bấm Dịch và chưa xem bản gốc)
  try {
    if (sessionStorage.getItem("sr-translate-wanted") === "1") {
      translateWanted = true;
    }
  } catch (e) {}

  console.log("[Story Reader] translator.js loaded — StoryTranslator ready");
})();
