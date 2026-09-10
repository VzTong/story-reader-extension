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
  let rate = parseFloat(localStorage.getItem("sr-rate") || "1") || 1;
  let pitch = parseFloat(localStorage.getItem("sr-pitch") || "1") || 1;
  let highlightEnabled = true;
  let autoScrollEnabled = false;
  let scrollSpeed = parseFloat(localStorage.getItem("sr-scroll-speed") || "1") || 1;
  let contextLevel = parseInt(localStorage.getItem("sr-context") || "2", 10);
  let pageLang = "vi";
  let autoScrollTimer = null;

  /* ---------- helpers ---------- */
  function splitIntoSentences(text) {
    if (!text) return [];
    const normalized = text
      .replace(/\r\n/g, "\n")
      .replace(/\s+/g, " ")
      .trim();
    const raw =
      normalized.match(/[^.!?…]+[.!?…]+["'”’)]?|[^.!?…]+$/g) || [normalized];
    return raw
      .map((s) => s.trim())
      .filter((s) => s.length > 5)
      .map((s) => s.replace(/^\d+[\.\)]\s*/, ""));
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

  function wrapSentencesInPage(sentences) {
    unwrapSentences();
    if (!sentences || !sentences.length) return;
    const root = getContentRoot();
    if (!root) return;

    // Build searchable keys (first ~40 chars) -> index
    const keys = sentences.map((s, i) => ({
      i,
      key: s.length > 50 ? s.slice(0, 40).trim() : s.trim(),
      full: s,
    }));

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest("[id^='sr-']") || p.closest("#sr-bubble") || p.closest("#sr-menu") || p.closest("#sr-tts-panel"))
          return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA")
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    // For each sentence, find first text node containing its key and wrap matching range
    keys.forEach(({ i, key, full }) => {
      if (!key || key.length < 4) return;
      for (let n = 0; n < textNodes.length; n++) {
        const node = textNodes[n];
        if (!node.parentNode) continue;
        const val = node.nodeValue;
        const idx = val.indexOf(key);
        if (idx === -1) {
          // try shorter key
          const short = key.slice(0, Math.min(24, key.length));
          const idx2 = val.indexOf(short);
          if (idx2 === -1) continue;
          wrapRangeInNode(node, idx2, Math.min(val.length, idx2 + full.length), i);
          return;
        }
        // Prefer wrapping roughly sentence length
        const end = Math.min(val.length, idx + full.length + 8);
        wrapRangeInNode(node, idx, end, i);
        return;
      }
    });
    wrapped = true;
  }

  function wrapRangeInNode(textNode, start, end, sentenceIndex) {
    try {
      const val = textNode.nodeValue;
      if (start < 0 || end > val.length || start >= end) return;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const span = document.createElement("span");
      span.className = "sr-sent";
      span.dataset.srIdx = String(sentenceIndex);
      range.surroundContents(span);
    } catch (e) {
      // surroundContents fails if range crosses element boundaries — skip
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

    // Prefer precise span
    let el = document.querySelector('span.sr-sent[data-sr-idx="' + index + '"]');
    if (!el) {
      // fallback: any .sr-sent containing text
      const sentence = currentUtterances[index];
      if (sentence) {
        const key = sentence.slice(0, 28);
        document.querySelectorAll("span.sr-sent").forEach((s) => {
          if (!el && (s.textContent || "").includes(key)) el = s;
        });
      }
    }

    if (el) {
      el.classList.add("sr-on");
      if ((isSpeaking && !isPaused) || autoScrollEnabled) {
        el.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
      }
    }
  }

  /* ---------- speak queue ---------- */
  function speakNext() {
    if (isPaused) return;
    if (currentIndex >= currentUtterances.length) {
      isSpeaking = false;
      setTimeout(clearPageHighlight, 800);
      window.StoryReaderUI?.setPlaying?.(false);
      console.log("[TTS] Đã đọc hết chương");
      return;
    }

    isSpeaking = true;
    window.StoryReaderUI?.setPlaying?.(true);
    // TTS đang chạy → tắt auto-scroll liên tục nếu có
    if (autoScrollEnabled) {
      stopAutoScroll();
    }
    highlightAndScroll(currentIndex);

    const text = currentUtterances[currentIndex];
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

    utter.onend = () => {
      currentIndex++;
      const delay = contextLevel * 120;
      if (delay > 0) setTimeout(speakNext, delay);
      else speakNext();
    };

    utter.onerror = (e) => {
      if (e.error === "interrupted" || e.error === "canceled") return;
      console.error("[TTS] error:", e.error);
      currentIndex++;
      speakNext();
    };

    try {
      speechSynthesis.speak(utter);
    } catch (err) {
      console.error("[TTS] speak failed:", err);
      currentIndex++;
      speakNext();
    }
  }

  function speakQueue(sentences, startIndex) {
    if (!sentences || !sentences.length) {
      console.warn("[TTS] empty queue");
      return;
    }
    if (startIndex == null) startIndex = 0;
    speechSynthesis.cancel();
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
      console.log(
        "[TTS] " +
          sentences.length +
          " câu | nguồn: " +
          result.source +
          " | title: " +
          result.title
      );
      speakQueue(sentences, 0);
    } catch (e) {
      console.error("[TTS] startFromPage:", e);
      alert("Lỗi khi đọc trang: " + (e.message || e));
    }
  }

  function pause() {
    isPaused = true;
    isSpeaking = false;
    try {
      speechSynthesis.pause();
    } catch (e) {}
    window.StoryReaderUI?.setPlaying?.(false);
  }

  function resume() {
    isPaused = false;
    isSpeaking = true;
    window.StoryReaderUI?.setPlaying?.(true);
    if (speechSynthesis.paused) {
      try {
        speechSynthesis.resume();
      } catch (e) {
        speakQueue(currentUtterances, currentIndex);
      }
    } else if (
      currentUtterances.length &&
      currentIndex < currentUtterances.length
    ) {
      speakQueue(currentUtterances, currentIndex);
    }
  }

  function stop() {
    isPaused = true;
    isSpeaking = false;
    try {
      speechSynthesis.cancel();
    } catch (e) {}
    currentIndex = 0;
    clearPageHighlight();
    unwrapSentences();
    window.StoryReaderUI?.setPlaying?.(false);
    if (window.StoryReaderUI?.updateProgress) {
      window.StoryReaderUI.updateProgress();
    }
  }

  function togglePlay() {
    if (isSpeaking && !isPaused) {
      pause();
      return;
    }
    if (isPaused && currentUtterances.length) {
      resume();
      return;
    }
    if (currentUtterances.length && currentIndex < currentUtterances.length) {
      resume();
      return;
    }
    startFromPage();
  }

  function jumpTo(index) {
    if (!currentUtterances.length) return;
    const i = Math.max(0, Math.min(index, currentUtterances.length - 1));
    speechSynthesis.cancel();
    currentIndex = i;
    isPaused = false;
    isSpeaking = true;
    setTimeout(function () {
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
    rate = Math.max(0.5, Math.min(2, parseFloat(v) || 1));
    localStorage.setItem("sr-rate", String(rate));
  }

  function setPitch(v) {
    pitch = Math.max(0.5, Math.min(1.5, parseFloat(v) || 1));
    localStorage.setItem("sr-pitch", String(pitch));
  }

  /* ---------- auto-scroll (kagane-style continuous, px/s) ---------- */
  let scrollPaused = false;
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

  function tickScroll() {
    if (!autoScrollEnabled || scrollPaused) return;
    // ~60fps: px per frame = px/s / 60
    const step = scrollSpeed / 60;
    window.scrollBy(0, step);
  }

  function startAutoScroll() {
    autoScrollEnabled = true;
    scrollPaused = false;
    resumeCountdown = 0;
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

  console.log("[Story Reader] tts-engine.js loaded (v2)");
})();
