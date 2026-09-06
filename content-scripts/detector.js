// content-scripts/detector.js

function cleanText(text) {
  if (!text) return "";

  return text
    // bỏ chuỗi ***** dài
    .replace(/\*{5,}/g, "")
    // bỏ "Edit: xxx"
    .replace(/Edit\s*:\s*\S+/gi, "")
    // bỏ ngày kiểu 25.12.2020 hoặc 2020-12-25
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, "")
    .replace(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g, "")
    // bỏ các cụm điều hướng thừa
    .replace(/(chương|chapter)\s*(trước|sau|tiếp|prev|next)/gi, "")
    .replace(/bài\s*(trước|tiếp theo)/gi, "")
    // bỏ khoảng trắng thừa
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function detectContent() {
  try {
    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (article && article.textContent && article.textContent.trim().length > 200) {
      let cleanTitle = cleanText(article.title || "");
      let body = cleanText(article.textContent);

      // Nếu body bắt đầu bằng title thì bỏ phần trùng
      if (cleanTitle && body.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
        body = body.slice(cleanTitle.length).trim();
      }

      // Bỏ dòng đầu nếu còn là tiêu đề chương
      body = body.replace(/^(chương|chapter|hồi)\s*\d+[.:]?\s*[^\n]{0,80}\n?/i, "").trim();

      const fullText = cleanTitle ? `${cleanTitle}. ${body}` : body;

      return {
        title: cleanTitle || document.title,
        text: fullText,
        source: "readability"
      };
    }
  } catch (e) {
    console.warn("Readability failed:", e);
  }

  // Fallback heuristic
  const contentSelectors = [
    "div.entry-content",
    "article .post-content",
    "article",
    ".chapter-content",
    "#chapter-content",
    ".content",
    "main",
    "#content",
    ".cha-content",          // webnovel
    ".chapter_content",
    ".novel-content"
  ];

  for (const sel of contentSelectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 200) {
      let text = cleanText(el.innerText);
      const h1 = document.querySelector("h1.entry-title, h1, .cha-title, .chapter-title");
      let cleanTitle = h1 ? cleanText(h1.innerText) : document.title;

      if (cleanTitle && text.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
        text = text.slice(cleanTitle.length).trim();
      }

      const fullText = cleanTitle ? `${cleanTitle}. ${text}` : text;

      return {
        title: cleanTitle,
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