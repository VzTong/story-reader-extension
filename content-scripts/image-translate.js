/**
 * OCR + dịch chữ trong ảnh truyện tranh (Phase 1: CV bubble).
 *
 * Chỉ dùng trên manga. Không gọi từ luồng dịch text novel.
 *
 * 1) captureVisibleTab (tránh CORS CDN)
 * 2) CV threshold → bbox bubble
 * 3) OCR.space (chỉ eng — free key không nhận "vie")
 * 4) Dịch → overlay
 * Giới hạn request + dừng khi 429.
 */
(function () {
  "use strict";

  var overlays = [];
  var ocrBackoffUntil = 0;

  function clearOverlays() {
    overlays.forEach(function (el) {
      try {
        el.remove();
      } catch (e) {}
    });
    overlays = [];
  }

  function setExtUiVisible(vis) {
    ["sr-bubble", "sr-menu", "sr-tts-panel", "sr-scroll-hud", "sr-toast"].forEach(
      function (id) {
        var el = document.getElementById(id);
        if (el) el.style.visibility = vis ? "" : "hidden";
      }
    );
  }

  function runtimeOk() {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  }

  function isMangaHost() {
    var host = (location.hostname || "").toLowerCase();
    return /kagane|nettruyen|truyenqq|truyentranh|mangadex|webtoon|asura|newtruyen|comick|manhwa|manhua/.test(
      host
    );
  }

  function captureTab() {
    return new Promise(function (resolve, reject) {
      if (!runtimeOk()) return reject(new Error("context invalidated"));
      chrome.runtime.sendMessage({ type: "CAPTURE_TAB" }, function (resp) {
        if (chrome.runtime.lastError)
          return reject(new Error(chrome.runtime.lastError.message));
        if (resp && resp.ok && resp.dataUrl) resolve(resp.dataUrl);
        else reject(new Error((resp && resp.error) || "capture fail"));
      });
    });
  }

  function dataUrlToCanvas(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c);
      };
      img.onerror = function () {
        reject(new Error("decode fail"));
      };
      img.src = dataUrl;
    });
  }

  function detectBubbles(canvas) {
    var maxW = 900;
    var scale = Math.min(1, maxW / canvas.width);
    var sw = Math.max(1, Math.round(canvas.width * scale));
    var sh = Math.max(1, Math.round(canvas.height * scale));
    var small = document.createElement("canvas");
    small.width = sw;
    small.height = sh;
    var sctx = small.getContext("2d");
    sctx.drawImage(canvas, 0, 0, sw, sh);
    var img = sctx.getImageData(0, 0, sw, sh);
    var d = img.data;
    var n = sw * sh;
    var mask = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      var g = (d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) | 0;
      mask[i] = g >= 200 ? 1 : 0;
    }
    var mask2 = new Uint8Array(n);
    for (var y = 1; y < sh - 1; y++) {
      for (var x = 1; x < sw - 1; x++) {
        var p = y * sw + x;
        if (mask[p] && mask[p - 1] && mask[p + 1] && mask[p - sw] && mask[p + sw])
          mask2[p] = 1;
      }
    }
    mask = mask2;

    var visited = new Uint8Array(n);
    var boxes = [];
    var minArea = Math.max(500, (sw * sh) / 100);
    var maxArea = sw * sh * 0.4;

    for (var i = 0; i < n; i++) {
      if (!mask[i] || visited[i]) continue;
      var qx = [i % sw];
      var qy = [(i / sw) | 0];
      visited[i] = 1;
      var qi = 0;
      var minX = qx[0],
        maxX = qx[0],
        minY = qy[0],
        maxY = qy[0];
      var area = 0;
      while (qi < qx.length) {
        var cx = qx[qi];
        var cy = qy[qi];
        qi++;
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        var neigh = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (var k = 0; k < 4; k++) {
          var nx = neigh[k][0];
          var ny = neigh[k][1];
          if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
          var ni = ny * sw + nx;
          if (!mask[ni] || visited[ni]) continue;
          visited[ni] = 1;
          qx.push(nx);
          qy.push(ny);
        }
      }
      if (area < minArea || area > maxArea) continue;
      var bw = maxX - minX + 1;
      var bh = maxY - minY + 1;
      if (bw < 24 || bh < 18) continue;
      var aspect = bw / bh;
      if (aspect > 7 || aspect < 0.18) continue;
      if (area / (bw * bh) < 0.28) continue;
      var inv = 1 / scale;
      var pad = 4 * inv;
      var bx = Math.max(0, minX * inv - pad);
      var by = Math.max(0, minY * inv - pad);
      var bx2 = Math.min(canvas.width, (maxX + 1) * inv + pad);
      var by2 = Math.min(canvas.height, (maxY + 1) * inv + pad);
      boxes.push({
        x: bx | 0,
        y: by | 0,
        w: (bx2 - bx) | 0,
        h: (by2 - by) | 0,
      });
    }
    boxes.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
    // merge overlap
    var merged = [];
    boxes.forEach(function (b) {
      var hit = null;
      for (var j = 0; j < merged.length; j++) {
        var m = merged[j];
        var ox = Math.max(
          0,
          Math.min(b.x + b.w, m.x + m.w) - Math.max(b.x, m.x)
        );
        var oy = Math.max(
          0,
          Math.min(b.y + b.h, m.y + m.h) - Math.max(b.y, m.y)
        );
        if (ox * oy > 0.4 * Math.min(b.w * b.h, m.w * m.h)) {
          hit = m;
          break;
        }
      }
      if (hit) {
        var x1 = Math.min(hit.x, b.x);
        var y1 = Math.min(hit.y, b.y);
        var x2 = Math.max(hit.x + hit.w, b.x + b.w);
        var y2 = Math.max(hit.y + hit.h, b.y + b.h);
        hit.x = x1;
        hit.y = y1;
        hit.w = x2 - x1;
        hit.h = y2 - y1;
      } else merged.push(b);
    });
    if (merged.length > 6) merged = merged.slice(0, 6);
    console.log(
      "[OCR-CV] bubbles",
      merged.length,
      "on",
      canvas.width + "x" + canvas.height
    );
    return merged;
  }

  function cropToDataUrl(canvas, box) {
    var w = Math.max(1, box.w);
    var h = Math.max(1, box.h);
    var scale = w < 180 ? 2 : w < 360 ? 1.3 : w > 600 ? 600 / w : 1;
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, box.x, box.y, w, h, 0, 0, c.width, c.height);
    var q = 0.82;
    var out = c.toDataURL("image/jpeg", q);
    while (out.length > 400000 && q > 0.5) {
      q -= 0.1;
      out = c.toDataURL("image/jpeg", q);
    }
    return out;
  }

  function ocrSpaceData(dataUrl) {
    return new Promise(function (resolve, reject) {
      if (!runtimeOk()) return reject(new Error("context invalidated"));
      if (Date.now() < ocrBackoffUntil) {
        return reject(new Error("OCR rate-limit — đợi " + Math.ceil((ocrBackoffUntil - Date.now()) / 1000) + "s"));
      }
      var apiKey = "";
      try {
        apiKey = localStorage.getItem("sr-ocr-key") || "";
      } catch (e) {}
      // Chỉ eng — free OCR.space từ chối "vie" (E201)
      chrome.runtime.sendMessage(
        {
          type: "OCR_SPACE",
          dataUrl: dataUrl,
          lang: "eng",
          apiKey: apiKey,
        },
        function (resp) {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
          if (resp && resp.ok) resolve(resp.text || "");
          else {
            var err = (resp && resp.error) || "ocr fail";
            if (String(err).indexOf("429") !== -1 || String(err).indexOf("503") !== -1) {
              ocrBackoffUntil = Date.now() + 60000;
            }
            reject(new Error(err));
          }
        }
      );
    });
  }

  function translateText(text) {
    var tl = localStorage.getItem("sr-target-lang") || "vi";
    return new Promise(function (resolve) {
      if (!text || text.trim().length < 1) return resolve("");
      if (!runtimeOk()) return resolve(text);
      chrome.runtime.sendMessage(
        {
          type: "MYMEMORY_TRANSLATE",
          text: text.slice(0, 900),
          langpair: "auto|" + tl,
        },
        function (resp) {
          if (chrome.runtime.lastError) return resolve(text);
          if (resp && resp.ok) resolve(resp.translatedText || text);
          else resolve(text);
        }
      );
    });
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
      "white-space:pre-wrap;";
    document.body.appendChild(box);
    overlays.push(box);
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  /**
   * @param root ignored
   * @param opts.silent — không toast (vẫn không chạy trên non-manga)
   * @param opts.force — bỏ qua check host (hiếm)
   */
  async function translateInRoot(root, opts) {
    opts = opts || {};
    clearOverlays();

    // Chặn OCR trên truyện chữ / silent gọi nhầm
    if (!opts.force && !isMangaHost()) {
      var bigImgs = 0;
      try {
        document.querySelectorAll("img").forEach(function (img) {
          if (img.closest && img.closest("[id^='sr-']")) return;
          var w = Math.max(img.naturalWidth || 0, img.clientWidth || 0);
          var h = Math.max(img.naturalHeight || 0, img.clientHeight || 0);
          if (w >= 250 && h >= 250) bigImgs++;
        });
      } catch (e0) {}
      if (bigImgs < 3) {
        if (!opts.silent) {
          window.StoryReaderUI?.toast?.(
            "Không phải trang truyện tranh — bỏ OCR",
            2500
          );
        }
        return 0;
      }
    }

    if (!opts.silent) {
      window.StoryReaderUI?.toast?.("OCR vùng đang xem (CV)…", 25000);
    }

    var lastErr = "";
    var total = 0;
    try {
      setExtUiVisible(false);
      await sleep(150);
      var shot = await captureTab();
      setExtUiVisible(true);

      var canvas = await dataUrlToCanvas(shot);
      var boxes = detectBubbles(canvas);
      if (!boxes.length) {
        // vùng giữa màn (1 crop lớn) — chỉ khi manga
        boxes = [
          {
            x: (canvas.width * 0.08) | 0,
            y: (canvas.height * 0.1) | 0,
            w: (canvas.width * 0.84) | 0,
            h: (canvas.height * 0.7) | 0,
          },
        ];
      }

      var texts = [];
      var maxCrops = Math.min(boxes.length, 4);
      for (var i = 0; i < maxCrops; i++) {
        if (Date.now() < ocrBackoffUntil) {
          lastErr = "OCR rate-limit (429) — thử lại sau 1 phút hoặc set sr-ocr-key";
          break;
        }
        try {
          var dataUrl = cropToDataUrl(canvas, boxes[i]);
          var raw = (await ocrSpaceData(dataUrl)).replace(/\r/g, "").trim();
          if (raw.length > 2) {
            texts.push(await translateText(raw));
            total++;
          }
          await sleep(400); // giảm 429
        } catch (eOne) {
          lastErr = String(eOne.message || eOne);
          console.warn("[OCR-CV] crop", lastErr);
          if (lastErr.indexOf("429") !== -1 || lastErr.indexOf("503") !== -1) break;
        }
      }

      if (texts.length) {
        placeOverlayViewport(texts.join("\n\n——\n\n"));
      }
    } catch (e) {
      setExtUiVisible(true);
      lastErr = String(e && e.message ? e.message : e);
      console.warn("[OCR-CV]", lastErr);
    }

    if (!opts.silent) {
      if (total > 0) {
        window.StoryReaderUI?.toast?.("✓ OCR dịch " + total + " vùng", 4000);
      } else {
        window.StoryReaderUI?.toast?.(
          "OCR: " + (lastErr || "không đọc được chữ").slice(0, 120),
          5000
        );
      }
    }
    return total;
  }

  window.StoryImageTranslate = {
    translateVisibleImages: function () {
      return translateInRoot(document.body, { silent: false });
    },
    translateInRoot: translateInRoot,
    clearOverlays: clearOverlays,
  };
  console.log("[Story Reader] image-translate.js loaded (capture-only CV OCR)");
})();
