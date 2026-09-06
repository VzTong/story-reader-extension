# Hướng dẫn xây dựng Extension đọc truyện đa nền tảng (Web, Android, iOS)

> Tài liệu này mô tả kiến trúc, thuật toán, và các API/thư viện **miễn phí, hợp pháp** để xây dựng một extension trình duyệt có 3 chức năng chính:
> 1. Đọc truyện chữ & truyện tranh bằng giọng nói (TTS) trên mọi trang web
> 2. Dịch toàn trang (chèn đè lên văn bản gốc, kiểu Google Dịch)
> 3. Tự động cuộn trang theo tiến độ đọc (kiểu kagane.to)
>
> Mục tiêu: chạy được trên Chrome/Edge/Firefox (desktop), trình duyệt hỗ trợ extension trên Android, và Safari trên iOS.

---

## 0. Lưu ý quan trọng trước khi bắt đầu

- **Không có API "đọc mọi trang web hoàn hảo 100%"**. Vì cấu trúc HTML của mỗi site khác nhau, extension cần một **hệ thống heuristic (dò tìm theo quy tắc) + cấu hình theo từng site** chứ không thể là một thuật toán tổng quát tuyệt đối. Cách thực tế nhất (giống cách các extension đọc truyện thật sự làm) là:
  - Có một bộ dò tìm "thông minh" mặc định (dựa vào thẻ HTML phổ biến: `<article>`, `<p>`, mật độ chữ, v.v.)
  - Cho phép người dùng "chọn vùng đọc" bằng tay 1 lần, rồi lưu lại cấu hình riêng cho domain đó (localStorage/IndexedDB) — đây là cách sangtacviet.app và các site đọc truyện dùng dưới dạng "reader mode" cá nhân hoá.
- **OCR truyện tranh trong thời gian thực trên toàn bộ ảnh của một trang là tác vụ nặng.** Cần cân nhắc giới hạn (chỉ OCR ảnh đang hiển thị trong khung nhìn, cache kết quả).
- **Không dùng API dịch/OCR trả phí ẩn danh hoặc "scrape" Google Dịch không chính thức** — vi phạm điều khoản dịch vụ của Google. Tài liệu này chỉ dùng các API/thư viện **có giấy phép mở hoặc free-tier chính thức**.

---

## 1. Kiến trúc tổng thể

```
extension/
├── manifest.json              # Manifest V3
├── background/
│   └── service-worker.js      # Điều phối, lưu trạng thái, gọi API dịch
├── content-scripts/
│   ├── detector.js            # Dò tìm nội dung truyện chữ/tranh trên trang
│   ├── tts-engine.js          # Điều khiển đọc, tô sáng câu đang đọc
│   ├── auto-scroll.js         # Tự cuộn theo tiến độ đọc
│   ├── translator.js          # Dịch & chèn đè văn bản
│   └── ocr-engine.js          # OCR bong bóng thoại trong truyện tranh
├── ui/
│   ├── floating-toolbar.html  # Nút nổi (play/pause, tốc độ, ẩn/hiện)
│   └── settings-panel.html    # Bảng cấu hình (giống ảnh bạn gửi: màu nền, cỡ chữ...)
├── popup/
│   └── popup.html             # Popup khi bấm icon extension
└── libs/                      # Thư viện bên thứ 3 đóng gói sẵn (offline-first)
    ├── tesseract.min.js
    └── readability.js
```

**Nguyên tắc thiết kế:** mọi logic "hiểu nội dung trang" nằm ở content script (chạy trong ngữ cảnh trang), còn mọi việc gọi API bên ngoài (dịch, đồng bộ cấu hình) nằm ở background service worker để tránh lộ CORS và dễ quản lý rate-limit.

---

## 2. Danh sách công nghệ/API miễn phí & hợp pháp

| Chức năng | Công nghệ đề xuất | Giấy phép / Chi phí | Ghi chú |
|---|---|---|---|
| Đọc giọng nói (TTS) | **Web Speech API** (`SpeechSynthesis`) — built-in trình duyệt | Miễn phí, không cần key | Có sẵn trên Chrome, Edge, Safari (iOS 15+), Firefox. Giọng đọc phụ thuộc hệ điều hành. |
| Trích xuất nội dung chính của trang | **Mozilla Readability.js** | Mã nguồn mở (Apache 2.0) | Cùng thư viện Firefox dùng cho "Reader View". Rất tốt để tách tiêu đề chương + nội dung khỏi menu/quảng cáo. |
| OCR (nhận diện chữ trong ảnh) | **Tesseract.js** | Mã nguồn mở (Apache 2.0), chạy hoàn toàn client-side | Không cần gửi ảnh lên server nào — tốt cho quyền riêng tư và không tốn phí. |
| Phát hiện vùng bong bóng thoại | **OpenCV.js** (contour detection) kết hợp Tesseract | Mã nguồn mở (BSD) | Dùng để khoanh vùng hình bầu dục/đa giác có nền trắng + viền đen trước khi OCR, giúp lọc bỏ SFX (từ tượng thanh) vốn thường nằm ngoài bong bóng. |
| Dịch văn bản (khuyến nghị chính) | **LibreTranslate tự host** bằng Docker | Mã nguồn mở (AGPL), tự host = miễn phí không giới hạn | ⚠️ Cập nhật quan trọng: instance công cộng `libretranslate.com` **hiện đã yêu cầu API key trả phí** (do bị bot lạm dụng, gói Pro ~29 USD/tháng) — **không còn free-tier public** như trước. Vì vậy phương án miễn phí thật sự là **tự host bằng Docker** (xem mục 14.1), hoặc dùng các instance cộng đồng miễn phí không chính thức như `translate.terraprint.co` (không đảm bảo uptime, chỉ nên dùng cho demo). |
| Dịch (phương án 2 — không cần server riêng) | **MyMemory Translation API** | Miễn phí 5.000 ký tự/ngày (ẩn danh, không cần đăng ký), 50.000 ký tự/ngày nếu gắn kèm email miễn phí | Gọi thẳng bằng `fetch`, có bật CORS nên gọi được trực tiếp từ content script mà không cần qua background service worker. Giới hạn 500 ký tự/request — cần chia nhỏ đoạn văn dài. Phù hợp nhất cho bản MVP vì không cần dựng server. |
| Dịch (phương án 3 — nâng cao) | **Chrome Built-in Translator API** (`window.translation` / Gemini Nano on-device, Chrome 131+) | Miễn phí, chạy on-device | Chỉ khả dụng trên Chrome desktop bản mới; dùng làm phương án dự phòng/nâng cao, không cần API key hay internet sau khi tải model lần đầu. |
| Nhận diện ngôn ngữ | **franc** (thư viện JS, mã nguồn mở) hoặc `navigator.language` kết hợp heuristic | MIT License | Chạy client-side, không cần gọi API ngoài. |
| Lưu cấu hình theo từng site | `chrome.storage.local` / `IndexedDB` | Miễn phí, built-in | Không cần backend riêng cho bản MVP. |
| Đồng bộ cấu hình đa thiết bị (tuỳ chọn) | `chrome.storage.sync` | Miễn phí, built-in, giới hạn ~100KB | Đủ cho lưu danh sách site đã cấu hình + tuỳ chỉnh giọng đọc. |

