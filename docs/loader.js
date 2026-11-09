/**
 * Story Reader — loader cho bookmarklet / mobile.
 *
 * Cách dùng (bookmark URL):
 * javascript:(function(){var s=document.createElement('script');s.src='https://vztong.github.io/story-reader-extension/loader.js?t='+Date.now();document.documentElement.appendChild(s);})();
 *
 * Loader sẽ:
 * 1) Gắn shim chrome.*
 * 2) Nạp CSS + JS theo thứ tự như manifest
 * 3) Tự showToolbar() (không cần popup)
 *
 * Giới hạn: CSP trang truyện có thể chặn script ngoài → dùng site ít CSP hoặc Kiwi.
 * OCR truyện tranh / capture tab: chỉ bản extension.
 */
(function () {
  "use strict";

  if (window.__SR_LOADER_DONE__) {
    try {
      window.StoryReaderUI &&
        window.StoryReaderUI.showToolbar &&
        window.StoryReaderUI.showToolbar();
    } catch (e) {}
    return;
  }
  window.__SR_LOADER_DONE__ = true;

  // Ưu tiên GitHub Pages; fallback jsDelivr (raw main)
  var PAGES = "https://vztong.github.io/story-reader-extension/";
  var CDN = "https://cdn.jsdelivr.net/gh/VzTong/story-reader-extension@main/";
  var BASE = window.__SR_BASE__ || PAGES;

  window.__SR_BASE__ = BASE;
  window.__SR_BOOKMARK_MODE__ = true;

  function loadCss(href) {
    return new Promise(function (resolve) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = function () {
        resolve(true);
      };
      link.onerror = function () {
        resolve(false);
      };
      (document.head || document.documentElement).appendChild(link);
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.async = false;
      s.src = src;
      s.onload = function () {
        resolve(true);
      };
      s.onerror = function () {
        reject(new Error("fail " + src));
      };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  async function tryBases(relPath, loaderFn) {
    var bases = [BASE, CDN, PAGES];
    var seen = {};
    for (var i = 0; i < bases.length; i++) {
      var b = bases[i];
      if (seen[b]) continue;
      seen[b] = true;
      try {
        var ok = await loaderFn(b + relPath);
        if (ok !== false) {
          BASE = b;
          window.__SR_BASE__ = b;
          return true;
        }
      } catch (e) {}
    }
    return false;
  }

  function toast(msg) {
    try {
      var el = document.createElement("div");
      el.textContent = msg;
      el.setAttribute(
        "style",
        "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
          "z-index:2147483647;background:#0d1117;color:#e6edf3;padding:10px 16px;" +
          "border-radius:10px;font:13px system-ui;border:1px solid rgba(0,229,255,.35);" +
          "box-shadow:0 8px 28px rgba(0,0,0,.4);max-width:90vw;text-align:center;"
      );
      document.documentElement.appendChild(el);
      setTimeout(function () {
        try {
          el.remove();
        } catch (e) {}
      }, 4500);
    } catch (e) {
      console.warn("[SR]", msg);
    }
  }

  async function main() {
    toast("Story Reader: đang tải…");

    // 1) Shim (cùng origin Pages hoặc CDN)
    var shimOk = false;
    try {
      await loadScript(BASE + "shim.js");
      shimOk = true;
    } catch (e1) {
      try {
        await loadScript(CDN + "docs/shim.js");
        window.__SR_BASE__ = CDN;
        BASE = CDN;
        shimOk = true;
      } catch (e2) {
        console.warn("[SR] shim fail", e2);
      }
    }
    if (!shimOk) {
      // inline minimal shim nếu file không về
      window.__SR_BOOKMARK_MODE__ = true;
      window.chrome = window.chrome || {};
      chrome.runtime = chrome.runtime || {
        id: "story-reader-bookmark",
        getURL: function (p) {
          return CDN + String(p || "").replace(/^\//, "");
        },
        sendMessage: function (m, cb) {
          cb && cb({ ok: false, error: "bookmark-mode" });
        },
        onMessage: { addListener: function () {} },
      };
    }

    // 2) CSS
    var cssOk = await loadCss(BASE + "ui/floating-toolbar.css").catch(
      function () {
        return false;
      }
    );
    if (!cssOk) {
      await loadCss(CDN + "ui/floating-toolbar.css").catch(function () {});
    }

    // 3) Scripts — cùng thứ tự manifest (bỏ image-translate: cần extension)
    var scripts = [
      "libs/readability.js",
      "content-scripts/detector.js",
      "content-scripts/translator.js",
      "content-scripts/tts-engine.js",
      "content-scripts/floating-toolbar.js",
    ];

    for (var i = 0; i < scripts.length; i++) {
      var path = scripts[i];
      try {
        await loadScript(BASE + path);
      } catch (err) {
        try {
          await loadScript(CDN + path);
        } catch (err2) {
          toast("Lỗi tải: " + path + " (CSP trang có thể chặn)");
          console.error("[SR] load", path, err2);
          return;
        }
      }
    }

    // 4) Hiện UI ngay (bookmark = bấm là chạy, không cần popup)
    function startUi() {
      try {
        if (window.StoryReaderUI && window.StoryReaderUI.showToolbar) {
          window.StoryReaderUI.showToolbar();
          toast("Story Reader sẵn sàng — bấm bubble để dùng");
          return true;
        }
      } catch (e) {
        console.warn("[SR] showToolbar", e);
      }
      return false;
    }

    if (!startUi()) {
      var n = 0;
      var t = setInterval(function () {
        n++;
        if (startUi() || n > 20) clearInterval(t);
      }, 150);
    }
  }

  main().catch(function (e) {
    console.error("[SR] loader", e);
    toast("Story Reader lỗi tải — xem Console / CSP");
  });
})();
