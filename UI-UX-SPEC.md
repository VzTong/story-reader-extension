# Story Reader Extension – UI/UX Specification

> Tài liệu này là **chuẩn duy nhất** để triển khai giao diện.
> Mọi thay đổi code phải bám theo tài liệu này. Không được tự ý thêm/bớt tính năng UI nếu chưa cập nhật tài liệu.

---

## 1. Mục tiêu tổng thể

- Giao diện **sạch, tối giản, hiện đại – cyberpunk**, lấy cảm hứng chính từ:
  - **kagane.to** (toolbar / auto-scroll / ẩn hiện mượt / setting)
  - **sangtacviet.app** (panel TTS + setting giọng)
  - **Ejoy** (bong bóng kéo thả + tự ẩn nửa cạnh)
- **Không làm ảnh hưởng layout** của trang web gốc (không đẩy content, không overlap xấu).
- Ưu tiên trải nghiệm **mobile** (vì hover không tiện trên điện thoại).

---

## 2. Thành phần giao diện chính

### 2.1. Floating Bubble (Bong bóng chính)

- Là **điểm vào duy nhất** của extension.
- Hình tròn, dùng **icon thật** của extension (`icons/icon128.png`).
- Có thể **kéo thả tự do** trên màn hình.
- Khi thả tay:
  - Tự động **hút vào cạnh gần nhất** (trái hoặc phải).
  - **Ẩn một nửa** vào cạnh màn hình (kiểu Ejoy).
  - Khi hover / chạm lại thì hiện đầy đủ.
- Bấm vào bubble → hiện **Mini Menu**.
- Vị trí được lưu vào `localStorage`.

### 2.2. Mini Menu (khi bấm Bubble)

Menu nhỏ, bo góc đẹp, hiện gần bubble.

**Các mục theo thứ tự:**

1. **Auto-scroll** (Play/Pause cuộn trang)
2. **Nghe TTS** (bật/tắt đọc)
3. **Danh sách câu** (mở panel bên phải)
4. ───────────── (divider)
5. **Highlight** (bật/tắt tô chữ)
6. **Đổi Theme** (sáng / tối)
7. **Setting** (mở nhanh phần setting giọng trong TTS Panel)
8. **Dừng tất cả**

**Yêu cầu visual:**
- Không viết HOA toàn bộ.
- Icon + chữ rõ ràng, khoảng cách thoáng.
- Hover có feedback nhẹ (glow accent).
- Đóng khi bấm ra ngoài hoặc Esc.

### 2.3. TTS Panel (bên phải)

- Trượt ra từ **cạnh phải** màn hình.
- Chiều rộng: ~320px (mobile: full width).
- Nội dung:
  - Header: “Danh sách câu” + nút ⚙️ + nút ✕
  - Danh sách câu (có số thứ tự, click để nhảy)
  - Footer: tiến độ (x / y) + nút Stop + Play TTS

**Setting giọng (quan trọng):**
- Chỉ hiện khi bấm nút **⚙️** trong header của panel TTS (hoặc từ Mini Menu → Setting).
- Setting nằm **bên trong panel** (không phải modal riêng).
- Các tùy chọn:
  - Giọng đọc (select)
  - Điều chỉnh âm thanh
    - Tốc độ đọc
    - Độ cao giọng (pitch)
    - Tốc độ cuộn
  - Giao diện: màu làm nổi bật văn bản (highlight color)
  - Lưu cài đặt (tự động lưu khi thay đổi)

### 2.4. Highlight

- Chỉ tô trên **nội dung trang** (nội dung của truyện), tuyệt đối không tô trong panel.
- Màu mặc định: neon vàng/lime nhẹ, có `box-shadow` glow để dễ nhìn trên nền tối.
- Người dùng có thể đổi màu trong Setting.

---

## 3. Quy tắc hành vi

