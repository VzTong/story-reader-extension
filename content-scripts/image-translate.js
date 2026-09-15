/**
 * Dịch chữ trong truyện tranh — không popup to.
 *
 * Hiển thị: overlay nhỏ đè lên từng bubble (nền trắng + chữ dịch).
 *
 * Pipeline free (không cần key):
 *   capture → CV bubble → OCR.space helloworld → Google gtx dịch
 * Có Gemini key (tuỳ chọn): 1 request Vision OCR+dịch chính xác hơn.
 *
 * localStorage: sr-gemini-key, sr-ocr-key, sr-target-lang
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
    return /kagane|nettruyen|truyenqq|truyentranh|mangadex|webtoon|asura|newtruyen|comick|manhwa|manhua|toonily|asurascans/.test(
      host
    );
  }

  function getGeminiKey() {
    try {
      return (localStorage.getItem("sr-gemini-key") || "").trim();
    } catch (e) {
      return "";
    }
  }

  function getOcrKey() {
    try {
      return (localStorage.getItem("sr-ocr-key") || "").trim();
    } catch (e) {
      return "";
    }
  }

  function targetLang() {
    return localStorage.getItem("sr-target-lang") || "vi";
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

  function shrinkDataUrl(dataUrl, maxW, quality) {
    maxW = maxW || 1280;
    quality = quality || 0.86;
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
        reject(new Error("decode fail"));
      };
      img.src = dataUrl;
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
      mask[i] = g >= 198 ? 1 : 0;
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
    var minArea = Math.max(400, (sw * sh) / 120);
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
        maxY = qy[0],
        area = 0;
      while (qi < qx.length) {
        var cx = qx[qi];
        var cy = qy[qi];
        qi++;
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        var dirs = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (var k = 0; k < 4; k++) {
          var nx = dirs[k][0];
          var ny = dirs[k][1];
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
      if (bw < 20 || bh < 14) continue;
      var aspect = bw / bh;
      if (aspect > 7.5 || aspect < 0.15) continue;
      if (area / (bw * bh) < 0.22) continue;
      var inv = 1 / scale;
      var pad = 4 * inv;
      boxes.push({
        x: Math.max(0, minX * inv - pad) | 0,
        y: Math.max(0, minY * inv - pad) | 0,
        w:
          (Math.min(canvas.width, (maxX + 1) * inv + pad) -
            Math.max(0, minX * inv - pad)) |
          0,
        h:
          (Math.min(canvas.height, (maxY + 1) * inv + pad) -
            Math.max(0, minY * inv - pad)) |
          0,
      });
    }
    boxes.sort(function (a, b) {
      return a.y - b.y || a.x - b.x;
    });
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
        if (ox * oy > 0.35 * Math.min(b.w * b.h, m.w * m.h)) {
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
    if (merged.length > 10) merged = merged.slice(0, 10);
    return merged;
  }

  function cropToDataUrl(canvas, box) {
    var w = Math.max(1, box.w);
    var h = Math.max(1, box.h);
    var scale = w < 160 ? 2.2 : w < 320 ? 1.4 : w > 600 ? 600 / w : 1;
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, box.x, box.y, w, h, 0, 0, c.width, c.height);
    var q = 0.88;
    var out = c.toDataURL("image/jpeg", q);
    while (out.length > 320000 && q > 0.5) {
      q -= 0.08;
      out = c.toDataURL("image/jpeg", q);
    }
    return out;
  }

  function ocrGemini(dataUrl, tl) {
    return new Promise(function (resolve, reject) {
      if (!runtimeOk()) return reject(new Error("context invalidated"));
      var key = getGeminiKey();
      if (!key) return reject(new Error("no gemini key"));
      chrome.runtime.sendMessage(
        { type: "OCR_GEMINI", dataUrl: dataUrl, apiKey: key, targetLang: tl },
        function (resp) {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
          if (resp && resp.ok) resolve(resp.text || "");
          else reject(new Error((resp && resp.error) || "gemini fail"));
        }
      );
    });
  }

  function ocrSpace(dataUrl) {
    return new Promise(function (resolve, reject) {
      if (!runtimeOk()) return reject(new Error("context invalidated"));
      if (Date.now() < ocrBackoffUntil)
        return reject(new Error("OCR rate-limit"));
      chrome.runtime.sendMessage(
        {
          type: "OCR_SPACE",
          dataUrl: dataUrl,
          lang: "eng",
          apiKey: getOcrKey(),
        },
        function (resp) {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
          if (resp && resp.ok) resolve(resp.text || "");
          else {
            var err = (resp && resp.error) || "ocr fail";
            if (/429|503/.test(String(err))) ocrBackoffUntil = Date.now() + 90000;
            reject(new Error(err));
          }
        }
      );
    });
  }

  function translateText(text, tl) {
    tl = tl || targetLang();
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
          if (resp && resp.ok && resp.translatedText)
            resolve(String(resp.translatedText));
          else resolve(text);
        }
      );
    });
  }

  /** Overlay đè đúng vị trí bubble trên viewport (không popup to) */
  function placeBubbleOverlay(box, canvasW, canvasH, text) {
    var sx = window.innerWidth / canvasW;
    var sy = window.innerHeight / canvasH;
    // capture = viewport → map 1:1 theo tỉ lệ canvas/capture
    var left = box.x * (window.innerWidth / canvasW);
    var top = box.y * (window.innerHeight / canvasH);
    var width = Math.max(48, box.w * (window.innerWidth / canvasW));
    var height = Math.max(28, box.h * (window.innerHeight / canvasH));

    var el = document.createElement("div");
    el.className = "sr-img-ocr-overlay sr-bubble-overlay";
    el.textContent = text;
    el.style.cssText =
      "position:fixed;left:" +
      Math.round(left) +
      "px;top:" +
      Math.round(top) +
      "px;width:" +
      Math.round(width) +
      "px;min-height:" +
      Math.round(height * 0.5) +
      "px;max-height:" +
      Math.round(height * 1.4) +
      "px;overflow:auto;z-index:2147483000;" +
      "background:rgba(255,255,255,0.94);color:#111;" +
      "padding:4px 6px;font:12px/1.35 system-ui,sans-serif;" +
      "border-radius:6px;border:1px solid rgba(0,0,0,0.12);" +
      "box-sizing:border-box;white-space:pre-wrap;pointer-events:auto;" +
      "box-shadow:0 2px 8px rgba(0,0,0,0.18);";
    el.title = "Click để ẩn";
    el.addEventListener("click", function () {
      el.remove();
    });
    document.body.appendChild(el);
    overlays.push(el);
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function looksSameLang(a, b) {
    a = (a || "").replace(/\s+/g, "").toLowerCase();
    b = (b || "").replace(/\s+/g, "").toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    var n = Math.min(40, a.length, b.length);
    return n > 12 && a.slice(0, n) === b.slice(0, n);
  }

  async function ensureTranslated(raw, tl) {
    raw = (raw || "").trim();
    if (!raw) return "";
    var out = await translateText(raw, tl);
    // Nếu API trả về gần như gốc mà target khác khả năng nguồn — thử lại không đổi
    if (looksSameLang(raw, out) && tl !== "vi") {
      // raw có thể đã đúng ngôn ngữ đích
      return out;
    }
    // Truyện đã tiếng Việt + target vi → không phải lỗi, trả nguyên
    return out || raw;
  }

  async function translateInRoot(root, opts) {
    opts = opts || {};
    clearOverlays();

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
        if (!opts.silent)
          window.StoryReaderUI?.toast?.("Không phải trang truyện tranh", 2500);
        return 0;
      }
    }

    var tl = targetLang();
    var geminiKey = getGeminiKey();
    if (!opts.silent) {
      window.StoryReaderUI?.toast?.(
        geminiKey ? "AI OCR bubble…" : "OCR bubble (free)…",
        25000
      );
    }

    var lastErr = "";
    var placed = 0;

    try {
      setExtUiVisible(false);
      await sleep(120);
      var shot = await captureTab();
      setExtUiVisible(true);

      var canvas = await dataUrlToCanvas(shot);
      var boxes = detectBubbles(canvas);
      console.log("[OCR] bubbles", boxes.length, "lang→", tl);

      // --- Gemini: OCR từng vùng hoặc full rồi split ---
      if (geminiKey && boxes.length) {
        try {
          // Gửi full viewport 1 lần (đỡ tốn quota) + map text theo dòng
          var small = await shrinkDataUrl(shot, 1200, 0.85);
          var aiText = (await ocrGemini(small, tl)).replace(/\r/g, "").trim();
          aiText = aiText.replace(/^```[\s\S]*?\n/, "").replace(/```$/, "").trim();
          var lines = aiText
            .split(/\n+/)
            .map(function (l) {
              return l.replace(/^[\d\-•\*]+\s*/, "").trim();
            })
            .filter(function (l) {
              return l.length > 1;
            });
          // Gán dòng → bubble theo thứ tự
          var n = Math.min(boxes.length, lines.length);
          for (var i = 0; i < n; i++) {
            var line = lines[i];
            // Gemini đã dịch theo prompt; nếu vẫn giống OCR-style raw thì dịch lại
            var out = await ensureTranslated(line, tl);
            placeBubbleOverlay(boxes[i], canvas.width, canvas.height, out);
            placed++;
          }
          // Thừa dòng → gộp bubble cuối
          if (lines.length > boxes.length && boxes.length) {
            var rest = lines.slice(boxes.length).join(" ");
            if (rest) {
              var last = overlays[overlays.length - 1];
              if (last) last.textContent += "\n" + rest;
            }
          }
        } catch (eG) {
          lastErr = String(eG.message || eG);
          console.warn("[OCR] Gemini", lastErr);
        }
      }

      // --- Free: OCR từng bubble + dịch gtx ---
      if (!placed) {
        if (!boxes.length) {
          boxes = [
            {
              x: (canvas.width * 0.1) | 0,
              y: (canvas.height * 0.12) | 0,
              w: (canvas.width * 0.8) | 0,
              h: (canvas.height * 0.55) | 0,
            },
          ];
        }
        var maxC = Math.min(boxes.length, 5);
        for (var j = 0; j < maxC; j++) {
          if (Date.now() < ocrBackoffUntil) {
            lastErr = "OCR rate-limit — thêm Gemini key trong Cài đặt";
            break;
          }
          try {
            var crop = cropToDataUrl(canvas, boxes[j]);
            var raw = (await ocrSpace(crop)).replace(/\r/g, "").trim();
            if (raw.length < 2) continue;
            var translated = await ensureTranslated(raw, tl);
            placeBubbleOverlay(
              boxes[j],
              canvas.width,
              canvas.height,
              translated
            );
            placed++;
            await sleep(450);
          } catch (eOne) {
            lastErr = String(eOne.message || eOne);
            if (/429|503|rate/.test(lastErr)) break;
          }
        }
      }
    } catch (e) {
      setExtUiVisible(true);
      lastErr = String(e && e.message ? e.message : e);
      console.warn("[OCR]", lastErr);
    }

    if (!opts.silent) {
      if (placed > 0) {
        var note =
          tl === "vi"
            ? "✓ " +
              placed +
              " bubble (truyện đã tiếng Việt + đích vi → giữ nguyên chữ)"
            : "✓ Đã dịch " + placed + " bubble → " + tl;
        window.StoryReaderUI?.toast?.(note, 4000);
      } else {
        window.StoryReaderUI?.toast?.(
          "OCR: " + (lastErr || "không đọc được").slice(0, 120),
          5000
        );
      }
    }
    return placed;
  }

  window.StoryImageTranslate = {
    translateVisibleImages: function () {
      return translateInRoot(document.body, { silent: false });
    },
    translateInRoot: translateInRoot,
    clearOverlays: clearOverlays,
  };
  console.log("[Story Reader] image-translate.js loaded (bubble overlay, no popup)");
})();
