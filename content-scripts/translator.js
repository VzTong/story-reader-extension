/**
 * Module dịch trang (Giai đoạn 4 — MyMemory).
 *
 * Luồng:
 * 1) collectTextNodes(): TreeWalker lấy text node trong vùng nội dung (bỏ script/style/UI extension).
 * 2) chunkBySize(): gộp ≤500 ký tự/request (giới hạn MyMemory).
 * 3) translatePage(targetLang): gọi background MYMEMORY_TRANSLATE, ghi đè nodeValue.
 * 4) originalTextMap (WeakMap): lưu bản gốc để undo / toggle.
 *
 * API: window.StoryTranslator
 *  - translatePage(targetLang)  targetLang mặc định "vi"
 *  - restoreOriginal()
 *  - toggleOriginal()
 *  - isTranslated()
 *
 * Giới hạn MyMemory: ~500 ký tự/request, ~5000 ký tự/ngày (ẩn danh).
 */
(function () {
  "use strict";

  /** @type {WeakMap<Text, string>} */
  var originalTextMap = new WeakMap();
  /** Danh sách node đã đụng tới trong lần dịch gần nhất (WeakMap không iterate được) */
  var touchedNodes = [];
  var showingOriginal = false;
  var isBusy = false;
  var dailyCharsKey = "sr-translate-chars-" + new Date().toISOString().slice(0, 10);

  function getDailyChars() {
    try {
      return parseInt(localStorage.getItem(dailyCharsKey) || "0", 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function addDailyChars(n) {
    try {
      localStorage.setItem(dailyCharsKey, String(getDailyChars() + n));
    } catch (e) {}
  }

  /**
   * Lấy root nội dung — ưu tiên StoryDetector / selector chương, fallback body.
   */
  function getTranslateRoot() {
    if (window.StoryDetector && window.StoryDetector.detectContent) {
      // Không dựa text; lấy DOM
    }
    var sels = [
      ".cha-words",
      ".cha-content",
      ".chapter-content",
      ".chapter_content",
      "div.entry-content",
      "article .post-content",
      "article",
      "main",
      "#content",
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el && (el.innerText || "").trim().length > 80) return el;
    }
    return document.body;
  }

  /**
   * Duyệt text node có thể dịch (bỏ UI extension, script, input…).
   */
  function collectTextNodes(root) {
    root = root || getTranslateRoot();
    var out = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest("[id^='sr-']") || p.closest("#sr-bubble") || p.closest("#sr-menu") || p.closest("#sr-tts-panel"))
          return NodeFilter.FILTER_REJECT;
        var tag = p.tagName;
        if (
          tag === "SCRIPT" ||
          tag === "STYLE" ||
          tag === "NOSCRIPT" ||
          tag === "TEXTAREA" ||
          tag === "INPUT" ||
          tag === "CODE" ||
          tag === "PRE"
        )
          return NodeFilter.FILTER_REJECT;
        // Bỏ text quá ngắn (ký tự trang trí)
        if (node.nodeValue.trim().length < 2) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }

  /**
   * Gộp text node thành batch ≤ maxLen ký tự (MyMemory: 500).
   * Mỗi item: { nodes: Text[], text: string }
   */
  function chunkBySize(nodes, maxLen) {
    maxLen = maxLen || 500;
    var batches = [];
    var curNodes = [];
    var curText = "";
    for (var i = 0; i < nodes.length; i++) {
      var piece = nodes[i].nodeValue;
      if ((curText + piece).length > maxLen && curText.length > 0) {
        batches.push({ nodes: curNodes, text: curText });
        curNodes = [];
        curText = "";
      }
      // Node đơn lẻ dài hơn maxLen → cắt gửi từng khúc (ghi đè cả node bằng bản dịch ghép)
      if (piece.length > maxLen) {
        if (curText) {
          batches.push({ nodes: curNodes, text: curText });
          curNodes = [];
          curText = "";
        }
        batches.push({ nodes: [nodes[i]], text: piece.slice(0, maxLen) });
        continue;
      }
      curNodes.push(nodes[i]);
      curText += piece;
    }
    if (curText) batches.push({ nodes: curNodes, text: curText });
    return batches;
  }

  /**
   * Gọi background MyMemory.
   */
  function translateChunk(text, langpair) {
    return new Promise(function (resolve, reject) {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error("no chrome.runtime"));
        return;
      }
      chrome.runtime.sendMessage(
        { type: "MYMEMORY_TRANSLATE", text: text, langpair: langpair },
        function (resp) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp && resp.ok && resp.translatedText != null) {
            resolve(String(resp.translatedText));
          } else {
            reject(new Error((resp && resp.error) || "translate failed"));
          }
        }
      );
    });
  }

  /**
   * Phát hiện lang nguồn thô: nhiều ký tự CJK → zh, Latin → en, mặc định en.
   */
  function guessSourceLang(sample) {
    var s = sample || "";
    var cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    var vi = (s.match(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi) || []).length;
    if (cjk > 10) return "zh-CN";
    if (vi > 15) return "vi";
    return "en";
  }

  /**
   * Dịch toàn vùng nội dung sang targetLang (mặc định vi).
   */
  async function translatePage(targetLang) {
    if (isBusy) {
      window.StoryReaderUI?.toast?.("Đang dịch…");
      return false;
    }
    targetLang = targetLang || localStorage.getItem("sr-target-lang") || "vi";
    isBusy = true;
    try {
      var nodes = collectTextNodes();
      if (!nodes.length) {
        window.StoryReaderUI?.toast?.("Không tìm thấy text để dịch");
        return false;
      }

      // Lưu bản gốc (chỉ lần đầu trên mỗi node)
      touchedNodes = [];
      nodes.forEach(function (n) {
        if (!originalTextMap.has(n)) {
          originalTextMap.set(n, n.nodeValue);
        }
        touchedNodes.push(n);
      });

      var sample = nodes
        .slice(0, 8)
        .map(function (n) {
          return n.nodeValue;
        })
        .join(" ");
      var source = guessSourceLang(sample);
      if (source === targetLang) {
        // Đã cùng ngôn ngữ đích — thử en→vi
        source = source === "vi" ? "en" : source;
      }
      var langpair = source + "|" + targetLang;

      var used = getDailyChars();
      if (used > 4500) {
        window.StoryReaderUI?.toast?.(
          "Gần chạm hạn MyMemory (~5000 ký tự/ngày). Nên giảm dịch hoặc tự host LibreTranslate."
        );
      }

      var batches = chunkBySize(nodes, 480);
      window.StoryReaderUI?.toast?.("Đang dịch " + batches.length + " phần…");

      for (var b = 0; b < batches.length; b++) {
        var batch = batches[b];
        var translated = await translateChunk(batch.text, langpair);
        addDailyChars(batch.text.length);

        // Phân bổ bản dịch lại các node theo tỉ lệ độ dài (đơn giản: node đầu nhận hết nếu 1 node)
        if (batch.nodes.length === 1) {
          batch.nodes[0].nodeValue = translated;
        } else {
          // Gán cả chuỗi dịch vào node đầu, xóa text các node còn lại trong batch
          // (tránh cắt sai giữa từ; layout vẫn ổn với text liền mạch)
          batch.nodes[0].nodeValue = translated;
          for (var j = 1; j < batch.nodes.length; j++) {
            batch.nodes[j].nodeValue = " ";
          }
        }
      }

      showingOriginal = false;
      window.StoryReaderUI?.toast?.("Đã dịch xong → " + targetLang);
      window.StoryReaderUI?.onTranslateState?.({ translated: true, showingOriginal: false });
      return true;
    } catch (err) {
      console.warn("[Translate]", err);
      window.StoryReaderUI?.toast?.("Dịch lỗi: " + (err.message || err));
      return false;
    } finally {
      isBusy = false;
    }
  }

  /** Khôi phục toàn bộ text gốc đã lưu. */
  function restoreOriginal() {
    for (var i = 0; i < touchedNodes.length; i++) {
      var n = touchedNodes[i];
      if (originalTextMap.has(n)) {
        try {
          n.nodeValue = originalTextMap.get(n);
        } catch (e) {}
      }
    }
    showingOriginal = true;
    window.StoryReaderUI?.onTranslateState?.({ translated: true, showingOriginal: true });
    window.StoryReaderUI?.toast?.("Đã hiện bản gốc");
  }

  /** Áp lại bản dịch đã có trong session: dịch lại từ original map. */
  async function showTranslated() {
    // Đơn giản: dịch lại từ original
    for (var i = 0; i < touchedNodes.length; i++) {
      var n = touchedNodes[i];
      if (originalTextMap.has(n)) {
        try {
          n.nodeValue = originalTextMap.get(n);
        } catch (e) {}
      }
    }
    showingOriginal = false;
    return translatePage(localStorage.getItem("sr-target-lang") || "vi");
  }

  function toggleOriginal() {
    if (!touchedNodes.length) {
      window.StoryReaderUI?.toast?.("Chưa dịch trang nào");
      return;
    }
    if (showingOriginal) {
      // Hiện lại bản dịch: cần dịch lại vì không cache bản dịch riêng
      showTranslated();
    } else {
      restoreOriginal();
    }
  }

  function isTranslated() {
    return touchedNodes.length > 0 && !showingOriginal;
  }

  window.StoryTranslator = {
    translatePage: translatePage,
    restoreOriginal: restoreOriginal,
    toggleOriginal: toggleOriginal,
    isTranslated: isTranslated,
    collectTextNodes: collectTextNodes,
    chunkBySize: chunkBySize,
  };

  console.log("[Story Reader] translator.js loaded — StoryTranslator ready");
})();