| Hành động              | Kết quả                                      |
|------------------------|----------------------------------------------|
| Kéo bubble             | Di chuyển tự do                              |
| Thả bubble             | Tự dock vào cạnh + ẩn nửa                    |
| Bấm bubble             | Mở / đóng Mini Menu                          |
| Bấm “Danh sách câu”    | Mở TTS Panel bên phải                        |
| Bấm Setting (menu)     | Mở TTS Panel + hiện phần setting giọng       |
| Bấm ⚙️ trong TTS Panel | Hiện / ẩn phần setting giọng bên trong panel |
| Bấm Esc                | Đóng panel hoặc menu đang mở                 |
| Đổi Theme              | Lưu vào localStorage                         |

---

## 4. Phong cách thiết kế (Design Tokens) – Cyberpunk

**Hướng thẩm mỹ:** Dark cyberpunk – nền đen sâu, accent neon cyan, glow nhẹ, glassmorphism tinh tế. Không dùng palette generic.

### 4.1. Color tokens

| Token              | Dark (mặc định)                    | Light                          | Vai trò                          |
|--------------------|------------------------------------|--------------------------------|----------------------------------|
| `--sr-bg`          | `rgba(6, 10, 18, 0.88)`            | `rgba(255, 255, 255, 0.94)`    | Nền glass menu/bubble            |
| `--sr-bg-solid`    | `#060a12`                          | `#ffffff`                      | Nền solid                        |
| `--sr-bg-panel`    | `rgba(6, 10, 18, 0.96)`            | `rgba(255, 255, 255, 0.98)`    | Nền TTS panel                    |
| `--sr-border`      | `rgba(0, 229, 255, 0.18)`          | `rgba(0, 0, 0, 0.08)`          | Viền                             |
| `--sr-text`        | `#e8f0ff`                          | `#0f172a`                      | Chữ chính                        |
| `--sr-muted`       | `#7a8ba0`                          | `#64748b`                      | Chữ phụ                          |
| `--sr-accent`      | `#00e5ff`                          | `#0284c7`                      | Accent chính (neon cyan)         |
| `--sr-accent-hover`| `#67f0ff`                          | `#0369a1`                      | Hover accent                     |
| `--sr-accent-dim`  | `rgba(0, 229, 255, 0.12)`          | `rgba(2, 132, 199, 0.12)`      | Nền active item                  |
| `--sr-danger`      | `#ff3b6b`                          | `#e11d48`                      | Nút dừng / nguy hiểm             |
| `--sr-highlight`   | `rgba(255, 230, 80, 0.42)`         | `rgba(250, 204, 21, 0.38)`     | Tô câu đang đọc                  |
| `--sr-glow`        | `0 0 16px rgba(0, 229, 255, 0.35)` | `0 4px 16px rgba(2,132,199,.2)`| Glow accent                      |
| `--sr-shadow`      | `0 12px 40px rgba(0, 0, 0, 0.55)`  | `0 8px 28px rgba(0, 0, 0, 0.12)`| Đổ bóng                         |

### 4.2. Typography

- Font stack: `system-ui, -apple-system, "Segoe UI", "Inter", sans-serif`
- Menu item: 14px / 500
- Panel header: 13.5px / 600
- Sentence list: 13px / 1.4
- Caption / muted: 11.5–12px

### 4.3. Radius & spacing

- Bubble: 50% (tròn)
- Menu / panel: 14–16px
- Menu item: 10–11px
- Gap menu items: 2px
- Panel width: 320px (mobile: 100%)

### 4.4. Motion

- Bubble dock / undock: 0.25s cubic-bezier(0.4, 0, 0.2, 1)
- Menu open: 0.18s ease scale + opacity
- Panel slide: 0.28s cubic-bezier(0.4, 0, 0.2, 1)
- Hover feedback: 0.12s

### 4.5. Signature element

- Bubble có **viền neon cyan mỏng + glow nhẹ** khi đang phát TTS hoặc auto-scroll.
- Active sentence trong panel có **thanh accent dọc bên trái** (inset box-shadow).
- Highlight trên trang có **glow vàng nhẹ** để nổi trên nền tối.

---

## 5. Không được làm

- Không thêm modal / popup chồng lên panel.
- Không viết chữ HOA toàn bộ trong menu.
- Không dùng emoji quá nhiều (chỉ icon tối giản).
- Không đẩy layout trang gốc.
- Không hardcode màu ngoài design tokens (trừ popup Chrome nhỏ).
