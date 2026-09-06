# Kế hoạch triển khai — Extension đọc truyện & dịch đa nền tảng

> Tài liệu này là bản kế hoạch hành động (action plan) đi kèm với tài liệu hướng dẫn kỹ thuật `huong-dan-extension-doc-truyen.md`. Mỗi giai đoạn có: mục tiêu, checklist công việc cụ thể, tiêu chí hoàn thành (Definition of Done), thời gian ước tính, và rủi ro cần lưu ý. Làm tuần tự theo thứ tự — mỗi giai đoạn sau đều phụ thuộc vào giai đoạn trước chạy ổn định.

**Nguyên tắc xuyên suốt**: sau mỗi giai đoạn phải có một bản chạy được thật (không chỉ code xong) trên ít nhất Chrome desktop, test trực tiếp trên `dunhien0808.wordpress.com` và `nguontruyen.com` — đây là 2 site tham chiếu để tránh việc code "chạy trên site demo nhưng vỡ trên site thật".

---

## Tổng quan lộ trình

| Giai đoạn | Nội dung | Thời gian ước tính | Phụ thuộc |
|---|---|---|---|
| 0 | Chuẩn bị môi trường & khung project | 1–2 ngày | — |
| 1 | MVP đọc truyện chữ (TTS cơ bản, chưa tự next) | 1–2 tuần | Giai đoạn 0 |
| 2 | Tô sáng câu + tự next trang + lưu cấu hình theo domain | 1 tuần | Giai đoạn 1 |
| 3 | Dò nội dung theo site cụ thể (WordPress + nguontruyen) | 3–5 ngày | Giai đoạn 2 |
| 4 | Module dịch toàn trang (MyMemory) | 1 tuần | Giai đoạn 1 |
| 5 | Module tự cuộn đồng bộ theo câu | 3–5 ngày | Giai đoạn 2 |
| 6 | UI hoàn chỉnh (thanh công cụ, panel cấu hình) | 1 tuần | Giai đoạn 1–5 |
| 7 | OCR truyện tranh (phần khó nhất) | 2–3 tuần | Giai đoạn 1, 4 |
| 8 | Dịch kiểu overlay (chụp màn hình) | 1–1.5 tuần | Giai đoạn 7 |
| 9 | Đóng gói & публish Firefox Android / Kiwi Android | 3–5 ngày | Giai đoạn 1–6 ổn định |
| 10 | Chuyển đổi sang Safari Web Extension (iOS) | 1–2 tuần | Giai đoạn 9 |
| 11 | Kiểm thử toàn diện, sửa lỗi, viết tài liệu người dùng | Liên tục + 1 tuần chốt | Tất cả |

**Tổng thời gian ước tính cho MVP đầy đủ (giai đoạn 0–6, chỉ desktop, chưa OCR/mobile): ~5–6 tuần** làm việc part-time (2-3 giờ/ngày), hoặc ~2-3 tuần nếu làm full-time.

---

## Giai đoạn 0 — Chuẩn bị môi trường & khung project

**Mục tiêu**: có một extension "Hello World" load được vào Chrome, có repo Git, có cấu trúc thư mục sẵn sàng.

### Checklist
- [ ] Cài Node.js (để dùng npm cho các thư viện sau này): `https://nodejs.org/`
- [ ] Cài Git: `https://git-scm.com/downloads`
- [ ] Tạo tài khoản GitHub (nếu chưa có) và tạo repo mới `story-reader-extension`
- [ ] Tạo cấu trúc thư mục đúng như mục 1 trong tài liệu hướng dẫn (`background/`, `content-scripts/`, `ui/`, `popup/`, `libs/`)
- [ ] Viết `manifest.json` tối thiểu (mẫu ở mục 7 tài liệu hướng dẫn)
- [ ] Tạo icon tạm (128x128px, có thể vẽ nhanh hoặc dùng placeholder)
- [ ] Load thử vào Chrome (`chrome://extensions` → Developer mode → Load unpacked) — xác nhận icon extension hiện lên thanh công cụ
- [ ] `git init`, commit lần đầu, `git push` lên GitHub theo hướng dẫn mục 15

