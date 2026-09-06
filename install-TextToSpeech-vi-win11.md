# Hướng dẫn cài đặt giọng đọc tiếng Việt (Text-to-Speech) trên Windows 11

Hướng dẫn này dành cho việc cài đặt **giọng đọc tiếng Việt (vi-VN)** để extension đọc truyện có thể dùng `speechSynthesis` với tiếng Việt.

---

## 1. Mở PowerShell với quyền Administrator

- Nhấn `Win` + `X` → chọn **Terminal (Admin)** (hoặc **Windows PowerShell (Admin)**)
- Hoặc: `Win` → gõ `powershell` → chuột phải → **Run as administrator**
- Nếu hiện hộp thoại UAC, chọn **Yes**

> ⚠️ Không mở bằng quyền Admin thì các lệnh `Add-WindowsCapability` / `Get-WindowsCapability -Online` sẽ báo lỗi truy cập.

---

## 2. Kiểm tra các ngôn ngữ đã cài đặt (bước kiểm tra ban đầu)

```powershell
Get-InstalledLanguage
```

Kết quả ví dụ:

```
Language Language Packs  Language Features
-------- --------------  -----------------
en-US    LpCab           BasicTyping, Handwriting, Speech, TextToSpeech, OCR
ja-JP    None            BasicTyping, Handwriting, OCR
und-Jpan None            Fonts
vi-VN    None            TextToSpeech
```

**Ý nghĩa các cột:**

| Cột | Ý nghĩa |
|---|---|
| `Language` | Mã ngôn ngữ (`vi-VN` là tiếng Việt) |
| `Language Packs` | Gói ngôn ngữ giao diện đầy đủ (`LpCab` = đã có gói, `None` = chưa có) |
| `Language Features` | Tính năng đi kèm: BasicTyping (gõ chữ), Handwriting (viết tay), Speech (nhận dạng giọng nói), **TextToSpeech (đọc văn bản)**, OCR (nhận chữ trong ảnh) |

---

## 3. Kiểm tra trạng thái chi tiết capability tiếng Việt

```powershell
Get-WindowsCapability -Online | Where-Object {$_.Name -like "*vi-VN*"} | Select-Object Name, State
```

Kết quả ví dụ:

```
Name                                       State
----                                       -----
Language.Basic~~~vi-VN~0.0.1.0        NotPresent
Language.Handwriting~~~vi-VN~0.0.1.0  NotPresent
Language.TextToSpeech~~~vi-VN~0.0.1.0  Installed
```

**Cách đọc kết quả:**

| Capability | State | Ý nghĩa |
|---|---|---|
| `Language.TextToSpeech~~~vi-VN` | `Installed` | Giọng đọc tiếng Việt **đã có** ✅ |
| `Language.Basic~~~vi-VN` | `NotPresent` | Gói gõ chữ chưa cài (không bắt buộc cho TTS) |
| `Language.Handwriting~~~vi-VN` | `NotPresent` | Gói viết tay chưa cài (không bắt buộc cho TTS) |

> 💡 Extension chỉ cần `Language.TextToSpeech` = `Installed`.
> - Nếu `NotPresent` → làm **Bước 4**.
> - Nếu đã `Installed` → bỏ qua Bước 4, sang Bước 5.

---

## 4. Cài đặt TextToSpeech tiếng Việt (chỉ làm khi chưa có)

```powershell
Add-WindowsCapability -Online -Name Language.TextToSpeech~~~vi-VN~0.0.1.0
```

(Tùy chọn) cài thêm gói gõ chữ cơ bản:

```powershell
Add-WindowsCapability -Online -Name Language.Basic~~~vi-VN~0.0.1.0
```

Kết quả thành công:

```
Path          :
Online        : True
RestartNeeded : False
```

- `Path` : trống (gói được tải tự động từ Windows Update)
- `Online` : `True` = cài cho hệ điều hành đang chạy
- `RestartNeeded` : `False` = **không cần khởi động lại**

> ⚠️ Lệnh này cần kết nối Internet (Windows tải gói từ Windows Update). Nếu lỗi, kiểm tra mạng rồi thử lại.

---

## 5. Kiểm tra lại sau khi cài đặt

```powershell
Get-WindowsCapability -Online | Where-Object {$_.Name -like "*vi-VN*"} | Select-Object Name, State
```

Kết quả mong muốn:

```
Name                                       State
----                                       -----
Language.Basic~~~vi-VN~0.0.1.0         Installed
Language.Handwriting~~~vi-VN~0.0.1.0  NotPresent
Language.TextToSpeech~~~vi-VN~0.0.1.0  Installed
```

✅ `Language.TextToSpeech~~~vi-VN~0.0.1.0` = **Installed** là thành công.

---

## 6. Cách cài thay thế bằng giao diện Settings (không cần lệnh)

1. Nhấn `Win` + `I` mở **Settings**
2. Vào **Time & language** → **Language & region**
3. Bấm **Add a language** (Thêm một ngôn ngữ)
4. Tìm **Tiếng Việt (Việt Nam)** → chọn → **Next**
5. Trong khung **Language features**, tích chọn **Text-to-speech** (chỉ cần mục này cho đọc truyện)
6. Bấm **Install** và chờ tải xong

> Đây chính là "bước tải tiếng Việt" bằng giao diện — tương đương với lệnh `Add-WindowsCapability` ở Bước 4.

---

## 7. Kiểm tra giọng đọc trong trình duyệt

Mở **DevTools Console** trên trình duyệt và chạy:

```javascript
speechSynthesis.getVoices()
  .filter(v => v.lang.startsWith('vi'))
  .forEach(v => console.log(v.name, v.lang));
```

Kết quả mong muốn:

```
Minh Vietnamese (Vietnam) vi-VN
HoaiMy Vietnamese (Vietnam) vi-VN
```

> 💡 Có thể cần **khởi động lại trình duyệt** (hoặc Windows nếu `RestartNeeded: True`) để giọng đọc mới xuất hiện.

**Thử đọc một câu tiếng Việt:**

```javascript
const utter = new SpeechSynthesisUtterance('Xin chào, đây là giọng đọc tiếng Việt.');
utter.lang = 'vi-VN';
speechSynthesis.speak(utter);
```

---

## 8. Tóm tắt nhanh (cheat sheet)

```powershell
# 1. Kiểm tra ngôn ngữ đã cài
Get-InstalledLanguage

# 2. Kiểm tra capability TTS tiếng Việt
Get-WindowsCapability -Online | Where-Object {$_.Name -like "*vi-VN*"} | Select-Object Name, State

# 3. Cài TTS tiếng Việt (nếu NotPresent)
Add-WindowsCapability -Online -Name Language.TextToSpeech~~~vi-VN~0.0.1.0

# 4. (Tùy chọn) Cài gói gõ chữ cơ bản
Add-WindowsCapability -Online -Name Language.Basic~~~vi-VN~0.0.1.0

# 5. Kiểm tra lại → TextToSpeech phải là Installed
Get-WindowsCapability -Online | Where-Object {$_.Name -like "*vi-VN*"} | Select-Object Name, State
```

Sau khi `Language.TextToSpeech~~~vi-VN` = `Installed`, khởi động lại trình duyệt và extension sẽ đọc được truyện bằng giọng tiếng Việt.