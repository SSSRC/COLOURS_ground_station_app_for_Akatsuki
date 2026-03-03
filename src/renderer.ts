// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// No Node.js APIs are available in this process unless
// nodeIntegration is set to true in webPreferences.
// Use preload.js to selectively enable features
// needed in the renderer process.

window.addEventListener("DOMContentLoaded", async () => {
  const api = (window as any).api;

  // ---- DOM ----
  const portSel = document.getElementById("port") as HTMLSelectElement | null;
  const baudInp = document.getElementById("baud") as HTMLInputElement | null;

  const btnCon = document.getElementById("connect") as HTMLButtonElement | null;
  const btnDis = document.getElementById("disconnect") as HTMLButtonElement | null;

  const statusEl = document.getElementById("status");
  const pEl = document.getElementById("pressure");
  const tEl = document.getElementById("temp");
  const aEl = document.getElementById("alt");
  const rawEl = document.getElementById("raw");

  // ---- state ----
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

  const setTelemetry = (pressurePa?: number, tempC?: number, altM?: number) => {
    if (typeof pressurePa === "number" && Number.isFinite(pressurePa) && pEl) {
      pEl.textContent = String(Math.round(pressurePa));
    }
    if (typeof tempC === "number" && Number.isFinite(tempC) && tEl) {
      tEl.textContent = tempC.toFixed(1);
    }
    if (typeof altM === "number" && Number.isFinite(altM) && aEl) {
      aEl.textContent = altM.toFixed(1);
    }
  };

  // 文字列から最初の数値を抜く（"ALT=12.3m" みたいなのもOK）
  const extractNumber = (s: string): number => {
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  };

  // 受信1行を解釈する
  // 対応:
  //  - "101114,20.7,12.3"
  //  - "101114,20.7"（alt無し）
  //  - "P=101114,T=20.7,ALT=12.3"
  const parseLine = (line: string): { p?: number; t?: number; a?: number } => {
    const s = line.trim();
    if (!s) return {};

    // コメント行（STM32側で #... を出してる場合）
    if (s.startsWith("#")) return {};

    // CSV分解
    const parts = s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);

    // キー付きかどうか判定（= を含む要素があればキー付き扱い）
    const hasKey = parts.some((x) => x.includes("="));

    if (hasKey) {
      // 例: "P=101114", "T=20.7", "ALT=12.3"
      const out: { p?: number; t?: number; a?: number } = {};
      for (const it of parts) {
        const [kRaw, vRaw] = it.split("=", 2);
        const k = (kRaw ?? "").trim().toUpperCase();
        const v = (vRaw ?? "").trim();
        const num = extractNumber(v);

        if (!Number.isFinite(num)) continue;

        if (k === "P" || k === "PRESS" || k === "PRESSURE") out.p = num;
        if (k === "T" || k === "TEMP" || k === "TEMPERATURE") out.t = num;
        if (k === "ALT" || k === "ALTITUDE" || k === "H") out.a = num;
      }
      return out;
    }

    // ふつうのCSV: p,t,a?
    const p = parts.length >= 1 ? extractNumber(parts[0]) : NaN;
    const t = parts.length >= 2 ? extractNumber(parts[1]) : NaN;
    const a = parts.length >= 3 ? extractNumber(parts[2]) : NaN;

    const out: { p?: number; t?: number; a?: number } = {};
    if (Number.isFinite(p)) out.p = p;
    if (Number.isFinite(t)) out.t = t;
    if (Number.isFinite(a)) out.a = a;
    return out;
  };

  // ---- init UI ----
  setStatus("未接続");
  setButtons();

  // ---- load ports ----
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

  // ---- main -> renderer ----
  // status通知がある場合だけ使う（無い環境でも落ちない）
  api.onStatus?.((st: string) => {
    connected = st === "connected";
    setStatus(connected ? "接続中（受信待ち）" : "未接続");
    setButtons();
  });

  api.onError((msg: string) => {
    console.error("serial error:", msg);
    // 接続してない時だけ画面に強く出す（接続中は受信表示を優先）
    if (!connected) setStatus(`エラー: ${msg}`);
  });

  api.onLine((line: string) => {
    if (rawEl) rawEl.textContent = line;

    // 受信できてるなら実質つながってる
    if (connected) setStatus("受信中");

    const { p, t, a } = parseLine(line);
    setTelemetry(p, t, a);
  });

  // ---- connect/disconnect ----
  btnCon?.addEventListener("click", async () => {
    const path = portSel?.value;
    const baud = Number(baudInp?.value ?? "115200");
    if (!path) return;

    setStatus("接続中...");
    try {
      const res = await api.connect(path, baud);
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