> **Không dùng:** Google Cloud Translation API kiểu "trả phí ẩn" khi vượt free-tier mà không cảnh báo người dùng, hoặc bất kỳ hình thức gọi ngầm API nội bộ của Google Dịch (`translate.googleapis.com` không chính thức) — vi phạm Điều khoản dịch vụ của Google dù kỹ thuật có thể làm được.

---

## 3. Module 1 — Đọc truyện chữ (Text-to-Speech)

### 3.1. Bước 1: Dò tìm tên truyện & chương

Thuật toán heuristic gợi ý (chạy trong `detector.js`):

1. **Tìm tiêu đề trang**: ưu tiên thẻ `<h1>` đầu tiên trong `<article>`/`<main>`, sau đó fallback về `document.title`.
2. **Tách "Tên truyện" và "Tên chương"**: dùng regex phổ biến để tách theo các từ khóa: `Chương`, `Chapter`, `Hồi`, `Ch.`, số La Mã/số Ả Rập đứng sau dấu `-` hoặc `:`.
   ```js
   const chapterPattern = /(chương|chapter|hồi|ch\.)\s*(\d+)/i;
   ```
3. **Tìm vùng nội dung chính**: dùng Readability.js để loại bỏ menu, quảng cáo, bình luận — trả về khối `<div>` chứa nội dung sạch.
4. **Fallback thủ công**: nếu Readability trả về kết quả rỗng hoặc quá ngắn (< 200 ký tự), hiển thị chế độ "Chọn vùng đọc bằng tay": người dùng click vào đoạn văn đầu và đoạn văn cuối, extension tự tính vùng DOM giữa hai điểm đó và lưu selector (CSS path) cho domain này vào `chrome.storage.local`.

### 3.2. Bước 2: Dò nút "Trang sau" / "Chương sau"

- Quét các thẻ `<a>`/`<button>` chứa text khớp với từ khóa: `tiếp`, `next`, `chương sau`, `>`, hoặc có `rel="next"` (chuẩn HTML5 cho phân trang).
- Nếu không tìm thấy bằng text, thử tìm theo icon phổ biến (mũi tên `→`, class chứa `next`, `pagination-next`).
- Lưu selector đã tìm được vào cấu hình site để lần sau không phải dò lại — **đây chính là cơ chế giúp "học" từng trang web khác nhau** như bạn mô tả.

### 3.3. Bước 3: Đọc bằng Web Speech API, tách theo câu

```js
function splitIntoSentences(text) {
  // Tách theo dấu kết câu, giữ lại dấu câu
  return text.match(/[^.!?…]+[.!?…]+["']?|[^.!?…]+$/g) || [text];
}

function speakQueue(sentences, index = 0) {
  if (index >= sentences.length) return nextPage();
  const utter = new SpeechSynthesisUtterance(sentences[index]);
  utter.rate = getUserRate();
  utter.onend = () => {
    highlightSentence(index + 1);
    autoScrollTo(index + 1);
    speakQueue(sentences, index + 1);
  };
  speechSynthesis.speak(utter);
}
```

- **Tô sáng câu đang đọc**: bọc mỗi câu trong `<span data-sentence-index="n">` khi render lại DOM (chỉ áp dụng trong "chế độ đọc", không sửa DOM gốc của trang — tạo một lớp overlay/clone để an toàn), rồi thêm class `.reading-highlight` khi TTS bắt đầu đọc câu đó.
- **Tự next trang**: khi hết danh sách câu, gọi hàm `nextPage()` để click vào nút đã dò được ở bước 3.2, đợi trang tải xong (`MutationObserver`) rồi lặp lại bước dò nội dung.

### 3.4. Bước 4: UI đọc (tham khảo ảnh bạn gửi)

- Thanh công cụ nổi giống ảnh 1 (thanh dưới): nút play/pause, tốc độ đọc, số chương hiện tại/tổng, nút thu gọn.
- Panel cấu hình giống ảnh 2: màu nền, màu chữ, cỡ chữ, giãn dòng, font, căn lề — áp dụng cho lớp overlay đọc (không phải trang gốc), lưu theo `chrome.storage.sync`.
- Panel danh sách câu giống ảnh 3 (danh sách "Câu 1/125", có thể nhảy tới câu bất kỳ) — hữu ích để người dùng tua nhanh.

---

## 4. Module 2 — Đọc truyện tranh (Manga/Comic OCR)

### 4.1. Quy trình xử lý một ảnh

