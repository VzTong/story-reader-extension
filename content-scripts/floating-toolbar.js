// ===== Story Reader – Floating Bubble (Ejoy + Cyberpunk) =====

(function () {
  "use strict";

  let bubble = null;
  let menu = null;
  let ttsPanel = null;
  let isDragging = false;
  let menuOpen = false;
  let ttsPanelOpen = false;
  let settingsOpen = false;
  let highlightEnabled = true;
  function syncHighlightLabel() {
    const textEl = document.getElementById("sr-menu-highlight-text");
    if (textEl) textEl.textContent = highlightEnabled ? "Tắt highlight" : "Highlight";
  }
  let autoScrollEnabled = false;
  let toolbarVisible = false;
  let currentTheme = "dark";

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
      // pause without auto-resume; long-press style not needed
      window.StoryTTS?.toggleAutoScrollPause?.(0);
    });
    document.getElementById("sr-hud-minus")?.addEventListener("click", () => {
      window.StoryTTS?.adjustScrollSpeed?.(-15);
    });
    document.getElementById("sr-hud-plus")?.addEventListener("click", () => {
      window.StoryTTS?.adjustScrollSpeed?.(15);
    });
    document.getElementById("sr-hud-close")?.addEventListener("click", () => {
      window.StoryTTS?.stopAutoScroll?.();
      autoScrollEnabled = false;
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

  function scheduleBubbleIdle() {
    clearTimeout(bubbleIdleTimer);
    bubble?.classList.remove("sr-idle-hide");
    bubbleIdleTimer = setTimeout(() => {
      if (menuOpen || ttsPanelOpen) return;
      if (bubble?.classList.contains("sr-dragging")) return;
      // Mobile / DevTools device mode: không half-hide (bubble bị cắt)
      const vs = viewportSize();
      if (vs.w <= 900 || "ontouchstart" in window) return;
      if (
        bubble?.classList.contains("sr-docked-left") ||
        bubble?.classList.contains("sr-docked-right")
      ) {
        bubble.classList.add("sr-idle-hide");
      }
    }, 2500);
  }

  function wakeBubble() {
    bubble?.classList.remove("sr-idle-hide");
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
      bubble.classList.remove("sr-idle-hide", "sr-docked-left", "sr-docked-right");
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
    // Device mode / mobile: mép 10px, không flush 0 (tránh bubble bị cắt)
    const edge = vs.w <= 900 ? 10 : 0;

    bubble.classList.remove("sr-docked-left", "sr-docked-right", "sr-idle-hide");

    if (isLeft) {
      bubble.style.left = edge + "px";
      bubble.style.right = "auto";
      if (edge === 0) bubble.classList.add("sr-docked-left");
    } else {
      bubble.style.left = "auto";
      bubble.style.right = edge + "px";
      if (edge === 0) bubble.classList.add("sr-docked-right");
    }
    // Giữ top trong khung
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
      bubble.classList.remove("sr-idle-hide", "sr-docked-left", "sr-docked-right");
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
  function toggleTheme() {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    document.body.classList.toggle("sr-theme-light", currentTheme === "light");
    localStorage.setItem("sr-theme", currentTheme);
    // Giữ màu tô do user chọn (không bị CSS theme đè)
    const hex = localStorage.getItem("sr-highlight-color") || "#ffe650";
    applyHighlightColor(hex);
  }

  function loadTheme() {
    const saved = localStorage.getItem("sr-theme") || "dark";
    currentTheme = saved;
    document.body.classList.toggle("sr-theme-light", saved === "light");
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
        const textEl = document.getElementById("sr-menu-highlight-text");
        if (textEl)
          textEl.textContent = highlightEnabled
            ? "Tắt highlight"
            : "Bật highlight";
        if (window.StoryTTS)
          window.StoryTTS.highlightEnabled = highlightEnabled;
        closeMenu();
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
      autoScrollEnabled = false;
      const textEl = document.getElementById("sr-menu-scroll-text");
      if (textEl) textEl.textContent = "Auto-scroll";
      window.StoryTTS?.stop?.();
      window.StoryTTS?.stopAutoScroll?.();
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
        window.StoryTTS?.stop?.();
        syncPlayButton();
        updateBubbleActive();
        if (window.StoryReaderUI?.updateProgress) {
          /* progress via UI */
        }
        // Force UI progress text
        const prog = document.querySelector(".sr-tts-progress");
        if (prog) {
          const total = window.StoryTTS?.getSentences?.()?.length || 0;
          prog.textContent = "0 / " + total;
        }
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

    // Kagane-like: lướt chuột/touch → tạm dừng, ~2s sau tự cuộn tiếp
    let userScrollTimer = null;
    const onUserScrollIntent = () => {
      if (!autoScrollEnabled) return;
      // Bỏ qua scroll do chính extension tạo ra (tránh ngắt 2s trên kagane)
      if (window.StoryTTS?.isProgrammaticScroll?.()) return;
      window.StoryTTS?.pauseAutoScroll?.(2);
      clearTimeout(userScrollTimer);
      userScrollTimer = setTimeout(() => {
        if (autoScrollEnabled) window.StoryTTS?.resumeAutoScroll?.();
      }, 2000);
    };
    window.addEventListener("wheel", onUserScrollIntent, { passive: true });
    // Không bind touchmove toàn cục — trên manga/kagane dễ false-pause ~2s
    window.addEventListener(
      "touchstart",
      function (e) {
        if (!autoScrollEnabled) return;
        if (window.StoryTTS?.isProgrammaticScroll?.()) return;
        // chỉ pause khi user chạm (không phải programmatic)
        if (e.touches && e.touches.length) window.StoryTTS?.pauseAutoScroll?.(2);
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
  window.StoryReaderUI = {
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
      bubble.classList.remove("sr-idle-hide");
      if (!localStorage.getItem("sr-bubble-pos")) {
        bubble.style.right = "12px";
        bubble.style.bottom = "100px";
        bubble.style.left = "auto";
        bubble.style.top = "auto";
        dockBubble();
      } else {
        restoreDockClass();
      }
      wakeBubble();
    }
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
    console.log("[Story Reader] UI ready — chờ popup Bắt đầu đọc");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
