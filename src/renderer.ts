// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process unless
// nodeIntegration is set to true in webPreferences.
// Use preload.js to selectively enable features
// needed in the renderer process.

window.addEventListener("DOMContentLoaded", async () => {
  const api = (window as any).api;

  const portSel = document.getElementById("port") as HTMLSelectElement | null;
  const baudInp = document.getElementById("baud") as HTMLInputElement | null;

  const btnCon = document.getElementById("connect") as HTMLButtonElement | null;
  const btnDis = document.getElementById("disconnect") as HTMLButtonElement | null;

  const statusEl = document.getElementById("status");
  const pEl = document.getElementById("pressure");
  const tEl = document.getElementById("temp");
  const rawEl = document.getElementById("raw");

  let connected = false;

  const setStatus = (s: string) => {
    if (statusEl) statusEl.textContent = s;
  };

  const setButtons = () => {
    if (btnCon) btnCon.disabled = connected;
    if (btnDis) btnDis.disabled = !connected;
    if (portSel) portSel.disabled = connected;
    if (baudInp) baudInp.disabled = connected;
  };

  // 初期状態
  setStatus("未接続");
  setButtons();

  // ポート一覧を読み込む
  try {
    const ports = await api.listPorts();
    if (portSel) {
      portSel.innerHTML = "";
      for (const p of ports as Array<{ path: string; manufacturer: string }>) {
        const opt = document.createElement("option");
        opt.value = p.path;
        opt.textContent = p.manufacturer ? `${p.path} (${p.manufacturer})` : p.path;
        portSel.appendChild(opt);
      }
    }
  } catch (e: any) {
    setStatus(`ポート一覧取得失敗: ${String(e?.message ?? e)}`);
  }

  // main → renderer: 接続状態
  api.onStatus?.((st: string) => {
    connected = st === "connected";
    setStatus(connected ? "接続中（受信待ち）" : "未接続");
    setButtons();
  });

  // main → renderer: エラー
  api.onError((msg: string) => {
    // 受信できているならconnectedのはずなので、必要以上に上書きしない
    // ただし、未接続のままのエラーは見せる
    if (!connected) setStatus(`エラー: ${msg}`);
    // connected中は console にも出しておくとデバッグしやすい
    console.error(msg);
  });

  // main → renderer: 受信1行
  api.onLine((line: string) => {
    if (rawEl) rawEl.textContent = line;

    // 受信できている = 実質接続できている
    if (connected) setStatus("受信中");

    // #行（STM32側のヘッダ/エラー）は無視（rawには表示される）
    if (line.startsWith("#")) return;

    // CSV: pressure_pa,temp_c
    const parts = line.split(",");
    if (parts.length < 2) return;

    const pressure = Number(parts[0]);
    const temp = Number(parts[1]);

    if (Number.isFinite(pressure) && pEl) pEl.textContent = String(Math.round(pressure));
    if (Number.isFinite(temp) && tEl) tEl.textContent = temp.toFixed(1);
  });

  // 接続ボタン
  btnCon?.addEventListener("click", async () => {
    if (!portSel) return;

    const path = portSel.value;
    const baud = Number(baudInp?.value ?? "115200");

    setStatus("接続中...");
    try {
      const res = await api.connect(path, baud); // {ok, message?}
      if (res?.ok) {
        connected = true;
        setStatus("接続中（受信待ち）");
      } else {
        connected = false;
        setStatus(`エラー: ${res?.message ?? "connect failed"}`);
      }
    } catch (e: any) {
      connected = false;
      setStatus(`エラー: ${String(e?.message ?? e)}`);
    } finally {
      setButtons();
    }
  });

  // 切断ボタン
  btnDis?.addEventListener("click", async () => {
    try {
      await api.disconnect();
    } finally {
      connected = false;
      setStatus("未接続");
      setButtons();
    }
  });
});