1. **Bắt ảnh trong khung nhìn**: dùng `IntersectionObserver` để chỉ xử lý ảnh đang hoặc sắp hiển thị (tránh OCR toàn bộ ảnh của cả chương cùng lúc — quá nặng).
2. **Tiền xử lý ảnh** (canvas): chuyển ảnh sang grayscale, tăng contrast để OCR chính xác hơn.
3. **Phát hiện bong bóng thoại** bằng OpenCV.js:
   - Tìm các "contour" (đường viền khép kín) có tỷ lệ diện tích/độ tròn đặc trưng của bong bóng thoại (thường là hình bầu dục/gần tròn, nền trắng chiếm > 80% vùng).
   - Loại bỏ các vùng không đạt tiêu chí này (phần lớn SFX/từ tượng thanh nằm tự do trên nền tranh, không có khung nền trắng bao quanh) → đáp ứng đúng yêu cầu "không đọc từ tượng thanh" của bạn.
4. **OCR từng vùng bong bóng** bằng Tesseract.js, dùng gói ngôn ngữ tương ứng (`chi_sim`, `jpn`, `vie`, `eng`...).
5. **Sắp xếp thứ tự đọc bong bóng**: theo quy tắc đọc từ phải sang trái/trên xuống dưới (manga Nhật) hoặc trái sang phải (truyện tranh phương Tây) — cho phép người dùng chọn hướng đọc trong cấu hình.
6. **Đưa văn bản đã OCR vào hàng đợi TTS** giống hệt cơ chế ở Module 1.

### 4.2. Giới hạn cần nêu rõ với người dùng

- Độ chính xác OCR phụ thuộc chất lượng ảnh gốc và font chữ cách điệu trong truyện tranh — nên có nút "Sửa văn bản đã nhận diện" trước khi đọc.
- Xử lý client-side bằng Tesseract.js sẽ tốn CPU trên máy yếu; nên cho phép giới hạn "chỉ OCR khi người dùng bấm nút" thay vì tự động toàn bộ.

---

## 5. Module 3 — Dịch toàn trang (chèn đè văn bản)

### 5.1. Cơ chế giống Google Dịch

1. Duyệt toàn bộ DOM bằng `TreeWalker` để lấy các text node hiển thị (bỏ qua `<script>`, `<style>`, phần tử ẩn).
2. Gom nhóm các text node thành từng "khối" theo phần tử cha gần nhất (`<p>`, `<li>`, `<span>`...) để giảm số lần gọi API (gộp nhiều câu ngắn thành 1 request).
3. Gọi API dịch (LibreTranslate hoặc MyMemory), truyền kèm ngôn ngữ nguồn (auto-detect hoặc do người dùng chọn) và ngôn ngữ đích.
4. **Thay thế nội dung tại chỗ**: gán `textNode.nodeValue = translatedText`, đồng thời lưu lại `originalText` vào một `WeakMap` để có thể "Hoàn tác / xem bản gốc" bất kỳ lúc nào — đây là điểm khác biệt quan trọng so với việc chỉ hiển thị bản dịch tạm thời.

```js
async function translatePage(targetLang) {
  const nodes = collectTextNodes(document.body);
  const batches = chunkBySize(nodes, 500); // gộp theo giới hạn ký tự của API
  for (const batch of batches) {
    const translations = await requestTranslation(batch.map(n => n.text), targetLang);
    batch.forEach((n, i) => {
      originalTextMap.set(n.node, n.node.nodeValue);
      n.node.nodeValue = translations[i];
    });
  }
}
```

### 5.2. Gọi API dịch từ background service worker (tránh CORS)

**Phương án A — MyMemory (không cần server riêng, dùng ngay cho MVP):**

```js
// background/service-worker.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TRANSLATE") {
    const email = "your-email@example.com"; // tuỳ chọn, tăng quota lên 50.000 ký tự/ngày
    const langpair = `${msg.source || "auto"}|${msg.target}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(msg.text)}&langpair=${langpair}&de=${email}`;
    fetch(url)
      .then(r => r.json())
      .then(data => sendResponse({ translatedText: data.responseData.translatedText }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // giữ kênh async mở
  }
});
```
- Giới hạn 500 ký tự/request → nhớ chia nhỏ đoạn văn dài trước khi gọi (xem hàm `chunkBySize` ở mục 5.1).
- Không bắt buộc đăng ký; thêm email vào tham số `de` chỉ để tăng hạn mức, không phải "API key" theo nghĩa thông thường.

**Phương án B — LibreTranslate tự host (khi cần khối lượng lớn hơn, xem hướng dẫn dựng server ở mục 14.1):**

```js
// background/service-worker.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TRANSLATE") {
    fetch("https://your-own-server.example.com/translate", { // đổi thành domain server bạn tự host
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: msg.text,
        source: msg.source || "auto",
        target: msg.target,
        format: "text"
      })
    })
      .then(r => r.json())
      .then(data => sendResponse({ translatedText: data.translatedText }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});
```
- Nếu chưa muốn tự host, có thể tạm dùng `https://libretranslate.com/translate` nhưng **phải đăng ký API key trả phí** tại `portal.libretranslate.com` (không còn free-tier ẩn danh) — chỉ khuyến nghị cho giai đoạn thử nghiệm ngắn hạn hoặc khi đã có ngân sách.

---

## 6. Module 4 — Tự động cuộn trang theo tiến độ đọc

Tham khảo hành vi của kagane.to: trang tự cuộn mượt theo tốc độ đọc, người dùng chỉ cần ngồi nhìn.

```js
let scrollSpeed = 1; // px mỗi frame, điều chỉnh theo tốc độ đọc TTS
let autoScrollEnabled = false;

function autoScrollLoop() {
  if (!autoScrollEnabled) return;
  window.scrollBy(0, scrollSpeed);
  requestAnimationFrame(autoScrollLoop);
}

function autoScrollTo(sentenceIndex) {
  // Đồng bộ theo câu đang đọc thay vì cuộn đều đều
  const el = document.querySelector(`[data-sentence-index="${sentenceIndex}"]`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}
```

