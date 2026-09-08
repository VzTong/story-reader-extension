// content-scripts/tts-engine.js

let currentUtterances = [];
let isPaused = false;
let currentIndex = 0;
let selectedVoiceURI = null;
let currentVoiceName = "";

function splitIntoSentences(text) {
  const raw = text.match(/[^.!?…]+[.!?…]+["']?|[^.!?…]+$/g) || [text];
  return raw
    .map((s) => s.trim())
    .filter((s) => s.length > 5)
    .map((s) => s.replace(/^\d+[\.\)]\s*/, ""));
}

function getAllVoices() {
  return speechSynthesis.getVoices();
}

function detectPageLanguage(text) {
  if (!text) return "vi";
  const vietChars = (
    text.match(
      /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi,
    ) || []
  ).length;
  const totalLetters = (
    text.match(
      /[a-zA-Zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g,
    ) || []
  ).length;
  if (totalLetters === 0) return "vi";
  return vietChars / totalLetters > 0.03 ? "vi" : "en";
}

function getBestVoice(lang = "vi") {
  const voices = getAllVoices();
  if (!voices.length) return null;

  if (selectedVoiceURI) {
    const chosen = voices.find((v) => v.voiceURI === selectedVoiceURI);
    if (chosen) return chosen;
  }

  if (lang === "en") {
    const preferredEn = [
      "Google US English",
      "Microsoft Aria Online (Natural) - English (United States)",
      "Microsoft Guy Online (Natural) - English (United States)",
      "Samantha",
      "Alex",
      "Google UK English Female",
      "Google UK English Male",
    ];
    for (const name of preferredEn) {
      const found = voices.find((v) => v.name.includes(name));
      if (found) return found;
    }
    return (
      voices.find((v) => v.lang.toLowerCase().startsWith("en")) || voices[0]
    );
  }

  const preferredVi = [
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
  for (const name of preferredVi) {
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

/* ===== Tô sáng chính xác hơn ===== */
function clearPageHighlight() {
  document.querySelectorAll(".sr-page-highlight").forEach((el) => {
    el.classList.remove("sr-page-highlight");
  });
}

function highlightAndScroll(index) {
  updateSentenceProgress(index, currentUtterances.length);
  clearPageHighlight();

  if (!currentUtterances[index]) return;

  const sentence = currentUtterances[index].trim();
  if (sentence.length < 6) return;

  // Lấy đoạn ngắn để tìm (tránh match quá rộng)
  const searchKey =
    sentence.length > 60 ? sentence.substring(0, 45).trim() : sentence;

  // Chỉ tìm trong nội dung trang, **loại bỏ** panel và toolbar của extension
  const containers = [
    document.querySelector(".cha-content"),
    document.querySelector(".chapter_content"),
    document.querySelector(".novel-content"),
    document.querySelector("div.entry-content"),
    document.querySelector("article .post-content"),
    document.querySelector("article"),
    document.querySelector("main"),
    document.querySelector("#content"),
  ].filter(Boolean);

  // Nếu không tìm thấy container đặc thù thì dùng body nhưng loại trừ panel
  if (containers.length === 0) {
    containers.push(document.body);
  }

  let bestEl = null;
  let bestScore = Infinity;

  for (const container of containers) {
    const candidates = [
      ...container.querySelectorAll("p"),
      ...container.querySelectorAll("div, span, section"),
    ];

    for (const el of candidates) {
      // Bỏ qua mọi thứ thuộc về extension
      if (
        el.closest("#sr-sentence-panel") ||
        el.closest("#story-reader-toolbar") ||
        el.closest("#sr-voice-panel")
      ) {
        continue;
      }

      const text = (el.innerText || "").trim();
      if (text.length < 10) continue;

      if (text.includes(searchKey)) {
        // Ưu tiên thẻ có độ dài gần với câu + không quá dài
        const lenDiff = Math.abs(text.length - sentence.length);
        const tooBigPenalty = text.length > sentence.length * 3 ? 500 : 0;
        const score = lenDiff + tooBigPenalty;

        if (score < bestScore) {
          bestScore = score;
          bestEl = el;
        }
      }
      if (bestEl && bestScore < 300) break;
    }

    if (bestEl && bestScore < 100) break;
  }

  if (bestEl) {
    bestEl.classList.add("sr-page-highlight");

    // Chỉ cuộn nếu auto-scroll đang bật
    if (window.StoryReaderUI?.isAutoScrollEnabled?.() !== false) {
      bestEl.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    }
  } else {
    // fallback cũng kiểm tra auto-scroll
    if (window.StoryReaderUI?.isAutoScrollEnabled?.() !== false) {
      const ratio = index / Math.max(currentUtterances.length - 1, 1);
      const contentEl = containers[0] || document.body;
      const target =
        contentEl.offsetTop +
        contentEl.offsetHeight * ratio -
        window.innerHeight * 0.35;
      window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }
  }
}

function speakQueue(sentences, startIndex = 0) {
  speechSynthesis.cancel();
  clearPageHighlight();

  currentUtterances = sentences;
  currentIndex = startIndex;
  isPaused = false;

  createSentencePanel(sentences);

  const pageLang = detectPageLanguage(sentences.join(" "));
  const voice = getBestVoice(pageLang);
  currentVoiceName = voice
    ? voice.name
    : pageLang === "en"
      ? "English"
      : "Tiếng Việt";

  // Cập nhật tên giọng lên toolbar nếu có
  const voiceLabel = document.getElementById("sr-voice-label");
  if (voiceLabel) {
    voiceLabel.textContent =
      currentVoiceName.length > 22
        ? currentVoiceName.substring(0, 20) + "…"
        : currentVoiceName;
    voiceLabel.title = currentVoiceName;
  }

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

    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = pageLang === "en" ? "en-US" : "vi-VN";
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
  const voices = getAllVoices();
  const v = voices.find((x) => x.voiceURI === voiceURI);
  currentVoiceName = v ? v.name : "";

  const voiceLabel = document.getElementById("sr-voice-label");
  if (voiceLabel && currentVoiceName) {
    voiceLabel.textContent =
      currentVoiceName.length > 22
        ? currentVoiceName.substring(0, 20) + "…"
        : currentVoiceName;
    voiceLabel.title = currentVoiceName;
  }

  // Nếu đang đọc thì restart câu hiện tại với giọng mới
  if (currentUtterances.length > 0 && !isPaused) {
    const keepIndex = currentIndex;
    speechSynthesis.cancel();
    setTimeout(() => {
      speakQueue(currentUtterances, keepIndex);
    }, 100);
  }
}

window.StoryTTS = {
  speakQueue,
  splitIntoSentences,
  pause,
  resume,
  stop,
  getBestVoice,
  getAllVoices,
  setVoice,
  detectPageLanguage,
};

console.log("[Story Reader] tts-engine.js loaded");