### Definition of Done
Extension trống load được vào Chrome không báo lỗi trong `chrome://extensions`, code đã có trên GitHub.

### Rủi ro cần lưu ý
- Sai định dạng `manifest.json` (thiếu dấu phẩy, permission sai tên) là lỗi phổ biến nhất ở bước này — luôn xem panel lỗi màu đỏ ngay dưới thẻ extension trong `chrome://extensions`.

---

## Giai đoạn 1 — MVP đọc truyện chữ cơ bản (TTS, chưa tự next trang)

**Mục tiêu**: bấm nút play là đọc được nội dung chương hiện tại bằng giọng nói, có nút dừng/tạm dừng. Chưa cần tự next, chưa cần tô sáng.

### Checklist
- [ ] Viết `detector.js`: hàm dò tiêu đề + nội dung dùng Readability.js (`npm install @mozilla/readability`, đóng gói vào `libs/`)
- [ ] Test hàm dò trên `dunhien0808.wordpress.com/2021/09/06/chuong-37/` — xác nhận lấy đúng "Chương 37" và đúng đoạn nội dung, không dính menu/sidebar
- [ ] Test hàm dò trên `nguontruyen.com` — **lưu ý bắt buộc dùng `MutationObserver`** (mục 12.2 tài liệu hướng dẫn) vì nội dung tải bằng AJAX, không có sẵn khi trang load xong
- [ ] Viết `tts-engine.js`: hàm `splitIntoSentences()` tách câu, hàm `speakQueue()` đọc tuần tự bằng `SpeechSynthesisUtterance`
- [ ] Viết `floating-toolbar.html` + CSS: chỉ cần nút Play/Pause/Stop và thanh trượt tốc độ đọc (tham khảo ảnh 1 bạn gửi trước đó)
- [ ] Nối toolbar với `tts-engine.js` qua event listener
- [ ] Xử lý trường hợp trang không dò được nội dung (Readability trả về rỗng) → hiện thông báo nhẹ nhàng "Không tìm thấy nội dung, thử chọn vùng đọc thủ công" (chức năng chọn thủ công để giai đoạn sau)

### Definition of Done
Vào 1 chương bất kỳ trên cả 2 site tham chiếu, bấm Play → nghe được giọng đọc đúng nội dung chương (không đọc nhầm menu/quảng cáo), bấm Pause/Stop hoạt động đúng.

### Rủi ro cần lưu ý
- Giọng đọc tiếng Việt trên `SpeechSynthesis` phụ thuộc hệ điều hành — trên Windows có thể không có giọng tiếng Việt cài sẵn, cần kiểm tra `speechSynthesis.getVoices()` và hướng dẫn người dùng cài thêm giọng nếu thiếu.
- Sự kiện `voiceschanged` bắn bất đồng bộ — nhớ đợi sự kiện này trước khi liệt kê danh sách giọng đọc cho người dùng chọn.

---

## Giai đoạn 2 — Tô sáng câu + tự next trang + lưu cấu hình theo domain

**Mục tiêu**: đọc xong 1 câu tự tô sáng câu tiếp theo; đọc hết chương tự động sang chương sau; cấu hình site đã dò được lưu lại để lần sau không phải dò lại.

