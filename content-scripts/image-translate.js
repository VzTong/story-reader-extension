/**
 * OCR chữ trong ảnh truyện tranh (capture viewport).
 *
 * Luồng:
 * 1) Ẩn UI extension (tránh OCR dính toast/menu)
 * 2) chrome.tabs.captureVisibleTab
 * 3) Nén JPEG ≤1200px (OCR.space free giới hạn size)
 * 4) OCR.space base64 → dịch → overlay
 */
(function () {
  "use strict";

  var overlays = [];

  function clearOverlays() {
    overlays.forEach(function (el) {
      try {
        el.remove();
      } catch (e) {}
    });
    overlays = [];
  }

  function placeOverlayViewport(text) {
    var box = document.createElement("div");
    box.className = "sr-img-ocr-overlay";
    box.textContent = text;
    box.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:80px;max-height:42vh;" +
      "overflow:auto;z-index:2147483000;" +
      "background:rgba(13,17,23,0.94);color:#e6edf3;padding:12px 14px;" +
      "font:14px/1.5 system-ui,sans-serif;border-radius:12px;" +
      "border:1px solid rgba(0,229,255,0.5);box-sizing:border-box;" +
      "white-space:pre-wrap;box-shadow:0 8px 32px rgba(0,0,0,0.45);";
    document.body.appendChild(box);
    overlays.push(box);
  }

  function setExtUiVisible(vis) {
    ["sr-bubble", "sr-menu", "sr-tts-panel", "sr-scroll-hud", "sr-toast"].forEach(
      function (id) {
        var el = document.getElementById(id);
        if (el) el.style.visibility = vis ? "" : "hidden";
      }
    );
    document.querySelectorAll(".sr-img-ocr-overlay").forEach(function (el) {
      el.style.visibility = vis ? "" : "hidden";
    });
  }

  function captureTab() {
    return new Promise(function (resolve, reject) {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        reject(new Error("Extension context invalidated — F5 sau Reload"));
        return;
      }
      chrome.runtime.sendMessage({ type: "CAPTURE_TAB" }, function (resp) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp && resp.ok && resp.dataUrl) resolve(resp.dataUrl);
        else
          reject(
            new Error((resp && resp.error) || "captureVisibleTab thất bại")
          );
      });
    });
  }

  /** Nén + thu nhỏ để OCR.space free nhận được */
  function shrinkDataUrl(dataUrl, maxW, quality) {
    maxW = maxW || 1100;
    quality = quality || 0.72;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, maxW / img.width);
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL("image/jpeg", quality));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () {
        reject(new Error("Không decode được ảnh chụp"));
      };
      img.src = dataUrl;
    });
  }

  function ocrSpaceData(dataUrl, lang) {
    return new Promise(function (resolve, reject) {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        reject(new Error("Extension context invalidated"));
        return;
      }
      chrome.runtime.sendMessage(
        { type: "OCR_SPACE", dataUrl: dataUrl, lang: lang || "eng" },
        function (resp) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp && resp.ok) resolve(resp.text || "");
          else reject(new Error((resp && resp.error) || "ocr fail"));
        }
      );
    });
  }

  function translateText(text) {
    var tl = localStorage.getItem("sr-target-lang") || "vi";
    return new Promise(function (resolve) {
      if (!text || text.trim().length < 1) {
        resolve("");
        return;
      }
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        resolve(text);
        return;
      }
      chrome.runtime.sendMessage(
        {
          type: "MYMEMORY_TRANSLATE",
          text: text.slice(0, 900),
          langpair: "auto|" + tl,
        },
        function (resp) {
          if (chrome.runtime.lastError) {
            resolve(text);
            return;
          }
          if (resp && resp.ok) resolve(resp.translatedText || text);
          else resolve(text);
        }
      );
    });
  }

  async function translateInRoot(root, opts) {
    opts = opts || {};
    clearOverlays();
    if (!opts.silent) {
      window.StoryReaderUI?.toast?.("Đang chụp + OCR vùng đang xem…", 25000);
    }

    var lastErr = "";
    try {
      setExtUiVisible(false);
      await new Promise(function (r) {
        setTimeout(r, 120);
      });

      var shot = await captureTab();
      var small = await shrinkDataUrl(shot, 1100, 0.7);
      var raw = await ocrSpaceData(small, "eng");
      raw = (raw || "").replace(/\r/g, "").trim();

      setExtUiVisible(true);

      if (raw.length > 2) {
        var out = await translateText(raw);
        placeOverlayViewport(out || raw);
        if (!opts.silent) {
          window.StoryReaderUI?.toast?.("✓ Đã OCR dịch vùng đang xem", 4000);
        }
        return 1;
      }
      lastErr = "OCR không thấy chữ (ảnh mờ / không có text)";
    } catch (e) {
      setExtUiVisible(true);
      lastErr = String(e && e.message ? e.message : e);
      console.warn("[OCR]", lastErr);
    }

    if (!opts.silent) {
      window.StoryReaderUI?.toast?.("OCR lỗi: " + lastErr.slice(0, 120), 6000);
    }
    return 0;
  }

  window.StoryImageTranslate = {
    translateVisibleImages: function () {
      return translateInRoot(document.body, { silent: false });
    },
    translateInRoot: translateInRoot,
    clearOverlays: clearOverlays,
  };
  console.log("[Story Reader] image-translate.js loaded (capture+shrink OCR)");
})();
