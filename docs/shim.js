/**
 * Bookmark / mobile shim — chạy TRƯỚC các module Story Reader.
 *
 * Mục tiêu: giả chrome.runtime tối thiểu để content-scripts không crash
 * khi không có extension context (Chrome ĐT, Safari, bookmarklet).
 *
 * - GOOGLE_TTS: thử fetch trực tiếp (thường fail CORS) → TTS engine fallback Web Speech
 * - getURL: trỏ về GitHub Pages / jsDelivr
 * - Không hỗ trợ captureVisibleTab / OCR ảnh (cần extension)
 */
(function () {
  "use strict";

  if (window.__SR_SHIM__) return;
  window.__SR_SHIM__ = true;
  window.__SR_BOOKMARK_MODE__ = true;

  var BASE =
    window.__SR_BASE__ ||
    "https://cdn.jsdelivr.net/gh/VzTong/story-reader-extension@main/";

  function emptyResponse(sendResponse, extra) {
    try {
      sendResponse &&
        sendResponse(
          Object.assign({ ok: false, error: "bookmark-mode" }, extra || {})
        );
    } catch (e) {}
  }

  if (typeof window.chrome === "undefined") {
    window.chrome = {};
  }

  if (!chrome.runtime) {
    chrome.runtime = {};
  }

  // id giả — một số chỗ check chrome.runtime.id
  if (!chrome.runtime.id) {
    chrome.runtime.id = "story-reader-bookmark";
  }

  chrome.runtime.getURL = function (path) {
    path = String(path || "").replace(/^\//, "");
    return BASE + path;
  };

  if (!chrome.runtime.onMessage) {
    chrome.runtime.onMessage = {
      addListener: function () {},
      removeListener: function () {},
    };
  }

  if (!chrome.runtime.sendMessage || window.__SR_BOOKMARK_MODE__) {
    chrome.runtime.sendMessage = function (msg, sendResponse) {
      if (!msg || !msg.type) {
        emptyResponse(sendResponse);
        return;
      }

      // TTS Google qua background — bookmark không có SW
      if (msg.type === "GOOGLE_TTS") {
        emptyResponse(sendResponse, { error: "no-service-worker" });
        return;
      }

      // Dịch / OCR / capture — không hỗ trợ ở bookmark mode
      if (
        msg.type === "CAPTURE_TAB" ||
        msg.type === "OCR_SPACE" ||
        msg.type === "OCR_GEMINI" ||
        msg.type === "OCR_SPACE_URL" ||
        msg.type === "FETCH_IMAGE_B64" ||
        msg.type === "FETCH_IMAGE_PAGE" ||
        msg.type === "INJECT_MODULES" ||
        msg.type === "FETCH_EXT_TEXT"
      ) {
        emptyResponse(sendResponse, { error: "need-extension" });
        return;
      }

      // MyMemory / gtx có thể gọi thẳng từ trang (CORS tùy endpoint)
      if (msg.type === "MYMEMORY_TRANSLATE" || msg.type === "TRANSLATE") {
        emptyResponse(sendResponse, { error: "use-page-translate" });
        return;
      }

      emptyResponse(sendResponse);
    };
  }

  if (!chrome.storage) {
    chrome.storage = {
      local: {
        get: function (keys, cb) {
          var out = {};
          try {
            var list = Array.isArray(keys)
              ? keys
              : keys && typeof keys === "object"
                ? Object.keys(keys)
                : keys
                  ? [keys]
                  : [];
            list.forEach(function (k) {
              var v = localStorage.getItem("sr-chrome-" + k);
              if (v != null) {
                try {
                  out[k] = JSON.parse(v);
                } catch (e) {
                  out[k] = v;
                }
              } else if (keys && typeof keys === "object" && !Array.isArray(keys)) {
                out[k] = keys[k];
              }
            });
          } catch (e) {}
          cb && cb(out);
        },
        set: function (items, cb) {
          try {
            Object.keys(items || {}).forEach(function (k) {
              localStorage.setItem(
                "sr-chrome-" + k,
                JSON.stringify(items[k])
              );
            });
          } catch (e) {}
          cb && cb();
        },
      },
    };
  }

  console.log("[Story Reader] bookmark shim ready — base:", BASE);
})();