- **Chế độ 1 — cuộn đều theo tốc độ đọc trung bình**: tính `scrollSpeed` dựa trên số ký tự còn lại chia cho thời lượng ước tính TTS đọc hết trang (ước tính từ `rate` của `SpeechSynthesisUtterance`).
- **Chế độ 2 — cuộn theo câu (khuyến nghị)**: mỗi khi TTS đọc xong 1 câu, cuộn mượt tới câu tiếp theo bằng `scrollIntoView`, chính xác hơn chế độ cuộn đều và đồng bộ hoàn hảo với phần tô sáng.
- Cho phép người dùng bật/tắt và chỉnh offset (cuộn tới vị trí cách mép trên bao nhiêu %) trong panel cấu hình.

---

## 7. Manifest V3 mẫu (dùng chung cho desktop & Android qua Chrome/Kiwi/Firefox)

```json
{
  "manifest_version": 3,
  "name": "Story Reader & Translator",
  "version": "1.0.0",
  "description": "Đọc truyện, dịch trang, tự cuộn — hoạt động trên mọi trang web",
  "permissions": ["storage", "scripting", "activeTab"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "libs/readability.js",
        "content-scripts/detector.js",
        "content-scripts/tts-engine.js",
        "content-scripts/auto-scroll.js",
        "content-scripts/translator.js",
        "content-scripts/ocr-engine.js"
      ],
      "css": ["ui/floating-toolbar.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": "icons/icon128.png"
  },
  "icons": {
    "128": "icons/icon128.png"
  }
}
```

---

## 8. Triển khai đa nền tảng

### 8.1. Desktop (Windows/macOS/Linux)

- Chrome, Edge, Brave, Opera: dùng thẳng Manifest V3, đăng lên Chrome Web Store (phí đăng ký một lần **5 USD**, không phải phí định kỳ) hoặc tải "Load unpacked" để dùng cá nhân miễn phí.
- Firefox: cần chỉnh nhỏ manifest (Firefox dùng `background.scripts` thay vì `service_worker` ở một số bản, hoặc dùng `browser_specific_settings`), đăng lên addons.mozilla.org **miễn phí**.

### 8.2. Android

- **Firefox for Android**: hỗ trợ cài extension trực tiếp từ addons.mozilla.org — cách dễ nhất, không cần sửa code.
- **Kiwi Browser**: trình duyệt Android dựa trên Chromium, hỗ trợ cài extension Chrome trực tiếp từ Chrome Web Store hoặc file `.crx` — dùng được ngay manifest ở trên.
- Chrome for Android **hiện không hỗ trợ cài extension của bên thứ ba** (đây là giới hạn của Google, không phải giới hạn kỹ thuật của bạn) — nên hướng dẫn người dùng Android dùng Firefox hoặc Kiwi.

### 8.3. iOS (Safari)

iOS không cho phép "extension trình duyệt" kiểu Chrome — phải đóng gói thành **Safari Web Extension** bên trong một app iOS thật sự:

1. Cần máy Mac + Xcode (miễn phí) + tài khoản Apple Developer (miễn phí để test trên thiết bị cá nhân qua Xcode; **99 USD/năm** chỉ khi muốn phát hành lên App Store).
2. Dùng công cụ có sẵn của Apple để chuyển extension Chrome sang dự án Xcode:
   ```bash
   xcrun safari-web-extension-converter /path/to/extension
   ```
3. Công cụ này tự tạo project Xcode chứa app bọc ngoài (container app) + extension. Phần lớn code JS (content scripts, background) tái sử dụng được gần như nguyên vẹn; cần điều chỉnh:
   - `chrome.*` API → dùng polyfill `webextension-polyfill` (mã nguồn mở, MIT) để code chạy được cả trên Chrome lẫn Safari bằng cùng một codebase.
   - Web Speech API trên Safari iOS: `SpeechSynthesis` được hỗ trợ nhưng danh sách giọng đọc có thể tải bất đồng bộ — cần đợi event `voiceschanged` trước khi phát.
4. Build và chạy qua Xcode lên iPhone cá nhân (không cần App Store) để dùng miễn phí; chỉ cần trả phí Apple Developer nếu muốn phân phối công khai.

---

## 9. Vấn đề pháp lý & bản quyền cần lưu ý

- **Bản thân extension đọc/tô sáng/dịch nội dung mà người dùng đang xem trên trình duyệt của họ** thường được xem là công cụ hỗ trợ truy cập (accessibility tool), tương tự trình đọc màn hình — hợp pháp ở hầu hết khu vực pháp lý vì không phân phối lại nội dung, không lưu trữ lại nội dung có bản quyền lên server của bạn.
- **Rủi ro pháp lý thực sự nằm ở nguồn nội dung** (trang web truyện lậu, ảnh manga vi phạm bản quyền) — đây là trách nhiệm của trang web nguồn, không phải của extension chỉ đọc lại nội dung hiển thị trên máy người dùng. Tuy vậy, để an toàn:
  - Không lưu trữ, cache lại nội dung truyện lên server của bạn.
  - Không quảng bá extension là công cụ để đọc truyện lậu; định vị là "công cụ hỗ trợ đọc & dịch web nói chung" (dùng được cho tin tức, tài liệu, blog... chứ không riêng gì truyện).
  - Ghi rõ trong mô tả extension rằng người dùng tự chịu trách nhiệm về nội dung họ truy cập.
- **API dịch/OCR dùng trong tài liệu này đều có giấy phép mã nguồn mở hoặc điều khoản free-tier công khai, hợp pháp để dùng trong sản phẩm thương mại lẫn phi thương mại**, miễn tuân thủ đúng giấy phép (ví dụ LibreTranslate là AGPL — nếu bạn sửa đổi và host lại server, cần công khai mã nguồn phần sửa đổi đó theo điều khoản AGPL).

