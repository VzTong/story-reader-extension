// ==UserScript==
// @name         Story Reader Auto (bookmark-free)
// @namespace    https://vztong.github.io/story-reader-extension/
// @version      0.9.23
// @description  Tự nạp Story Reader trên mọi trang — không cần bấm bookmark mỗi chương
// @author       VzTong
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  // Tránh chạy trên trang cài đặt / about
  var h = location.hostname || "";
  if (!h || h === "localhost") return;
  if (window.__SR_LOADER_DONE__ || window.__SR_SHIM__) return;

  // Chỉ auto khi đã từng dùng (có cờ) hoặc luôn bật — luôn bật cho tiện
  var s = document.createElement("script");
  s.src =
    "https://cdn.jsdelivr.net/gh/VzTong/story-reader-extension@main/docs/loader.js?t=" +
    Date.now();
  s.onerror = function () {
    var s2 = document.createElement("script");
    s2.src =
      "https://vztong.github.io/story-reader-extension/loader.js?t=" + Date.now();
    document.documentElement.appendChild(s2);
  };
  document.documentElement.appendChild(s);
})();
