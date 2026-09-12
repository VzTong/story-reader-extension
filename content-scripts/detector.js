/**
 * Content detector — lấy text chương từ trang truyện.
 *
 * Thứ tự ưu tiên:
 * 1) Site đặc thù (webnovel: gộp mọi khối .cha-words đang có trên trang).
 * 2) Mozilla Readability trên bản clone DOM.
 * 3) Heuristic selector (.chapter-content, article, …).
 *
 * cleanText(): loại UI rác (gift, ranking, nút next/prev, ngày tháng…).
 * API: StoryDetector.detectContent() → { title, text, source } | null
 *       StoryDetector.waitForContent(ms) → Promise kết quả khi text đủ dài.
 */


function cleanText(text) {
  if (!text) return "";

  return text
    // UI / gift / ranking webnovel
    .replace(/Load failed[\s\S]{0,150}?(?:Like|Gifts?|Vote|Power)/gi, " ")
    .replace(/Wanna gift[\s\S]{0,80}?one\.?/gi, " ")
    .replace(/SEND GIFT/gi, " ")
    .replace(/Weekly Power[\s\S]{0,100}/gi, " ")
    .replace(/Power Ranking[\s\S]{0,80}/gi, " ")
    .replace(/Power stone[\s\S]{0,60}/gi, " ")
    // Bỏ chuỗi ***** dài
    .replace(/\*{4,}/g, "")
    // Bỏ "Edit: xxx"
    .replace(/Edit\s*:\s*[\w\-_.]+/gi, "")
    // Bỏ ngày tháng
    .replace(/\b\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}\b/g, "")
    .replace(/\b\d{4}[./\-]\d{1,2}[./\-]\d{1,2}\b/g, "")
    // Bỏ cụm điều hướng
    .replace(/(chương|chapter|hồi)\s*(trước|sau|tiếp|prev|next|previous)/gi, "")
    .replace(/bài\s*(trước|tiếp theo)/gi, "")
    // Bỏ tiêu đề truyện bị lặp (nguontruyen)
    .replace(/Truyện\s+Sau Khi Nữ Cải Nam Trang Tôi Cầm Kịch Bản Nam Chính/gi, "")
    .replace(/Sau Khi Nu Cai Nam Trang Toi Cam Kich Ban Nam Chinh/gi, "")
    // Bỏ khoảng trắng thừa
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function getBetterTitle() {
  // Ưu tiên cao cho nguontruyen
  const specific = [
    "h1",
    ".chapter-title",
    ".cha-title",
    ".title",
    "[class*='chapter']",
    "[class*='chap-title']",
    ".entry-title"
  ];

  for (const sel of specific) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const t = cleanText(el.innerText || el.textContent || "");
      if (t && t.length >= 4 && t.length < 120 && !/edit|ngày|date/i.test(t)) {
        return t;
      }
    }
  }

  // Lấy từ breadcrumb hoặc select box (nguontruyen hay dùng)
  const select = document.querySelector("select, .chapter-select, [name*='chapter']");
  if (select && select.options && select.selectedIndex >= 0) {
    const t = cleanText(select.options[select.selectedIndex].text);
    if (t) return t;
  }

  // Fallback document.title
  let docTitle = (document.title || "").split(/[-|–—]/)[0].trim();
  return cleanText(docTitle) || "Chương hiện tại";
}

/**
 * Webnovel: reader có thể gắn nhiều chapter trên cùng trang khi user/scroll load.
 * Gộp text mọi khối chapter tìm được (không chỉ chapter đang focus).
 */
