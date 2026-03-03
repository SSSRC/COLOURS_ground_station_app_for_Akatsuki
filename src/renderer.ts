window.addEventListener("DOMContentLoaded", async () => {
  const api = (window as any).api;

  // -----------------------------
  // DOM
  // -----------------------------
  const portSel = document.getElementById("port") as HTMLSelectElement | null;
  const baudInp = document.getElementById("baud") as HTMLInputElement | null;
  const btnCon = document.getElementById("connect") as HTMLButtonElement | null;
  const btnDis = document.getElementById("disconnect") as HTMLButtonElement | null;

  const statusEl = document.getElementById("status");
  const pEl = document.getElementById("pressure");
  const tEl = document.getElementById("temp");
  const aEl = document.getElementById("alt");
  const rawEl = document.getElementById("raw");

  const canvasP = document.getElementById("chartPressure") as HTMLCanvasElement | null;
  const canvasT = document.getElementById("chartTemp") as HTMLCanvasElement | null;
  const canvasA = document.getElementById("chartAlt") as HTMLCanvasElement | null;

  // -----------------------------
  // state
  // -----------------------------
  let connected = false;

  const setStatus = (s: string) => {
    if (statusEl) statusEl.textContent = s;
    console.log("[status]", s);
  };

  const setButtons = () => {
    if (btnCon) btnCon.disabled = connected;
    if (btnDis) btnDis.disabled = !connected;
    if (portSel) portSel.disabled = connected;
    if (baudInp) baudInp.disabled = connected;
  };

  // -----------------------------
  // helpers
  // -----------------------------
  const extractNumber = (s: string): number => {
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  };

  // "100117,20.6,1.98" / "P=...,T=...,ALT=..." どっちでも
  const parseLine = (line: string): { p?: number; t?: number; a?: number } => {
    const s = (line ?? "").trim();
    if (!s) return {};
    if (s.startsWith("#")) return {};

    const parts = s.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
    const hasKey = parts.some((x) => x.includes("="));

    if (hasKey) {
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

    const out: { p?: number; t?: number; a?: number } = {};
    if (parts.length >= 1) {
      const p = extractNumber(parts[0]);
      if (Number.isFinite(p)) out.p = p;
    }
    if (parts.length >= 2) {
      const t = extractNumber(parts[1]);
      if (Number.isFinite(t)) out.t = t;
    }
    if (parts.length >= 3) {
      const a = extractNumber(parts[2]);
      if (Number.isFinite(a)) out.a = a;
    }
    return out;
  };

  // -----------------------------
  // Chart.js setup (CDN)
  // -----------------------------
  const C = (window as any).Chart;
  console.log("Chart typeof:", typeof C);

  const ensureCanvas = (c: HTMLCanvasElement | null, name: string) => {
    if (!c) {
      setStatus(`canvasが見つかりません: ${name}（index.htmlのidを確認）`);
      return false;
    }
    // CSSのheightだけだと描画バッファが小さい/0になることがあるので明示
    // 親幅に合わせて横800固定でもOKだが、まずは確実に見えるサイズにする
    const w = Math.max(600, c.parentElement?.clientWidth ?? 600);
    c.width = w;
    c.height = 220;

    c.style.display = "block";
    c.style.width = "100%";
    c.style.height = "220px";
    c.style.background = "#fff";
    c.style.borderRadius = "6px";
    c.style.margin = "10px 0 30px";

    return true;
  };

  if (!C) {
    setStatus("Chart.jsが読み込めていません（index.htmlの読み込み順/CSP確認）");
    return;
  }

  if (!ensureCanvas(canvasP, "chartPressure")) return;
  if (!ensureCanvas(canvasT, "chartTemp")) return;
  if (!ensureCanvas(canvasA, "chartAlt")) return;

  const MAX_POINTS = 600;
  const labels: string[] = [];
  const dataP: number[] = [];
  const dataT: number[] = [];
  const dataA: number[] = [];

  const nowLabel = () => new Date().toLocaleTimeString();

  const trimToMax = () => {
    while (labels.length > MAX_POINTS) {
      labels.shift();
      dataP.shift();
      dataT.shift();
      dataA.shift();
    }
  };

  const destroyIfExists = (canvas: HTMLCanvasElement) => {
    // Chart.js v3+ で getChart がある
    try {
      const existing = (C as any).getChart?.(canvas);
      if (existing) existing.destroy();
    } catch {}
  };

  const makeChart = (canvas: HTMLCanvasElement, label: string, data: number[]) => {
    destroyIfExists(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    return new C(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label,
            data,
            tension: 0.2,
            pointRadius: 0,
          },
        ],
      },
      options: {
        animation: false,
        responsive: false, // ★ width/heightを固定したのでfalseにして確実化
        maintainAspectRatio: false,
        scales: {
          x: { display: true },
        },
      },
    });
  };

  const chartP = makeChart(canvasP!, "Pressure (Pa)", dataP);
  const chartT = makeChart(canvasT!, "Temp (°C)", dataT);
  const chartA = makeChart(canvasA!, "Alt (m)", dataA);

  console.log("charts created:", !!chartP, !!chartT, !!chartA);
  setStatus("未接続（グラフ初期化OK）");

  const pushPoint = (p?: number, t?: number, a?: number) => {
    // ★まずは P だけでも描く（真っ白を確実に回避）
    if (!Number.isFinite(p as number)) return;

    labels.push(nowLabel());
    dataP.push(p as number);

    // T/A が無ければ前回値 or 0 にする（線が途切れないように）
    dataT.push(Number.isFinite(t as number) ? (t as number) : (dataT.length ? dataT[dataT.length - 1] : 0));
    dataA.push(Number.isFinite(a as number) ? (a as number) : (dataA.length ? dataA[dataA.length - 1] : 0));

    trimToMax();

    chartP?.update();
    chartT?.update();
    chartA?.update();
  };

  // -----------------------------
  // init UI
  // -----------------------------
  setButtons();

  // -----------------------------
  // ports
  // -----------------------------
  const refreshPorts = async () => {
    if (!portSel) return;
    try {
      const ports = await api.listPorts();
      const prev = portSel.value;

      portSel.innerHTML = "";
      for (const p of ports as Array<{ path: string; manufacturer: string }>) {
        const opt = document.createElement("option");
        opt.value = p.path;
        opt.textContent = p.manufacturer ? `${p.path} (${p.manufacturer})` : p.path;
        portSel.appendChild(opt);
      }
      if (prev) portSel.value = prev;
    } catch (e: any) {
      setStatus(`ポート一覧取得失敗: ${String(e?.message ?? e)}`);
    }
  };

  await refreshPorts();

  // -----------------------------
  // events
  // -----------------------------
  api.onError((msg: string) => {
    console.error("serial error:", msg);
    if (!connected) setStatus(`エラー: ${msg}`);
  });

  api.onLine((line: string) => {
    if (rawEl) rawEl.textContent = line;

    const { p, t, a } = parseLine(line);
    console.log("parsed:", { p, t, a });

    // 数字表示
    if (typeof p === "number" && Number.isFinite(p) && pEl) pEl.textContent = String(Math.round(p));
    if (typeof t === "number" && Number.isFinite(t) && tEl) tEl.textContent = t.toFixed(1);
    if (typeof a === "number" && Number.isFinite(a) && aEl) aEl.textContent = a.toFixed(2);

    // グラフへ（Pが来たら必ず描く）
    pushPoint(p, t, a);

    if (connected) setStatus("受信中");
  });

  btnCon?.addEventListener("click", async () => {
    const path = portSel?.value;
    const baud = Number(baudInp?.value ?? "115200");
    if (!path) return;

    setStatus("接続中...");
    try {
      const res = await api.connect(path, baud);
      connected = !!res?.ok;
      setStatus(connected ? "接続中（受信待ち）" : `エラー: ${res?.message ?? "connect failed"}`);
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