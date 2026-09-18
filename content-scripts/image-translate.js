/**
 * Dịch chữ truyện tranh — gắn overlay CỐ ĐỊNH trên từng ảnh (cuộn theo nội dung).
 *
 * Giống dịch truyện chữ: xử lý cả chương (mọi panel), chữ đè bubble, không dính viewport.
 *
 * Pipeline:
 *  1) Tìm img panel trong trang
 *  2) Lấy pixel: background fetch → canvas clone → capture vùng ảnh
 *  3) CV bubble + OCR (Gemini / OCR.space) + dịch
 *  4) position:absolute % trên parent ảnh
 *
 * localStorage: sr-gemini-key, sr-ocr-key, sr-target-lang
 */
(function () {
  "use strict";

  var overlays = [];
  var ocrBackoffUntil = 0;
  var processedImgs = new WeakSet();

  function clearOverlays() {
    overlays.forEach(function (el) {
      try {
        el.remove();
      } catch (e) {}
    });
    overlays = [];
    processedImgs = new WeakSet();
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

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  /** Bỏ dòng OCR là UI/ads trang manga */
  function isJunkOcrLine(s) {
    s = String(s || "").trim();
    if (s.length < 2) return true;
    if (/truyenqq|truyenccc|foxtruyen|nettruyen|webtoon|\.com|\.net|\.gg|truyencap/i.test(s))
      return true;
    if (/chapter\s*\d+|theo dõi|follow\s*up|server\s*\d+|báo lỗi|quảng cáo/i.test(s))
      return true;
    if (/cải kho|tốc độ|smooth read|read stor|comic code|update new/i.test(s))
      return true;
    if (/tủ sách|xinh xinh|đọc truyện miễn phí|cấp nhật chương/i.test(s)) return true;
    if (/cinder.?s tea|tea time team/i.test(s)) return true;
    if (/^[\d\W]+$/.test(s)) return true;
    if (/0\/x1|from the\?/i.test(s)) return true;
    if (/huge story|comic code|tu sacho|xinh xinh|star child|beautiful boys/i.test(s)) return true;
    if (/damn it$|^name$|^fc$|^boys$/i.test(s)) return true;
    return false;
  }

  function cleanOcrLines(raw) {
    return String(raw || "")
      .replace(/\r/g, "")
      .split(/\n+/)
      .map(function (l) {
        return l.replace(/^[\d\-•\*]+\.?\s*/, "").trim();
      })
      .filter(function (l) {
        return l.length > 1 && !isJunkOcrLine(l);
      });
  }

  /** Có dấu tiếng Việt */
  function looksVietnamese(s) {
    return /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóọỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(
      String(s || "")
    );
  }

  /** Chủ yếu ASCII Latin → gần như tiếng Anh */
  function looksEnglish(s) {
    s = String(s || "").trim();
    if (looksVietnamese(s)) return false;
    var letters = (s.match(/[a-zA-Z]/g) || []).length;
    return letters >= 4 && letters / Math.max(1, s.replace(/\s/g, "").length) > 0.55;
  }




  /** Ảnh panel truyện (bỏ icon/ads nhỏ) */
  function collectPanelImages(root) {
    root = root || document.body;
    var list = [];
    var seen = new Set();
    var nodes = root.querySelectorAll(
      ".page-chapter img, .chapter-content img, .reading-detail img, " +
        "#chapter-content img, .viewer-img, img.lazy, img.lozad, " +
        "img[data-src], img[data-original], article img, main img, .container img"
    );
    if (!nodes.length) nodes = root.querySelectorAll("img");
    nodes.forEach(function (img) {
      if (img.closest && img.closest("[id^='sr-']")) return;
      if (processedImgs.has(img)) return;
      var src =
        img.currentSrc ||
        img.src ||
        img.getAttribute("data-src") ||
        img.getAttribute("data-original") ||
        img.getAttribute("data-url") ||
        "";
      if (!src || src.indexOf("data:") === 0) return;
      if (/avatar|icon|logo|emoji|button|ads|banner|pixel/i.test(src)) return;
      var w = Math.max(img.naturalWidth || 0, img.clientWidth || 0, img.width || 0);
      var h = Math.max(img.naturalHeight || 0, img.clientHeight || 0, img.height || 0);
      if (w && h && (w < 200 || h < 200)) return;
      // banner ads thường rất ngang
      if (w && h && w / h > 3.2) return;
      if (/banner|ads|qc-|quangcao|logo/i.test(src)) return;
      if (seen.has(src)) return;
      seen.add(src);
      list.push(img);
    });
    return list;
  }

  function ensureRelativeParent(img) {
    var p = img.parentElement;
    if (!p) return img;
    var st = window.getComputedStyle(p);
    if (st.position === "static") {
      p.style.position = "relative";
    }
    // tránh overflow cắt chữ
    if (st.overflow === "hidden") {
      try {
        p.style.overflow = "visible";
      } catch (e) {}
    }
    return p;
  }

  /**
   * Overlay % trên parent ảnh — cuộn theo trang, cố định với panel.
   * box: tọa độ trên ảnh natural (hoặc canvas cùng tỉ lệ).
   */
  function placeOnImage(img, box, imgW, imgH, text, meta) {
    text = (text || "").trim();
    if (!text || !imgW || !imgH) return;
    meta = meta || {};

    // Wrap img để % bám đúng khung ảnh
    var parent = img.parentElement;
    if (!img.dataset.srOcrWrap) {
      var wrap = document.createElement("div");
      wrap.className = "sr-ocr-img-wrap";
      wrap.style.cssText =
        "position:relative;display:block;width:100%;line-height:0;max-width:100%";
      if (img.parentNode) {
        img.parentNode.insertBefore(wrap, img);
        wrap.appendChild(img);
      }
      img.dataset.srOcrWrap = "1";
      parent = wrap;
    } else {
      parent = img.closest(".sr-ocr-img-wrap") || ensureRelativeParent(img);
    }

    // box trên canvas crop; meta offset nếu chỉ thấy 1 phần ảnh
    var ox = meta.offsetX || 0;
    var oy = meta.offsetY || 0;
    var vw = meta.visibleW || 1;
    var vh = meta.visibleH || 1;
    var left = (ox + (box.x / imgW) * vw) * 100;
    var top = (oy + (box.y / imgH) * vh) * 100;
    var width = (box.w / imgW) * vw * 100;
    var height = (box.h / imgH) * vh * 100;

    // Font theo chiều cao bubble
    var boxPxH = Math.max(20, (box.h / imgH) * (img.clientHeight || 400));
    var fs = Math.max(10, Math.min(16, Math.round(boxPxH * 0.22)));
    if (text.length > 40) fs = Math.max(10, fs - 1);
    if (text.length > 80) fs = Math.max(9, fs - 1);

    // Nới box một chút để che kín chữ gốc
    var padX = 0.4;
    var padY = 0.3;
    left = Math.max(0, left - padX);
    top = Math.max(0, top - padY);
    width = Math.min(100 - left, width + padX * 2);
    height = Math.min(100 - top, Math.max(height, height * 1.05) + padY * 2);

    var el = document.createElement("div");
    el.className = "sr-img-ocr-overlay sr-bubble-on-img";
    el.textContent = text;
    el.style.cssText = [
      "position:absolute",
      "left:" + left.toFixed(2) + "%",
      "top:" + top.toFixed(2) + "%",
      "width:" + Math.max(10, width).toFixed(2) + "%",
      "height:" + Math.max(5, height).toFixed(2) + "%",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "text-align:center",
      "z-index:60",
      "background:#ffffff",
      "color:#111",
      "padding:4px 6px",
      "font:" + fs + "px/" + (fs + 3) + "px system-ui,-apple-system,'Segoe UI',sans-serif",
      "font-weight:600",
      "border-radius:8px",
      "border:1px solid rgba(0,0,0,0.08)",
      "box-sizing:border-box",
      "white-space:pre-wrap",
      "overflow:hidden",
      "pointer-events:auto",
      "box-shadow:0 2px 8px rgba(0,0,0,0.15)",
      "line-height:1.3",
      "word-break:break-word",
    ].join(";");
    el.title = "Click ẩn";
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      el.remove();
    });
    parent.appendChild(el);
    overlays.push(el);
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

  function fetchImageB64(url) {
    return new Promise(function (resolve, reject) {
      if (!runtimeOk()) return reject(new Error("context invalidated"));
      chrome.runtime.sendMessage(
        {
          type: "FETCH_IMAGE_B64",
          url: url,
          referer: location.href,
        },
        function (resp) {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
          if (resp && resp.ok && resp.dataUrl) resolve(resp.dataUrl);
          else reject(new Error((resp && resp.error) || "fetch img fail"));
        }
      );
    });
  }

  function dataUrlToCanvas(dataUrl) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () {
        var c = document.createElement("canvas");
        c.width = im.naturalWidth || im.width;
        c.height = im.naturalHeight || im.height;
        c.getContext("2d").drawImage(im, 0, 0);
        resolve(c);
      };
      im.onerror = function () {
        reject(new Error("decode fail"));
      };
      im.src = dataUrl;
    });
  }

  /** Chụp viewport rồi crop đúng vùng ảnh trên màn hình */
  async function canvasFromVisibleImg(img) {
    var rect = img.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 30) throw new Error("img not visible");
    // Clip phần giao với viewport
    var top = Math.max(0, rect.top);
    var left = Math.max(0, rect.left);
    var bottom = Math.min(window.innerHeight, rect.bottom);
    var right = Math.min(window.innerWidth, rect.right);
    var vw = right - left;
    var vh = bottom - top;
    if (vw < 40 || vh < 40) throw new Error("offscreen");

    setExtUiVisible(false);
    await sleep(100);
    var shot = await captureTab();
    setExtUiVisible(true);
    var full = await dataUrlToCanvas(shot);
    var dpr = full.width / Math.max(1, window.innerWidth);
    // fallback dpr
    if (!isFinite(dpr) || dpr < 0.5 || dpr > 4) dpr = window.devicePixelRatio || 1;

    var sx = Math.max(0, Math.round(left * dpr));
    var sy = Math.max(0, Math.round(top * dpr));
    var sw = Math.min(full.width - sx, Math.round(vw * dpr));
    var sh = Math.min(full.height - sy, Math.round(vh * dpr));
    if (sw < 24 || sh < 24) throw new Error("crop tiny");

    var c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    c.getContext("2d").drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
    // Ghi offset trong ảnh hiển thị (khi chỉ crop phần visible)
    c.__srOffsetX = (left - rect.left) / Math.max(1, rect.width);
    c.__srOffsetY = (top - rect.top) / Math.max(1, rect.height);
    c.__srVisibleW = vw / Math.max(1, rect.width);
    c.__srVisibleH = vh / Math.max(1, rect.height);
    return c;
  }

  /**
   * Lấy pixel panel KHÔNG cuộn trang (giống dịch truyện chữ).
   * Thứ tự: bg fetch → decode img đã load → crop phần đang hiện trên màn hình.
   * Ảnh ngoài viewport → throw "not visible" (caller bỏ qua / chờ user cuộn).
   */
  async function panelToCanvas(img) {
    var src =
      img.currentSrc ||
      img.src ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-url") ||
      "";

    // 1) Background fetch (CORS bypass) — không cần ảnh trong viewport
    if (src && src.indexOf("data:") !== 0) {
      try {
        var r = await new Promise(function (resolve) {
          if (!runtimeOk()) return resolve(null);
          chrome.runtime.sendMessage(
            { type: "FETCH_IMAGE_B64", url: src, referer: location.href },
            function (resp) {
              if (chrome.runtime.lastError) return resolve(null);
              resolve(resp);
            }
          );
        });
        if (r && r.ok && r.dataUrl) {
          var c1 = await dataUrlToCanvas(r.dataUrl);
          if (c1 && c1.width > 40 && c1.height > 40) return c1;
        }
      } catch (eFetch) {
        console.warn("[OCR] bg fetch", eFetch && eFetch.message ? eFetch.message : eFetch);
      }
    }

    // 2) Clone từ <img> đã decode (cùng origin / đã CORS)
    try {
      if (img.complete && (img.naturalWidth || 0) > 40) {
        var c2 = document.createElement("canvas");
        c2.width = img.naturalWidth;
        c2.height = img.naturalHeight;
        c2.getContext("2d").drawImage(img, 0, 0);
        // Test tainted
        try {
          c2.getContext("2d").getImageData(0, 0, 1, 1);
          return c2;
        } catch (tainted) {}
      }
    } catch (eClone) {}

    // 3) Chỉ crop phần đang hiện — KHÔNG scrollIntoView
    var rect = img.getBoundingClientRect();
    var visH =
      Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top);
    var visW =
      Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left);
    if (visH < 60 || visW < 60) {
      throw new Error("not visible");
    }
    try {
      var c3 = await canvasFromVisibleImg(img);
      if (c3 && c3.width > 40) return c3;
    } catch (eCap) {
      console.warn("[OCR] capture", eCap && eCap.message ? eCap.message : eCap);
    }

    throw new Error("cannot read panel");
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
    var data = sctx.getImageData(0, 0, sw, sh).data;
    var n = sw * sh;
    var mask = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      var g = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) | 0;
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
    var minArea = Math.max(350, (sw * sh) / 130);
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
      if (bw < 18 || bh < 12) continue;
      var aspect = bw / bh;
      if (aspect > 8 || aspect < 0.14) continue;
      if (area / (bw * bh) < 0.2) continue;
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
    if (boxes.length > 8) boxes = boxes.slice(0, 8);
    return boxes;
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
    while (out.length > 300000 && q > 0.5) {
      q -= 0.08;
      out = c.toDataURL("image/jpeg", q);
    }
    return out;
  }

  function shrinkCanvas(canvas, maxW) {
    maxW = maxW || 1100;
    if (canvas.width <= maxW) {
      return canvas.toDataURL("image/jpeg", 0.86);
    }
    var s = maxW / canvas.width;
    var c = document.createElement("canvas");
    c.width = maxW;
    c.height = Math.round(canvas.height * s);
    c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.86);
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

  /** Ngôn ngữ OCR.space theo host / target */
  function ocrLangs() {
    var host = (location.hostname || "").toLowerCase();
    var tl = (targetLang() || "vi").toLowerCase();
    // Trang VN: ưu tiên vie rồi eng
    if (/nettruyen|truyenqq|truyentranh|nguontruyen|blogtruyen|truyenfull/.test(host) || tl === "vi" || tl === "vie") {
      return ["vie", "eng"];
    }
    if (tl === "ja" || tl === "jpn") return ["jpn", "eng"];
    if (tl === "ko" || tl === "kor") return ["kor", "eng"];
    if (tl === "zh" || tl === "zh-CN" || tl === "chs") return ["chs", "eng"];
    return ["eng", "vie"];
  }

  function ocrSpaceOnce(dataUrl, lang) {
    return new Promise(function (resolve, reject) {
      if (!runtimeOk()) return reject(new Error("context invalidated"));
      if (Date.now() < ocrBackoffUntil)
        return reject(new Error("OCR rate-limit"));
      chrome.runtime.sendMessage(
        {
          type: "OCR_SPACE",
          dataUrl: dataUrl,
          lang: lang || "eng",
          apiKey: getOcrKey(),
        },
        function (resp) {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
          if (resp && resp.ok) resolve(resp.text || "");
          else {
            var err = (resp && resp.error) || "ocr fail";
            if (/429|503/.test(String(err))) ocrBackoffUntil = Date.now() + 120000;
            reject(new Error(err));
          }
        }
      );
    });
  }

  /**
   * Free OCR.space: CHỈ 1 ngôn ngữ / 1 request (tránh 429).
   * Có OCR key riêng hoặc Gemini → có thể thử fallback.
   */
  async function ocrSpace(dataUrl) {
    var langs = ocrLangs();
    var hasOwnKey = !!(getOcrKey() && getOcrKey() !== "helloworld");
    // Free helloworld: chỉ lang đầu tiên
    if (!hasOwnKey) langs = langs.slice(0, 1);
    var lastErr = "";
    for (var i = 0; i < langs.length; i++) {
      try {
        var text = await ocrSpaceOnce(dataUrl, langs[i]);
        if (text && String(text).trim().length > 1) {
          console.log("[OCR] ocr.space lang=" + langs[i], String(text).slice(0, 80));
          return text;
        }
      } catch (e) {
        lastErr = String(e && e.message ? e.message : e);
        if (/rate-limit|429/.test(lastErr)) throw e;
      }
    }
    if (lastErr) throw new Error(lastErr);
    return "";
  }

  /**
   * Dịch thông minh:
   * - Nếu OCR đã đúng ngôn ngữ đích → giữ nguyên (tránh vi→en khi target=vi)
   * - langpair cố định sl|tl (không dùng auto)
   */
  function translateText(text, tl) {
    tl = (tl || targetLang() || "vi").toLowerCase();
    return new Promise(function (resolve) {
      text = String(text || "").trim();
      if (!text) return resolve("");
      if (!runtimeOk()) return resolve(text);

      // Đã là tiếng Việt mà đích là vi → không dịch lại
      if ((tl === "vi" || tl === "vie") && looksVietnamese(text)) {
        return resolve(text);
      }
      // Đã Latin/Anh mà đích en → giữ
      if ((tl === "en" || tl === "eng") && looksEnglish(text) && !looksVietnamese(text)) {
        return resolve(text);
      }

      var sl = "auto";
      if (looksVietnamese(text)) sl = "vi";
      else if (looksEnglish(text)) sl = "en";
      if (sl === tl || (sl === "vi" && tl === "vie") || (sl === "en" && tl === "eng")) {
        return resolve(text);
      }

      chrome.runtime.sendMessage(
        {
          type: "MYMEMORY_TRANSLATE",
          text: text.slice(0, 900),
          langpair: sl + "|" + tl,
        },
        function (resp) {
          if (chrome.runtime.lastError) return resolve(text);
          if (resp && resp.ok && resp.translatedText) {
            var out = String(resp.translatedText).trim();
            // GTX đôi khi trả lại bản gốc / rác — ưu tiên bản có nghĩa
            if (!out || out === text) return resolve(text);
            // Nếu target vi nhưng ra toàn English & gốc có tiếng Việt → giữ gốc
            if (
              (tl === "vi" || tl === "vie") &&
              looksVietnamese(text) &&
              !looksVietnamese(out) &&
              looksEnglish(out)
            ) {
              return resolve(text);
            }
            resolve(out);
          } else resolve(text);
        }
      );
    });
  }

  async function processPanel(img, tl, silent) {
    var canvas = await panelToCanvas(img);
    var boxes = detectBubbles(canvas);
    console.log("[OCR] panel bubbles", boxes.length, canvas.width + "x" + canvas.height);

    var meta = {
      offsetX: canvas.__srOffsetX || 0,
      offsetY: canvas.__srOffsetY || 0,
      visibleW: canvas.__srVisibleW || 1,
      visibleH: canvas.__srVisibleH || 1,
    };
    var placed = 0;
    var geminiKey = getGeminiKey();

    // --- Gemini: 1 request / panel ---
    if (geminiKey) {
      try {
        var small = shrinkCanvas(canvas, 1000);
        var ai = (await ocrGemini(small, tl)).replace(/\r/g, "").trim();
        ai = ai.replace(/^```[\s\S]*?\n/, "").replace(/```$/, "").trim();
        var gLines = cleanOcrLines(ai);
        console.log("[OCR] gemini lines", gLines.length);
        if (gLines.length) {
          if (!boxes.length) {
            boxes = [
              {
                x: (canvas.width * 0.1) | 0,
                y: (canvas.height * 0.08) | 0,
                w: (canvas.width * 0.8) | 0,
                h: Math.min((canvas.height * 0.3) | 0, 160),
              },
            ];
          }
          if (gLines.length > boxes.length) {
            var per = Math.ceil(gLines.length / boxes.length);
            var grouped = [];
            for (var gg = 0; gg < boxes.length; gg++) {
              var chunk = gLines.slice(gg * per, (gg + 1) * per).join("\n");
              if (chunk) grouped.push(chunk);
            }
            gLines = grouped;
          }
          var gn = Math.min(boxes.length, gLines.length);
          for (var gi = 0; gi < gn; gi++) {
            var gout = (await translateText(gLines[gi], tl)) || gLines[gi];
            placeOnImage(img, boxes[gi], canvas.width, canvas.height, gout, meta);
            placed++;
            console.log("[OCR] placed", placed, String(gout).slice(0, 50));
          }
          if (placed) {
            processedImgs.add(img);
            return placed;
          }
        }
      } catch (eG) {
        console.warn("[OCR] gemini", eG.message || eG);
      }
    }

    // --- Free: CHỈ 1 OCR cả panel (không crop từng bubble → tránh 429) ---
    if (Date.now() < ocrBackoffUntil) {
      console.warn("[OCR] rate-limit active — skip panel");
      return 0;
    }
    try {
      var full = shrinkCanvas(canvas, 900);
      var raw = (await ocrSpace(full)).replace(/\r/g, "").trim();
      var lines = cleanOcrLines(raw);
      console.log("[OCR] full-panel lines", lines.length, (raw || "").slice(0, 100));
      if (!lines.length) return 0;

      if (!boxes.length) {
        boxes = [
          {
            x: (canvas.width * 0.08) | 0,
            y: (canvas.height * 0.08) | 0,
            w: (canvas.width * 0.84) | 0,
            h: Math.min((canvas.height * 0.35) | 0, 180),
          },
        ];
      }

      if (lines.length > boxes.length) {
        var per2 = Math.ceil(lines.length / boxes.length);
        var groups = [];
        for (var g = 0; g < boxes.length; g++) {
          var c2 = lines.slice(g * per2, (g + 1) * per2).join("\n");
          if (c2) groups.push(c2);
        }
        lines = groups;
      }

      var n = Math.min(boxes.length, lines.length);
      for (var i = 0; i < n; i++) {
        var out = (await translateText(lines[i], tl)) || lines[i];
        placeOnImage(img, boxes[i], canvas.width, canvas.height, out, meta);
        placed++;
        console.log("[OCR] placed", placed, String(out).slice(0, 50));
      }
      if (placed) processedImgs.add(img);
    } catch (eO) {
      console.warn("[OCR] full-panel", eO.message || eO);
      if (/429|503|rate|limit/i.test(String(eO.message || eO))) {
        ocrBackoffUntil = Date.now() + 60000;
      }
    }
    return placed;
  }

  function isImgMostlyVisible(img) {
    var r = img.getBoundingClientRect();
    var vh = window.innerHeight || 1;
    var vis = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    return vis > 80 && r.width > 60;
  }

  /**
   * Dịch manga KHÔNG tự cuộn trang.
   * Ưu tiên ảnh đang hiện trên màn hình (giống dịch chữ).
   * Gặp rate-limit → dừng sớm + hướng dẫn Gemini key.
   */
  async function translateInRoot(root, opts) {
    opts = opts || {};
    var tl = targetLang();
    if (!isMangaHost() && !opts.force) {
      if (!opts.silent)
        window.StoryReaderUI?.toast?.("Không phải trang truyện tranh", 2500);
      return 0;
    }

    var all = collectPanelImages(root);
    if (!all.length) {
      if (!opts.silent)
        window.StoryReaderUI?.toast?.("Không tìm thấy ảnh chapter", 3000);
      return 0;
    }

    // Visible trước, còn lại sau — không scroll
    var visible = [];
    var hidden = [];
    all.forEach(function (img) {
      if (isImgMostlyVisible(img)) visible.push(img);
      else hidden.push(img);
    });
    var imgs = visible.concat(hidden);

    if (!opts.silent) {
      window.StoryReaderUI?.toast?.(
        "Đang dịch truyện tranh 0/" + imgs.length + "…",
        60000
      );
    }

    var total = 0;
    var lastErr = "";
    var hitLimit = false;
    var hasGemini = !!getGeminiKey();
    // Free: tối đa 4 panel / lần bấm (tránh đốt hết quota OCR.space)
    var limit = hasGemini ? imgs.length : Math.min(imgs.length, 4);

    for (var i = 0; i < limit; i++) {
      if (Date.now() < ocrBackoffUntil) {
        hitLimit = true;
        break;
      }
      var img = imgs[i];
      try {
        var n = await processPanel(img, tl, opts.silent);
        total += n;
        if (!opts.silent) {
          window.StoryReaderUI?.toast?.(
            "Đang dịch " + (i + 1) + "/" + limit + " (" + total + " bubble)…",
            60000
          );
        }
      } catch (e) {
        lastErr = String(e && e.message ? e.message : e);
        console.warn("[OCR] panel", lastErr);
        if (/rate-limit|429/.test(lastErr)) {
          hitLimit = true;
          break;
        }
      }
      // Free OCR.space: nghỉ 3s giữa panel
      await sleep(hasGemini ? 500 : 3000);
    }

    if (!opts.silent) {
      if (total > 0) {
        var msg =
          "✓ Đã gắn " + total + " bubble → " + tl;
        if (hitLimit)
          msg += " (OCR limit — thêm Gemini key hoặc đợi 2 phút)";
        window.StoryReaderUI?.toast?.(msg, 5000);
      } else {
        var hint = lastErr || "không đọc được chữ";
        if (hitLimit || Date.now() < ocrBackoffUntil)
          hint =
            "OCR.space free limit — đợi ~1 phút rồi dịch lại, hoặc thêm Gemini key (Cài đặt)";
        window.StoryReaderUI?.toast?.("OCR: " + String(hint).slice(0, 160), 7000);
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
  console.log("[Story Reader] image-translate.js loaded (fixed-on-image overlays)");
})();
