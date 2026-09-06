let toolbarVisible = false;
let voicePanelCreated = false;

function createToolbar() {
  if (document.getElementById("story-reader-toolbar")) return;

  const toolbar = document.createElement("div");
  toolbar.id = "story-reader-toolbar";
  toolbar.style.display = "none"; // mặc định ẩn
  toolbar.innerHTML = `
    <button id="sr-play" class="play" title="Play / Resume">▶</button>
    <button id="sr-pause" title="Pause">⏸</button>
    <button id="sr-stop" class="stop" title="Stop">⏹</button>
    <div class="divider"></div>
    <input type="range" id="sr-rate" min="0.5" max="2" step="0.05" value="1" title="Tốc độ đọc">
    <span class="rate-label" id="sr-rate-label">1.00x</span>
    <div class="divider"></div>
    <button id="sr-voice-btn" title="Chọn giọng đọc">🎤</button>
    <button id="sr-close" title="Ẩn thanh công cụ">✕</button>
  `;
  document.body.appendChild(toolbar);

  // Panel chọn giọng
  const voicePanel = document.createElement("div");
  voicePanel.id = "sr-voice-panel";
  document.body.appendChild(voicePanel);

  // ===== Sự kiện =====
  document.getElementById("sr-play").addEventListener("click", async () => {
    if (speechSynthesis.paused) {
      window.StoryTTS.resume();
      return;
    }

    const result = await window.StoryDetector.waitForContent();
    if (!result || !result.text) {
      alert("Không tìm thấy nội dung truyện trên trang này.");
      return;
    }

    console.log("[Story Reader] Đã dò được:", result.title, "| Nguồn:", result.source);
    const sentences = window.StoryTTS.splitIntoSentences(result.text);
    window.StoryTTS.speakQueue(sentences);
  });

  document.getElementById("sr-pause").addEventListener("click", () => {
    window.StoryTTS.pause();
  });

  document.getElementById("sr-stop").addEventListener("click", () => {
    window.StoryTTS.stop();
  });

  document.getElementById("sr-close").addEventListener("click", () => {
    hideToolbar();
  });

  const rateInput = document.getElementById("sr-rate");
  const rateLabel = document.getElementById("sr-rate-label");
  rateInput.addEventListener("input", () => {
    const val = parseFloat(rateInput.value);
    window.StoryReaderRate = val;
    rateLabel.textContent = val.toFixed(2) + "x";
  });

  document.getElementById("sr-voice-btn").addEventListener("click", () => {
    const panel = document.getElementById("sr-voice-panel");
    if (panel.style.display === "block") {
      panel.style.display = "none";
      return;
    }
    if (!voicePanelCreated) {
      buildVoiceList(panel);
      voicePanelCreated = true;
    }
    panel.style.display = "block";
  });

  document.addEventListener("click", (e) => {
    const panel = document.getElementById("sr-voice-panel");
    const btn = document.getElementById("sr-voice-btn");
    if (panel && panel.style.display === "block" && !panel.contains(e.target) && e.target !== btn) {
      panel.style.display = "none";
    }
  });
}

function buildVoiceList(panel) {
  panel.innerHTML = `<h4>Chọn giọng đọc</h4>`;
  const voices = window.StoryTTS.getAllVoices();

  if (voices.length === 0) {
    panel.innerHTML += `<div style="padding:12px;opacity:0.7;font-size:13px">Đang tải danh sách giọng...</div>`;
    speechSynthesis.onvoiceschanged = () => {
      speechSynthesis.onvoiceschanged = null;
      voicePanelCreated = false;
    };
    return;
  }

  const sorted = [...voices].sort((a, b) => {
    const aVi = a.lang.toLowerCase().startsWith("vi") ? 0 : 1;
    const bVi = b.lang.toLowerCase().startsWith("vi") ? 0 : 1;
    if (aVi !== bVi) return aVi - bVi;
    return a.name.localeCompare(b.name);
  });

  sorted.forEach(v => {
    const div = document.createElement("div");
    div.className = "voice-item";
    div.innerHTML = `${v.name} <span class="voice-lang">${v.lang}</span>`;
    div.addEventListener("click", () => {
      window.StoryTTS.setVoice(v.voiceURI);
      panel.style.display = "none";
      panel.querySelectorAll(".voice-item").forEach(el => el.classList.remove("active"));
      div.classList.add("active");
    });
    panel.appendChild(div);
  });
}

function showToolbar() {
  createToolbar();
  const toolbar = document.getElementById("story-reader-toolbar");
  if (toolbar) {
    toolbar.style.display = "flex";
    toolbarVisible = true;
  }
}

function hideToolbar() {
  const toolbar = document.getElementById("story-reader-toolbar");
  const panel = document.getElementById("sr-voice-panel");
  if (toolbar) toolbar.style.display = "none";
  if (panel) panel.style.display = "none";
  toolbarVisible = false;
  window.StoryTTS?.stop();
}

// Lắng nghe lệnh từ popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SHOW_TOOLBAR") showToolbar();
  if (msg.type === "HIDE_TOOLBAR") hideToolbar();
});

console.log("[Story Reader] floating-toolbar.js loaded");