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

  if (msg.type === "INJECT_MODULES") {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "no tab" });
      return true;
    }
    chrome.scripting
      .executeScript({
        target: { tabId: tabId },
        files: [
          "content-scripts/translator.js",
          "content-scripts/image-translate.js",
        ],
      })
      .then(function () {
        sendResponse({ ok: true });
      })
      .catch(function (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      });
    return true;
  }


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
  // Tải ảnh → base64 (bypass CORS trang manga)
  // Lấy ảnh trong PAGE world (có cookie + referer của trang → tránh 403 CDN)
  // Chụp viewport tab → OCR khi CDN chặn từng ảnh
  if (msg.type === "CAPTURE_TAB") {
    const tabId = sender.tab && sender.tab.id;
    const windowId = sender.tab && sender.tab.windowId;
    if (!tabId) {
      sendResponse({ ok: false, error: "no tab" });
      return true;
    }
    (async () => {
      try {
        // windowId optional — null = current window
        const dataUrl = await chrome.tabs.captureVisibleTab(
          typeof windowId === "number" ? windowId : null,
          { format: "jpeg", quality: 88 }
        );
        if (!dataUrl) {
          sendResponse({ ok: false, error: "empty capture" });
          return;
        }
        sendResponse({ ok: true, dataUrl: dataUrl });
      } catch (e) {
        console.warn("[SR] captureVisibleTab", e);
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (msg.type === "FETCH_IMAGE_PAGE") {
    const tabId = sender.tab && sender.tab.id;
    const url = String(msg.url || "");
    if (!tabId || !url) {
      sendResponse({ ok: false, error: "no tab/url" });
      return true;
    }
    (async () => {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          world: "MAIN",
          func: async function (imageUrl) {
            try {
              const res = await fetch(imageUrl, {
                credentials: "include",
                mode: "cors",
              });
              if (!res.ok) {
                // thử no-cors không đọc được body — fail
                return { ok: false, error: "http " + res.status };
              }
              const blob = await res.blob();
              const dataUrl = await new Promise(function (resolve, reject) {
                const reader = new FileReader();
                reader.onload = function () {
                  resolve(reader.result);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              return { ok: true, dataUrl: dataUrl };
            } catch (e) {
              return { ok: false, error: String(e && e.message ? e.message : e) };
            }
          },
          args: [url],
        });
        const r = results && results[0] && results[0].result;
        if (r && r.ok) sendResponse({ ok: true, dataUrl: r.dataUrl });
        else sendResponse({ ok: false, error: (r && r.error) || "page fetch fail" });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (msg.type === "FETCH_IMAGE_B64") {
    const url = String(msg.url || "");
    if (!url || (!url.startsWith("http") && !url.startsWith("data:"))) {
      sendResponse({ ok: false, error: "bad url" });
      return true;
    }
    (async () => {
      try {
        if (url.startsWith("data:")) {
          sendResponse({ ok: true, dataUrl: url });
          return;
        }
        const referer = String(msg.referer || "");
        const headers = {
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        };
        if (referer) {
          headers["Referer"] = referer;
          try {
            headers["Origin"] = new URL(referer).origin;
          } catch (e) {}
        }
        let res = await fetch(url, {
          credentials: "omit",
          redirect: "follow",
          headers: headers,
        });
        if (!res.ok && referer) {
          // Thử không Referer
          res = await fetch(url, {
            credentials: "omit",
            redirect: "follow",
            headers: {
              Accept: headers.Accept,
              "User-Agent": headers["User-Agent"],
            },
          });
        }
        if (!res.ok) {
          sendResponse({ ok: false, error: "http " + res.status });
          return;
        }
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
        const b64 = btoa(binary);
        sendResponse({ ok: true, dataUrl: "data:" + mime + ";base64," + b64 });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  // OCR.space free (apikey helloworld — giới hạn; dùng khi Tesseract fail)
  if (msg.type === "OCR_SPACE_URL") {
    const imageUrl = String(msg.url || "");
    const lang = msg.lang || "eng";
    if (!imageUrl) {
      sendResponse({ ok: false, error: "no url" });
      return true;
    }
    (async () => {
      try {
        const form = new FormData();
        form.append("url", imageUrl);
        form.append("language", lang);
        form.append("isOverlayRequired", "false");
        form.append("OCREngine", "2");
        form.append("scale", "true");
        const res = await fetch("https://api.ocr.space/parse/image", {
          method: "POST",
          headers: { apikey: "helloworld" },
          body: form,
        });
        const data = await res.json();
        if (!data || data.IsErroredOnProcessing) {
          sendResponse({
            ok: false,
            error: (data && (data.ErrorMessage || data.ErrorDetails)) || "ocr error",
          });
          return;
        }
        const parsed = (data.ParsedResults && data.ParsedResults[0]) || {};
        sendResponse({ ok: true, text: (parsed.ParsedText || "").trim() });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (msg.type === "OCR_SPACE") {
    const dataUrl = String(msg.dataUrl || "");
    const lang = msg.lang || "eng";
    const apiKey = String(msg.apiKey || "").trim() || "helloworld";
    if (!dataUrl) {
      sendResponse({ ok: false, error: "no image" });
      return true;
    }
    (async () => {
      async function callOcr(engine) {
        // FormData
        try {
          const form = new FormData();
          form.append("base64Image", dataUrl);
          form.append("language", lang);
          form.append("isOverlayRequired", "false");
          form.append("OCREngine", String(engine));
          form.append("scale", "true");
          form.append("detectOrientation", "true");
          form.append("filetype", "JPG");
          const res = await fetch("https://api.ocr.space/parse/image", {
            method: "POST",
            headers: { apikey: apiKey },
            body: form,
          });
          if (!res.ok) {
            return {
              IsErroredOnProcessing: true,
              ErrorMessage: "http " + res.status,
            };
          }
          return await res.json();
        } catch (eForm) {
          // Fallback: application/x-www-form-urlencoded
          const body =
            "base64Image=" +
            encodeURIComponent(dataUrl) +
            "&language=" +
            encodeURIComponent(lang) +
            "&isOverlayRequired=false&OCREngine=" +
            encodeURIComponent(String(engine)) +
            "&scale=true&filetype=JPG";
          const res2 = await fetch("https://api.ocr.space/parse/image", {
            method: "POST",
            headers: {
              apikey: apiKey,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body,
          });
          if (!res2.ok) {
            return {
              IsErroredOnProcessing: true,
              ErrorMessage:
                "http " + res2.status + " / " + String(eForm && eForm.message),
            };
          }
          return await res2.json();
        }
      }
      try {
        let data = await callOcr(2);
        let text = "";
        if (data && !data.IsErroredOnProcessing) {
          const parsed = (data.ParsedResults && data.ParsedResults[0]) || {};
          text = (parsed.ParsedText || "").trim();
        }
        if (!text) {
          data = await callOcr(1);
          if (data && !data.IsErroredOnProcessing) {
            const parsed = (data.ParsedResults && data.ParsedResults[0]) || {};
            text = (parsed.ParsedText || "").trim();
          }
        }
        if (data && data.IsErroredOnProcessing && !text) {
          const err =
            (data &&
              (Array.isArray(data.ErrorMessage)
                ? data.ErrorMessage.join("; ")
                : data.ErrorMessage || data.ErrorDetails)) ||
            "ocr error";
          sendResponse({ ok: false, error: String(err) });
          return;
        }
        sendResponse({ ok: true, text: text || "" });
      } catch (e) {
        console.warn("[SR] OCR_SPACE", e);
        sendResponse({
          ok: false,
          error: String(e && e.message ? e.message : e),
        });
      }
    })();
    return true;
  }

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