---

## 10. Lộ trình phát triển đề xuất (MVP → hoàn thiện)

| Giai đoạn | Nội dung | Ước tính |
|---|---|---|
| 1 | Content script dò + đọc TTS cơ bản cho truyện chữ (không tự next trang) | 1–2 tuần |
| 2 | Thêm tô sáng câu + tự next trang + lưu cấu hình theo domain | 1 tuần |
| 3 | Module dịch toàn trang (LibreTranslate + hoàn tác) | 1 tuần |
| 4 | Module tự cuộn đồng bộ theo câu | 3–5 ngày |
| 5 | Module OCR truyện tranh (Tesseract.js + OpenCV.js lọc bong bóng thoại) | 2–3 tuần (phần khó nhất) |
| 6 | Đóng gói Firefox Android / Kiwi Android | 3–5 ngày |
| 7 | Chuyển đổi sang Safari Web Extension cho iOS | 1–2 tuần (cần Mac) |
| 8 | Kiểm thử trên nhiều site thực tế, tinh chỉnh heuristic dò nội dung | Liên tục |

---

## 11. Tổng kết bảng API/thư viện cần cài đặt

```bash
npm install webextension-polyfill      # đồng bộ API Chrome/Firefox/Safari
npm install tesseract.js               # OCR client-side, MIT/Apache 2.0
npm install @mozilla/readability       # tách nội dung chính trang, Apache 2.0
npm install franc                      # nhận diện ngôn ngữ, MIT
# OpenCV.js: tải file build sẵn từ opencv.org (BSD license), nhúng trực tiếp, không qua npm
```

Không cần bất kỳ API key trả phí nào để có một bản MVP đầy đủ 3 chức năng chạy trên desktop (dùng MyMemory cho dịch); chỉ khi mở rộng quy mô lớn (nhiều người dùng đồng thời gọi dịch) mới cần cân nhắc tự host LibreTranslate trên server riêng.

---

## 12. Case study: dò nội dung trên 2 site cụ thể bạn đang đọc

Mình đã kiểm tra trực tiếp cấu trúc HTML thật của 2 trang bạn đưa để đưa ra selector cụ thể — đây chính là cách "học" từng site mà hệ thống cấu hình theo domain ở mục 3.1 sẽ lưu lại.

### 12.1. WordPress.com (ví dụ `dunhien0808.wordpress.com`)

Đặc điểm nhận dạng: URL có dạng `https://<tên-blog>.wordpress.com/<năm>/<tháng>/<ngày>/<slug>/`, mỗi chương = 1 bài viết (post) riêng.

| Thành phần cần dò | Selector thực tế quan sát được | Ghi chú |
|---|---|---|
| Tên chương | `h1.entry-title` (nội dung: "Chương 37") | Chuẩn theme WordPress, gần như mọi theme .com đều có class `entry-title`. |
| Nội dung chương | `div.entry-content` hoặc `article .post-content` (thẻ `<article>` bao ngoài) | Dùng Readability.js làm fallback nếu theme lạ đổi tên class. |
| **Nút chương sau (đáng tin cậy nhất)** | Khối điều hướng bài viết ở cuối trang, tiếng Việt hiển thị **"Điều hướng bài viết"**, chứa 2 link: **"Bài trước"** + tên chương và **"Bài tiếp theo"** + tên chương | Đây là tính năng chuẩn "Post Navigation" của WordPress — link tới bài kế tiếp/trước theo thời gian đăng, mà vì mỗi bài = 1 chương nên trùng khớp hoàn hảo với "chương sau". Selector CSS thường gặp: `.post-navigation .nav-next a`, `.nav-links .nav-next a`, hoặc `nav[aria-label*="Điều hướng" i] a:last-of-type`. |
| Nút chương sau (dự phòng) | Một số blog tự chèn thủ công link dạng chữ `"Chương trước ... Chương sau"` ngay trong nội dung bài (ví dụ dùng icon 🌸 phân cách) | Không phải tính năng theme, nên **kém tin cậy hơn** — chỉ dùng khi không tìm thấy khối "Điều hướng bài viết" chuẩn ở trên. Dò bằng regex text `/chương\s*(sau|tiếp)/i` trong các thẻ `<a>` nằm cuối bài. |
| Thẻ `<link rel="next">` trong `<head>` | Không phải blog nào cũng có, nhưng nên kiểm tra trước tiên vì đây là chuẩn HTML5, độ tin cậy cao nhất khi tồn tại | `document.querySelector('link[rel="next"]')?.href` |

**Đoạn code detector mẫu cho WordPress:**

```js
function detectWordPress() {
  const title = document.querySelector("h1.entry-title")?.textContent.trim();
  const contentEl = document.querySelector("div.entry-content, article .post-content");
  if (!title || !contentEl) return null;

  // Ưu tiên 1: chuẩn HTML5
  let nextUrl = document.querySelector('link[rel="next"]')?.href;

  // Ưu tiên 2: khối "Điều hướng bài viết" chuẩn theme WordPress
  if (!nextUrl) {
    const navNext = document.querySelector(
      '.nav-next a, .post-navigation .nav-next a, nav[aria-label*="hướng" i] a:last-of-type'
    );
    if (navNext && /chương|chapter/i.test(navNext.textContent)) nextUrl = navNext.href;
  }

  // Ưu tiên 3: link chữ tự chèn trong nội dung bài
  if (!nextUrl) {
    const candidates = [...contentEl.querySelectorAll("a")].filter(a =>
      /chương\s*(sau|tiếp)|next\s*chapter/i.test(a.textContent)
    );
    nextUrl = candidates.at(-1)?.href;
  }

  return { title, contentEl, nextUrl };
}
```

