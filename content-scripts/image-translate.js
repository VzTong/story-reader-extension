/**
 * Dịch chữ trong ảnh (OCR) — Tesseract từ libs/ qua background.
 */
(function () {
  "use strict";

  var tesseractLoading = null;
  var overlays = [];
  var ocrDone = new WeakSet();

  function extUrl(path) {
    try {
      return chrome.runtime.getURL(path);
    } catch (e) {
      return path;
    }
  }

  function fetchExtText(path) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(
        { type: "FETCH_EXT_TEXT", path: path },
        function (resp) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp && resp.ok && resp.text) resolve(resp.text);
          else reject(new Error((resp && resp.error) || "empty"));
        }
      );
    });
  }

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractLoading) return tesseractLoading;
    tesseractLoading = (async function () {
      var code = await fetchExtText("libs/tesseract.min.js");
      (0, eval)(code);
      if (!window.Tesseract) throw new Error("Tesseract missing after eval");
      return window.Tesseract;
    })().catch(function (e) {
      console.warn("[OCR] load fail", e);
      tesseractLoading = null;
      return null;
    });
    return tesseractLoading;
  }

  function getContentRoot() {
    var sels = [
      "[class*='viewer']",
      "[class*='reading']",
      "[class*='manga']",
      "[class*='comic']",
      "[class*='chapter']",
      "article",
      "main",
      "#content",
      "body",
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el && el.querySelectorAll("img").length >= 1) return el;
    }
    return document.body;
  }

  function collectImageTargets(root, looseViewport) {
    root = root || getContentRoot();
    var vh = window.innerHeight || 800;
    var margin = looseViewport ? vh * 4 : vh * 0.5;
    var out = [];

    function inRange(el) {
      var r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) return false;
      if (r.bottom < -margin || r.top > vh + margin) return false;
      return true;
    }

    root.querySelectorAll("img").forEach(function (img) {
      if (img.closest && img.closest("[id^='sr-']")) return;
      if (!inRange(img)) return;
      var src = img.currentSrc || img.src || img.getAttribute("data-src") || "";
      if (!src) return;
      // bỏ icon nhỏ
      if (img.naturalWidth > 0 && img.naturalWidth < 80) return;
      out.push({ type: "img", el: img, src: src });
    });
    return out;
  }

  function clearOverlays() {
    overlays.forEach(function (el) {
      try {
        el.remove();
      } catch (e) {}
    });
    overlays = [];
  }

  function placeOverlay(el, text) {
    var r = el.getBoundingClientRect();
    var box = document.createElement("div");
    box.className = "sr-img-ocr-overlay";
    box.textContent = text;
    box.style.cssText =
      "position:fixed;left:" +
      Math.max(4, r.left) +
      "px;top:" +
      Math.max(4, r.top) +
      "px;width:" +
      Math.max(120, Math.min(r.width, window.innerWidth - 16)) +
      "px;max-height:" +
      Math.max(80, Math.min(r.height, window.innerHeight * 0.5)) +
      "px;overflow:auto;z-index:2147483000;" +
      "background:rgba(13,17,23,0.92);color:#e6edf3;padding:8px 10px;" +
      "font:13px/1.45 system-ui,sans-serif;border-radius:8px;" +
      "border:1px solid rgba(0,229,255,0.4);box-sizing:border-box;";
    document.body.appendChild(box);
    overlays.push(box);
  }

  function translateText(text) {
    var tl = localStorage.getItem("sr-target-lang") || "vi";
    return new Promise(function (resolve, reject) {
      if (!text || text.trim().length < 2) {
        resolve("");
        return;
      }
      chrome.runtime.sendMessage(
        {
          type: "MYMEMORY_TRANSLATE",
          text: text.slice(0, 450),
          langpair: "auto|" + tl,
        },
        function (resp) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp && resp.ok) resolve(resp.translatedText || "");
          else reject(new Error((resp && resp.error) || "fail"));
        }
      );
    });
  }

  async function ocrTarget(Tesseract, target) {
    if (ocrDone.has(target.el)) return null;
    var opts = {
      workerPath: extUrl("libs/tesseract.worker.min.js"),
      corePath:
        "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core.wasm.js",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: function () {},
    };
    var result;
    try {
      result = await Tesseract.recognize(target.el, "eng", opts);
    } catch (e1) {
      console.warn("[OCR] recognize with opts fail", e1);
      try {
        result = await Tesseract.recognize(target.el, "eng");
      } catch (e2) {
        console.warn("[OCR] recognize plain fail", e2);
        ocrDone.add(target.el);
        return null;
      }
    }
    var raw = (result && result.data && result.data.text) || "";
    raw = raw.replace(/\s+/g, " ").trim();
    if (raw.length < 2) {
      ocrDone.add(target.el);
      return null;
    }
    var out = raw;
    try {
      out = (await translateText(raw)) || raw;
    } catch (e) {}
    placeOverlay(target.el, out);
    ocrDone.add(target.el);
    return out;
  }

  async function translateInRoot(root, opts) {
    opts = opts || {};
    var targets = collectImageTargets(root, opts.loose !== false);
    if (!targets.length) {
      if (!opts.silent) {
        window.StoryReaderUI?.toast?.("Không thấy ảnh để OCR");
      }
      return 0;
    }
    if (!opts.silent) {
      window.StoryReaderUI?.toast?.("OCR " + targets.length + " ảnh…", 15000);
    }
    try {
      var Tesseract = await loadTesseract();
      if (!Tesseract) {
        if (!opts.silent) {
          window.StoryReaderUI?.toast?.(
            "Không load được Tesseract — Reload extension (libs/)",
            4000
          );
        }
        return 0;
      }
      var n = 0;
      // Giới hạn 8 ảnh / lần để không quá lâu
      var max = Math.min(targets.length, 8);
      for (var i = 0; i < max; i++) {
        try {
          var r = await ocrTarget(Tesseract, targets[i]);
          if (r) n++;
        } catch (e) {
          console.warn("[OCR] target", e);
        }
      }
      if (!opts.silent) {
        window.StoryReaderUI?.toast?.(
          n ? "✓ OCR dịch " + n + " ảnh" : "OCR xong — không đọc được chữ trong ảnh",
          3500
        );
      }
      return n;
    } catch (e) {
      console.warn("[OCR]", e);
      if (!opts.silent) {
        window.StoryReaderUI?.toast?.("OCR lỗi: " + (e.message || e), 4000);
      }
      return 0;
    }
  }

  window.StoryImageTranslate = {
    translateVisibleImages: function () {
      return translateInRoot(getContentRoot(), { loose: true, silent: false });
    },
    translateInRoot: translateInRoot,
    clearOverlays: clearOverlays,
  };
  console.log("[Story Reader] image-translate.js loaded");
})();
