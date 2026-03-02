// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process unless
// nodeIntegration is set to true in webPreferences.
// Use preload.js to selectively enable features
// needed in the renderer process.

window.addEventListener("DOMContentLoaded", () => {
  const pEl = document.getElementById("pressure");
  const tEl = document.getElementById("temp");

  // ダミー：1秒ごとに更新
  let p = 101325;
  let t = 25.0;

  setInterval(() => {
    p += Math.round((Math.random() - 0.5) * 20);
    t += (Math.random() - 0.5) * 0.1;

    if (pEl) pEl.textContent = String(p);
    if (tEl) tEl.textContent = t.toFixed(1);
  }, 1000);
});