### Checklist
- [ ] Bọc mỗi câu trong `<span data-sentence-index="n">` trên một lớp overlay (không sửa DOM gốc trực tiếp — tạo bản sao render riêng để an toàn)
- [ ] Thêm/xoá class `.reading-highlight` đồng bộ với `onstart`/`onend` của từng `SpeechSynthesisUtterance`
- [ ] Viết hàm dò nút "chương sau" theo đúng thứ tự ưu tiên ở mục 12.1 (rel=next → khối "Điều hướng bài viết" → link chữ trong nội dung)
- [ ] Viết hàm tương tự cho nguontruyen.com theo mục 12.2 (ưu tiên nút "Chapter sau" cố định)
- [ ] Khi đọc hết chương: tự động điều hướng (`location.href = nextUrl` hoặc click phần tử nút), đợi trang mới load xong (`MutationObserver` hoặc lắng nghe sự kiện `load`), chạy lại detector, tự động Play tiếp
- [ ] Thiết kế schema lưu cấu hình: `{ domain, contentSelector, nextButtonSelector, titleSelector }` lưu vào `chrome.storage.local`
- [ ] Khi vào 1 site đã có cấu hình lưu sẵn → dùng ngay selector đã lưu, bỏ qua bước dò lại (tăng tốc + tránh dò sai nếu site đổi giao diện)
- [ ] Thêm UI "Reset cấu hình site này" trong popup, phòng khi site đổi giao diện làm selector cũ sai

### Definition of Done
Đọc liên tục từ Chương 37 sang Chương 38 trên site WordPress mà không cần bấm gì; tương tự trên nguontruyen.com đọc hết 1 chương tự chuyển chương kế tiếp; tắt/mở lại trình duyệt vào lại đúng site đó không bị dò lại từ đầu.

### Rủi ro cần lưu ý
- Một số theme WordPress khác có thể không có khối "Điều hướng bài viết" — luôn có fallback, không giả định 1 cấu trúc cố định cho mọi blog WordPress.
- nguontruyen.com dùng AJAX nên sau khi bấm "Chapter sau", URL có thể đổi nhưng DOM cũ chưa bị xoá ngay — cần đợi `MutationObserver` xác nhận nội dung MỚI (so sánh với tiêu đề chương cũ) trước khi bắt đầu đọc, tránh đọc nhầm nội dung chương vừa rồi.

---

## Giai đoạn 3 — Mở rộng dò nội dung cho các site khác

**Mục tiêu**: hệ thống dò không chỉ chạy tốt trên 2 site tham chiếu mà còn "đoán tương đối đúng" trên site lạ chưa từng gặp.

### Checklist
- [ ] Liệt kê thêm 5–10 trang đọc truyện phổ biến khác (site chữ + site tranh) để test chéo
- [ ] Chạy detector mặc định (Readability + heuristic nút next) trên từng site, ghi lại tỉ lệ đúng/sai
- [ ] Với site dò sai: bổ sung rule riêng theo domain (giống cách đã làm ở Giai đoạn 2 cho WordPress/nguontruyen), hoặc cải thiện heuristic chung nếu lỗi có tính hệ thống
- [ ] Xây tính năng "Chọn vùng đọc thủ công": người dùng bấm 1 nút, sau đó click vào đoạn văn đầu và đoạn văn cuối trên trang, hệ thống tự tính DOM path chung rồi lưu làm cấu hình riêng cho domain đó
- [ ] Test tính năng chọn thủ công trên 1 site mà detector tự động dò sai hoàn toàn

### Definition of Done
Với ít nhất 8/10 site test, detector tự động hoặc chọn thủ công cho ra kết quả đọc đúng nội dung.

---

## Giai đoạn 4 — Module dịch toàn trang (MyMemory)

**Mục tiêu**: dịch được nội dung trang từ tiếng Trung/Anh/... sang tiếng Việt (hoặc ngược lại), chèn đè lên văn bản gốc, có nút hoàn tác.

### Checklist
- [ ] Viết `translator.js`: hàm `collectTextNodes()` duyệt DOM bằng `TreeWalker`
- [ ] Viết hàm `chunkBySize()` gộp nhóm text node theo giới hạn 500 ký tự/request của MyMemory
- [ ] Nối `background/service-worker.js` gọi MyMemory API (code mẫu ở mục 5.2 Phương án A)
- [ ] Lưu `originalText` vào `WeakMap` trước khi ghi đè `nodeValue`
- [ ] Thêm nút "Xem bản gốc / Xem bản dịch" trong toolbar để toggle qua lại
- [ ] Test dịch 1 trang tin tức tiếng Anh bất kỳ sang tiếng Việt — kiểm tra layout trang không bị vỡ sau khi thay text
- [ ] Test dịch trực tiếp nội dung chương truyện đã dò được ở Giai đoạn 1–3 (kết hợp: dò nội dung → dịch → đọc bản dịch bằng TTS)
- [ ] Xử lý giới hạn 5.000 ký tự/ngày của MyMemory: hiện cảnh báo nhẹ khi gần chạm hạn mức, gợi ý người dùng tự dựng LibreTranslate (mục 14.1) nếu dùng nhiều

