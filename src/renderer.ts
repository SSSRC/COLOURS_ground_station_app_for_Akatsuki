// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process unless
// nodeIntegration is set to true in webPreferences.
// Use preload.js to selectively enable features
// needed in the renderer process.

window.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btn");
  const status = document.getElementById("status");

  btn?.addEventListener("click", () => {
    if (status) {
      status.innerText = "接続成功（仮）🚀";
    }
  });
});