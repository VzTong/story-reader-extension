document.getElementById("btn-start").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "SHOW_TOOLBAR" });
  document.getElementById("status").textContent = "Đã hiện thanh công cụ trên trang.";
  window.close();
});

document.getElementById("btn-hide").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "HIDE_TOOLBAR" });
  document.getElementById("status").textContent = "Đã ẩn thanh công cụ.";
  window.close();
});