### Definition of Done
Dịch được 1 trang bất kỳ, giữ nguyên bố cục, hoàn tác về bản gốc được, không văng lỗi khi trang có nhiều text node (>500).

---

## Giai đoạn 5 — Module tự cuộn đồng bộ theo câu

**Mục tiêu**: khi đang đọc TTS, trang tự cuộn mượt theo câu đang đọc, người dùng không cần tự cuộn tay.

### Checklist
- [ ] Viết `auto-scroll.js` theo mẫu mục 6 tài liệu hướng dẫn — ưu tiên "Chế độ 2: cuộn theo câu" bằng `scrollIntoView`
- [ ] Thêm option bật/tắt trong panel cấu hình
- [ ] Thêm option chỉnh vị trí cuộn tới (ví dụ: câu đang đọc nằm cách mép trên màn hình bao nhiêu %)
- [ ] Test trên điện thoại thật (giả lập bằng Chrome DevTools responsive mode trước, test thật sau) để đảm bảo cuộn mượt không giật

### Definition of Done
Đọc 1 đoạn dài, trang tự cuộn theo đúng câu đang đọc, không bị giật, không bị cuộn vượt quá nội dung.

---

## Giai đoạn 6 — Hoàn thiện UI

**Mục tiêu**: giao diện gọn gàng, dễ dùng, giống mức độ hoàn thiện của 3 ảnh tham khảo ban đầu bạn gửi (thanh công cụ dưới, panel cấu hình màu/font, danh sách câu).

### Checklist
- [ ] Thanh công cụ nổi: Play/Pause, tốc độ đọc, số chương hiện tại, nút thu gọn/mở rộng, kéo thả di chuyển vị trí thanh
- [ ] Panel cấu hình: màu nền/màu chữ overlay đọc, cỡ chữ, giãn dòng, font, căn lề — lưu vào `chrome.storage.sync`
- [ ] Panel danh sách câu: hiện toàn bộ câu trong chương, bấm vào câu bất kỳ để nhảy tới đọc từ đó
- [ ] Popup khi bấm icon extension: bật/tắt nhanh từng module (đọc / dịch / tự cuộn), link tới trang cài đặt đầy đủ
- [ ] Test toàn bộ UI ở kích thước màn hình điện thoại (giả lập trước bằng Chrome DevTools)

### Definition of Done
Một người chưa từng dùng extension có thể tự bật đọc + chỉnh cỡ chữ + tắt tự cuộn mà không cần hướng dẫn.

---

## Giai đoạn 7 — OCR truyện tranh (module khó nhất, chuẩn bị tinh thần tốn thời gian nhất)

**Mục tiêu**: đọc được truyện tranh bằng giọng nói, chỉ đọc bong bóng thoại, bỏ qua từ tượng thanh.

### Checklist
- [ ] Tích hợp Tesseract.js (`npm install tesseract.js`), tải sẵn gói ngôn ngữ cần thiết vào `libs/tessdata/` (mục 14.3)
- [ ] Tích hợp OpenCV.js (tải file build sẵn, nhúng trực tiếp)
- [ ] Viết `ocr-engine.js`: `IntersectionObserver` chỉ xử lý ảnh trong khung nhìn
- [ ] Viết hàm phát hiện contour hình bong bóng thoại (nền trắng, tỉ lệ tròn/bầu dục) bằng OpenCV.js, lọc bỏ vùng không đạt tiêu chí
- [ ] Chạy Tesseract OCR riêng từng vùng bong bóng đã lọc được
- [ ] Viết hàm sắp xếp thứ tự đọc bong bóng (phải→trái cho manga Nhật, trái→phải cho truyện tranh phương Tây), có option chọn hướng
- [ ] Thêm UI "Sửa văn bản đã nhận diện" trước khi đọc, vì OCR truyện tranh dễ sai
- [ ] Nối kết quả OCR vào hàng đợi TTS đã có ở Giai đoạn 1
- [ ] Test trên ít nhất 3 bộ truyện tranh có phong cách chữ khác nhau (chữ in đậm rõ ràng, chữ viết tay cách điệu, chữ nhỏ dày đặc) để đánh giá độ chính xác thực tế

