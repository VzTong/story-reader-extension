/**
 * Background service worker (Manifest V3).
 *
 * - GOOGLE_TTS: fetch audio từ endpoint Translate công khai (tránh CORS trên trang),
 *   trả base64 cho content script phát bằng Audio + Blob.
 * - MYMEMORY_TRANSLATE: dịch text (MyMemory free tier).
 * - PING: kiểm tra worker còn sống.
 */
console.log("[Story Reader] background service worker loaded");

  // Content script nhờ background đọc file trong package (tránh Failed to fetch)
  // dùng cho Tesseract libs


/** Hàng đợi dịch tuần tự — tránh bắn song song gây 429 */
let translateQueue = Promise.resolve();
function enqueueTranslate(fn) {
  translateQueue = translateQueue.then(fn, fn);
  return translateQueue;
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "GOOGLE_TTS") {
    const text = String(msg.text || "").slice(0, 180);
    const lang = msg.lang || "vi";
    if (!text) {
      sendResponse({ ok: false, error: "empty" });
      return true;
    }
    const urls = [
      `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}`,
      `https://translate.google.com/translate_tts?ie=UTF-8&client=gtx&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}`,
      `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}`,
    ];

    (async () => {
      let lastErr = "all failed";
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            method: "GET",
            credentials: "omit",
            headers: {
              // một số endpoint cần UA/referrer giả lập trình duyệt
              Accept: "*/*",
            },
          });
          if (!res.ok) {
            lastErr = "http " + res.status;
            continue;
          }
          const buf = await res.arrayBuffer();
          if (!buf || buf.byteLength < 100) {
            lastErr = "empty body";
            continue;
          }
          // base64
          const bytes = new Uint8Array(buf);
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          const b64 = btoa(binary);
          const mime = res.headers.get("content-type") || "audio/mpeg";
          sendResponse({ ok: true, base64: b64, mime });
          return;
        } catch (e) {
          lastErr = String(e && e.message ? e.message : e);
        }
      }
      sendResponse({ ok: false, error: lastErr });
    })();
    return true; // async
  }

  if (msg.type === "PING") {
    sendResponse({ ok: true });
    return true;
  }

  /**
   * MyMemory Translation API (free tier).
   * msg: { text, langpair } — langpair ví dụ "en|vi", "zh-CN|vi"
   * Giới hạn ~500 ký tự/request; content script đã chunk trước khi gửi.
   */
  if (msg.type === "FETCH_EXT_TEXT") {
    const path = String(msg.path || "");
    if (!path || path.indexOf("..") !== -1) {
      sendResponse({ ok: false, error: "bad path" });
      return true;
    }
    (async () => {
      try {
        const url = chrome.runtime.getURL(path);
        const res = await fetch(url);
        if (!res.ok) {
          sendResponse({ ok: false, error: "http " + res.status });
          return;
        }
        const text = await res.text();
        sendResponse({ ok: true, text: text });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (msg.type === "MYMEMORY_TRANSLATE") {
    const text = String(msg.text || "").slice(0, 500);
    const langpair = msg.langpair || "en|vi";
    const email = msg.email || "storyreader@extension.local";
    if (!text.trim()) {
      sendResponse({ ok: false, error: "empty" });
      return true;
    }

    function sleep(ms) {
      return new Promise(function (r) {
        setTimeout(r, ms);
      });
    }

    /** Parse langpair "en|vi" → { sl, tl } */
    function parsePair(pair) {
      var p = String(pair || "en|vi").split("|");
      return { sl: p[0] || "auto", tl: p[1] || "vi" };
    }

    /** MyMemory — retry khi 429 */
    async function tryMyMemory() {
      var url =
        "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(text) +
        "&langpair=" +
        encodeURIComponent(langpair) +
        "&de=" +
        encodeURIComponent(email);
      var delays = [0, 2000, 5000];
      var lastErr = "mymemory fail";
      for (var i = 0; i < delays.length; i++) {
        if (delays[i]) await sleep(delays[i]);
        try {
          var res = await fetch(url, { method: "GET", credentials: "omit" });
          if (res.status === 429) {
            lastErr = "http 429";
            continue;
          }
          if (!res.ok) {
            lastErr = "http " + res.status;
            continue;
          }
          var data = await res.json();
          var translated =
            data && data.responseData && data.responseData.translatedText;
          if (translated != null && String(translated).length) {
            return { ok: true, translatedText: String(translated), via: "mymemory" };
          }
          lastErr = (data && data.responseDetails) || "no translation";
        } catch (e) {
          lastErr = String(e && e.message ? e.message : e);
        }
      }
      return { ok: false, error: lastErr };
    }

    /**
     * Fallback: Google gtx endpoint (không key, dùng khi MyMemory 429/hết quota).
     * Chỉ dùng nội bộ extension, không phải Cloud Translation API trả phí.
     */
    async function tryGoogleGtx() {
      var pair = parsePair(langpair);
      var url =
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" +
        encodeURIComponent(pair.sl === "zh-CN" ? "zh-CN" : pair.sl) +
        "&tl=" +
        encodeURIComponent(pair.tl) +
        "&dt=t&q=" +
        encodeURIComponent(text);
      try {
        var res = await fetch(url, { method: "GET", credentials: "omit" });
        if (!res.ok) return { ok: false, error: "gtx http " + res.status };
        var data = await res.json();
        // data[0] = [[translated, original, ...], ...]
        var parts = [];
        if (data && data[0]) {
          for (var i = 0; i < data[0].length; i++) {
            if (data[0][i] && data[0][i][0]) parts.push(data[0][i][0]);
          }
        }
        var out = parts.join("");
        if (!out) return { ok: false, error: "gtx empty" };
        return { ok: true, translatedText: out, via: "gtx" };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }

    enqueueTranslate(async () => {
      // Ưu tiên gtx (nhanh hơn MyMemory, ít 429 hơn khi có queue)
      var r = await tryGoogleGtx();
      if (!r.ok) {
        console.warn("[SR] gtx fail:", r.error, "→ MyMemory");
        r = await tryMyMemory();
      }
      if (!r.ok && String(r.error || "").indexOf("429") !== -1) {
        await sleep(2500);
        r = await tryGoogleGtx();
      }
      sendResponse(r);
    });
    return true;
  }
});
