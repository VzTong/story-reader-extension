/**
 * Background service worker (Manifest V3).
 *
 * - GOOGLE_TTS: fetch audio từ endpoint Translate công khai (tránh CORS trên trang),
 *   trả base64 cho content script phát bằng Audio + Blob.
 * - PING: kiểm tra worker còn sống.
 * Không cần API key Google Cloud; endpoint free có thể bị 403/giới hạn.
 */
console.log("[Story Reader] background service worker loaded");

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
});
