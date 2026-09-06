// content-scripts/tts-engine.js

let currentUtterances = [];
let isPaused = false;
let currentIndex = 0;
let selectedVoiceURI = null;

function splitIntoSentences(text) {
  // Tách câu sạch, bỏ qua số thứ tự nếu có
  const raw = text.match(/[^.!?…]+[.!?…]+["']?|[^.!?…]+$/g) || [text];
  return raw
    .map((s) => s.trim())
    .filter((s) => s.length > 5)
    .map((s) => s.replace(/^\d+[\.\)]\s*/, "")); // bỏ số thứ tự đầu câu nếu có
}

function getAllVoices() {
  return speechSynthesis.getVoices();
}

function getBestVietnameseVoice() {
  const voices = getAllVoices();
  if (selectedVoiceURI) {
    const chosen = voices.find((v) => v.voiceURI === selectedVoiceURI);
    if (chosen) return chosen;
  }
  const preferred = [
    "Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)",
    "Microsoft NamMinh Online (Natural) - Vietnamese (Vietnam)",
    "Microsoft HoaiMy",
    "Microsoft NamMinh",
    "An",
    "Google Tiếng Việt",
    "Google Vietnamese",
    "Linh",
    "My",
  ];
  for (const name of preferred) {
    const found = voices.find((v) => v.name.includes(name));
    if (found) return found;
  }
  return voices.find((v) => v.lang.toLowerCase().startsWith("vi")) || null;
}

/* ===== Panel danh sách câu ===== */
function createSentencePanel(sentences) {
  const old = document.getElementById("sr-sentence-panel");
  if (old) old.remove();

  const panel = document.createElement("div");
  panel.id = "sr-sentence-panel";
  panel.innerHTML = `
    <div class="sr-panel-header">
      <span>Danh sách câu</span>
      <span id="sr-sentence-progress">0/${sentences.length}</span>
      <button id="sr-panel-close" title="Đóng">✕</button>
    </div>
    <div id="sr-sentence-list"></div>
  `;
  document.body.appendChild(panel);

  const list = document.getElementById("sr-sentence-list");
  sentences.forEach((sentence, index) => {
    const item = document.createElement("div");
    item.className = "sr-sentence-item";
    item.dataset.index = index;
    item.innerHTML = `
      <span class="sr-idx">${index + 1}</span>
      <span class="sr-text">${sentence}</span>
    `;
    item.addEventListener("click", () => {
      // Dừng hoàn toàn rồi đọc lại từ câu được chọn
      window.StoryTTS.stop();
      setTimeout(() => {
        window.StoryTTS.speakQueue(sentences, index);
      }, 80);
    });
    list.appendChild(item);
  });

  document.getElementById("sr-panel-close").addEventListener("click", () => {
    panel.style.display = "none";
  });
}

function updateSentenceProgress(index, total) {
  const progress = document.getElementById("sr-sentence-progress");
  if (progress) progress.textContent = `${index + 1}/${total}`;

  document
    .querySelectorAll(".sr-sentence-item")
    .forEach((el) => el.classList.remove("active"));
  const active = document.querySelector(
    `.sr-sentence-item[data-index="${index}"]`,
  );
  if (active) {
    active.classList.add("active");
    active.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/* ===== Tô sáng + cuộn trên trang ===== */
function clearPageHighlight() {
  document.querySelectorAll(".sr-page-highlight").forEach((el) => {
    el.classList.remove("sr-page-highlight");
  });
}

function highlightAndScroll(index) {
  // 1. Cập nhật panel
  updateSentenceProgress(index, currentUtterances.length);

  // 2. Xóa highlight cũ
  clearPageHighlight();

  if (!currentUtterances[index]) return;

  const sentence = currentUtterances[index].trim();
  if (sentence.length < 8) return;

  // Lấy 2-3 từ đầu + 2-3 từ cuối để tìm chính xác hơn
  const words = sentence.split(/\s+/).filter(Boolean);
  const startKey = words.slice(0, 4).join(" ");
  const endKey = words.slice(-3).join(" ");

  // Ưu tiên các container nội dung thật
  const containers = [
    document.querySelector(".cha-content"),          // webnovel
    document.querySelector(".chapter_content"),
    document.querySelector(".novel-content"),
    document.querySelector("div.entry-content"),
    document.querySelector("article .post-content"),
    document.querySelector("article"),
    document.querySelector("main"),
    document.querySelector("#content"),
    document.body
  ].filter(Boolean);

  let bestEl = null;

  outer:
  for (const container of containers) {
    // Tìm trong các thẻ có text
    const candidates = container.querySelectorAll("p, div, span, section");
    for (const el of candidates) {
      const text = (el.innerText || "").trim();
      if (text.length < 15) continue;

      // Khớp mạnh: chứa cả đoạn đầu hoặc đoạn cuối
      if (text.includes(startKey) || text.includes(endKey) || text.includes(sentence.substring(0, 40))) {
        // Ưu tiên thẻ nhỏ hơn (gần câu thật)
        if (!bestEl || el.innerText.length < bestEl.innerText.length) {
          bestEl = el;
        }
      }
    }
    if (bestEl) break outer;
  }

  // 3. Tô sáng + cuộn
  if (bestEl) {
    bestEl.classList.add("sr-page-highlight");
    bestEl.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest"
    });
  } else {
    // Fallback: cuộn theo tỷ lệ tiến độ
    const ratio = index / Math.max(currentUtterances.length - 1, 1);
    const contentEl = containers[0] || document.body;
    const target =
      contentEl.offsetTop +
      contentEl.offsetHeight * ratio -
      window.innerHeight * 0.35;

    window.scrollTo({
      top: Math.max(0, target),
      behavior: "smooth"
    });
  }
}

function speakQueue(sentences, startIndex = 0) {
  speechSynthesis.cancel();
  clearPageHighlight();

  currentUtterances = sentences;
  currentIndex = startIndex;
  isPaused = false;

  createSentencePanel(sentences);

  function speakNext() {
    if (isPaused || currentIndex >= currentUtterances.length) {
      if (currentIndex >= currentUtterances.length) {
        console.log("[TTS] Đã đọc hết chương");
        setTimeout(clearPageHighlight, 1200);
      }
      return;
    }

    highlightAndScroll(currentIndex);

    const utter = new SpeechSynthesisUtterance(currentUtterances[currentIndex]);
    utter.rate = window.StoryReaderRate || 1.0;

    const voice = getBestVietnameseVoice();
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = "vi-VN";
    }

    utter.onend = () => {
      currentIndex++;
      speakNext();
    };

    utter.onerror = (e) => {
      if (e.error !== "interrupted") {
        console.error("[TTS] Lỗi:", e.error);
        currentIndex++;
        speakNext();
      }
    };

    speechSynthesis.speak(utter);
  }

  if (getAllVoices().length === 0) {
    speechSynthesis.onvoiceschanged = () => {
      speechSynthesis.onvoiceschanged = null;
      speakNext();
    };
  } else {
    speakNext();
  }
}

function pause() {
  isPaused = true;
  speechSynthesis.pause();
}

function resume() {
  isPaused = false;
  if (speechSynthesis.paused) {
    speechSynthesis.resume();
  } else if (currentIndex < currentUtterances.length) {
    speakQueue(currentUtterances, currentIndex);
  }
}

function stop() {
  isPaused = true;
  speechSynthesis.cancel();
  currentIndex = 0;
  currentUtterances = [];
  clearPageHighlight();
}

function setVoice(voiceURI) {
  selectedVoiceURI = voiceURI;
}

window.StoryTTS = {
  speakQueue,
  splitIntoSentences,
  pause,
  resume,
  stop,
  getBestVietnameseVoice,
  getAllVoices,
  setVoice,
};

console.log("[Story Reader] tts-engine.js loaded");