### Definition of Done
Với ít nhất 1 bộ truyện tranh chữ rõ ràng, extension đọc đúng >80% nội dung bong bóng thoại, không đọc từ tượng thanh.

### Rủi ro cần lưu ý
- Đây là phần dễ vượt tiến độ nhất — nếu quá 3 tuần vẫn chưa đạt kết quả chấp nhận được, cân nhắc scope lại: chỉ hỗ trợ manga có font in chuẩn trước, để lại chữ viết tay cách điệu cho phiên bản sau.

---

## Giai đoạn 8 — Dịch kiểu chụp màn hình + overlay

**Mục tiêu**: dịch được chữ trong ảnh/truyện tranh, chèn đè lên đúng vị trí như app tham khảo (EZ Screen Translator) nhưng mượt hơn.

### Checklist
- [ ] Xin thêm permission `activeTab`/`tabs` trong `manifest.json`
- [ ] Viết hàm gọi `chrome.tabs.captureVisibleTab()` từ background service worker
- [ ] Tái sử dụng pipeline OCR đã có ở Giai đoạn 7 để lấy text + bbox từ ảnh chụp
- [ ] Viết hàm lấy màu nền trung bình quanh mỗi bbox (dùng canvas `getImageData`) để che chữ gốc tự nhiên hơn
- [ ] Viết `renderOverlay()` vẽ `<div>` overlay đè đúng toạ độ (mẫu code mục 13.1)
- [ ] Thêm debounce khi cuộn/resize để tự chụp lại và dịch lại vùng nhìn thấy mới
- [ ] Test hiệu năng: đo thời gian từ lúc cuộn tới lúc overlay mới hiện ra, tối ưu nếu >1.5 giây (gây cảm giác giật)
- [ ] Quyết định logic tự động chuyển giữa Module 4 (dịch text node) và Module 8 (overlay) dựa trên loại nội dung phát hiện được (text thật vs ảnh truyện tranh)

### Definition of Done
Vào 1 trang truyện tranh/webtoon, bật dịch, thấy được bản dịch đè lên đúng vị trí bong bóng thoại, cuộn trang thấy overlay cập nhật theo mà không lag quá rõ.

---

## Giai đoạn 9 — Đóng gói cho Android

### Checklist
- [ ] Đảm bảo extension chạy ổn định trên Chrome desktop trước (không mang bug sang mobile)
- [ ] Nén extension, đăng ký tài khoản `addons.mozilla.org`, nộp bản unlisted để Mozilla ký số miễn phí (mục 16.2 Cách 2)
- [ ] Cài Firefox for Android, làm theo mục 16.3 để cài extension đã ký
- [ ] Test toàn bộ 3 module (đọc/dịch/tự cuộn) trên Firefox Android thật — chú ý UI toolbar có bị che bởi thanh điều hướng Android không
- [ ] Test song song trên Kiwi Browser (cài trực tiếp không cần ký số) để có phương án dự phòng cho người dùng
- [ ] Ghi chú lại các khác biệt hành vi giữa desktop và Android (ví dụ: giọng đọc TTS trên Android có thể khác, cần test riêng)

### Definition of Done
Một người dùng Android thật (không phải giả lập) cài được extension qua Firefox hoặc Kiwi và dùng được cả 3 module.

---

## Giai đoạn 10 — Chuyển đổi sang Safari Web Extension (iOS)

