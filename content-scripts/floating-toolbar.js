/**
 * Floating UI — bubble, menu nhanh, panel danh sách câu + cài đặt, HUD auto-scroll.
 *
 * Trách nhiệm chính:
 * - Tạo bubble kéo thả (dock trái/phải, idle half-hide trên desktop).
 * - Menu: Auto-scroll, Nghe TTS, Danh sách câu, Highlight, Theme, Cài đặt, Dừng.
 * - Panel TTS: list câu, Go to #, engine giọng (máy / Google), slider rate-pitch-context-scroll.
 * - HUD tốc độ cuộn phía trên bubble; đồng bộ nút play/pause với StoryTTS.
 * - Chỉ hiện bubble sau khi popup gửi SHOW_TOOLBAR (không tự hiện lúc load trang).
 *
 * API public: window.StoryReaderUI (showToolbar, setPlaying, buildSentenceList, …).
 * Style: ui/floating-toolbar.css — token màu --sr-accent #00e5ff.
 */
(function () {
  "use strict";













  /* ===== Inline modules (tránh eval / CSP trang) ===== */
  if (!window.StoryTranslator) {
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

      // Không OCR trên truyện chữ — OCR chỉ khi isManga (nhánh trên).
      // Tránh overlay OCR dính lên trang novel.

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
   * Đang nghe TTS hoặc auto-scroll → dịch nền im lặng (không toast "Đang dịch").
   */
  function isContinuousSession() {
    try {
      if (window.StoryTTS?.isSpeaking?.() || window.StoryTTS?.isPlaying?.()) return true;
      if (window.StoryTTS?.autoScrollEnabled) return true;
      if (window.StoryTTS?.isSessionActive?.()) return true;
    } catch (e) {}
    return false;
  }

  function distToBottom() {
    var h = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
    var y = window.scrollY + window.innerHeight;
    return Math.max(0, h - y);
  }

  /**
   * Cuộn ngầm gần đáy để site infinite load thêm chapter (webnovel…).
   * Đánh dấu programmatic để không pause auto-scroll.
   */
  function nudgeLoadMore() {
    return new Promise(function (resolve) {
      var before = document.documentElement.scrollHeight;
      try {
        window.__srTranslateNudge = true;
        if (window.StoryTTS) {
          try {
            // tránh pauseAutoScroll coi là user
            window.StoryTTS.isProgrammaticScroll && window.StoryTTS.isProgrammaticScroll();
          } catch (e0) {}
        }
        // hích xuống — site infinite thường load khi gần đáy
        window.scrollBy(0, Math.min(400, Math.max(120, distToBottom() + 80)));
      } catch (e1) {}
      var checks = 0;
      var wait = function () {
        checks++;
        var now = document.documentElement.scrollHeight;
        if (now > before + 60 || checks >= 8) {
          setTimeout(function () {
            window.__srTranslateNudge = false;
          }, 300);
          resolve(now > before + 60);
          return;
        }
        setTimeout(wait, 200);
      };
      setTimeout(wait, 250);
    });
  }

  /**
   * Dịch các khối mới (chapter load thêm).
   * @param {object} [opts]
   * @param {boolean} [opts.silent] — ẩn toast (mặc định true nếu đang nghe/cuộn)
   * @param {boolean} [opts.prefetch] — gần đáy thì nudge load trước
   */
  function translateNewBlocksOnly(opts) {
    opts = opts || {};
    if (!isTranslateWanted()) return Promise.resolve(0);

    var silent =
      opts.silent === true ||
      (opts.silent !== false && isContinuousSession());

    var run = async function () {
      // Prefetch: gần đáy → cuộn ngầm load → rồi dịch
      if (opts.prefetch !== false && distToBottom() < 1400) {
        try {
          await nudgeLoadMore();
          await sleep(200);
        } catch (eN) {}
      }

      var blocks = collectBlocks();
      var fresh = blocks.filter(function (el) {
        return !originalMap.has(el);
      });
      if (!fresh.length) return 0;

      if (isBusy) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            translateNewBlocksOnly({ silent: silent, prefetch: false }).then(resolve);
          }, 900);
        });
      }

      isBusy = true;
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
        console.log(
          "[Translate] auto +" + fresh.length + " khối",
          silent ? "(silent)" : ""
        );
        // Không toast "Đang dịch" khi continuous / silent
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
          await sleep(20);
        }
        // Toast ngắn chỉ khi user tự cuộn (không continuous)
        if (ok && !silent) {
          window.StoryReaderUI?.toast?.("✓ Tự dịch +" + ok + " đoạn", 1800);
        }
        return ok;
      } finally {
        isBusy = false;
      }
    };

    return run();
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
    try {
      clearInterval(window.__srTrPrefetch);
    } catch (e2) {}
  }

  function startAutoTranslateObserver() {
    if (autoObs) return;
    autoObs = new MutationObserver(function () {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(function () {
        translateNewBlocksOnly({ silent: isContinuousSession(), prefetch: false });
      }, 500);
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
        translateNewBlocksOnly({ silent: isContinuousSession(), prefetch: false });
      }
    }, 1000);

    // Prefetch định kỳ khi gần đáy + đang nghe/cuộn (hoặc user gần đáy)
    clearInterval(window.__srTrPrefetch);
    window.__srTrPrefetch = setInterval(function () {
      if (!isTranslateWanted() || isBusy) return;
      var near = distToBottom() < 1600;
      if (!near) return;
      // Continuous: luôn prefetch; user thường: chỉ khi rất gần đáy
      if (isContinuousSession() || distToBottom() < 1000) {
        translateNewBlocksOnly({ silent: true, prefetch: true });
      }
    }, 1800);

    if (!window.__srTrScrollBound) {
      window.__srTrScrollBound = true;
      window.addEventListener(
        "scroll",
        function () {
          if (!isTranslateWanted()) return;
          // Nudge translate không kích hoạt lại (tránh vòng)
          if (window.__srTranslateNudge) return;
          clearTimeout(window.__srTrScrollT);
          window.__srTrScrollT = setTimeout(function () {
            if (distToBottom() < 1200) {
              translateNewBlocksOnly({
                silent: isContinuousSession(),
                prefetch: true,
              });
            }
          }, 350);
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

  }
  if (!window.StoryImageTranslate) {
/**
 * OCR + dịch chữ trong ảnh truyện tranh (Phase 1: CV bubble).
 *
 * Chỉ dùng trên manga. Không gọi từ luồng dịch text novel.
 *
 * 1) captureVisibleTab (tránh CORS CDN)
 * 2) CV threshold → bbox bubble
 * 3) OCR.space (chỉ eng — free key không nhận "vie")
 * 4) Dịch → overlay
 * Giới hạn request + dừng khi 429.
 */
(function () {
  "use strict";

  var overlays = [];
  var ocrBackoffUntil = 0;

  function clearOverlays() {
    overlays.forEach(function (el) {
      try {
        el.remove();
      } catch (e) {}
    });
    overlays = [];
  }

  function setExtUiVisible(vis) {
    ["sr-bubble", "sr-menu", "sr-tts-panel", "sr-scroll-hud", "sr-toast"].forEach(
      function (id) {
        var el = document.getElementById(id);
        if (el) el.style.visibility = vis ? "" : "hidden";
      }
    );
  }

  function runtimeOk() {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  }

  function isMangaHost() {
    var host = (location.hostname || "").toLowerCase();
    return /kagane|nettruyen|truyenqq|truyentranh|mangadex|webtoon|asura|newtruyen|comick|manhwa|manhua/.test(
      host
    );
  }

  function captureTab() {
    return new Promise(function (resolve, reject) {
      if (!runtimeOk()) return reject(new Error("context invalidated"));
      chrome.runtime.sendMessage({ type: "CAPTURE_TAB" }, function (resp) {
        if (chrome.runtime.lastError)
          return reject(new Error(chrome.runtime.lastError.message));
        if (resp && resp.ok && resp.dataUrl) resolve(resp.dataUrl);
        else reject(new Error((resp && resp.error) || "capture fail"));
      });
    });
  }

  function dataUrlToCanvas(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c);
      };
      img.onerror = function () {
        reject(new Error("decode fail"));
      };
      img.src = dataUrl;
    });
  }

  function detectBubbles(canvas) {
    var maxW = 900;
    var scale = Math.min(1, maxW / canvas.width);
    var sw = Math.max(1, Math.round(canvas.width * scale));
    var sh = Math.max(1, Math.round(canvas.height * scale));
    var small = document.createElement("canvas");
    small.width = sw;
    small.height = sh;
    var sctx = small.getContext("2d");
    sctx.drawImage(canvas, 0, 0, sw, sh);
    var img = sctx.getImageData(0, 0, sw, sh);
    var d = img.data;
    var n = sw * sh;
    var mask = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      var g = (d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) | 0;
      mask[i] = g >= 200 ? 1 : 0;
    }
    var mask2 = new Uint8Array(n);
    for (var y = 1; y < sh - 1; y++) {
      for (var x = 1; x < sw - 1; x++) {
        var p = y * sw + x;
        if (mask[p] && mask[p - 1] && mask[p + 1] && mask[p - sw] && mask[p + sw])
          mask2[p] = 1;
      }
    }
    mask = mask2;

    var visited = new Uint8Array(n);
    var boxes = [];
    var minArea = Math.max(500, (sw * sh) / 100);
    var maxArea = sw * sh * 0.4;

    for (var i = 0; i < n; i++) {
      if (!mask[i] || visited[i]) continue;
      var qx = [i % sw];
      var qy = [(i / sw) | 0];
      visited[i] = 1;
      var qi = 0;
      var minX = qx[0],
        maxX = qx[0],
        minY = qy[0],
        maxY = qy[0];
      var area = 0;
      while (qi < qx.length) {
        var cx = qx[qi];
        var cy = qy[qi];
        qi++;
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        var neigh = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (var k = 0; k < 4; k++) {
          var nx = neigh[k][0];
          var ny = neigh[k][1];
          if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
          var ni = ny * sw + nx;
          if (!mask[ni] || visited[ni]) continue;
          visited[ni] = 1;
          qx.push(nx);
          qy.push(ny);
        }
      }
      if (area < minArea || area > maxArea) continue;
      var bw = maxX - minX + 1;
      var bh = maxY - minY + 1;
      if (bw < 24 || bh < 18) continue;
      var aspect = bw / bh;
      if (aspect > 7 || aspect < 0.18) continue;
      if (area / (bw * bh) < 0.28) continue;
      var inv = 1 / scale;
      var pad = 4 * inv;
      var bx = Math.max(0, minX * inv - pad);
      var by = Math.max(0, minY * inv - pad);
      var bx2 = Math.min(canvas.width, (maxX + 1) * inv + pad);
      var by2 = Math.min(canvas.height, (maxY + 1) * inv + pad);
      boxes.push({
        x: bx | 0,
        y: by | 0,
        w: (bx2 - bx) | 0,
        h: (by2 - by) | 0,
      });
    }
    boxes.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
    // merge overlap
    var merged = [];
    boxes.forEach(function (b) {
      var hit = null;
      for (var j = 0; j < merged.length; j++) {
        var m = merged[j];
        var ox = Math.max(
          0,
          Math.min(b.x + b.w, m.x + m.w) - Math.max(b.x, m.x)
        );
        var oy = Math.max(
          0,
          Math.min(b.y + b.h, m.y + m.h) - Math.max(b.y, m.y)
        );
        if (ox * oy > 0.4 * Math.min(b.w * b.h, m.w * m.h)) {
          hit = m;
          break;
        }
      }
      if (hit) {
        var x1 = Math.min(hit.x, b.x);
        var y1 = Math.min(hit.y, b.y);
        var x2 = Math.max(hit.x + hit.w, b.x + b.w);
        var y2 = Math.max(hit.y + hit.h, b.y + b.h);
        hit.x = x1;
        hit.y = y1;
        hit.w = x2 - x1;
        hit.h = y2 - y1;
      } else merged.push(b);
    });
    if (merged.length > 6) merged = merged.slice(0, 6);
    console.log(
      "[OCR-CV] bubbles",
      merged.length,
      "on",
      canvas.width + "x" + canvas.height
    );
    return merged;
  }

  function cropToDataUrl(canvas, box) {
    var w = Math.max(1, box.w);
    var h = Math.max(1, box.h);
    var scale = w < 180 ? 2 : w < 360 ? 1.3 : w > 600 ? 600 / w : 1;
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, box.x, box.y, w, h, 0, 0, c.width, c.height);
    var q = 0.82;
    var out = c.toDataURL("image/jpeg", q);
    while (out.length > 400000 && q > 0.5) {
      q -= 0.1;
      out = c.toDataURL("image/jpeg", q);
    }
    return out;
  }

  function ocrSpaceData(dataUrl) {
    return new Promise(function (resolve, reject) {
      if (!runtimeOk()) return reject(new Error("context invalidated"));
      if (Date.now() < ocrBackoffUntil) {
        return reject(new Error("OCR rate-limit — đợi " + Math.ceil((ocrBackoffUntil - Date.now()) / 1000) + "s"));
      }
      var apiKey = "";
      try {
        apiKey = localStorage.getItem("sr-ocr-key") || "";
      } catch (e) {}
      // Chỉ eng — free OCR.space từ chối "vie" (E201)
      chrome.runtime.sendMessage(
        {
          type: "OCR_SPACE",
          dataUrl: dataUrl,
          lang: "eng",
          apiKey: apiKey,
        },
        function (resp) {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
          if (resp && resp.ok) resolve(resp.text || "");
          else {
            var err = (resp && resp.error) || "ocr fail";
            if (String(err).indexOf("429") !== -1 || String(err).indexOf("503") !== -1) {
              ocrBackoffUntil = Date.now() + 60000;
            }
            reject(new Error(err));
          }
        }
      );
    });
  }

  function translateText(text) {
    var tl = localStorage.getItem("sr-target-lang") || "vi";
    return new Promise(function (resolve) {
      if (!text || text.trim().length < 1) return resolve("");
      if (!runtimeOk()) return resolve(text);
      chrome.runtime.sendMessage(
        {
          type: "MYMEMORY_TRANSLATE",
          text: text.slice(0, 900),
          langpair: "auto|" + tl,
        },
        function (resp) {
          if (chrome.runtime.lastError) return resolve(text);
          if (resp && resp.ok) resolve(resp.translatedText || text);
          else resolve(text);
        }
      );
    });
  }

  function placeOverlayViewport(text) {
    var box = document.createElement("div");
    box.className = "sr-img-ocr-overlay";
    box.textContent = text;
    box.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:80px;max-height:42vh;" +
      "overflow:auto;z-index:2147483000;" +
      "background:rgba(13,17,23,0.94);color:#e6edf3;padding:12px 14px;" +
      "font:14px/1.5 system-ui,sans-serif;border-radius:12px;" +
      "border:1px solid rgba(0,229,255,0.5);box-sizing:border-box;" +
      "white-space:pre-wrap;";
    document.body.appendChild(box);
    overlays.push(box);
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  /**
   * @param root ignored
   * @param opts.silent — không toast (vẫn không chạy trên non-manga)
   * @param opts.force — bỏ qua check host (hiếm)
   */
  async function translateInRoot(root, opts) {
    opts = opts || {};
    clearOverlays();

    // Chặn OCR trên truyện chữ / silent gọi nhầm
    if (!opts.force && !isMangaHost()) {
      var bigImgs = 0;
      try {
        document.querySelectorAll("img").forEach(function (img) {
          if (img.closest && img.closest("[id^='sr-']")) return;
          var w = Math.max(img.naturalWidth || 0, img.clientWidth || 0);
          var h = Math.max(img.naturalHeight || 0, img.clientHeight || 0);
          if (w >= 250 && h >= 250) bigImgs++;
        });
      } catch (e0) {}
      if (bigImgs < 3) {
        if (!opts.silent) {
          window.StoryReaderUI?.toast?.(
            "Không phải trang truyện tranh — bỏ OCR",
            2500
          );
        }
        return 0;
      }
    }

    if (!opts.silent) {
      window.StoryReaderUI?.toast?.("OCR vùng đang xem (CV)…", 25000);
    }

    var lastErr = "";
    var total = 0;
    try {
      setExtUiVisible(false);
      await sleep(150);
      var shot = await captureTab();
      setExtUiVisible(true);

      var canvas = await dataUrlToCanvas(shot);
      var boxes = detectBubbles(canvas);
      if (!boxes.length) {
        // vùng giữa màn (1 crop lớn) — chỉ khi manga
        boxes = [
          {
            x: (canvas.width * 0.08) | 0,
            y: (canvas.height * 0.1) | 0,
            w: (canvas.width * 0.84) | 0,
            h: (canvas.height * 0.7) | 0,
          },
        ];
      }

      var texts = [];
      var maxCrops = Math.min(boxes.length, 4);
      for (var i = 0; i < maxCrops; i++) {
        if (Date.now() < ocrBackoffUntil) {
          lastErr = "OCR rate-limit (429) — thử lại sau 1 phút hoặc set sr-ocr-key";
          break;
        }
        try {
          var dataUrl = cropToDataUrl(canvas, boxes[i]);
          var raw = (await ocrSpaceData(dataUrl)).replace(/\r/g, "").trim();
          if (raw.length > 2) {
            texts.push(await translateText(raw));
            total++;
          }
          await sleep(400); // giảm 429
        } catch (eOne) {
          lastErr = String(eOne.message || eOne);
          console.warn("[OCR-CV] crop", lastErr);
          if (lastErr.indexOf("429") !== -1 || lastErr.indexOf("503") !== -1) break;
        }
      }

      if (texts.length) {
        placeOverlayViewport(texts.join("\n\n——\n\n"));
      }
    } catch (e) {
      setExtUiVisible(true);
      lastErr = String(e && e.message ? e.message : e);
      console.warn("[OCR-CV]", lastErr);
    }

    if (!opts.silent) {
      if (total > 0) {
        window.StoryReaderUI?.toast?.("✓ OCR dịch " + total + " vùng", 4000);
      } else {
        window.StoryReaderUI?.toast?.(
          "OCR: " + (lastErr || "không đọc được chữ").slice(0, 120),
          5000
        );
      }
    }
    return total;
  }

  window.StoryImageTranslate = {
    translateVisibleImages: function () {
      return translateInRoot(document.body, { silent: false });
    },
    translateInRoot: translateInRoot,
    clearOverlays: clearOverlays,
  };
  console.log("[Story Reader] image-translate.js loaded (capture-only CV OCR)");
})();

  }

  let toolbarVisible = false;
  let currentTheme = "dark";

  /** @type {HTMLElement|null} */
  let bubble = null;
  /** @type {HTMLElement|null} */
  let menu = null;
  /** @type {HTMLElement|null} */
  let ttsPanel = null;
  let autoScrollEnabled = false;
  let settingsOpen = false;
  let panelDragging = false;
  let menuOpen = false;
  let ttsPanelOpen = false;
  let isDragging = false;
  let highlightOn = localStorage.getItem("sr-highlight-on") !== "0";
  let highlightEnabled = highlightOn;

  /** Cập nhật nhãn menu Highlight bật/tắt */
  function syncHighlightLabel() {
    const el = document.getElementById("sr-menu-highlight-text");
    if (el) el.textContent = highlightOn ? "Tắt highlight" : "Bật highlight";
    try {
      document.documentElement.classList.toggle("sr-highlight-off", !highlightOn);
    } catch (e) {}
  }

  // ===== Create UI =====

  function ensureCtrlElements() {
    const wrap = document.querySelector(".sr-tts-controls");
    if (!wrap) return;
    const stop = document.getElementById("sr-panel-stop");
    const play = document.getElementById("sr-panel-play");
    if (stop && stop.tagName === "BUTTON") {
      const d = document.createElement("div");
      d.id = "sr-panel-stop";
      d.className = "sr-ctrl";
      d.setAttribute("role", "button");
      d.tabIndex = 0;
      d.title = "Dừng";
      d.textContent = "■";
      stop.replaceWith(d);
    }
    if (play && play.tagName === "BUTTON") {
      const d = document.createElement("div");
      d.id = "sr-panel-play";
      d.className = "sr-ctrl play";
      d.setAttribute("role", "button");
      d.tabIndex = 0;
      d.title = "Nghe TTS";
      d.textContent = "▶";
      play.replaceWith(d);
    }
  }

  function createUI() {
    // Bubble
    if (!document.getElementById("sr-bubble")) {
      bubble = document.createElement("div");
      bubble.id = "sr-bubble";
      bubble.title = "Story Reader";

      const img = document.createElement("img");
      img.src = chrome.runtime.getURL("icons/icon128.png");
      img.alt = "Story Reader";
      bubble.appendChild(img);

      document.body.appendChild(bubble);
      bubble.style.display = "none"; // chỉ hiện khi popup "Bắt đầu đọc"

      const saved = localStorage.getItem("sr-bubble-pos");
      if (saved) {
        try {
          const pos = JSON.parse(saved);
          bubble.style.left = pos.left + "px";
          bubble.style.top = pos.top + "px";
        } catch (_) {
          bubble.style.right = "12px";
          bubble.style.bottom = "100px";
        }
      } else {
        bubble.style.right = "12px";
        bubble.style.bottom = "100px";
      }
    } else {
      bubble = document.getElementById("sr-bubble");
    }

    // Mini Menu — đúng thứ tự SPEC
    if (!document.getElementById("sr-menu")) {
      menu = document.createElement("div");
      menu.id = "sr-menu";
      menu.innerHTML = `
        <button type="button" id="sr-menu-scroll">
          <span class="sr-icon">↕</span>
          <span id="sr-menu-scroll-text">Auto-scroll</span>
        </button>
        <button type="button" id="sr-menu-tts">
          <span class="sr-icon">▶</span>
          <span>Nghe TTS</span>
        </button>
        <button type="button" id="sr-menu-list">
          <span class="sr-icon">☰</span>
          <span>Danh sách câu</span>
        </button>
        <div class="sr-divider"></div>
        <button type="button" id="sr-menu-highlight">
          <span class="sr-icon">✎</span>
          <span id="sr-menu-highlight-text">Highlight</span>
        </button>
        <button type="button" id="sr-menu-translate">
          <span class="sr-icon">文A</span>
          <span id="sr-menu-translate-text">Dịch trang</span>
        </button>
        <button type="button" id="sr-menu-theme">
          <span class="sr-icon">◐</span>
          <span>Đổi theme</span>
        </button>
        <button type="button" id="sr-menu-setting">
          <span class="sr-icon">⚙</span>
          <span>Cài đặt</span>
        </button>
        <button type="button" id="sr-menu-stop" class="sr-danger">
          <span class="sr-icon">■</span>
          <span>Dừng tất cả</span>
        </button>
      `;
      document.body.appendChild(menu);
      syncHighlightLabel();
    } else {
      menu = document.getElementById("sr-menu");
    }

    // TTS Panel
    if (!document.getElementById("sr-tts-panel")) {
      ttsPanel = document.createElement("div");
      ttsPanel.id = "sr-tts-panel";
      ttsPanel.innerHTML = `
        <div class="sr-tts-header">
          <span>Danh sách câu</span>
          <button type="button" id="sr-tts-toggle-settings" title="Cài đặt giọng">⚙</button>
          <button type="button" id="sr-tts-close" title="Đóng">✕</button>
        </div>
        <div id="sr-sentence-list"></div>
        <div class="sr-panel-split" id="sr-panel-split" title="Kéo để chỉnh kích thước"></div>
        <div class="sr-tts-settings" id="sr-tts-settings">
          <div class="sr-set-group">
            <div class="sr-set-title">Giọng nói</div>
            <select id="sr-tts-engine" title="Engine TTS">
              <option value="web">Giọng máy (Windows/Chrome)</option>
              <option value="google">Google Translate (online)</option>
            </select>
            <select id="sr-voice-select" style="margin-top:8px"></select>
          </div>

          <div class="sr-set-group">
            <div class="sr-set-title">Âm thanh</div>
            <div class="sr-slider-row">
              <span class="sr-slider-label">Tốc độ đọc</span>
              <input type="range" id="sr-rate" min="0.5" max="5" step="0.1" value="1">
              <span class="sr-val" id="sr-rate-val">1.0</span>
            </div>
            <div class="sr-slider-row">
              <span class="sr-slider-label">Độ cao giọng</span>
              <input type="range" id="sr-pitch" min="0.5" max="2" step="0.1" value="1">
              <span class="sr-val" id="sr-pitch-val">1.0</span>
            </div>
            <div class="sr-slider-row">
              <span class="sr-slider-label">Ngữ cảnh</span>
              <input type="range" id="sr-context" min="0" max="4" step="1" value="2">
              <span class="sr-val" id="sr-context-val">2</span>
            </div>
            <div class="sr-slider-row">
              <span class="sr-slider-label">Tốc độ cuộn</span>
              <input type="range" id="sr-scroll-speed" min="40" max="280" step="5" value="135">
              <span class="sr-val" id="sr-scroll-speed-val">135</span>
            </div>
          </div>

          <div class="sr-set-group">
            <div class="sr-set-title">Dịch thuật</div>
            <div class="sr-color-row" style="flex-direction:column;align-items:stretch;gap:6px">
              <span class="sr-slider-label">Ngôn ngữ đích</span>
              <select id="sr-target-lang" class="sr-select" style="width:100%">
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
                <option value="zh-CN">中文 (简体)</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="es">Español</option>
                <option value="th">ไทย</option>
                <option value="id">Indonesia</option>
              </select>
            </div>
          </div>

          <div class="sr-set-group">
            <div class="sr-set-title">Giao diện</div>
            <div class="sr-color-row">
              <span class="sr-slider-label">Màu tô văn bản</span>
              <label class="sr-color-swatch" for="sr-highlight-color">
                <input type="color" id="sr-highlight-color" value="#ffe650">
              </label>
            </div>
            <div class="sr-color-row" style="margin-top:10px">
              <span class="sr-slider-label">Tự next chương</span>
              <label class="sr-switch" title="Hết chương tự mở chương sau">
                <input type="checkbox" id="sr-auto-next" checked>
                <span class="sr-switch-ui"></span>
              </label>
            </div>
          </div>

          <div role="button" tabindex="0" class="sr-save-btn" id="sr-save-settings">Lưu cài đặt</div>
        </div>
        <div class="sr-tts-footer">
          <div class="sr-goto-row">
            <input type="text" id="sr-goto" placeholder="Go to # / tìm câu…" title="Nhập số câu hoặc một đoạn chữ để nhảy">
            <button type="button" id="sr-goto-btn" title="Nhảy tới">↵</button>
          </div>
          <div class="sr-tts-progress" id="sr-progress">0 / 0</div>
          <div class="sr-tts-controls">
            <div role="button" tabindex="0" class="sr-ctrl" id="sr-panel-stop" title="Dừng">■</div>
            <div role="button" tabindex="0" class="sr-ctrl play" id="sr-panel-play" title="Nghe TTS">▶</div>
          </div>
        </div>
      `;
      document.body.appendChild(ttsPanel);
    } else {
      ttsPanel = document.getElementById("sr-tts-panel");
    }
  }

  // ===== Bubble Drag & Dock =====
  // ===== Kagane-style scroll HUD =====
  let scrollHud = null;
  let scrollHudVisible = false;

  function createScrollHud() {
    if (document.getElementById("sr-scroll-hud")) {
      scrollHud = document.getElementById("sr-scroll-hud");
      positionScrollHud();
      return;
    }
    scrollHud = document.createElement("div");
    scrollHud.id = "sr-scroll-hud";
    scrollHud.innerHTML = `
      <button type="button" id="sr-hud-pause" title="Tạm dừng / Tiếp tục" aria-label="Pause">▶</button>
      <button type="button" id="sr-hud-minus" title="Giảm tốc độ">−</button>
      <div id="sr-hud-speed"><strong>135</strong><small>px/s</small></div>
      <button type="button" id="sr-hud-plus" title="Tăng tốc độ">+</button>
      <div id="sr-hud-status"></div>
      <button type="button" id="sr-hud-close" title="Tắt auto-scroll">✕</button>
    `;
    document.body.appendChild(scrollHud);
    positionScrollHud();

    document.getElementById("sr-hud-pause")?.addEventListener("click", () => {
      // ⏸ = tạm dừng GIỮ nguyên (không tự resume 3s). User cuộn tay mới pause+resume 3s.
      window.StoryTTS?.toggleAutoScrollPause?.(0);
    });
    document.getElementById("sr-hud-minus")?.addEventListener("click", () => {
      window.StoryTTS?.adjustScrollSpeed?.(-15);
    });
    document.getElementById("sr-hud-plus")?.addEventListener("click", () => {
      window.StoryTTS?.adjustScrollSpeed?.(15);
    });
    document.getElementById("sr-hud-close")?.addEventListener("click", () => {
      // HUD ✕ = tắt auto-scroll hẳn
      autoScrollEnabled = false;
      try {
        window.StoryTTS.stopAutoScroll();
      } catch (e) {}
      const textEl = document.getElementById("sr-menu-scroll-text");
      if (textEl) textEl.textContent = "Auto-scroll";
      hideScrollHud();
      updateBubbleActive();
    });
    scrollHud.addEventListener("mouseenter", () => {
      clearTimeout(hudFadeTimer);
      scrollHud.classList.remove("sr-faded");
    });
    scrollHud.addEventListener("mouseleave", () => {
      if (autoScrollEnabled) scheduleHudFade();
    });
  }

  function positionScrollHud() {
    if (!scrollHud || !bubble) return;
    const br = bubble.getBoundingClientRect();
    const hudW = 52;
    const gap = 12; // khoảng cách với bubble
    const edgePad = 16; // không sát mép màn hình
    const hudH = scrollHud.offsetHeight || 168;

    // Căn giữa theo bubble, phía TRÊN
    let left = br.left + (br.width - hudW) / 2;
    left = Math.max(edgePad, Math.min(left, window.innerWidth - hudW - edgePad));

    let top = br.top - hudH - gap;
    if (top < edgePad) {
      // không đủ chỗ phía trên → đặt dưới bubble
      top = br.bottom + gap;
    }
    top = Math.max(edgePad, Math.min(top, window.innerHeight - hudH - edgePad));

    scrollHud.style.left = left + "px";
    scrollHud.style.top = top + "px";
    scrollHud.style.right = "auto";
    scrollHud.style.bottom = "auto";
    scrollHud.style.transform = "none";
  }

  function showScrollHud() {
    createScrollHud();
    scrollHud?.classList.add("sr-visible");
    scrollHudVisible = true;
    positionScrollHud();
  }

  function hideScrollHud() {
    clearTimeout(hudFadeTimer);
    if (scrollHud) {
      scrollHud.classList.remove("sr-visible", "sr-faded");
      scrollHud.style.opacity = "";
    }
    scrollHudVisible = false;
  }

  let hudFadeTimer = null;

  function scheduleHudFade() {
    clearTimeout(hudFadeTimer);
    scrollHud?.classList.remove("sr-faded");
    hudFadeTimer = setTimeout(() => {
      if (scrollHudVisible && scrollHud) scrollHud.classList.add("sr-faded");
    }, 2000);
  }

  function updateScrollHud(state) {
    if (!state) return;
    if (state.active) showScrollHud();
    else {
      hideScrollHud();
      return;
    }
    createScrollHud();
    scrollHud?.classList.remove("sr-faded");
    const speedEl = document.getElementById("sr-hud-speed");
    const statusEl = document.getElementById("sr-hud-status");
    const pauseBtn = document.getElementById("sr-hud-pause");
    if (speedEl) {
      const px = state.pxPerSec || 135;
      speedEl.innerHTML = "<strong>" + px + "</strong><small>px/s</small>";
    }
    if (statusEl) {
      if (state.paused && state.resumeIn > 0) {
        statusEl.textContent = state.resumeIn + "s";
      } else if (state.paused) {
        statusEl.textContent = "Paused";
      } else {
        statusEl.textContent = "";
      }
    }
    if (pauseBtn) {
      pauseBtn.textContent = state.paused ? "▶" : "⏸";
      pauseBtn.title = state.paused ? "Tiếp tục" : "Tạm dừng";
    }
    // Keep fully visible while paused or counting down; else fade
    if (state.paused) {
      clearTimeout(hudFadeTimer);
      scrollHud?.classList.remove("sr-faded");
    } else {
      scheduleHudFade();
    }
  }

  let bubbleIdleTimer = null;

  /**
   * Sau ~2.5s không hover/kéo:
   * - Màn hẹp (≤640): class sr-idle-dim → chỉ giảm opacity (vẫn thấy + bấm được).
   * - Desktop: class sr-idle-hide → trượt nửa bubble vào mép (cần dock trái/phải).
   * Không cần đang dock để mờ trên màn hẹp.
   */
  function scheduleBubbleIdle() {
    clearTimeout(bubbleIdleTimer);
    if (!bubble) return;
    bubble.classList.remove("sr-idle-hide", "sr-idle-dim");
    bubbleIdleTimer = setTimeout(function () {
      if (!bubble) return;
      if (menuOpen || ttsPanelOpen) return;
      if (bubble.classList.contains("sr-dragging")) return;
      if (bubble.style.display === "none") return;
      var vs = viewportSize();
      if (vs.w <= 640) {
        bubble.classList.add("sr-idle-dim");
        return;
      }
      // Desktop half-hide: tự gán dock theo vị trí nếu thiếu class
      var rect = bubble.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      if (!bubble.classList.contains("sr-docked-left") && !bubble.classList.contains("sr-docked-right")) {
        if (centerX < vs.w / 2) bubble.classList.add("sr-docked-left");
        else bubble.classList.add("sr-docked-right");
      }
      bubble.classList.add("sr-idle-hide");
    }, 2500);
  }

  function wakeBubble() {
    bubble?.classList.remove("sr-idle-hide", "sr-idle-dim");
    scheduleBubbleIdle();
  }

  function viewportSize() {
    const vv = window.visualViewport;
    return {
      w: (vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 360,
      h: (vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 640,
    };
  }

  function initBubbleDrag() {
    bubble?.addEventListener("mouseenter", wakeBubble);
    bubble?.addEventListener("mouseleave", scheduleBubbleIdle);

    let startX, startY, startLeft, startTop;
    let moved = false;
    let activePointer = null;

    const onStart = (e) => {
      if (!bubble || bubble.style.display === "none") return;
      // Chỉ nhận nút trái / touch
      if (e.type === "mousedown" && e.button !== 0) return;
      if (e.type === "touchstart" && e.touches.length > 1) return;

      wakeBubble();
      isDragging = true;
      moved = false;
      activePointer = e.type;
      bubble.classList.add("sr-dragging");
      bubble.classList.remove("sr-idle-hide", "sr-idle-dim", "sr-docked-left", "sr-docked-right");
      bubble.style.transition = "none";
      bubble.style.transform = "none";

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const rect = bubble.getBoundingClientRect();
      startX = clientX;
      startY = clientY;
      startLeft = rect.left;
      startTop = rect.top;

      // Ép dùng left/top tuyệt đối (tránh right:0 + dock làm mất hit-area khi F12)
      bubble.style.left = startLeft + "px";
      bubble.style.top = startTop + "px";
      bubble.style.right = "auto";
      bubble.style.bottom = "auto";

      if (e.type === "touchstart") e.preventDefault();
    };

    const onMove = (e) => {
      if (!isDragging || !bubble) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      if (clientX == null) return;

      const dx = clientX - startX;
      const dy = clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;

      const vs = viewportSize();
      const size = 44;
      let newLeft = startLeft + dx;
      let newTop = startTop + dy;
      newLeft = Math.max(0, Math.min(vs.w - size, newLeft));
      newTop = Math.max(0, Math.min(vs.h - size, newTop));

      bubble.style.left = newLeft + "px";
      bubble.style.top = newTop + "px";
      bubble.style.right = "auto";
      bubble.style.bottom = "auto";
      bubble.style.transform = "none";

      if (e.cancelable) e.preventDefault();
    };

    const onEnd = (e) => {
      if (!isDragging) return;
      isDragging = false;
      bubble.classList.remove("sr-dragging");
      bubble.style.transition = "";

      if (!moved) {
        // Click: giữ vị trí hiện tại, mở menu — không dock nửa màn hình
        restoreDockClass();
        toggleMenu();
        scheduleBubbleIdle();
        return;
      }

      dockBubble();
      saveBubblePos();
      positionScrollHud();
      scheduleBubbleIdle();
    };

    // ensure transform cleared path exists

    bubble.addEventListener("mousedown", onStart);
    bubble.addEventListener("touchstart", onStart, { passive: false });

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
  }

  function restoreDockClass() {
    if (!bubble) return;
    const rect = bubble.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    bubble.style.transform = "";
    bubble.classList.remove("sr-docked-left", "sr-docked-right");
    if (centerX < window.innerWidth / 2) {
      bubble.classList.add("sr-docked-left");
    } else {
      bubble.classList.add("sr-docked-right");
    }
  }

  function dockBubble() {
    const rect = bubble.getBoundingClientRect();
    const vs = viewportSize();
    const centerX = rect.left + rect.width / 2;
    const isLeft = centerX < vs.w / 2;
    // Mobile hẹp: mép 10px; desktop: 0 để half-hide hoạt động
    const edge = vs.w <= 480 ? 10 : 0;

    bubble.classList.remove("sr-docked-left", "sr-docked-right", "sr-idle-hide");
    // Xóa transform inline (nếu còn) để CSS idle-hide chạy được
    bubble.style.transform = "";
    bubble.style.transition = "";

    if (isLeft) {
      bubble.style.left = edge + "px";
      bubble.style.right = "auto";
      bubble.classList.add("sr-docked-left");
    } else {
      bubble.style.left = "auto";
      bubble.style.right = edge + "px";
      bubble.classList.add("sr-docked-right");
    }
    let top = rect.top;
    top = Math.max(8, Math.min(top, vs.h - 52));
    bubble.style.top = top + "px";
    bubble.style.bottom = "auto";
  }

  function saveBubblePos() {
    positionScrollHud();
    const rect = bubble.getBoundingClientRect();
    localStorage.setItem(
      "sr-bubble-pos",
      JSON.stringify({ left: rect.left, top: rect.top })
    );
  }

  // ===== Menu =====
  function toggleMenu() {
    if (menuOpen) closeMenu();
    else openMenu();
  }

  function openMenu() {
    wakeBubble();
    // Mobile: kéo bubble vào trong viewport trước khi mở menu
    if (bubble && (window.innerWidth <= 640 || "ontouchstart" in window)) {
      bubble.classList.remove("sr-idle-hide", "sr-idle-dim", "sr-docked-left", "sr-docked-right");
      const br = bubble.getBoundingClientRect();
      if (br.right > window.innerWidth - 8 || br.width < 30) {
        bubble.style.left = "auto";
        bubble.style.right = "12px";
        bubble.style.top = Math.min(br.top, window.innerHeight - 80) + "px";
        bubble.style.bottom = "auto";
      }
    }
    const rect = bubble.getBoundingClientRect();
    const menuWidth = Math.min(196, window.innerWidth - 24);
    const edge = 12;
    const gap = 10;

    let left = rect.left + rect.width / 2 - menuWidth / 2;
    if (rect.right > window.innerWidth - 40) {
      left = Math.min(left, window.innerWidth - menuWidth - edge);
    }
    if (rect.left < 40) {
      left = Math.max(left, edge);
    }
    left = Math.max(edge, Math.min(left, window.innerWidth - menuWidth - edge));

    // Ưu tiên menu phía trên bubble nếu đủ chỗ, không tràn mép
    const menuH = 280;
    if (rect.top > menuH + 20) {
      menu.style.top = rect.top - gap + "px";
      menu.style.transformOrigin = "bottom center";
      menu.style.transform = "translateY(-100%) scale(0.95)";
    } else {
      menu.style.top = Math.min(rect.bottom + gap, window.innerHeight - menuH - 8) + "px";
      menu.style.transformOrigin = "top center";
      menu.style.transform = "scale(0.95)";
    }

    menu.style.left = left + "px";
    menu.style.width = menuWidth + "px";
    menu.classList.add("sr-open");
    menuOpen = true;

    requestAnimationFrame(() => {
      menu.style.transform = menu.style.transform.replace(
        "scale(0.95)",
        "scale(1)"
      );
    });
  }

  function closeMenu() {
    scheduleBubbleIdle();
    menu.classList.remove("sr-open");
    menuOpen = false;
  }

  // ===== TTS Panel =====
  function initPanelSplit() {
    const split = document.getElementById("sr-panel-split");
    const settings = document.getElementById("sr-tts-settings");
    const list = document.getElementById("sr-sentence-list");
    if (!split || !settings || !list || split.dataset.bound) return;
    split.dataset.bound = "1";

    let dragging = false;

    const onMove = (e) => {
      if (!dragging || !ttsPanel) return;
      const rect = ttsPanel.getBoundingClientRect();
      const footer = ttsPanel.querySelector(".sr-tts-footer");
      const header = ttsPanel.querySelector(".sr-tts-header");
      const footerH = footer ? footer.offsetHeight : 70;
      const headerH = header ? header.offsetHeight : 48;
      const splitH = 10;
      const available = rect.height - headerH - footerH - splitH;
      const settingsBottom = rect.bottom - footerH;
      let settingsH = settingsBottom - e.clientY;
      // list tối thiểu ~80px, settings tối thiểu ~120px
      settingsH = Math.max(120, Math.min(available - 80, settingsH));
      // Chỉ đổi viewport height — nội dung bên trong giữ size, cuộn được
      settings.style.flex = "0 0 auto";
      settings.style.height = settingsH + "px";
      settings.style.maxHeight = settingsH + "px";
      settings.style.minHeight = "120px";
      settings.style.overflowY = "auto";
      settings.style.overflowX = "hidden";
      list.style.flex = "1 1 auto";
      list.style.minHeight = "80px";
      list.style.overflowY = "auto";
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      split.classList.remove("sr-dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    split.addEventListener("mousedown", (e) => {
      if (!settings.classList.contains("sr-open")) return;
      dragging = true;
      e.preventDefault();
      split.classList.add("sr-dragging");
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function openTtsPanel(openSettings) {
    ttsPanel.classList.add("sr-open");
    ttsPanelOpen = true;
    initPanelSplit();
    closeMenu();
    buildSentenceList();
    populateVoices();
    loadSettingsUI();

    if (openSettings) {
      settingsOpen = true;
      const settings = document.getElementById("sr-tts-settings");
      settings?.classList.add("sr-open");
      document.getElementById("sr-panel-split")?.classList.add("sr-show");
      // Chiều cao mặc định ~40% panel — nội dung cuộn bên trong
      if (settings && ttsPanel && !settings.style.height) {
        const h = Math.round(ttsPanel.getBoundingClientRect().height * 0.42);
        settings.style.height = Math.max(160, h) + "px";
        settings.style.overflowY = "auto";
        settings.style.overflowX = "hidden";
      }
    }
  }

  function closeTtsPanel() {
    ttsPanel.classList.remove("sr-open");
    ttsPanelOpen = false;
    document.getElementById("sr-tts-settings")?.classList.remove("sr-open");
    settingsOpen = false;
  }

  function toggleTtsSettings() {
    const el = document.getElementById("sr-tts-settings");
    if (!el) return;
    settingsOpen = !settingsOpen;
    el.classList.toggle("sr-open", settingsOpen);
    const split = document.getElementById("sr-panel-split");
    if (split) split.classList.toggle("sr-show", settingsOpen);
    document.getElementById("sr-tts-toggle-settings")?.classList.toggle("sr-on", settingsOpen);
    if (settingsOpen && ttsPanel) {
      if (!el.style.height) {
        const h = Math.round(ttsPanel.getBoundingClientRect().height * 0.42);
        el.style.height = Math.max(160, h) + "px";
      }
      el.style.overflowY = "auto";
      el.style.overflowX = "hidden";
    }
  }

  // ===== Sentence List =====
  function buildSentenceList() {
    const list = document.getElementById("sr-sentence-list");
    if (!list) return;

    const sentences = window.StoryTTS?.getSentences?.() || [];
    list.innerHTML = "";

    if (!sentences.length) {
      const empty = document.createElement("div");
      empty.className = "sr-empty";
      empty.textContent = "Chưa có nội dung. Bấm Nghe TTS trên trang truyện để bắt đầu.";
      list.appendChild(empty);
      updateProgress();
      return;
    }

    sentences.forEach((s, i) => {
      const item = document.createElement("div");
      item.className = "sr-sentence-item";
      item.dataset.index = i;
      item.innerHTML = `
        <span class="sr-idx">${i + 1}</span>
        <span class="sr-text"></span>
      `;
      item.querySelector(".sr-text").textContent = s;
      item.addEventListener("click", () => {
        window.StoryTTS?.jumpTo?.(i);
      });
      list.appendChild(item);
    });
    updateProgress();
  }

  function updateProgress() {
    const el = document.getElementById("sr-progress");
    if (!el || !window.StoryTTS) return;
    const total = window.StoryTTS.getSentences?.()?.length || 0;
    // Đã stop hẳn → 0/N; đang nghe hoặc pause → index+1
    const active =
      window.StoryTTS.isSessionActive?.() || window.StoryTTS.isPlaying?.();
    const current = active
      ? (window.StoryTTS.getCurrentIndex?.() || 0) + 1
      : 0;
    el.textContent = `${Math.min(current, total)} / ${total}`;
  }

  function highlightSentenceInPanel(index) {
    document.querySelectorAll(".sr-sentence-item").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.index) === index);
    });
    const active = document.querySelector(".sr-sentence-item.active");
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    updateProgress();
  }

  // ===== Voices =====
  function syncEngineUI() {
    const eng = document.getElementById("sr-tts-engine");
    const voice = document.getElementById("sr-voice-select");
    if (!eng || !voice) return;
    const isGoogle = eng.value === "google";
    voice.style.display = isGoogle ? "none" : "";
    let note = document.getElementById("sr-google-note");
    if (isGoogle) {
      if (!note) {
        note = document.createElement("div");
        note.id = "sr-google-note";
        note.className = "sr-google-note";
        note.textContent = "Không cần API key · dùng endpoint công khai Google Translate · có thể bị chặn/giới hạn";
        voice.parentNode.insertBefore(note, voice.nextSibling);
      }
      note.style.display = "";
    } else if (note) {
      note.style.display = "none";
    }
  }

  function populateVoices() {
    const select = document.getElementById("sr-voice-select");
    if (!select || !window.speechSynthesis) return;

    const voices = speechSynthesis.getVoices() || [];
    const prev = select.value;
    select.innerHTML = "";

    function groupOf(v) {
      const n = (v.name || "").toLowerCase();
      const lang = (v.lang || "").toLowerCase();
      if (lang.startsWith("vi")) {
        if (n.includes("microsoft") || n.includes("hoaimy") || n.includes("namminh") || n.includes(" an"))
          return "Giọng Microsoft (Việt)";
        if (n.includes("google")) return "Giọng Google (Việt)";
        return "Giọng Việt khác";
      }
      if (n.includes("microsoft") || n.includes("natural")) return "Microsoft (khác)";
      if (n.includes("google")) return "Google (khác)";
      if (lang.startsWith("en")) return "English";
      return "Giọng trình duyệt khác";
    }

    const groups = {};
    voices.forEach((v) => {
      const g = groupOf(v);
      (groups[g] = groups[g] || []).push(v);
    });

    const order = [
      "Giọng Microsoft (Việt)",
      "Giọng Google (Việt)",
      "Giọng Việt khác",
      "English",
      "Microsoft (khác)",
      "Google (khác)",
      "Giọng trình duyệt khác",
    ];

    order.forEach((gName) => {
      const list = groups[gName];
      if (!list || !list.length) return;
      list.sort((a, b) => a.name.localeCompare(b.name));
      const og = document.createElement("optgroup");
      og.label = gName;
      list.forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.voiceURI;
        // Gọn label: bỏ phần dài trong ngoặc nếu tên đã đủ
        let label = v.name || v.voiceURI;
        // Gọn: bỏ "Microsoft " prefix dài nếu có
        label = label.replace(/^Microsoft\s+/i, "");
        if (label.length > 28) label = label.slice(0, 26) + "…";
        if (v.lang) {
          const shortLang = (v.lang || "").split("-")[0];
          if (shortLang && !label.toLowerCase().includes(shortLang.toLowerCase())) {
            label += " · " + shortLang;
          }
        }
        opt.textContent = label;
        og.appendChild(opt);
      });
      select.appendChild(og);
    });

    // note: Bing / Google Cloud / TikTok cần API riêng — chỉ hiện giọng trình duyệt
    const saved = localStorage.getItem("sr-voice-uri") || prev;
    if (saved && [...select.options].some((o) => o.value === saved)) {
      select.value = saved;
    }
  }

  // ===== Settings persistence =====
  function loadSettingsUI() {
    const langSel = document.getElementById("sr-target-lang");
    if (langSel) {
      langSel.value = localStorage.getItem("sr-target-lang") || "vi";
      langSel.onchange = function () {
        localStorage.setItem("sr-target-lang", langSel.value);
      };
    }

    const rate = localStorage.getItem("sr-rate") || "1";
    const pitch = localStorage.getItem("sr-pitch") || "1";
    const context = localStorage.getItem("sr-context") || "2";
    const scroll = localStorage.getItem("sr-scroll-px") || "135";
    const hlColor = localStorage.getItem("sr-highlight-color") || "#ffe650";

    const autoNextEl = document.getElementById("sr-auto-next");
    if (autoNextEl) {
      autoNextEl.checked = localStorage.getItem("sr-auto-next") !== "0";
    }
    const engEl = document.getElementById("sr-tts-engine");
    if (engEl) {
      engEl.value = localStorage.getItem("sr-tts-engine") || "web";
    }
    syncEngineUI();

    const rateEl = document.getElementById("sr-rate");
    const pitchEl = document.getElementById("sr-pitch");
    const contextEl = document.getElementById("sr-context");
    const scrollEl = document.getElementById("sr-scroll-speed");
    const colorEl = document.getElementById("sr-highlight-color");

    if (rateEl) {
      rateEl.value = rate;
      const v = document.getElementById("sr-rate-val");
      if (v) v.textContent = rate;
    }
    if (pitchEl) {
      pitchEl.value = pitch;
      const v = document.getElementById("sr-pitch-val");
      if (v) v.textContent = pitch;
    }
    if (contextEl) {
      contextEl.value = context;
      const v = document.getElementById("sr-context-val");
      if (v) v.textContent = context;
    }
    if (scrollEl) {
      scrollEl.value = scroll;
      const v = document.getElementById("sr-scroll-speed-val");
      if (v) v.textContent = scroll;
    }
    if (colorEl) {
      colorEl.value = hlColor;
      applyHighlightColor(hlColor);
    }

    const voiceURI = localStorage.getItem("sr-voice-uri");
    if (voiceURI) {
      const sel = document.getElementById("sr-voice-select");
      if (sel) sel.value = voiceURI;
      window.StoryTTS?.setVoice?.(voiceURI);
    }

    // Apply to TTS engine
    if (window.StoryTTS) {
      window.StoryTTS.setRate?.(parseFloat(rate));
      window.StoryTTS.setPitch?.(parseFloat(pitch));
      window.StoryTTS.contextLevel = parseInt(context, 10);
      window.StoryTTS.scrollSpeed = parseFloat(scroll);
    }
  }

  function saveSettings() {
    const autoNext = document.getElementById("sr-auto-next")?.checked !== false;
    localStorage.setItem("sr-auto-next", autoNext ? "1" : "0");
    if (window.StoryTTS) window.StoryTTS.autoNextChapter = autoNext;

    const rate = document.getElementById("sr-rate")?.value || "1";
    const pitch = document.getElementById("sr-pitch")?.value || "1";
    const context = document.getElementById("sr-context")?.value || "2";
    const scroll = document.getElementById("sr-scroll-speed")?.value || "1";
    const hlColor = document.getElementById("sr-highlight-color")?.value || "#ffe650";

    localStorage.setItem("sr-rate", rate);
    localStorage.setItem("sr-pitch", pitch);
    localStorage.setItem("sr-context", context);
    localStorage.setItem("sr-scroll-px", scroll);
    localStorage.setItem("sr-highlight-color", hlColor);
    const langSel = document.getElementById("sr-target-lang");
    if (langSel && langSel.value) {
      localStorage.setItem("sr-target-lang", langSel.value);
    }
    const voiceURI = document.getElementById("sr-voice-select")?.value;
    if (voiceURI) localStorage.setItem("sr-voice-uri", voiceURI);

    if (window.StoryTTS) {
      window.StoryTTS.setRate?.(parseFloat(rate));
      window.StoryTTS.setPitch?.(parseFloat(pitch));
      window.StoryTTS.contextLevel = parseInt(context, 10);
      window.StoryTTS.scrollSpeed = parseFloat(scroll);
    }
    applyHighlightColor(hlColor);

    const btn = document.getElementById("sr-save-settings");
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Đã lưu ✓";
      btn.classList.add("sr-saved");
      setTimeout(() => {
        btn.textContent = prev;
        btn.classList.remove("sr-saved");
      }, 1400);
    }
  }

  function applyHighlightColor(hex) {
    if (!hex || hex[0] !== "#" || hex.length < 7) hex = "#ffe650";
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const val = `rgba(${r}, ${g}, ${b}, 0.45)`;
    // Set cả html + body để theme light không đè lại
    document.documentElement.style.setProperty("--sr-highlight", val);
    document.body.style.setProperty("--sr-highlight", val);
    const colorEl = document.getElementById("sr-highlight-color");
    if (colorEl && colorEl.value !== hex) colorEl.value = hex;
  }

  // ===== Theme =====
  /** Gán theme lên UI extension only — không class lên body (tránh vỡ layout host). */
  function applyThemeClass() {
    const on = currentTheme === "light";
    try {
      document.body.classList.toggle("sr-theme-light", on);
      document.documentElement.classList.toggle("sr-theme-light", on);
    } catch (e) {}
    ["sr-bubble", "sr-menu", "sr-tts-panel", "sr-scroll-hud", "sr-toast"].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("sr-theme-light", on);
    });
  }

  function toggleTheme() {
    try {
      currentTheme = currentTheme === "dark" ? "light" : "dark";
      localStorage.setItem("sr-theme", currentTheme);
      // Áp dụng mượt: 2 frame để CSS transition chạy
      requestAnimationFrame(function () {
        applyThemeClass();
        const hex = localStorage.getItem("sr-highlight-color") || "#ffe650";
        applyHighlightColor(hex);
      });
      window.StoryReaderUI?.toast?.(
        currentTheme === "light" ? "Theme sáng" : "Theme tối",
        1500
      );
    } catch (err) {
      console.warn("[SR] toggleTheme", err);
    }
  }

  function loadTheme() {
    const saved = localStorage.getItem("sr-theme") || "dark";
    currentTheme = saved;
    // legacy cleanup
    try {
      document.body.classList.remove("sr-theme-light");
    } catch (e) {}
    applyThemeClass();
    const hex = localStorage.getItem("sr-highlight-color") || "#ffe650";
    applyHighlightColor(hex);
  }

  // ===== Events =====
  function bindEvents() {
    document.getElementById("sr-menu-scroll")?.addEventListener("click", () => {
      autoScrollEnabled = !autoScrollEnabled;
      const textEl = document.getElementById("sr-menu-scroll-text");
      if (textEl)
        textEl.textContent = autoScrollEnabled
          ? "Tắt auto-scroll"
          : "Auto-scroll";
      if (window.StoryTTS) {
        if (autoScrollEnabled) {
          window.StoryTTS.startAutoScroll?.();
          showScrollHud();
          updateScrollHud({
            active: true,
            paused: false,
            pxPerSec: window.StoryTTS.getScrollPxPerSec?.() || 135,
            resumeIn: 0,
          });
        } else {
          // Tắt auto-scroll từ menu = stop hẳn
          window.StoryTTS.stopAutoScroll?.();
          hideScrollHud();
        }
      }
      updateBubbleActive();
      closeMenu();
    });

    document.getElementById("sr-menu-tts")?.addEventListener("click", () => {
      closeMenu();
      const playing = window.StoryTTS?.isPlaying?.();
      const paused =
        !playing &&
        window.StoryTTS?.getSentences?.()?.length &&
        window.StoryTTS?.getCurrentIndex != null;

      // Đang phát → chỉ pause, KHÔNG mở list / không start lại
      if (playing) {
        window.StoryTTS.pause();
        syncPlayButton();
        updateBubbleActive();
        return;
      }

      // Đang pause → resume đúng chỗ
      if (window.StoryTTS?.getSentences?.()?.length) {
        // Kiểm tra isPaused qua toggle (resume)
        const idx = window.StoryTTS.getCurrentIndex?.() ?? 0;
        if (idx >= 0) {
          window.StoryTTS.togglePlay?.();
          syncPlayButton();
          updateBubbleActive();
          return;
        }
      }

      // Bắt đầu mới: tắt scroll, mở panel, nghe từ viewport
      if (autoScrollEnabled) {
        autoScrollEnabled = false;
        window.StoryTTS?.stopAutoScroll?.();
        hideScrollHud();
        const textEl = document.getElementById("sr-menu-scroll-text");
        if (textEl) textEl.textContent = "Auto-scroll";
      }
      openTtsPanel(false);
      setTimeout(() => {
        window.StoryTTS?.startFromPage?.();
        buildSentenceList();
        syncPlayButton();
        updateBubbleActive();
      }, 80);
    });

    document.getElementById("sr-menu-list")?.addEventListener("click", () => {
      openTtsPanel(false);
      buildSentenceList();
      closeMenu();
    });

    document
      .getElementById("sr-menu-highlight")
      ?.addEventListener("click", () => {
        highlightEnabled = !highlightEnabled;
        highlightOn = highlightEnabled;
        localStorage.setItem("sr-highlight-on", highlightOn ? "1" : "0");
        syncHighlightLabel();
        if (window.StoryTTS)
          window.StoryTTS.highlightEnabled = highlightEnabled;
        closeMenu();
      });


    document.getElementById("sr-menu-translate")?.addEventListener("click", async () => {
      closeMenu();
      const label = document.getElementById("sr-menu-translate-text");
      if (!window.StoryTranslator || !window.StoryImageTranslate) {
        try {
          await new Promise(function (resolve) {
            chrome.runtime.sendMessage({ type: "INJECT_MODULES" }, function () {
              resolve();
            });
          });
          await new Promise(function (r) { setTimeout(r, 200); });
        } catch (eInj) {}
      }
      if (!window.StoryTranslator) {
        console.warn("[SR] StoryTranslator missing after inject");
        toast("Module dịch chưa load. chrome://extensions → Reload → F5");
        return;
      }
      // Đã dịch → toggle gốc/dịch
      if (window.StoryTranslator.isTranslated?.() || (label && label.textContent.indexOf("gốc") !== -1)) {
        window.StoryTranslator.toggleOriginal();
        if (label) {
          const showingOrig = !window.StoryTranslator.isTranslated?.();
          label.textContent = showingOrig ? "Xem bản dịch" : "Xem bản gốc";
        }
        return;
      }
      if (label) label.textContent = "Đang dịch…";

      // Truyện tranh (nettruyen / kagane…): OCR ảnh
      var host = (location.hostname || "").toLowerCase();
      var isMangaHost =
        /kagane|nettruyen|truyenqq|truyentranh|mangadex|webtoon|asura|newtruyen|comick|manhwa|manhua/.test(
          host
        );
      if (isMangaHost) {
        if (!window.StoryImageTranslate) {
          toast("Module OCR chưa load — Reload extension", 3500);
          if (label) label.textContent = "Dịch trang";
          return;
        }
        toast("Truyện tranh — OCR ảnh…", 15000);
        try {
          var n = await window.StoryImageTranslate.translateInRoot(null, {
            loose: true,
            silent: false,
          });
          if (label) label.textContent = n > 0 ? "Xem bản gốc" : "Dịch trang";
          if (n > 0) {
            try {
              sessionStorage.setItem("sr-translate-wanted", "1");
            } catch (e) {}
          }
          return;
        } catch (e) {
          console.warn("[SR] manga OCR", e);
          toast("OCR lỗi: " + (e.message || e), 4000);
          if (label) label.textContent = "Dịch trang";
          return;
        }
      }

      const ok = await window.StoryTranslator.translatePage(
        localStorage.getItem("sr-target-lang") || "vi"
      );
      if (label) label.textContent = ok ? "Xem bản gốc" : "Dịch trang";
    });


    document.getElementById("sr-menu-theme")?.addEventListener("click", () => {
      toggleTheme();
      closeMenu();
    });

    document
      .getElementById("sr-menu-setting")
      ?.addEventListener("click", () => {
        openTtsPanel(true);
      });

    document.getElementById("sr-menu-stop")?.addEventListener("click", () => {
      // Dừng HẲN: TTS + auto-scroll + dịch + tắt cờ tự dịch
      autoScrollEnabled = false;
      try {
        window.StoryTranslator?.abort?.();
        window.StoryTranslator?.clearTranslateWanted?.();
      } catch (e) {}
      try {
        window.StoryImageTranslate?.clearOverlays?.();
      } catch (e) {}
      try {
        sessionStorage.removeItem("sr-translate-wanted");
      } catch (e) {}
      const textEl = document.getElementById("sr-menu-scroll-text");
      if (textEl) textEl.textContent = "Auto-scroll";
      if (window.StoryTTS) {
        window.StoryTTS.stopAutoScroll();
        window.StoryTTS.stop();
        setTimeout(function () {
          window.StoryTTS.stopAutoScroll();
          window.StoryTTS.stop();
          updateProgress();
          syncPlayButton();
        }, 50);
      }
      updateProgress();
      hideScrollHud();
      syncPlayButton();
      updateBubbleActive();
      closeMenu();
    });

    document
      .getElementById("sr-tts-close")
      ?.addEventListener("click", closeTtsPanel);
    document
      .getElementById("sr-tts-toggle-settings")
      ?.addEventListener("click", toggleTtsSettings);
    document
      .getElementById("sr-panel-play")
      ?.addEventListener("click", () => {
        // Bật nghe → tắt auto-scroll
        if (autoScrollEnabled && !window.StoryTTS?.isPlaying?.()) {
          autoScrollEnabled = false;
          window.StoryTTS?.stopAutoScroll?.();
          hideScrollHud();
          const textEl = document.getElementById("sr-menu-scroll-text");
          if (textEl) textEl.textContent = "Auto-scroll";
        }
        window.StoryTTS?.togglePlay?.();
        setTimeout(() => {
          buildSentenceList();
          syncPlayButton();
          updateBubbleActive();
        }, 150);
      });

    // role=button keyboard
    ["sr-panel-stop", "sr-panel-play", "sr-save-settings"].forEach((id) => {
      document.getElementById(id)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.currentTarget.click();
        }
      });
    });

    const doGoto = () => {
      const q = document.getElementById("sr-goto")?.value || "";
      const ok = window.StoryTTS?.jumpToByQuery?.(q);
      if (ok) {
        buildSentenceList();
        syncPlayButton();
        updateBubbleActive();
      } else if (q.trim()) {
        const inp = document.getElementById("sr-goto");
        if (inp) {
          inp.style.borderColor = "#ff3b6b";
          setTimeout(() => { inp.style.borderColor = ""; }, 800);
        }
      }
    };
    document.getElementById("sr-goto-btn")?.addEventListener("click", doGoto);
    document.getElementById("sr-goto")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doGoto();
      }
    });

    document.getElementById("sr-panel-stop")
      ?.addEventListener("click", () => {
        autoScrollEnabled = false;
        try {
          window.StoryTTS.stopAutoScroll();
        } catch (e) {}
        window.StoryTTS?.stop?.();
        hideScrollHud();
        updateProgress();
        syncPlayButton();
        updateBubbleActive();
      });

    document.getElementById("sr-auto-next")?.addEventListener("change", (e) => {
      const on = !!e.target.checked;
      localStorage.setItem("sr-auto-next", on ? "1" : "0");
      if (window.StoryTTS) window.StoryTTS.autoNextChapter = on;
    });
    document.getElementById("sr-tts-engine")?.addEventListener("change", (e) => {
      const v = e.target.value === "google" ? "google" : "web";
      localStorage.setItem("sr-tts-engine", v);
      if (window.StoryTTS) window.StoryTTS.ttsEngine = v;
      syncEngineUI();
    });

    document.getElementById("sr-rate")?.addEventListener("input", (e) => {
      document.getElementById("sr-rate-val").textContent = e.target.value;
      window.StoryTTS?.setRate?.(parseFloat(e.target.value));
    });
    document.getElementById("sr-pitch")?.addEventListener("input", (e) => {
      document.getElementById("sr-pitch-val").textContent = e.target.value;
      window.StoryTTS?.setPitch?.(parseFloat(e.target.value));
    });
    document.getElementById("sr-context")?.addEventListener("input", (e) => {
      document.getElementById("sr-context-val").textContent = e.target.value;
      if (window.StoryTTS)
        window.StoryTTS.contextLevel = parseInt(e.target.value, 10);
    });
    document
      .getElementById("sr-scroll-speed")
      ?.addEventListener("input", (e) => {
        document.getElementById("sr-scroll-speed-val").textContent =
          e.target.value;
        window.StoryTTS?.setScrollPxPerSec?.(parseFloat(e.target.value));
      });
    document
      .getElementById("sr-voice-select")
      ?.addEventListener("change", (e) => {
        localStorage.setItem("sr-voice-uri", e.target.value);
        window.StoryTTS?.setVoice?.(e.target.value);
      });
    document
      .getElementById("sr-highlight-color")
      ?.addEventListener("input", (e) => {
        applyHighlightColor(e.target.value);
      });
    document
      .getElementById("sr-save-settings")
      ?.addEventListener("click", saveSettings);

    document.addEventListener("click", (e) => {
      if (
        menuOpen &&
        !menu.contains(e.target) &&
        !bubble.contains(e.target)
      ) {
        closeMenu();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (ttsPanelOpen) closeTtsPanel();
        else if (menuOpen) closeMenu();
      }
    });

    if (window.speechSynthesis) {
      speechSynthesis.onvoiceschanged = populateVoices;
    }

    /**
     * User cuộn lên/xuống khi đang auto-scroll → tạm dừng ~3s rồi tự cuộn lại.
     * - wheel / touchmove: LUÔN coi là user (scrollBy không tạo wheel).
     * - event scroll: chỉ xử lý khi KHÔNG phải programmatic
     *   (vì scrollTop do ta set cũng fire scroll, và cờ programmatic
     *    bị reset timeout liên tục nên không tin cậy nếu check trên wheel).
     * Nút "Dừng" vẫn stop hẳn (stopAutoScroll) — không đi qua hàm này.
     */
    let userScrollTimer = null;
    function onUserScrollIntent(fromScrollEvent) {
      var engineOn = !!window.StoryTTS?.autoScrollEnabled;
      if (!autoScrollEnabled && !engineOn) return;
      // Chỉ event "scroll" mới cần lọc programmatic
      if (window.__srTranslateNudge) return;
      if (fromScrollEvent && window.StoryTTS?.isProgrammaticScroll?.()) return;
      window.StoryTTS?.pauseAutoScroll?.(3);
      clearTimeout(userScrollTimer);
      userScrollTimer = setTimeout(function () {
        if (window.StoryTTS?.autoScrollEnabled) {
          window.StoryTTS.resumeAutoScroll?.();
        }
      }, 3000);
    }
    window.addEventListener(
      "wheel",
      function () {
        onUserScrollIntent(false);
      },
      { passive: true, capture: true }
    );
    document.addEventListener(
      "scroll",
      function () {
        onUserScrollIntent(true);
      },
      { passive: true, capture: true }
    );
    var touchPauseArmed = false;
    window.addEventListener(
      "touchstart",
      function () {
        touchPauseArmed = true;
      },
      { passive: true }
    );
    window.addEventListener(
      "touchmove",
      function () {
        if (!touchPauseArmed) return;
        touchPauseArmed = false;
        onUserScrollIntent(false);
      },
      { passive: true }
    );
  }

  function syncPlayButton() {
    const playing = !!window.StoryTTS?.isPlaying?.();
    const btn = document.getElementById("sr-panel-play");
    if (btn) {
      if (playing) {
        btn.textContent = "⏸";
        btn.title = "Tạm dừng";
        btn.classList.add("sr-playing");
      } else {
        btn.textContent = "▶";
        btn.title = "Nghe TTS";
        btn.classList.remove("sr-playing");
      }
    }
    // Menu item
    const menuTts = document.querySelector("#sr-menu-tts span:last-child");
    const menuIcon = document.querySelector("#sr-menu-tts .sr-icon");
    if (menuTts) menuTts.textContent = playing ? "Tạm dừng" : "Nghe TTS";
    if (menuIcon) menuIcon.textContent = playing ? "⏸" : "▶";
    document.getElementById("sr-menu-tts")?.classList.toggle("sr-active-item", playing);
  }

  function updateBubbleActive() {
    const playing =
      window.StoryTTS?.isPlaying?.() ||
      autoScrollEnabled ||
      false;
    bubble?.classList.toggle("sr-active", !!playing);
  }

  // ===== Public API =====
  /**
   * Toast giữa màn hình — msg + thời gian hiện (ms).
   * Dịch xong dùng ~4.5s; tiến trình dùng lâu hơn.
   */
  function toast(msg, durationMs) {
    let el = document.getElementById("sr-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "sr-toast";
      document.body.appendChild(el);
    }
    el.textContent = String(msg || "");
    el.classList.add("sr-show");
    clearTimeout(toast._t);
    var ms = typeof durationMs === "number" ? durationMs : 3200;
    toast._t = setTimeout(function () {
      el.classList.remove("sr-show");
    }, ms);
  }

  window.StoryReaderUI = {
    toast: toast,
    showToolbar() { showToolbar(); },
    hideToolbar() { hideToolbar(); },
    openTtsPanel,
    closeTtsPanel,
    buildSentenceList,
    highlightSentenceInPanel,
    updateProgress,
    setPlaying(isPlaying) {
      bubble?.classList.toggle("sr-active", !!isPlaying || autoScrollEnabled);
      syncPlayButton();
    },
    setScrolling(isScrolling) {
      autoScrollEnabled = isScrolling;
      const textEl = document.getElementById("sr-menu-scroll-text");
      if (textEl)
        textEl.textContent = isScrolling
          ? "Tắt auto-scroll"
          : "Auto-scroll";
      updateBubbleActive();
    },
    onScrollState(state) {
      if (state && state.active) {
        autoScrollEnabled = true;
        const textEl = document.getElementById("sr-menu-scroll-text");
        if (textEl) textEl.textContent = "Tắt auto-scroll";
        updateScrollHud(state);
      } else {
        autoScrollEnabled = false;
        const textEl = document.getElementById("sr-menu-scroll-text");
        if (textEl) textEl.textContent = "Auto-scroll";
        hideScrollHud();
      }
      updateBubbleActive();
    },
  };

  function showToolbar() {
    toolbarVisible = true;
    createUI();
    if (!bubble) bubble = document.getElementById("sr-bubble");
    if (!menu) menu = document.getElementById("sr-menu");
    if (menu) menu.style.display = "";
    if (bubble) {
      bubble.style.display = "flex";
      // Hiện rõ khi vừa bật; scheduleBubbleIdle sẽ mờ/half-hide sau 2.5s
      bubble.classList.remove("sr-idle-hide", "sr-idle-dim");
      if (!localStorage.getItem("sr-bubble-pos")) {
        bubble.style.right = "12px";
        bubble.style.bottom = "100px";
        bubble.style.left = "auto";
        bubble.style.top = "auto";
        dockBubble();
      } else {
        restoreDockClass();
      }
      wakeBubble(); // bắt đầu đếm idle → dim / half-hide
    }
    applyThemeClass();
    if (bubble && !bubble.dataset.srDragBound) {
      ensureCtrlElements();
      initBubbleDrag();
      bubble.dataset.srDragBound = "1";
    }
  }

  function hideToolbar() {
    toolbarVisible = false;
    closeMenu();
    closeTtsPanel();
    window.StoryTTS?.stop?.();
    window.StoryTTS?.stopAutoScroll?.();
    hideScrollHud();
    if (bubble) bubble.style.display = "none";
    if (menu) menu.style.display = "none";
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "SHOW_TOOLBAR") {
      showToolbar();
      sendResponse?.({ ok: true });
    } else if (msg.type === "HIDE_TOOLBAR") {
      hideToolbar();
      sendResponse?.({ ok: true });
    }
    return true;
  });

  // ===== Init =====
  function init() {
    createUI(); // bubble display:none cho đến khi popup bật

    // Không bind drag / không hiện bubble — chờ SHOW_TOOLBAR
    bindEvents();
    loadTheme();
    loadSettingsUI();

    // Nếu user đã từng bật trong session này (optional: không auto)
    console.log(
      "[Story Reader] UI ready — chờ popup Bắt đầu đọc",
      "| translator:",
      !!window.StoryTranslator,
      "| ocr:",
      !!window.StoryImageTranslate
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