### 12.2. nguontruyen.com — nội dung tải động bằng JavaScript (AJAX)

Điểm khác biệt quan trọng: khi tải trang lần đầu, phần nội dung chương **chưa có sẵn trong HTML** — trang chỉ hiển thị dòng chữ "Đang tải truyện..." (`Đang tải truyện <img src=".../loading_film.gif">`) rồi mới gọi AJAX lấy nội dung thật và chèn vào DOM sau đó. Nếu content script chạy ở `document_idle` và đọc DOM ngay, **sẽ chỉ thấy chữ "Đang tải truyện" chứ chưa có nội dung** — đây chính là lý do một hệ thống dò "một lần duy nhất khi trang load xong" sẽ thất bại trên site dạng này.

**Cách xử lý: dùng `MutationObserver` để chờ nội dung thật xuất hiện**

```js
function waitForDynamicContent(containerSelector, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(containerSelector);
    if (existing && existing.textContent.trim().length > 200) {
      return resolve(existing);
    }
    const observer = new MutationObserver(() => {
      const el = document.querySelector(containerSelector);
      if (el && el.textContent.trim().length > 200) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error("Timeout chờ nội dung chương tải xong"));
    }, timeoutMs);
  });
}
```

Các mốc dò khác trên nguontruyen.com:

- **Tên truyện**: nằm trong thẻ `<h1>` chứa link về trang tổng quan truyện (ví dụ "Xuyên Thành Chị Gái Phản Diện Của Nam Chính").
- **Danh sách chương (sidebar)**: trang có sẵn menu liệt kê toàn bộ "Chapter 1, Chapter 2, ... Chapter 86" dưới dạng danh sách link — có thể tận dụng danh sách này để **nhảy thẳng tới URL chương kế tiếp** thay vì phải bấm nút, đáng tin cậy hơn việc dò nút.
- **Nút chương sau**: có sẵn 2 nút chữ **"Chapter trước"** / **"Chapter sau"** cố định trên giao diện đọc — dò theo text khớp `/chapter\s*(sau|trước)/i`.
- Site này **đã có sẵn tính năng "Nghe AI"** riêng của họ (đúng như bạn nhận xét là khá hay nhưng còn "lỏ" — tức đọc chưa mượt/chưa chính xác 100%). Extension của bạn không cần và không nên phụ thuộc vào tính năng đó của site; cứ tự trích xuất text bằng detector riêng rồi đọc bằng TTS của mình để đảm bảo hoạt động nhất quán trên mọi trang, kể cả trang không có tính năng đọc sẵn.

---

## 13. Phương án dịch kiểu "chụp màn hình + overlay" (giống app Dịch Màn Hình / EZ Screen Translator trong ảnh bạn gửi)

Cách dịch ở Module 3 (mục 5) chỉ hoạt động với **text node thật trong DOM** — sẽ **không dịch được** chữ nằm trong ảnh truyện tranh/webtoon (vì đó là pixel, không phải text). Ứng dụng "Dịch Màn Hình" trong ảnh bạn gửi dùng cách khác: chụp ảnh màn hình, OCR toàn bộ vùng nhìn thấy, rồi vẽ đè bản dịch lên đúng vị trí bong bóng thoại. Đây là cách để extension làm được y hệt, kể cả áp dụng luôn cho truyện tranh.

### 13.1. Quy trình

1. **Chụp vùng đang hiển thị**: dùng API có sẵn của trình duyệt, miễn phí, không cần OCR/AI ngoài:
   ```js
   // background/service-worker.js — cần permission "activeTab" hoặc "tabs" + "<all_urls>"
   chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
     // dataUrl là ảnh PNG base64 của khung nhìn hiện tại
   });
   ```
2. **OCR ảnh vừa chụp** bằng Tesseract.js (như Module 2, mục 4), lấy về danh sách text kèm toạ độ khung chữ (`bbox: {x0,y0,x1,y1}`).
3. **Dịch từng khối text** đã OCR được bằng MyMemory/LibreTranslate (như Module 3, mục 5).
4. **Vẽ lớp overlay** đè lên đúng vị trí: tạo một `<div>` `position: fixed` phủ toàn màn hình, bên trong là các `<span>` đặt tuyệt đối theo toạ độ `bbox` đã OCR, nền gần trùng màu nền gốc (lấy mẫu màu pixel xung quanh bằng canvas) để che chữ gốc, chữ dịch hiển thị đè lên trên — đúng hiệu ứng "chèn chữ thay cho chữ gốc" như bạn mô tả.
   ```js
   function renderOverlay(translatedBlocks) {
     const layer = document.getElementById("translate-overlay") || createOverlayLayer();
     layer.innerHTML = "";
     translatedBlocks.forEach(block => {
       const span = document.createElement("span");
       span.textContent = block.translatedText;
       span.style.cssText = `
         position: absolute;
         left: ${block.bbox.x0}px; top: ${block.bbox.y0}px;
         width: ${block.bbox.x1 - block.bbox.x0}px;
         background: ${block.averageBgColor};
         color: ${block.averageTextColor};
         font-size: ${estimateFontSize(block.bbox)}px;
       `;
       layer.appendChild(span);
     });
   }
   ```
5. **Tự động chụp lại khi cuộn trang**: gắn listener `scroll`/`resize` (debounce ~300ms) để chụp và OCR lại vùng nhìn thấy mới, giữ cảm giác "luôn dịch mọi thứ trên màn hình" như app tham khảo.

### 13.2. So sánh 2 phương án dịch để bạn chọn khi nào dùng cái nào