### Checklist
- [ ] Chuẩn bị máy Mac + Xcode
- [ ] Chạy `xcrun safari-web-extension-converter` theo mục 16.4
- [ ] Cài `webextension-polyfill`, thay mọi lời gọi `chrome.*` bằng `browser.*` polyfill để tương thích Safari
- [ ] Sửa lỗi phát sinh do khác biệt API giữa Chromium và WebKit (thường gặp nhất: cách đăng ký content script, cách dùng `chrome.storage`)
- [ ] Xử lý riêng sự kiện `voiceschanged` cho Web Speech API trên Safari iOS (danh sách giọng tải bất đồng bộ, chậm hơn desktop)
- [ ] Build và cài lên iPhone thật qua cáp USB, tin cậy Apple ID theo mục 16.4
- [ ] Test cả 3 module trên Safari iOS thật

### Definition of Done
Extension chạy được trên Safari iOS thật (không phải giả lập), cả 3 module hoạt động dù có thể có giới hạn nhỏ so với desktop (ghi chú lại các giới hạn này cho người dùng biết trước).

---

## Giai đoạn 11 — Kiểm thử toàn diện & hoàn thiện

### Checklist
- [ ] Test hồi quy (regression test) lại toàn bộ Giai đoạn 1–10 sau khi có thay đổi lớn ở bất kỳ giai đoạn nào
- [ ] Test trên tối thiểu 10 site đọc truyện khác nhau (5 truyện chữ, 5 truyện tranh) ngoài 2 site tham chiếu ban đầu
- [ ] Viết tài liệu hướng dẫn sử dụng ngắn gọn cho người dùng cuối (khác với tài liệu kỹ thuật này) — có thể làm dạng trang README trên GitHub hoặc trang giới thiệu đơn giản
- [ ] Rà lại phần pháp lý/bản quyền (mục 9 tài liệu hướng dẫn) trước khi công khai chia sẻ extension cho người khác dùng
- [ ] Dọn dẹp code, xoá `console.log` thừa, viết comment cho các hàm phức tạp (đặc biệt là detector và OCR)
- [ ] Gắn số phiên bản rõ ràng trong `manifest.json`, tạo tag Git tương ứng khi release

### Definition of Done
Extension chạy ổn định trên cả 4 nền tảng (Chrome/Edge desktop, Firefox desktop, Android, iOS), có tài liệu người dùng, code sạch sẽ có trên GitHub với lịch sử commit rõ ràng theo từng giai đoạn ở trên.

---

## Bảng theo dõi tiến độ nhanh (cập nhật thủ công khi làm)

| Giai đoạn | Trạng thái | Ngày bắt đầu | Ngày hoàn thành | Ghi chú |
|---|---|---|---|---|
| 0. Chuẩn bị môi trường | ☐ Chưa bắt đầu | | | |
| 1. MVP đọc truyện chữ | ☐ Chưa bắt đầu | | | |
| 2. Tô sáng + tự next + lưu config | ☐ Chưa bắt đầu | | | |
| 3. Mở rộng dò site khác | ☐ Chưa bắt đầu | | | |
| 4. Module dịch (MyMemory) | ☐ Chưa bắt đầu | | | |
| 5. Tự cuộn theo câu | ☐ Chưa bắt đầu | | | |
| 6. Hoàn thiện UI | ☐ Chưa bắt đầu | | | |
| 7. OCR truyện tranh | ☐ Chưa bắt đầu | | | |
| 8. Dịch overlay | ☐ Chưa bắt đầu | | | |
| 9. Đóng gói Android | ☐ Chưa bắt đầu | | | |
| 10. Chuyển đổi iOS | ☐ Chưa bắt đầu | | | |
| 11. Kiểm thử & hoàn thiện | ☐ Chưa bắt đầu | | | |

> Gợi ý: đổi "☐ Chưa bắt đầu" thành "🔄 Đang làm" hoặc "✅ Xong" khi cập nhật, để dễ theo dõi khi mở lại file này sau này.
