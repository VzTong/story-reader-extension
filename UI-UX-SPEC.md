# Story Reader Extension – UI/UX Specification

> Tài liệu này là **chuẩn duy nhất** để triển khai giao diện.
> Mọi thay đổi code phải bám theo tài liệu này. Không được tự ý thêm/bớt tính năng UI nếu chưa cập nhật tài liệu.

---

## 1. Mục tiêu tổng thể

- Giao diện **sạch, tối giản, hiện đại**, lấy cảm hứng chính từ:
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
7. **Setting**
8. **Dừng tất cả**

**Yêu cầu visual:**
- Không viết HOA toàn bộ.
- Icon + chữ rõ ràng, khoảng cách thoáng.
- Hover có feedback nhẹ.
- Đóng khi bấm ra ngoài hoặc Esc.

### 2.3. TTS Panel (bên phải)

- Trượt ra từ **cạnh phải** màn hình.
- Chiều rộng: ~320px (mobile: half width).
- Nội dung:
  - Header: “Danh sách câu” + nút ⚙️ + nút ✕
  - Danh sách câu (có số thứ tự, click để nhảy)
  - Footer: tiến độ (x / y) + nút Stop + Play TTS

**Setting giọng (quan trọng):**
- Chỉ hiện khi bấm nút **⚙️** trong header của panel TTS.
- Setting nằm **bên trong panel** (không phải modal riêng).
- Các tùy chọn:
  - Giọng đọc (select)
  - Điều chỉnh âm thanh
    - Tốc độ đọc
    - Độ cao giọng
    - Điều chỉnh theo ngữ cảnh
  - Giao diện (màu làm nổi bật văn bản -> chổ này là màu tô văn bản)
  - Lưu cài đặt

### 2.4. Highlight

- Chỉ tô trên **nội dung trang** (nội dung của truyện), tuyệt đối không tô trong panel.
- Màu vàng nhẹ (hoặc màu được chỉnh), có `box-shadow` để dễ nhìn trên nền tối.

---

## 3. Quy tắc hành vi

| Hành động              | Kết quả                                      |
|------------------------|----------------------------------------------|
| Kéo bubble             | Di chuyển tự do                              |
| Thả bubble             | Tự dock vào cạnh + ẩn nửa                    |
| Bấm bubble             | Mở / đóng Mini Menu                          |
| Bấm “Transcript”       | Mở TTS Panel bên phải                        |
| Bấm ⚙️ trực tiếp       | Mở popup kế mini Menu để setting men         |
| Bấm ⚙️ trong TTS Panel | Hiện / ẩn phần setting giọng bên trong panel |
| Bấm Esc                | Đóng panel hoặc menu đang mở                 |
| Đổi Theme              | Lưu vào localStorage                         |

---

## 4. Phong cách thiết kế (Design Tokens)

hiện đại - cyper