function detectWebnovelChapters() {
  var host = (location.hostname || "").toLowerCase();
  if (host.indexOf("webnovel.com") === -1 && host.indexOf("webnovel.") === -1) return null;

  var parts = [];
  var seen = {};

  function pushText(raw) {
    var t = cleanText(raw || "");
    if (t.length < 40) return;
    var sig = t.slice(0, 80);
    if (seen[sig]) return;
    seen[sig] = true;
    parts.push(t);
  }

  /**
   * Mỗi chapter: lấy tiêu đề (cha-tit / h1…) + body (cha-words)
   * để TTS đọc luôn tên chương trước nội dung.
   */
  function pushChapterBlock(block) {
    if (!block || (block.closest && block.closest("nav, header, footer, .g_header"))) return;
    var titleEl = block.querySelector(
      ".cha-tit, .cha-title, h1, h2, h3, .chapter-title, [class*='cha-tit'], [class*='chapter-title']"
    );
    var bodyEl =
      block.querySelector(".cha-words, [class*='cha-words'], .cha-content") || block;
    // Tránh lấy cả block lồng nhau hai lần
    if (bodyEl !== block && block.classList && block.classList.contains("cha-words")) {
      bodyEl = block;
      titleEl = null;
    }
    var title = titleEl ? cleanText(titleEl.innerText || titleEl.textContent || "") : "";
    var body = cleanText(bodyEl.innerText || bodyEl.textContent || "");
    if (title && body.indexOf(title) === 0) {
      // body đã chứa title
      pushText(body);
    } else if (title && body) {
      pushText(title + ". " + body);
    } else {
      pushText(body || title);
    }
  }

  // Ưu tiên item chapter (mỗi chapter một khối)
  var chapterItems = document.querySelectorAll(
    ".j_chapter_item, .chapter_content_item, [class*='chapter-item'], [class*='cha-item']"
  );
  if (chapterItems.length) {
    chapterItems.forEach(pushChapterBlock);
  }

  // Các khối content còn lại
  var sels = [
    ".cha-content",
    ".cha-words",
    ".chapter-content",
    "[class*='cha-words']",
    "[class*='chapter_content']",
    "[class*='chapter-content']",
  ];
  for (var s = 0; s < sels.length; s++) {
    try {
      document.querySelectorAll(sels[s]).forEach(function (el) {
        if (el.closest && el.closest(".j_chapter_item, .chapter_content_item")) return;
        pushChapterBlock(el);
      });
    } catch (err) {}
  }

  if (!parts.length) {
    document.querySelectorAll("article, main, .reader").forEach(function (el) {
      pushText(el.innerText);
    });
  }

  if (!parts.length) return null;

  // Giữ thứ tự xuất hiện; nối bằng xuống dòng đôi
  var title = getBetterTitle() || document.title || "Webnovel";
  return {
    title: cleanText(title),
    text: parts.join("\n\n"),
    source: "webnovel-multi",
  };
}


function detectContent() {
  // Ưu tiên extractor webnovel (nhiều chapter trên 1 trang)
  try {
    var wn = detectWebnovelChapters();
    if (wn && wn.text && wn.text.length > 200) return wn;
  } catch (e0) {}
  try {
    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (article && article.textContent && article.textContent.trim().length > 200) {
      let cleanTitle = cleanText(article.title || "") || getBetterTitle();
      let body = cleanText(article.textContent);

      // Loại bỏ title bị lặp ở đầu body
      if (cleanTitle) {
        const escaped = cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        body = body.replace(new RegExp(escaped, "gi"), "").trim();
      }

      // Bỏ dòng "Chương x: ..." ở đầu
      body = body.replace(/^(chương|chapter|hồi)\s*\d+[.:]?\s*[^\n]{0,120}\n?/i, "").trim();

      // Nếu body bắt đầu bằng số hoặc chữ thừa thì cắt
      body = body.replace(/^[0-9\s:.\-]+/, "").trim();

      const fullText = cleanTitle ? `${cleanTitle}. ${body}` : body;

      return {
        title: cleanTitle || "Không có tiêu đề",
        text: fullText,
        source: "readability"
      };
    }
  } catch (e) {
    console.warn("Readability failed:", e);
  }

  // Fallback heuristic
  const contentSelectors = [
    ".cha-words",
    ".cha-content",
    ".chapter_content",
    ".novel-content",
    "[class*='chapter-content']",
    "[class*='chapter_content']",
    "div.entry-content",
    "article .post-content",
    "article",
    ".chapter-content",
    "#chapter-content",
    ".content-body",
    ".content",
    "main",
    "#content"
  ];

  for (const sel of contentSelectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 200) {
      let text = cleanText(el.innerText);
      let cleanTitle = getBetterTitle();

      if (cleanTitle && text.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
        text = text.slice(cleanTitle.length).trim();
      }

      const fullText = cleanTitle ? `${cleanTitle}. ${text}` : text;

      return {
        title: cleanTitle || "Không có tiêu đề",
        text: fullText,
        source: "heuristic"
      };
    }
  }

  return null;
}

function waitForContent(timeoutMs = 15000) {
  return new Promise((resolve) => {
    const result = detectContent();
    if (result && result.text.length > 200) {
      resolve(result);
      return;
    }

    const observer = new MutationObserver(() => {
      const result = detectContent();
      if (result && result.text.length > 200) {
        observer.disconnect();
        resolve(result);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(detectContent());
    }, timeoutMs);
  });
}

window.StoryDetector = {
  detectContent,
  waitForContent
};

console.log("[Story Reader] detector.js loaded");