| | Module 3 (thay text node) | Module 13 (chụp màn hình + overlay) |
|---|---|---|
| Áp dụng cho | Trang web văn bản thường (tin tức, blog, truyện chữ) | Ảnh, truyện tranh/webtoon, canvas, PDF nhúng, bất kỳ nội dung nào không phải text thật |
| Độ chính xác dịch | Cao hơn (dịch thẳng text gốc, không qua OCR) | Phụ thuộc độ chính xác OCR, có thể sai sót với font cách điệu |
| Hiệu năng | Nhẹ | Nặng hơn (phải OCR ảnh liên tục khi cuộn) |
| Giữ được bố cục trang | Có (chỉ thay chữ, layout gốc không đổi) | Cần tự vẽ lại overlay đúng vị trí, dễ lệch nếu trang có animation/lazy-load ảnh |

**Khuyến nghị**: mặc định dùng Module 3 cho toàn trang; **tự động chuyển sang Module 13 cho riêng các thẻ `<img>`/`<canvas>` được phát hiện là ảnh truyện tranh** (kích thước lớn, nằm trong khu vực đọc đã dò được ở Module 1/2) — kết hợp cả hai cho trải nghiệm mượt nhất, đúng như bạn muốn "cải tiến để nhìn nó mượt hơn" so với app tham khảo.

---

## 14. Hướng dẫn lấy API key / dựng dịch vụ — cụ thể từng bước

### 14.1. Tự host LibreTranslate bằng Docker (miễn phí, không giới hạn, không cần API key)

**Bước 1 — Cài Docker** (nếu chưa có): tải Docker Desktop miễn phí tại `https://www.docker.com/products/docker-desktop/`, cài như phần mềm bình thường.

**Bước 2 — Chạy LibreTranslate trên máy/server cá nhân:**
```bash
docker run -d --name libretranslate -p 5000:5000 libretranslate/libretranslate
```
Sau khoảng 1–2 phút (lần đầu tải model ngôn ngữ), truy cập `http://localhost:5000` sẽ thấy giao diện LibreTranslate chạy được ngay — không cần đăng ký gì cả.

**Bước 3 — Đưa server lên internet để extension trên điện thoại cũng gọi được** (bắt buộc nếu muốn dùng trên Android/iOS, vì `localhost` trên máy tính điện thoại không gọi tới được):
- Cách miễn phí đơn giản nhất: dùng **Render.com** hoặc **Fly.io** (đều có gói free tier) — deploy Docker image `libretranslate/libretranslate` lên đó theo hướng dẫn "Deploy a Docker image" trong docs của từng nền tảng, bạn sẽ nhận được 1 URL dạng `https://ten-app.onrender.com`.
- Đổi endpoint trong code (mục 5.2, Phương án B) từ `your-own-server.example.com` thành URL thật này.

**Bước 4 — (Tuỳ chọn) Giới hạn ai được gọi server của bạn**: thêm biến môi trường `LT_API_KEYS=true` và `LT_API_KEYS_DB_PATH=...` khi chạy Docker để bật xác thực bằng key riêng do bạn tự cấp, tránh người lạ gọi tràn server miễn phí của bạn. Chi tiết đầy đủ các biến môi trường xem tại kho mã nguồn chính thức: `https://github.com/LibreTranslate/LibreTranslate`.

### 14.2. Dùng MyMemory (không cần dựng server, có thể bỏ qua bước 14.1 nếu chỉ cần bản MVP)

**Bước 1**: Không cần đăng ký gì để dùng ngay ở mức 5.000 ký tự/ngày — chỉ cần gọi thẳng URL `https://api.mymemory.translated.net/get?q=...&langpair=vi|en` như code ở mục 5.2 Phương án A.

**Bước 2 (tuỳ chọn, tăng hạn mức lên 50.000 ký tự/ngày)**:
1. Vào `https://mymemory.translated.net/`, bấm mục đăng ký tài khoản miễn phí (chỉ cần email).
2. Xác nhận email.
3. Thêm email đó vào tham số `de` trong mọi request gọi API — không có "API key" riêng biệt, email chính là định danh tăng quota.

### 14.3. Tải gói ngôn ngữ cho Tesseract.js (OCR)

Tesseract.js cần file dữ liệu ngôn ngữ (`.traineddata`) để nhận diện chữ — các file này **miễn phí, mã nguồn mở**, tự động tải lần đầu sử dụng từ CDN của dự án, hoặc bạn có thể tự tải về đóng gói sẵn trong extension (khuyến nghị, để không phụ thuộc mạng khi OCR):
```bash
npm install tesseract.js
# Tải sẵn file ngôn ngữ tiếng Việt + Trung + Nhật để đóng gói offline:
curl -L -o vie.traineddata.gz https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/vie.traineddata.gz
curl -L -o chi_sim.traineddata.gz https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/chi_sim.traineddata.gz
curl -L -o jpn.traineddata.gz https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/jpn.traineddata.gz
```
Đặt các file này vào `libs/tessdata/` trong extension và trỏ `langPath` khi khởi tạo Tesseract worker để chạy hoàn toàn offline, không cần internet, không cần key.

---

## 15. Hướng dẫn đẩy code lên GitHub — từng bước cụ thể

**Bước 1 — Tạo tài khoản GitHub** (nếu chưa có): vào `https://github.com/signup`, đăng ký miễn phí bằng email.

**Bước 2 — Cài Git trên máy**: tải tại `https://git-scm.com/downloads`, cài đặt mặc định (Next liên tục).

**Bước 3 — Tạo repository mới trên GitHub**:
1. Đăng nhập GitHub → bấm nút **"+"** góc trên phải → **"New repository"**.
2. Đặt tên (ví dụ `story-reader-extension`), chọn **Private** nếu chưa muốn công khai, hoặc **Public** nếu muốn chia sẻ.
3. Không tick "Add a README" nếu bạn đã có code sẵn ở máy (để tránh xung đột), bấm **Create repository**.

