// content-scripts/tts-engine.js
// Giai đoạn 1–2: TTS queue + highlight + rate/pitch + jump + auto-scroll cơ bản

(function () {
  "use strict";

  let currentUtterances = [];
  let currentIndex = 0;
  let isPaused = false;
  let isSpeaking = false;
  let selectedVoiceURI = null;
  let currentVoiceName = "";
  let rate = Math.max(0.5, Math.min(5, parseFloat(localStorage.getItem("sr-rate") || "1") || 1));
  let pitch = parseFloat(localStorage.getItem("sr-pitch") || "1") || 1;
  let highlightEnabled = true;
  let autoNextChapter = localStorage.getItem("sr-auto-next") !== "0";
  let ttsEngine = localStorage.getItem("sr-tts-engine") || "web"; // web | google
  let googleAudio = null;
  let wakeLockSentinel = null;
  let speakGeneration = 0;
  let pendingSpeakTimer = null;
  let autoScrollEnabled = false;
  let scrollSpeed = parseFloat(localStorage.getItem("sr-scroll-speed") || "1") || 1;
  let contextLevel = parseInt(localStorage.getItem("sr-context") || "2", 10);
  let pageLang = "vi";
  let autoScrollTimer = null;

  /* ---------- helpers ---------- */
  function isNoiseSentence(s) {
    if (!s || s.length < 6) return true;
    // UI / ads / webnovel chrome
    if (
      /load failed|please retry|retry gifts?|send gift|wanna gift|weekly power|power ranking|power stone|gift received|comment\s*\d|\bvote\b|\bshare\b|sign in|đăng nhập|theo dõi|bình luận|cookie|subscribe|add to library|table of contents|mục lục|previous chapter|next chapter|^chapter\s*\d+$/i.test(
        s
      )
    )
      return true;
    // quá nhiều chữ hoa kiểu UI
    var letters = s.replace(/[^a-zA-Zà-ỹÀ-Ỹ]/g, "");
    if (letters.length > 12) {
      var up = (s.match(/[A-Z]/g) || []).length;
      if (up / letters.length > 0.55 && s.length < 80) return true;
    }
    return false;
  }

  function splitIntoSentences(text) {
    if (!text) return [];
    const normalized = text
      .replace(/\r\n/g, "\n")
      .replace(/\s+/g, " ")
      .trim();
    const raw =
      normalized.match(/[^.!?…]+[.!?…]+["'”’)]?|[^.!?…]+$/g) || [normalized];
    return raw
      .map(function (s) {
        s = s.trim();
        // Bỏ số thứ tự đầu câu (1. 2) 7 8…) để list không bị "7 7…"
        s = s.replace(/^\d{1,3}[\.\)\:]\s+/, "");
        s = s.replace(/^\d{1,3}(?=[A-ZÀ-Ỵ"«“])/, "");
        s = s.replace(/^\d{1,3}\s+/, "");
        return s.trim();
      })
      .filter(function (s) {
        return s.length > 5 && !isNoiseSentence(s);
      });
  }

  function getAllVoices() {
    try {
      return speechSynthesis.getVoices() || [];
    } catch {
      return [];
    }
  }

  function detectPageLanguage(text) {
    if (!text) return "vi";
    const vietChars = (
      text.match(
        /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi
      ) || []
    ).length;
    const totalLetters = (
      text.match(
        /[a-zA-Zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g
      ) || []
    ).length;
    if (totalLetters === 0) return "vi";
    return vietChars / totalLetters > 0.03 ? "vi" : "en";
  }

  function getBestVoice(lang) {
    const voices = getAllVoices();
    if (!voices.length) return null;

    if (selectedVoiceURI) {
      const chosen = voices.find((v) => v.voiceURI === selectedVoiceURI);
      if (chosen) return chosen;
    }

    if (lang === "en") {
      const preferredEn = [
        "Google US English",
        "Microsoft Aria",
        "Microsoft Guy",
        "Samantha",
        "Alex",
        "Google UK English",
      ];
      for (const name of preferredEn) {
        const found = voices.find((v) => v.name.includes(name));
        if (found) return found;
      }
      return voices.find((v) => v.lang.toLowerCase().startsWith("en")) || voices[0];
    }

    const preferredVi = [
      "Microsoft HoaiMy",
      "Microsoft NamMinh",
      "Microsoft An",
      "Google Tiếng Việt",
      "Google Vietnamese",
      "An",
      "Linh",
      "My",
    ];
    for (const name of preferredVi) {
      const found = voices.find((v) => v.name.includes(name));
      if (found) return found;
    }
    return voices.find((v) => v.lang.toLowerCase().startsWith("vi")) || null;
  }

  /* ---------- highlight (sentence spans) ---------- */
  let wrapped = false;

  function getContentRoot() {
    const selectors = [
      ".cha-content",
      ".chapter_content",
      ".novel-content",
      "div.entry-content",
      "article .post-content",
      ".chapter-content",
      "#chapter-content",
      "article",
      "main",
      "#content",
    ];
    for (let i = 0; i < selectors.length; i++) {
      const el = document.querySelector(selectors[i]);
      if (el && (el.innerText || "").trim().length > 80) return el;
    }
    return document.body;
  }

  function clearPageHighlight() {
    document.querySelectorAll(".sr-sent.sr-on").forEach((el) => {
      el.classList.remove("sr-on");
    });
    document.querySelectorAll(".sr-page-highlight").forEach((el) => {
      el.classList.remove("sr-page-highlight");
    });
  }

  function unwrapSentences() {
    document.querySelectorAll("span.sr-sent").forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    });
    wrapped = false;
  }

  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest("[id^='sr-']") || p.closest("#sr-bubble") || p.closest("#sr-menu") || p.closest("#sr-tts-panel"))
          return NodeFilter.FILTER_REJECT;
        if (p.closest("span.sr-sent")) return NodeFilter.FILTER_REJECT; // đã wrap
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA")
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function wrapSentencesInPage(sentences) {
    unwrapSentences();
    if (!sentences || !sentences.length) return;
    const root = getContentRoot();
    if (!root) return;

    // Wrap từng câu, refresh text nodes sau mỗi lần (tránh lệch câu 1/2)
    for (let i = 0; i < sentences.length; i++) {
      const full = (sentences[i] || "").trim();
      if (full.length < 2) continue;

      // Thử nhiều độ dài key: dài → ngắn để khớp chính xác
      const tryKeys = [];
      if (full.length <= 60) tryKeys.push(full);
      tryKeys.push(full.slice(0, Math.min(40, full.length)));
      tryKeys.push(full.slice(0, Math.min(28, full.length)));
      tryKeys.push(full.slice(0, Math.min(16, full.length)));

      const textNodes = collectTextNodes(root);
      let done = false;
      for (let k = 0; k < tryKeys.length && !done; k++) {
        const key = tryKeys[k].trim();
        if (key.length < 4) continue;
        for (let n = 0; n < textNodes.length; n++) {
          const node = textNodes[n];
          if (!node.parentNode) continue;
          const val = node.nodeValue;
          const idx = val.indexOf(key);
          if (idx === -1) continue;
          // end = khớp đúng độ dài câu trong node, không +8 tràn sang câu sau
          let end = idx + full.length;
          // Nếu full không nằm gọn trong node, cắt theo key + phần còn lại tới dấu câu
          if (end > val.length) {
            end = idx + key.length;
            // kéo tới dấu kết câu nếu có trong node
            const slice = val.slice(end);
            const m = slice.match(/^[^.!?…]*[.!?…""」』]/);
            if (m) end += m[0].length;
            else end = Math.min(val.length, idx + Math.max(key.length, Math.min(full.length, val.length - idx)));
          }
          // Không vượt quá node
          end = Math.min(val.length, end);
          // Tránh nuốt sang câu kế nếu key ngắn: giới hạn max ~ full.length
          if (end - idx > full.length + 4) end = idx + full.length;
          if (end <= idx) continue;
          if (wrapRangeInNode(node, idx, end, i)) {
            done = true;
            break;
          }
        }
      }
    }
    wrapped = true;
  }

  function wrapRangeInNode(textNode, start, end, sentenceIndex) {
    try {
      const val = textNode.nodeValue;
      if (start < 0 || end > val.length || start >= end) return false;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const span = document.createElement("span");
      span.className = "sr-sent";
      span.dataset.srIdx = String(sentenceIndex);
      range.surroundContents(span);
      return true;
    } catch (e) {
      return false;
    }
  }

  function highlightAndScroll(index) {
    if (window.StoryReaderUI?.highlightSentenceInPanel) {
      window.StoryReaderUI.highlightSentenceInPanel(index);
    }
    if (window.StoryReaderUI?.updateProgress) {
      window.StoryReaderUI.updateProgress();
    }

    if (!highlightEnabled) {
      clearPageHighlight();
      return;
    }

    clearPageHighlight();

    let el = document.querySelector('span.sr-sent[data-sr-idx="' + index + '"]');
    if (!el) {
      const sentence = currentUtterances[index];
      if (sentence) {
        const key = sentence.slice(0, 28).trim();
        document.querySelectorAll("span.sr-sent").forEach((s) => {
          if (!el && (s.textContent || "").includes(key)) el = s;
        });
        // Fallback: tìm text node trên trang và bọc tạm
        if (!el && key.length >= 6) {
          el = highlightByTextSearch(key, sentence, index);
        }
      }
    }

    if (el) {
      el.classList.add("sr-on");
      if ((isSpeaking && !isPaused) || autoScrollEnabled) {
        try {
          el.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest",
          });
        } catch (e) {}
      }
    }
  }

  function highlightByTextSearch(key, full, index) {
    const root = getContentRoot();
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || p.closest("[id^='sr-']")) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const val = node.nodeValue;
      let idx = val.indexOf(key);
      if (idx === -1) {
        const short = key.slice(0, Math.min(18, key.length));
        idx = val.indexOf(short);
        if (idx === -1) continue;
      }
      try {
        const end = Math.min(val.length, idx + Math.min(full.length, 120));
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, end);
        const span = document.createElement("span");
        span.className = "sr-sent sr-on";
        span.dataset.srIdx = String(index);
        range.surroundContents(span);
        return span;
      } catch (e) {
        // parent paragraph highlight fallback
        const p = node.parentElement;
        if (p) {
          p.classList.add("sr-page-highlight");
          return p;
        }
      }
    }
    return null;
  }


  /* ---------- auto next chapter ---------- */
  function findNextChapterLink() {
    var host = (location.hostname || "").toLowerCase();
    var path = location.pathname || "";

    // --- nguontruyen: select episode + nút Chapter sau ---
    if (host.indexOf("nguontruyen") !== -1) {
      var sel = document.querySelector("select.selectEpisode.episodeLink, select.episodeLink");
      if (sel && sel.options && sel.selectedIndex >= 0 && sel.selectedIndex < sel.options.length - 1) {
        var nextOpt = sel.options[sel.selectedIndex + 1];
        var val = nextOpt && (nextOpt.value || nextOpt.getAttribute("value"));
        if (val && val !== "#" && !String(val).startsWith("javascript:")) {
          return { __srNavigate: val };
        }
      }
      // Nút UI của site (href="#" nhưng có handler jQuery)
      var nextBtn =
        document.querySelector(".choiceBox .item.next2 a") ||
        document.querySelector(".choiceBox .item.next a") ||
        document.querySelector(".choiceBox2 .item.next2 a");
      if (nextBtn) return nextBtn;
    }

    // 1. rel=next
    var rel = document.querySelector('a[rel="next"]');
    if (rel && rel.href && !rel.href.startsWith("javascript:")) {
      if (isLikelySameStory(rel.href, path)) return rel;
    }

    // 2. Selector phổ biến (lọc cùng truyện)
    var selectors = [
      "a#next_chap",
      "a.btn-next",
      "a.chapter-next",
      "a.next-chapter",
      "a.next_page",
      "a[class*='next-chap']",
      "a[class*='chapter-next']",
      ".nav-next a",
      ".chapter-nav a.next",
      "#next a",
      "a#next",
    ];
    for (var si = 0; si < selectors.length; si++) {
      var el = document.querySelector(selectors[si]);
      if (!el) continue;
      var href = el.getAttribute("href") || "";
      if (!href || href === "#" || href.startsWith("javascript:")) {
        // nút JS
        if ((el.innerText || "").length < 40) return el;
        continue;
      }
      if (isLikelySameStory(href, path)) return el;
    }

    // 3. Keyword trên text (tránh link "Đọc truyện" / truyện đề xuất)
    var keywords = [
      /^\\s*chương\\s*sau\\s*$/i,
      /^\\s*chuong\\s*sau\\s*$/i,
      /^\\s*chapter\\s*sau\\s*$/i,
      /^\\s*next\\s*chapter\\s*$/i,
      /^\\s*chapter\\s*next\\s*$/i,
      /^\\s*next\\s*$/i,
      /^\\s*tiếp(\\s*theo)?\\s*$/i,
      /^\\s*chap\\s*sau\\s*$/i,
      /chương\\s*sau/i,
      /chapter\\s*sau/i,
    ];
    var candidates = Array.from(
      document.querySelectorAll("a[href], button, [role='link'], [role='button']")
    );
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      // bỏ khối truyện đề xuất
      if (c.closest(".relation-movie, .relation-movie-mobile, .list-movies, .movie-item, .watch-movie, .caption-movie1"))
        continue;
      if (c.classList && c.classList.contains("watch-movie")) continue;
      var t = (c.innerText || c.textContent || c.getAttribute("aria-label") || "").trim();
      if (!t || t.length > 48) continue;
      if (/đọc\\s*truyện|xem\\s*thêm|truyện\\s*khác/i.test(t)) continue;
      var sc = 0;
      for (var k = 0; k < keywords.length; k++) {
        if (keywords[k].test(t)) sc += keywords[k].source.indexOf("^") === 0 ? 15 : 8;
      }
      var cls = ((c.className || "") + " " + (c.id || "")).toLowerCase();
      if (/next|sau|tiep/.test(cls)) sc += 3;
      if (/prev|truoc|previous|back/.test(cls + " " + t)) sc -= 25;
      var href2 = c.getAttribute("href") || "";
      if (c.tagName === "A" && href2 && href2 !== "#" && !href2.startsWith("javascript:")) {
        if (!isLikelySameStory(href2, path)) sc -= 30;
        else sc += 5;
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    if (bestScore >= 8) return best;

    // 4. Dropdown chương chung
    var selects = document.querySelectorAll(
      "select.selectEpisode, select.episodeLink, select[name*='chapter' i], select[id*='chapter' i], select[class*='chapter' i]"
    );
    for (var s = 0; s < selects.length; s++) {
      var se = selects[s];
      if (!se.options || se.selectedIndex < 0) continue;
      if (se.selectedIndex >= se.options.length - 1) continue;
      var opt = se.options[se.selectedIndex + 1];
      var ov = opt && (opt.value || "");
      if (ov && ov !== "#" && !String(ov).startsWith("javascript:")) {
        // chỉ nhận nếu value là URL cùng truyện hoặc id chương
        if (ov.indexOf("/") !== -1 || ov.indexOf("chap") !== -1 || /^\\d+$/.test(ov)) {
          return { __srNavigate: ov, __srSelect: se, __srNextIndex: se.selectedIndex + 1 };
        }
      }
      return { __srSelect: se, __srNextIndex: se.selectedIndex + 1 };
    }
    return null;
  }

  function isLikelySameStory(href, path) {
    try {
      var u = new URL(href, location.href);
      // cùng host
      if (u.hostname && location.hostname && u.hostname !== location.hostname) {
        // subdomain ok nếu cùng root
        if (u.hostname.replace(/^www\\./, "") !== location.hostname.replace(/^www\\./, ""))
          return false;
      }
      var hp = u.pathname || "";
      // id kiểu nt74720
      var idm = (path || "").match(/nt\\d+/i);
      if (idm && hp.indexOf(idm[0]) !== -1) return true;
      // slug chung: bỏ phần -N-chXXXX.html
      var base = (path || "").replace(/-\\d+-ch\\d+.*$/i, "").replace(/\\.html?$/i, "");
      var base2 = hp.replace(/-\\d+-ch\\d+.*$/i, "").replace(/\\.html?$/i, "");
      if (base && base2 && (base2.indexOf(base) !== -1 || base.indexOf(base2) !== -1)) return true;
      // cùng thư mục doc-truyen + nhiều segment trùng
      var segs = base.split("/").filter(Boolean);
      var segs2 = base2.split("/").filter(Boolean);
      if (segs.length && segs2.length) {
        var last = segs[segs.length - 1];
        if (last && last.length > 8 && segs2[segs2.length - 1].indexOf(last.slice(0, 12)) !== -1)
          return true;
      }
      // relative chapter ?id=
      if (href.indexOf("chapter") !== -1 || href.indexOf("chuong") !== -1) return true;
      return false;
    } catch (e) {
      return true;
    }
  }

  function goNextChapter(mode) {
    // mode: "tts" | "scroll" — trang mới tiếp tục đúng hành vi
    const el = findNextChapterLink();
    if (!el) {
      console.log("[TTS] Không tìm thấy nút chương sau");
      window.StoryReaderUI?.toast?.("Không tìm thấy chương sau");
      return false;
    }
    try {
      sessionStorage.setItem("sr-continue-mode", mode === "scroll" ? "scroll" : "tts");
      sessionStorage.setItem("sr-auto-next", autoNextChapter ? "1" : "0");
      // legacy
      if (mode === "tts") sessionStorage.setItem("sr-continue-tts", "1");
      else sessionStorage.removeItem("sr-continue-tts");
    } catch (e) {}
    // URL trực tiếp (option value)
    if (el && el.__srNavigate) {
      var nav = el.__srNavigate;
      console.log("[TTS] Next chapter navigate →", nav);
      try {
        if (el.__srSelect && el.__srNextIndex != null) {
          el.__srSelect.selectedIndex = el.__srNextIndex;
          el.__srSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch (e) {}
      window.location.href = nav;
      return true;
    }
    // select only
    if (el && el.__srSelect) {
      var sel = el.__srSelect;
      var ni = el.__srNextIndex;
      console.log("[TTS] Next chapter via <select> index", ni);
      sel.selectedIndex = ni;
      var opt = sel.options[ni];
      var ov = opt && opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      if (ov && String(ov).indexOf("/") !== -1) {
        window.location.href = ov;
      }
      return true;
    }
    console.log("[TTS] Next chapter (" + (mode || "tts") + ") →", el.href || el);
    // href="#" → click để site JS xử lý (nguontruyen)
    if (el.tagName === "A") {
      var h = el.getAttribute("href") || "";
      if (h && h !== "#" && !h.startsWith("javascript:")) {
        window.location.href = el.href;
      } else {
        el.click();
      }
    } else {
      el.click();
    }
    return true;
  }


  function clearPendingSpeak() {
    if (pendingSpeakTimer) {
      clearTimeout(pendingSpeakTimer);
      pendingSpeakTimer = null;
    }
  }

  function bumpSpeakGeneration() {
    speakGeneration++;
    clearPendingSpeak();
  }

  function stopGoogleAudio() {
    if (googleAudio) {
      try {
        googleAudio.pause();
        googleAudio.src = "";
      } catch (e) {}
      googleAudio = null;
    }
  }

  function speakGoogle(text, lang) {
    return new Promise(function (resolve, reject) {
      stopGoogleAudio();
      var chunk = (text || "").slice(0, 180);
      var tl = lang || "vi";

      function playFromBlob(blob) {
        var url = URL.createObjectURL(blob);
        var audio = new Audio(url);
        googleAudio = audio;
        audio.playbackRate = Math.max(0.6, Math.min(2, rate));
        audio.onended = function () {
          try {
            URL.revokeObjectURL(url);
          } catch (e) {}
          googleAudio = null;
          resolve();
        };
        audio.onerror = function () {
          try {
            URL.revokeObjectURL(url);
          } catch (e) {}
          googleAudio = null;
          reject(new Error("google-tts-play-error"));
        };
        audio.play().catch(reject);
      }

      // 1) Background fetch (tránh CORS trên page)
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage(
            { type: "GOOGLE_TTS", text: chunk, lang: tl },
            function (resp) {
              if (chrome.runtime.lastError) {
                console.warn("[TTS] bg msg error", chrome.runtime.lastError.message);
                tryDirect();
                return;
              }
              if (resp && resp.ok && resp.base64) {
                try {
                  var bin = atob(resp.base64);
                  var arr = new Uint8Array(bin.length);
                  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                  playFromBlob(new Blob([arr], { type: resp.mime || "audio/mpeg" }));
                } catch (e) {
                  reject(e);
                }
              } else {
                console.warn("[TTS] Google bg fail:", resp && resp.error);
                tryDirect();
              }
            }
          );
          return;
        }
      } catch (e) {
        console.warn("[TTS] no chrome.runtime", e);
      }
      tryDirect();

      function tryDirect() {
        // 2) Fallback Audio trực tiếp (thường bị CORS)
        var url =
          "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=" +
          encodeURIComponent(chunk) +
          "&tl=" +
          encodeURIComponent(tl);
        var audio = new Audio(url);
        googleAudio = audio;
        audio.playbackRate = Math.max(0.6, Math.min(2, rate));
        audio.onended = function () {
          googleAudio = null;
          resolve();
        };
        audio.onerror = function () {
          googleAudio = null;
          reject(new Error("google-tts-error"));
        };
        audio.play().catch(function (err) {
          googleAudio = null;
          reject(err || new Error("google-tts-error"));
        });
      }
    });
  }


  async function requestWakeLock() {
    try {
      if (!("wakeLock" in navigator)) return;
      if (wakeLockSentinel) return;
      wakeLockSentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinel.addEventListener("release", function () {
        wakeLockSentinel = null;
      });
      console.log("[SR] Wake Lock on");
    } catch (e) {
      console.warn("[SR] Wake Lock failed", e);
    }
  }

  function releaseWakeLock() {
    try {
      if (wakeLockSentinel) {
        wakeLockSentinel.release();
        wakeLockSentinel = null;
        console.log("[SR] Wake Lock off");
      }
    } catch (e) {}
  }

  // Re-acquire when tab visible again during play/scroll
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && (isSpeaking || autoScrollEnabled)) {
      requestWakeLock();
    }
  });

  /* ---------- speak queue ---------- */
  function speakNext() {
    if (isPaused) return;
    if (currentIndex >= currentUtterances.length) {
      isSpeaking = false;
      setTimeout(clearPageHighlight, 800);
      window.StoryReaderUI?.setPlaying?.(false);
      console.log("[TTS] Đã đọc hết hàng đợi");
      if (isInfiniteScrollHost()) {
        // Webnovel: tải thêm chapter trên cùng trang → đọc tiếp phần mới
        setTimeout(function () {
          continueInfiniteReading();
        }, 800);
        return;
      }
      if (autoNextChapter) {
        setTimeout(function () {
          goNextChapter("tts");
        }, 600);
      }
      return;
    }

    isSpeaking = true;
    requestWakeLock();
    window.StoryReaderUI?.setPlaying?.(true);
    // TTS đang chạy → tắt auto-scroll liên tục nếu có
    if (autoScrollEnabled) {
      stopAutoScroll();
    }
    highlightAndScroll(currentIndex);

    const text = currentUtterances[currentIndex];

    const gen = speakGeneration;
    const afterSentence = function () {
      // Đã stop/pause sau khi xếp câu này → bỏ qua
      if (gen !== speakGeneration || isPaused || !isSpeaking) return;
      currentIndex++;
      var baseGap =
        contextLevel <= 0 ? 15 : 20 + contextLevel * 45;
      var delay = Math.max(10, Math.round(baseGap / Math.max(1, rate)));
      clearPendingSpeak();
      if (delay > 0) {
        pendingSpeakTimer = setTimeout(function () {
          pendingSpeakTimer = null;
          if (gen !== speakGeneration || isPaused || !isSpeaking) return;
          speakNext();
        }, delay);
      } else {
        speakNext();
      }
    };

    // --- Google Translate TTS (free) ---
    if (ttsEngine === "google") {
      const lang = pageLang === "en" ? "en" : "vi";
      currentVoiceName = "Google TTS (free)";
      // Tắt hẳn Web Speech để không bị chồng giọng
      try {
        speechSynthesis.cancel();
      } catch (e) {}
      speakGoogle(text, lang)
        .then(afterSentence)
        .catch(function (err) {
          if (gen !== speakGeneration || isPaused || !isSpeaking) return;
          console.warn("[TTS] Google fail, fallback Web Speech (1 câu):", err);
          try {
            speechSynthesis.cancel();
          } catch (e) {}
          stopGoogleAudio();
          var utterFb = new SpeechSynthesisUtterance(text);
          utterFb.rate = rate;
          utterFb.pitch = pitch;
          utterFb.lang = lang === "en" ? "en-US" : "vi-VN";
          var v = getBestVoice(pageLang);
          if (v) {
            utterFb.voice = v;
            utterFb.lang = v.lang;
          }
          utterFb.onend = function () {
            if (gen !== speakGeneration) return;
            afterSentence();
          };
          utterFb.onerror = function () {
            if (gen !== speakGeneration) return;
            afterSentence();
          };
          try {
            speechSynthesis.speak(utterFb);
          } catch (e2) {
            afterSentence();
          }
        });
      return;
    }

    // --- Web Speech API ---
    stopGoogleAudio(); // đảm bảo không còn audio Google
    try {
      speechSynthesis.cancel();
    } catch (e) {}
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = rate;
    utter.pitch = pitch;

    const voice = getBestVoice(pageLang);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
      currentVoiceName = voice.name;
    } else {
      utter.lang = pageLang === "en" ? "en-US" : "vi-VN";
    }

    utter.onend = afterSentence;

    utter.onerror = (e) => {
      if (e.error === "interrupted" || e.error === "canceled") return;
      console.error("[TTS] error:", e.error);
      afterSentence();
    };

    try {
      speechSynthesis.speak(utter);
    } catch (err) {
      console.error("[TTS] speak failed:", err);
      afterSentence();
    }
  }

  function speakQueue(sentences, startIndex) {
    if (!sentences || !sentences.length) {
      console.warn("[TTS] empty queue");
      return;
    }
    if (startIndex == null) startIndex = 0;
    bumpSpeakGeneration();
    stopGoogleAudio();
    try {
      speechSynthesis.cancel();
    } catch (e) {}
    currentUtterances = sentences;
    currentIndex = Math.max(0, Math.min(startIndex, sentences.length - 1));
    isPaused = false;
    isSpeaking = true;

    pageLang = detectPageLanguage(sentences.slice(0, 5).join(" "));

    try {
      wrapSentencesInPage(sentences);
    } catch (e) {
      console.warn("[TTS] wrap sentences:", e);
    }

    if (window.StoryReaderUI?.buildSentenceList) {
      window.StoryReaderUI.buildSentenceList();
    }

    const start = function () {
      speakNext();
    };
    if (getAllVoices().length === 0) {
      speechSynthesis.onvoiceschanged = function () {
        speechSynthesis.onvoiceschanged = null;
        start();
      };
      setTimeout(start, 400);
    } else {
      start();
    }
  }

  /* ---------- public controls ---------- */
  function findIndexNearViewport(sentences) {
    const viewTop = 8;
    const viewBottom = window.innerHeight * 0.55;

    // 1) span.sr-sent trong nửa trên khung nhìn, ưu tiên gần đỉnh
    const spans = document.querySelectorAll("span.sr-sent[data-sr-idx]");
    if (spans.length) {
      let best = null;
      let bestScore = -1e9;
      spans.forEach(function (s) {
        const r = s.getBoundingClientRect();
        if (r.bottom < viewTop || r.top > viewBottom) return;
        const idx = parseInt(s.dataset.srIdx, 10);
        if (isNaN(idx)) return;
        // điểm cao = gần đỉnh + nằm trong viewport
        const score = 1000 - Math.abs(r.top - 48) - (r.top < 0 ? 200 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = idx;
        }
      });
      if (best != null) return best;
      // 2) span bất kỳ trong full viewport
      bestScore = -1e9;
      spans.forEach(function (s) {
        const r = s.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        const idx = parseInt(s.dataset.srIdx, 10);
        if (isNaN(idx)) return;
        const score = 500 - Math.abs(r.top - 80);
        if (score > bestScore) {
          bestScore = score;
          best = idx;
        }
      });
      if (best != null) return best;
    }

    // 3) chưa có span: dò text
    if (!sentences || !sentences.length) return 0;
    const root = getContentRoot();
    if (!root) return 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || p.closest("[id^='sr-']")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const p = node.parentElement;
      if (!p) continue;
      const r = p.getBoundingClientRect();
      if (r.bottom < 20 || r.top > viewBottom) continue;
      const val = node.nodeValue;
      for (var i = 0; i < sentences.length; i++) {
        var key = sentences[i].slice(0, 22).trim();
        if (key.length >= 6 && val.indexOf(key) !== -1) return i;
      }
    }
    return 0;
  }

  async function continueInfiniteReading() {
    if (!window.StoryDetector) return;
    try {
      // hích trang để webnovel load chapter mới
      window.scrollBy(0, 400);
      await new Promise(function (r) {
        setTimeout(r, 1500);
      });
      window.scrollBy(0, 200);
      await new Promise(function (r) {
        setTimeout(r, 800);
      });
      var result = window.StoryDetector.detectContent();
      if (!result || !result.text || result.text.length < 40) {
        console.log("[TTS] Infinite: không có content mới");
        window.StoryReaderUI?.setPlaying?.(false);
        return;
      }
      var sentences = splitIntoSentences(result.text);
      if (!sentences.length) return;

      // Tìm câu cuối đã đọc trong list mới → tiếp tục sau nó
      var startIdx = 0;
      var found = false;
      if (currentUtterances.length) {
        var last = currentUtterances[currentUtterances.length - 1] || "";
        var keys = [last.slice(0, 40).trim(), last.slice(0, 24).trim()];
        for (var i = 0; i < sentences.length; i++) {
          for (var k = 0; k < keys.length; k++) {
            if (keys[k].length >= 8 && sentences[i].indexOf(keys[k]) !== -1) {
              startIdx = i + 1;
              found = true;
            }
          }
        }
      }
      if (!found || startIdx >= sentences.length) {
        try {
          wrapSentencesInPage(sentences);
        } catch (err) {}
        startIdx = findIndexNearViewport(sentences);
        if (startIdx === 0 && currentUtterances.length > 3) {
          // lấy phần sau nửa list (chapter mới thường append)
          startIdx = Math.min(sentences.length - 1, Math.floor(currentUtterances.length * 0.9));
          if (startIdx >= sentences.length - 1) {
            console.log("[TTS] Infinite: hết / không có đoạn mới");
            window.StoryReaderUI?.setPlaying?.(false);
            return;
          }
        }
      }
      if (startIdx >= sentences.length) {
        window.StoryReaderUI?.setPlaying?.(false);
        return;
      }
      console.log("[TTS] Infinite continue @" + startIdx + "/" + sentences.length);
      speakQueue(sentences, startIdx);
    } catch (e) {
      console.warn("[TTS] continueInfiniteReading", e);
    }
  }

  async function startFromPage() {
    if (!window.StoryDetector) {
      alert("Detector chưa sẵn sàng.");
      return;
    }
    try {
      const result = await window.StoryDetector.waitForContent(12000);
      if (!result || !result.text || result.text.length < 40) {
        alert(
          "Không tìm thấy nội dung chương.\nThử mở đúng trang chương hoặc đợi trang load xong."
        );
        return;
      }
      const sentences = splitIntoSentences(result.text);
      if (!sentences.length) {
        alert("Không tách được câu từ nội dung trang.");
        return;
      }
      // Wrap trước để dò viewport chính xác hơn
      try {
        wrapSentencesInPage(sentences);
      } catch (err) {}
      var startIdx = findIndexNearViewport(sentences);
      // Webnovel / infinite: nếu đang giữa trang dài, không về 0
      if (isInfiniteScrollHost() && startIdx === 0 && window.scrollY > 400) {
        // ước lượng theo tỉ lệ cuộn
        var ratio = window.scrollY / Math.max(1, document.documentElement.scrollHeight);
        startIdx = Math.min(sentences.length - 1, Math.floor(ratio * sentences.length));
      }
      console.log(
        "[TTS] " +
          sentences.length +
          " câu | start@" +
          startIdx +
          " | nguồn: " +
          result.source +
          " | title: " +
          result.title
      );
      speakQueue(sentences, startIdx);
    } catch (e) {
      console.error("[TTS] startFromPage:", e);
      alert("Lỗi khi đọc trang: " + (e.message || e));
    }
  }

  function pause() {
    isPaused = true;
    // Giữ isSpeaking=true để togglePlay nhận đúng trạng thái pause (không start lại)
    bumpSpeakGeneration();
    stopGoogleAudio();
    try {
      speechSynthesis.cancel(); // cancel chắc hơn pause (tránh resume chồng)
    } catch (e) {}
    try {
      speechSynthesis.pause();
    } catch (e) {}
    window.StoryReaderUI?.setPlaying?.(false);
  }

  function resume() {
    isPaused = false;
    isSpeaking = true;
    bumpSpeakGeneration();
    stopGoogleAudio();
    try {
      speechSynthesis.cancel();
    } catch (e) {}
    requestWakeLock();
    window.StoryReaderUI?.setPlaying?.(true);
    // Luôn phát lại từ câu hiện tại (tránh chồng giọng sau cancel)
    if (currentUtterances.length && currentIndex < currentUtterances.length) {
      speakQueue(currentUtterances, currentIndex);
    }
  }

  function stop() {
    isPaused = false;
    isSpeaking = false;
    bumpSpeakGeneration();
    stopGoogleAudio();
    if (!autoScrollEnabled) releaseWakeLock();
    try {
      speechSynthesis.cancel();
    } catch (e) {}
    // Giữ currentIndex — lần nghe sau có thể resume / viewport
    clearPageHighlight();
    window.StoryReaderUI?.setPlaying?.(false);
    if (window.StoryReaderUI?.updateProgress) {
      window.StoryReaderUI.updateProgress();
    }
  }

  function togglePlay() {
    // Đang phát → tạm dừng (không mở lại từ đầu)
    if (isSpeaking && !isPaused) {
      pause();
      return;
    }
    // Đang pause → resume đúng câu hiện tại
    if (isPaused && currentUtterances.length) {
      resume();
      return;
    }
    // Bắt đầu mới từ viewport
    startFromPage();
  }

  function jumpToByQuery(query) {
    if (!currentUtterances.length) return false;
    var q = String(query || "").trim();
    if (!q) return false;
    // Số: 1-based
    if (/^\d+$/.test(q)) {
      var n = parseInt(q, 10);
      if (n >= 1 && n <= currentUtterances.length) {
        jumpTo(n - 1);
        return true;
      }
      return false;
    }
    // Tìm câu chứa chuỗi
    var lower = q.toLowerCase();
    for (var i = 0; i < currentUtterances.length; i++) {
      if (currentUtterances[i].toLowerCase().indexOf(lower) !== -1) {
        jumpTo(i);
        return true;
      }
    }
    return false;
  }

  function jumpTo(index) {
    if (!currentUtterances.length) return;
    const i = Math.max(0, Math.min(index, currentUtterances.length - 1));
    bumpSpeakGeneration();
    stopGoogleAudio();
    try {
      speechSynthesis.cancel();
    } catch (e) {}
    currentIndex = i;
    isPaused = false;
    isSpeaking = true;
    const gen = speakGeneration;
    setTimeout(function () {
      if (gen !== speakGeneration || isPaused || !isSpeaking) return;
      speakNext();
    }, 60);
  }

  function setVoice(voiceURI) {
    selectedVoiceURI = voiceURI || null;
    const voices = getAllVoices();
    const v =
      voices.find(function (x) {
        return x.voiceURI === voiceURI;
      }) ||
      voices.find(function (x) {
        return x.name === voiceURI;
      });
    if (v) {
      selectedVoiceURI = v.voiceURI;
      currentVoiceName = v.name;
    } else {
      currentVoiceName = "";
    }
    if (currentUtterances.length && isSpeaking && !isPaused) {
      const keep = currentIndex;
      speechSynthesis.cancel();
      setTimeout(function () {
        speakQueue(currentUtterances, keep);
      }, 80);
    }
  }

  function setRate(v) {
    rate = Math.max(0.5, Math.min(5, parseFloat(v) || 1));
    localStorage.setItem("sr-rate", String(rate));
  }

  function setPitch(v) {
    pitch = Math.max(0.5, Math.min(2, parseFloat(v) || 1));
    localStorage.setItem("sr-pitch", String(pitch));
  }

  /* ---------- auto-scroll (kagane-style continuous, px/s) ---------- */
  let scrollPaused = false;
  let srProgrammaticScroll = false;
  let resumeTimer = null;
  let resumeCountdown = 0;
  // scrollSpeed stored as px/s (default 135)
  scrollSpeed = parseFloat(localStorage.getItem("sr-scroll-px") || "135") || 135;

  function stopAutoScrollTimer() {
    if (autoScrollTimer) {
      clearInterval(autoScrollTimer);
      autoScrollTimer = null;
    }
    if (resumeTimer) {
      clearInterval(resumeTimer);
      resumeTimer = null;
    }
  }

  let reachedBottomOnce = false;
  let bottomWatchTimer = null;
  let lastScrollHeight = 0;

  function isInfiniteScrollHost() {
    var h = (location.hostname || "").toLowerCase();
    return (
      h.indexOf("webnovel.com") !== -1 ||
      h.indexOf("wattpad.com") !== -1 ||
      h.indexOf("royalroad.com") !== -1 ||
      h.indexOf("scribblehub.com") !== -1 ||
      h.indexOf("mtlnovel") !== -1 ||
      h.indexOf("novelbin") !== -1
    );
  }

  function isMangaOrImageHost() {
    var h = (location.hostname || "").toLowerCase();
    return (
      h.indexOf("kagane.to") !== -1 ||
      h.indexOf("kagane.") !== -1 ||
      h.indexOf("nettruyen") !== -1 ||
      h.indexOf("truyenqq") !== -1 ||
      h.indexOf("comick") !== -1 ||
      h.indexOf("mangadex") !== -1
    );
  }

  function getPageScrollHeight() {
    var doc = document.documentElement;
    return Math.max(
      doc.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
  }

  function isNearPageBottom() {
    try {
      var root = getScrollRoot();
      if (root && root !== document.documentElement && root !== document.body) {
        if (root.scrollTop + root.clientHeight >= root.scrollHeight - 160) return true;
      }
    } catch (e) {}
    var height = getPageScrollHeight();
    var scrollBottom = window.scrollY + window.innerHeight;
    if (scrollBottom >= height - 160) return true;
    try {
      var content = getContentRoot();
      if (content && content !== document.body) {
        var r = content.getBoundingClientRect();
        if (r.bottom <= window.innerHeight + 100) return true;
      }
    } catch (e) {}
    return false;
  }

  function handleReachedBottom() {
    if (reachedBottomOnce) return;
    reachedBottomOnce = true;
    lastScrollHeight = getPageScrollHeight();
    console.log("[Scroll] Gần cuối — height=" + lastScrollHeight);

    // Webnovel & site infinite: chờ content load thêm, KHÔNG next ngay
    if (bottomWatchTimer) clearTimeout(bottomWatchTimer);
    var checks = 0;
    var maxChecks = isInfiniteScrollHost() ? 8 : 4; // ~2s vs ~1s

    var watch = function () {
      checks++;
      var h = getPageScrollHeight();
      // Có content mới → tiếp tục cuộn
      if (h > lastScrollHeight + 80) {
        console.log("[Scroll] Content mới load (+" + (h - lastScrollHeight) + "px) → cuộn tiếp");
        lastScrollHeight = h;
        reachedBottomOnce = false;
        bottomWatchTimer = null;
        return;
      }
      if (checks < maxChecks) {
        bottomWatchTimer = setTimeout(watch, 250);
        return;
      }
      bottomWatchTimer = null;

      // Infinite host: KHÔNG dừng — hích xuống để site load, rồi cuộn tiếp
      if (isInfiniteScrollHost()) {
        console.log("[Scroll] Infinite site — nudge & keep scrolling");
        window.scrollBy(0, 80);
        setTimeout(function () {
          reachedBottomOnce = false;
          lastScrollHeight = getPageScrollHeight();
        }, 400);
        return;
      }

      // Manga / ảnh: không next URL — nhưng VẪN cuộn (nudge), không dừng 2s
      if (isMangaOrImageHost()) {
        console.log("[Scroll] Manga host — nudge keep scrolling, no next");
        try {
          var root = getScrollRoot();
          if (root && root !== document.documentElement && root !== document.body) {
            root.scrollTop += 120;
          } else {
            window.scrollBy(0, 120);
          }
        } catch (e) {
          window.scrollBy(0, 120);
        }
        setTimeout(function () {
          reachedBottomOnce = false;
        }, 500);
        return;
      }

      // Site thường: next chương nếu bật
      if (autoNextChapter) {
        var nextEl = findNextChapterLink();
        if (nextEl) {
          stopAutoScroll();
          setTimeout(function () {
            goNextChapter("scroll");
          }, 300);
          return;
        }
      }
      stopAutoScroll();
      window.StoryReaderUI?.onScrollState?.({
        active: false,
        paused: false,
        pxPerSec: 0,
        resumeIn: 0,
      });
    };
    bottomWatchTimer = setTimeout(watch, 250);
  }

  function getScrollRoot() {
    var se = document.scrollingElement || document.documentElement;
    var best = null;
    var bestScore = 0;
    var nodes = document.querySelectorAll(
      "div, main, section, article, [class*='reader'], [class*='scroll'], [class*='chapter'], [class*='viewer']"
    );
    var limit = Math.min(nodes.length, 120);
    for (var i = 0; i < limit; i++) {
      var el = nodes[i];
      var st = window.getComputedStyle(el);
      var ov = st.overflowY;
      if (ov !== "auto" && ov !== "scroll" && ov !== "overlay") continue;
      var can = el.scrollHeight - el.clientHeight;
      if (can < 120) continue;
      // Ưu tiên vùng cao + cuộn được nhiều (manga viewer)
      var score = can + el.clientHeight * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    // Document chỉ thắng nếu cuộn được nhiều hơn container
    var docCan = (se && se.scrollHeight - se.clientHeight) || 0;
    if (docCan > bestScore) return se;
    return best || se;
  }

  function tickScroll() {
    if (!autoScrollEnabled || scrollPaused) return;
    var step = scrollSpeed / 60;
    var root = getScrollRoot();
    srProgrammaticScroll = true;
    try {
      if (root && root !== document.documentElement && root !== document.body) {
        root.scrollTop += step;
      } else {
        window.scrollBy(0, step);
      }
    } catch (err) {
      window.scrollBy(0, step);
    }
    // giữ flag ~120ms (kagane/react có thể emit scroll trễ)
    clearTimeout(window.__srProgScrollT);
    window.__srProgScrollT = setTimeout(function () {
      srProgrammaticScroll = false;
    }, 120);

    if (isNearPageBottom()) {
      handleReachedBottom();
    } else {
      reachedBottomOnce = false;
      if (bottomWatchTimer) {
        clearTimeout(bottomWatchTimer);
        bottomWatchTimer = null;
      }
    }
  }

  function startAutoScroll() {
    autoScrollEnabled = true;
    scrollPaused = false;
    resumeCountdown = 0;
    reachedBottomOnce = false;
    requestWakeLock();
    stopAutoScrollTimer();
    autoScrollTimer = setInterval(tickScroll, 1000 / 60);
    window.StoryReaderUI?.onScrollState?.({
      active: true,
      paused: false,
      pxPerSec: Math.round(scrollSpeed),
      resumeIn: 0,
    });
  }

  function pauseAutoScroll(autoResumeSec) {
    if (!autoScrollEnabled) return;
    scrollPaused = true;
    resumeCountdown = 0;
    if (resumeTimer) {
      clearInterval(resumeTimer);
      resumeTimer = null;
    }
    window.StoryReaderUI?.onScrollState?.({
      active: true,
      paused: true,
      pxPerSec: Math.round(scrollSpeed),
      resumeIn: 0,
    });
    if (autoResumeSec && autoResumeSec > 0) {
      resumeCountdown = autoResumeSec;
      resumeTimer = setInterval(function () {
        resumeCountdown -= 1;
        window.StoryReaderUI?.onScrollState?.({
          active: true,
          paused: true,
          pxPerSec: Math.round(scrollSpeed),
          resumeIn: resumeCountdown,
        });
        if (resumeCountdown <= 0) {
          clearInterval(resumeTimer);
          resumeTimer = null;
          resumeAutoScroll();
        }
      }, 1000);
    }
  }

  function resumeAutoScroll() {
    if (!autoScrollEnabled) return;
    scrollPaused = false;
    resumeCountdown = 0;
    if (resumeTimer) {
      clearInterval(resumeTimer);
      resumeTimer = null;
    }
    window.StoryReaderUI?.onScrollState?.({
      active: true,
      paused: false,
      pxPerSec: Math.round(scrollSpeed),
      resumeIn: 0,
    });
  }

  function toggleAutoScrollPause(autoResumeSec) {
    if (!autoScrollEnabled) {
      startAutoScroll();
      return;
    }
    if (scrollPaused) resumeAutoScroll();
    else pauseAutoScroll(autoResumeSec || 0);
  }

  function setScrollPxPerSec(px) {
    scrollSpeed = Math.max(20, Math.min(400, parseFloat(px) || 135));
    localStorage.setItem("sr-scroll-px", String(Math.round(scrollSpeed)));
    window.StoryReaderUI?.onScrollState?.({
      active: autoScrollEnabled,
      paused: scrollPaused,
      pxPerSec: Math.round(scrollSpeed),
      resumeIn: resumeCountdown,
    });
  }

  function adjustScrollSpeed(delta) {
    setScrollPxPerSec(scrollSpeed + delta);
  }

  function stopAutoScroll() {
    autoScrollEnabled = false;
    scrollPaused = false;
    resumeCountdown = 0;
    stopAutoScrollTimer();
    if (!isSpeaking) releaseWakeLock();
    window.StoryReaderUI?.onScrollState?.({
      active: false,
      paused: false,
      pxPerSec: Math.round(scrollSpeed),
      resumeIn: 0,
    });
    window.StoryReaderUI?.setScrolling?.(false);
  }

  /* ---------- API ---------- */
  window.StoryTTS = {
    speakQueue: speakQueue,
    startFromPage: startFromPage,
    splitIntoSentences: splitIntoSentences,
    pause: pause,
    resume: resume,
    stop: stop,
    togglePlay: togglePlay,
    jumpTo: jumpTo,
    jumpToByQuery: jumpToByQuery,
    setVoice: setVoice,
    setRate: setRate,
    setPitch: setPitch,
    getBestVoice: getBestVoice,
    getAllVoices: getAllVoices,
    detectPageLanguage: detectPageLanguage,
    getSentences: function () {
      return currentUtterances.slice();
    },
    getCurrentIndex: function () {
      return currentIndex;
    },
    getCurrentVoiceName: function () {
      return currentVoiceName;
    },
    isPlaying: function () {
      return isSpeaking && !isPaused;
    },
    isProgrammaticScroll: function () {
      return !!srProgrammaticScroll;
    },
    isPaused: function () {
      return isPaused;
    },
    get highlightEnabled() {
      return highlightEnabled;
    },
    set highlightEnabled(v) {
      highlightEnabled = !!v;
      if (!highlightEnabled) clearPageHighlight();
    },
    get autoNextChapter() {
      return autoNextChapter;
    },
    set autoNextChapter(v) {
      autoNextChapter = !!v;
      localStorage.setItem("sr-auto-next", autoNextChapter ? "1" : "0");
    },
    findNextChapterLink: findNextChapterLink,
    get ttsEngine() { return ttsEngine; },
    set ttsEngine(v) {
      ttsEngine = v === "google" ? "google" : "web";
      localStorage.setItem("sr-tts-engine", ttsEngine);
    },
    goNextChapter: goNextChapter,
    get autoScrollEnabled() {
      return autoScrollEnabled;
    },
    set autoScrollEnabled(v) {
      autoScrollEnabled = !!v;
    },
    get scrollSpeed() {
      return scrollSpeed;
    },
    set scrollSpeed(v) {
      // accept legacy 0.3-3 multiplier OR direct px/s (>10)
      var n = parseFloat(v);
      if (!n || isNaN(n)) n = 135;
      if (n <= 5) n = Math.round(n * 135); // legacy multiplier
      setScrollPxPerSec(n);
    },
    get contextLevel() {
      return contextLevel;
    },
    set contextLevel(v) {
      contextLevel = Math.max(0, Math.min(4, parseInt(v, 10) || 0));
      localStorage.setItem("sr-context", String(contextLevel));
    },
    startAutoScroll: startAutoScroll,
    stopAutoScroll: stopAutoScroll,
    pauseAutoScroll: pauseAutoScroll,
    resumeAutoScroll: resumeAutoScroll,
    toggleAutoScrollPause: toggleAutoScrollPause,
    setScrollPxPerSec: setScrollPxPerSec,
    adjustScrollSpeed: adjustScrollSpeed,
    getScrollPxPerSec: function () {
      return Math.round(scrollSpeed);
    },
    isScrollPaused: function () {
      return scrollPaused;
    },
  };

  // Sau next chương: tiếp tục đúng mode (tts | scroll)
  try {
    var contMode = sessionStorage.getItem("sr-continue-mode") || "";
    if (!contMode && sessionStorage.getItem("sr-continue-tts") === "1") contMode = "tts";
    sessionStorage.removeItem("sr-continue-mode");
    sessionStorage.removeItem("sr-continue-tts");
    if (contMode === "tts" || contMode === "scroll") {
      var tries = 0;
      var tryStart = function () {
        tries++;
        if (!window.StoryDetector && contMode === "tts") {
          if (tries < 25) setTimeout(tryStart, 300);
          return;
        }
        try {
          window.StoryReaderUI?.showToolbar?.();
        } catch (e) {}
        if (contMode === "scroll") {
          // Tiếp tục auto-scroll (không bật TTS)
          autoScrollEnabled = true;
          startAutoScroll();
          try {
            window.StoryReaderUI?.setScrolling?.(true);
          } catch (e) {}
        } else {
          startFromPage();
        }
      };
      setTimeout(tryStart, contMode === "scroll" ? 900 : 1500);
    }
  } catch (e) {}

  console.log("[Story Reader] tts-engine.js loaded (v3)");
})();
