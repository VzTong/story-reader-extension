// ===== Story Reader – Floating Bubble (Ejoy style) =====

(function () {
  "use strict";

  let bubble = null;
  let menu = null;
  let ttsPanel = null;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let menuOpen = false;
  let ttsPanelOpen = false;
  let settingsOpen = false;
  let highlightEnabled = true;
  let autoScrollEnabled = false;
  let currentTheme = "dark";

  // ===== Create UI =====
  function createUI() {
    // Bubble
    if (!document.getElementById("sr-bubble")) {
      bubble = document.createElement("div");
      bubble.id = "sr-bubble";
      bubble.title = "Story Reader";

      // Dùng icon thật của extension
      const img = document.createElement("img");
      img.src = chrome.runtime.getURL("icons/icon128.png");
      img.alt = "Story Reader";
      bubble.appendChild(img);

      document.body.appendChild(bubble);

      // Vị trí mặc định
      const saved = localStorage.getItem("sr-bubble-pos");
      if (saved) {
        const pos = JSON.parse(saved);
        bubble.style.left = pos.left + "px";
        bubble.style.top = pos.top + "px";
      } else {
        bubble.style.right = "16px";
        bubble.style.bottom = "120px";
      }
    } else {
      bubble = document.getElementById("sr-bubble");
    }
    
    // Mini Menu
    if (!document.getElementById("sr-menu")) {
      menu = document.createElement("div");
      menu.id = "sr-menu";
      menu.innerHTML = `
        <button id="sr-menu-scroll">
          <span class="sr-icon">↕</span>
          <span id="sr-menu-scroll-text">Bật Auto-scroll</span>
        </button>
        <button id="sr-menu-tts">
          <span class="sr-icon">🔊</span>
          <span>Nghe TTS</span>
        </button>
        <button id="sr-menu-list">
          <span class="sr-icon">☰</span>
          <span>Danh sách câu</span>
        </button>
        <div class="sr-divider"></div>
        <button id="sr-menu-highlight">
          <span class="sr-icon">✏️</span>
          <span id="sr-menu-highlight-text">Tắt Highlight</span>
        </button>
        <button id="sr-menu-theme">
          <span class="sr-icon">🌓</span>
          <span>Đổi Theme</span>
        </button>
        <button id="sr-menu-stop">
          <span class="sr-icon">⏹</span>
          <span>Dừng tất cả</span>
        </button>
      `;
      document.body.appendChild(menu);
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
          <button id="sr-tts-toggle-settings" title="Cài đặt giọng">⚙️</button>
          <button id="sr-tts-close" title="Đóng">✕</button>
        </div>
        <div id="sr-sentence-list"></div>
        <div class="sr-tts-settings" id="sr-tts-settings">
          <label>Giọng đọc</label>
          <select id="sr-voice-select"></select>

          <label>Tốc độ đọc: <span id="sr-rate-val">1.0</span></label>
          <input type="range" id="sr-rate" min="0.5" max="2" step="0.1" value="1">

          <label>Tốc độ cuộn: <span id="sr-scroll-speed-val">1.0</span></label>
          <input type="range" id="sr-scroll-speed" min="0.3" max="3" step="0.1" value="1">

          <label>Pitch: <span id="sr-pitch-val">1.0</span></label>
          <input type="range" id="sr-pitch" min="0.5" max="1.5" step="0.1" value="1">
        </div>
        <div class="sr-tts-footer">
          <div class="sr-tts-progress" id="sr-progress">0 / 0</div>
          <div class="sr-tts-controls">
            <button id="sr-panel-stop" title="Stop">⏹</button>
            <button id="sr-panel-play" class="play" title="Play TTS">▶</button>
          </div>
        </div>
      `;
      document.body.appendChild(ttsPanel);
    } else {
      ttsPanel = document.getElementById("sr-tts-panel");
    }
  }

  // ===== Bubble Drag & Dock =====
  function initBubbleDrag() {
    let startX, startY, startLeft, startTop;
    let moved = false;

    const onStart = (e) => {
      isDragging = true;
      moved = false;
      bubble.style.transition = "none";

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const rect = bubble.getBoundingClientRect();
      startX = clientX;
      startY = clientY;
      startLeft = rect.left;
      startTop = rect.top;

      // Clear dock class while dragging
      bubble.classList.remove("sr-docked-left", "sr-docked-right");
    };

    const onMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const dx = clientX - startX;
      const dy = clientY - startY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;

      // Giới hạn trong màn hình
      newLeft = Math.max(0, Math.min(window.innerWidth - 48, newLeft));
      newTop = Math.max(0, Math.min(window.innerHeight - 48, newTop));

      bubble.style.left = newLeft + "px";
      bubble.style.top = newTop + "px";
      bubble.style.right = "auto";
      bubble.style.bottom = "auto";
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      bubble.style.transition = "";

      if (!moved) {
        // Đây là click → mở menu
        toggleMenu();
        return;
      }

      // Dock vào cạnh gần nhất
      dockBubble();
      saveBubblePos();
    };

    bubble.addEventListener("mousedown", onStart);
    bubble.addEventListener("touchstart", onStart, { passive: false });

    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: false });

    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchend", onEnd);
  }

  function dockBubble() {
    const rect = bubble.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const isLeft = centerX < window.innerWidth / 2;

    bubble.classList.remove("sr-docked-left", "sr-docked-right");

    if (isLeft) {
      bubble.style.left = "0px";
      bubble.style.right = "auto";
      bubble.classList.add("sr-docked-left");
    } else {
      bubble.style.left = "auto";
      bubble.style.right = "0px";
      bubble.classList.add("sr-docked-right");
    }
  }

  function saveBubblePos() {
    const rect = bubble.getBoundingClientRect();
    localStorage.setItem(
      "sr-bubble-pos",
      JSON.stringify({
        left: rect.left,
        top: rect.top,
      }),
    );
  }

  // ===== Menu =====
  function toggleMenu() {
    if (menuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function openMenu() {
    const rect = bubble.getBoundingClientRect();
    const menuWidth = 190;

    let left = rect.left + rect.width / 2 - menuWidth / 2;
    let top = rect.top - 10;

    // Điều chỉnh nếu tràn màn hình
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }

    // Hiện phía trên hoặc dưới
    if (rect.top > 220) {
      menu.style.top = rect.top - 8 + "px";
      menu.style.transformOrigin = "bottom center";
      menu.style.transform = "translateY(-100%) scale(0.95)";
    } else {
      menu.style.top = rect.bottom + 8 + "px";
      menu.style.transformOrigin = "top center";
      menu.style.transform = "scale(0.95)";
    }

    menu.style.left = left + "px";
    menu.classList.add("sr-open");
    menuOpen = true;

    // Force reflow rồi animate
    requestAnimationFrame(() => {
      menu.style.transform = menu.style.transform.replace(
        "scale(0.95)",
        "scale(1)",
      );
    });
  }

  function closeMenu() {
    menu.classList.remove("sr-open");
    menuOpen = false;
  }

  // ===== TTS Panel =====
  function openTtsPanel() {
    ttsPanel.classList.add("sr-open");
    ttsPanelOpen = true;
    closeMenu();
    buildSentenceList();
    populateVoices();
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
  }

  // ===== Sentence List =====
  function buildSentenceList() {
    const list = document.getElementById("sr-sentence-list");
    if (!list || !window.StoryTTS) return;

    const sentences = window.StoryTTS.getSentences?.() || [];
    list.innerHTML = "";

    sentences.forEach((s, i) => {
      const item = document.createElement("div");
      item.className = "sr-sentence-item";
      item.dataset.index = i;
      item.innerHTML = `
        <span class="sr-idx">${i + 1}</span>
        <span class="sr-text">${s}</span>
      `;
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
    const current = (window.StoryTTS.getCurrentIndex?.() || 0) + 1;
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
  function populateVoices() {
    const select = document.getElementById("sr-voice-select");
    if (!select || !window.speechSynthesis) return;

    const voices = speechSynthesis.getVoices();
    select.innerHTML = "";

    const sorted = [...voices].sort((a, b) => {
      const aVi = a.lang.startsWith("vi") ? 0 : 1;
      const bVi = b.lang.startsWith("vi") ? 0 : 1;
      return aVi - bVi || a.name.localeCompare(b.name);
    });

    sorted.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      select.appendChild(opt);
    });

    if (window.StoryTTS?.getCurrentVoiceName) {
      const current = window.StoryTTS.getCurrentVoiceName();
      if (current) select.value = current;
    }
  }

  // ===== Theme =====
  function toggleTheme() {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    document.body.classList.toggle("sr-theme-light", currentTheme === "light");
    localStorage.setItem("sr-theme", currentTheme);
  }

  function loadTheme() {
    const saved = localStorage.getItem("sr-theme") || "dark";
    currentTheme = saved;
    document.body.classList.toggle("sr-theme-light", saved === "light");
  }

  // ===== Events =====
  function bindEvents() {
    // Menu buttons
    document.getElementById("sr-menu-scroll")?.addEventListener("click", () => {
      autoScrollEnabled = !autoScrollEnabled;
      const textEl = document.getElementById("sr-menu-scroll-text");
      if (textEl)
        textEl.textContent = autoScrollEnabled
          ? "Tắt Auto-scroll"
          : "Bật Auto-scroll";

      if (window.StoryTTS) {
        window.StoryTTS.autoScrollEnabled = autoScrollEnabled;
        if (autoScrollEnabled) {
          window.StoryTTS.startAutoScroll?.();
        } else {
          window.StoryTTS.stopAutoScroll?.();
        }
      }
      closeMenu();
    });

    document.getElementById("sr-menu-tts")?.addEventListener("click", () => {
      window.StoryTTS?.togglePlay?.();
      closeMenu();
    });

    document.getElementById("sr-menu-list")?.addEventListener("click", () => {
      openTtsPanel();
    });

    document
      .getElementById("sr-menu-highlight")
      ?.addEventListener("click", () => {
        highlightEnabled = !highlightEnabled;
        const textEl = document.getElementById("sr-menu-highlight-text");
        if (textEl)
          textEl.textContent = highlightEnabled
            ? "Tắt Highlight"
            : "Bật Highlight";
        if (window.StoryTTS)
          window.StoryTTS.highlightEnabled = highlightEnabled;
        closeMenu();
      });

    document.getElementById("sr-menu-theme")?.addEventListener("click", () => {
      toggleTheme();
      closeMenu();
    });

    document.getElementById("sr-menu-stop")?.addEventListener("click", () => {
      autoScrollEnabled = false;
      const textEl = document.getElementById("sr-menu-scroll-text");
      if (textEl) textEl.textContent = "Bật Auto-scroll";
      window.StoryTTS?.stop?.();
      window.StoryTTS?.stopAutoScroll?.();
      closeMenu();
    });

    // TTS Panel
    document
      .getElementById("sr-tts-close")
      ?.addEventListener("click", closeTtsPanel);
    document
      .getElementById("sr-tts-toggle-settings")
      ?.addEventListener("click", toggleTtsSettings);
    document
      .getElementById("sr-panel-play")
      ?.addEventListener("click", () => window.StoryTTS?.togglePlay?.());
    document
      .getElementById("sr-panel-stop")
      ?.addEventListener("click", () => window.StoryTTS?.stop?.());

    // Settings live update
    document.getElementById("sr-rate")?.addEventListener("input", (e) => {
      document.getElementById("sr-rate-val").textContent = e.target.value;
      window.StoryTTS?.setRate?.(parseFloat(e.target.value));
    });
    document.getElementById("sr-pitch")?.addEventListener("input", (e) => {
      document.getElementById("sr-pitch-val").textContent = e.target.value;
      window.StoryTTS?.setPitch?.(parseFloat(e.target.value));
    });
    document
      .getElementById("sr-scroll-speed")
      ?.addEventListener("input", (e) => {
        document.getElementById("sr-scroll-speed-val").textContent =
          e.target.value;
        if (window.StoryTTS)
          window.StoryTTS.scrollSpeed = parseFloat(e.target.value);
      });
    document
      .getElementById("sr-voice-select")
      ?.addEventListener("change", (e) => {
        window.StoryTTS?.setVoice?.(e.target.value);
      });

    // Click outside to close menu
    document.addEventListener("click", (e) => {
      if (menuOpen && !menu.contains(e.target) && !bubble.contains(e.target)) {
        closeMenu();
      }
    });

    // Keyboard
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (ttsPanelOpen) closeTtsPanel();
        else if (menuOpen) closeMenu();
      }
    });

    if (window.speechSynthesis) {
      speechSynthesis.onvoiceschanged = populateVoices;
    }
  }

  // ===== Public API =====
  window.StoryReaderUI = {
    openTtsPanel,
    closeTtsPanel,
    buildSentenceList,
    highlightSentenceInPanel,
    updateProgress,
    setPlaying(isPlaying) {
      // có thể đổi icon bubble nếu muốn
    },
    setScrolling(isScrolling) {
      autoScrollEnabled = isScrolling;
      const textEl = document.getElementById("sr-menu-scroll-text");
      if (textEl)
        textEl.textContent = isScrolling
          ? "Tắt Auto-scroll"
          : "Bật Auto-scroll";
    },
  };

  // ===== Init =====
  function init() {
    createUI();
    initBubbleDrag();
    bindEvents();
    loadTheme();

    // Dock lần đầu nếu chưa có vị trí
    setTimeout(() => {
      if (!localStorage.getItem("sr-bubble-pos")) {
        dockBubble();
      }
    }, 100);

    console.log(
      "[Story Reader] floating-toolbar.js loaded (Floating Bubble style)",
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