**Bước 4 — Đẩy code từ máy lên repo vừa tạo** (chạy trong thư mục chứa code extension, dùng Terminal/Command Prompt/PowerShell):
```bash
cd duong-dan-toi-thu-muc-extension
git init
git add .
git commit -m "Initial commit: story reader extension"
git branch -M main
git remote add origin https://github.com/<tên-github-của-bạn>/story-reader-extension.git
git push -u origin main
```
- Lần đầu `git push`, trình duyệt/terminal sẽ yêu cầu đăng nhập GitHub — nếu dùng HTTPS, GitHub yêu cầu tạo **Personal Access Token** thay cho mật khẩu: vào `Settings → Developer settings → Personal access tokens → Generate new token`, chọn quyền `repo`, copy token dán vào khi được hỏi mật khẩu.
- Cách dễ hơn cho người mới: cài **GitHub Desktop** (`https://desktop.github.com/`) — ứng dụng giao diện đồ hoạ, chỉ cần đăng nhập rồi kéo-thả thư mục, bấm "Publish repository", không cần gõ lệnh Git nào cả.

**Bước 5 — Thêm file `.gitignore`** để không đẩy nhầm file rác/thư viện nặng lên repo:
```
node_modules/
libs/tessdata/*.traineddata
.DS_Store
```

**Bước 6 — Cập nhật code sau này**: mỗi khi sửa code xong, chạy:
```bash
git add .
git commit -m "Mô tả ngắn gọn thay đổi"
git push
```

---

## 16. Hướng dẫn cài đặt & sử dụng extension — cụ thể trên từng thiết bị

### 16.1. Chrome / Edge / Brave trên máy tính (Windows/macOS/Linux)

1. Mở trình duyệt, gõ vào thanh địa chỉ: `chrome://extensions/` (Edge: `edge://extensions/`).
2. Bật công tắc **"Chế độ nhà phát triển" / "Developer mode"** ở góc trên phải.
3. Bấm **"Tải tiện ích đã giải nén" / "Load unpacked"**.
4. Chọn thư mục chứa code extension (thư mục có file `manifest.json`).
5. Extension xuất hiện ngay trên thanh công cụ (icon hình mảnh ghép 🧩) — ghim lại để dễ truy cập.
6. Sau khi sửa code, quay lại trang `chrome://extensions/`, bấm nút **"⟳" (Reload)** trên thẻ extension để cập nhật.

### 16.2. Firefox trên máy tính

**Cách 1 — Test tạm thời (mất khi tắt trình duyệt):**
1. Gõ `about:debugging#/runtime/this-firefox` vào thanh địa chỉ.
2. Bấm **"Load Temporary Add-on…"**.
3. Chọn file `manifest.json` trong thư mục extension.

**Cách 2 — Cài lâu dài, cần ký số (miễn phí):**
1. Đăng ký tài khoản tại `https://addons.mozilla.org/`.
2. Vào `https://addons.mozilla.org/developers/addon/submit/` → chọn **"On your own"** (unlisted, không public lên kho) nếu chỉ muốn dùng cá nhân.
3. Nén thư mục extension thành `.zip`, tải lên để Mozilla tự động ký số miễn phí.
4. Tải file `.xpi` đã ký về, kéo-thả vào cửa sổ Firefox để cài đặt vĩnh viễn.

### 16.3. Android

**Firefox for Android (khuyến nghị, dễ nhất):**
1. Cài Firefox từ Google Play.
2. Vào **Cài đặt → About Firefox**, bấm liên tục vào logo Firefox ~5 lần cho tới khi hiện thông báo **"Debug menu enabled"**.
3. Quay lại **Cài đặt**, tìm mục **"Install Extension From File"** (hoặc mục nâng cao tương đương) đã được mở khoá — chọn file `.xpi` đã ký ở bước 16.2 Cách 2, hoặc dùng tính năng "Custom Add-on Collection" để trỏ tới add-on đã đăng trên AMO dạng unlisted.
4. Extension hoạt động như trên desktop.

**Kiwi Browser (thay thế, cài trực tiếp file .crx không cần ký):**
1. Cài Kiwi Browser từ Google Play.
2. Mở menu (⋮) → **Extensions**.
3. Bật **Developer mode** ở góc trên.
4. Bấm nút **"(+) Từ file .zip/.crx"**, chọn thư mục/file extension đã đóng gói.

> Lưu ý: Chrome for Android hiện **không hỗ trợ** cài extension bên thứ ba — đây là giới hạn của Google, không phải lỗi ở code của bạn.

### 16.4. iOS (Safari)

**Yêu cầu**: máy Mac + Xcode (miễn phí) + tài khoản Apple ID thường (miễn phí, đủ để cài lên iPhone cá nhân qua cáp USB; chỉ cần trả 99 USD/năm nếu muốn phát hành công khai qua App Store/TestFlight cho người khác).

1. Trên Mac, mở Terminal, chạy:
   ```bash
   xcrun safari-web-extension-converter /duong-dan/toi/thu-muc-extension
   ```
2. Lệnh này tự mở Xcode với project đã tạo sẵn (app bọc ngoài + Safari extension).
3. Trong Xcode: chọn thiết bị đích (iPhone của bạn, cắm cáp USB), bấm nút **▶ Run**.
4. Lần đầu chạy trên máy thật, iPhone sẽ báo "Untrusted Developer" — vào **Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị**, tin cậy Apple ID/profile của bạn.
5. Mở app vừa cài (chỉ là app "vỏ" chứa extension) → làm theo hướng dẫn trong app để mở **Cài đặt Safari → Extensions**, bật extension lên.
6. Mở Safari, vào trang truyện muốn đọc, bấm biểu tượng "aA" trên thanh địa chỉ → chọn extension vừa bật để sử dụng.

> Vì cần build lại bằng Xcode mỗi khi sửa code, đây là bước tốn công nhất trong toàn bộ quy trình — nên hoàn thiện và test kỹ trên Chrome/Firefox trước, chỉ chuyển sang iOS ở giai đoạn gần cuối.
