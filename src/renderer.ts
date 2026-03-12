window.addEventListener("DOMContentLoaded", async () => {
  const api = (window as any).api;

  // =============================
  // DOM
  // =============================
  const portSel = document.getElementById("port") as HTMLSelectElement | null;
  const baudInp = document.getElementById("baud") as HTMLInputElement | null;

  const btnCon = document.getElementById("connect") as HTMLButtonElement | null;
  const btnDis = document.getElementById("disconnect") as HTMLButtonElement | null;

  const statusEl = document.getElementById("status");
  const pEl = document.getElementById("pressure");
  const tEl = document.getElementById("temp");
  const aEl = document.getElementById("alt");
  const rawEl = document.getElementById("raw");

  const canvasAlt = document.getElementById("chartAlt") as HTMLCanvasElement | null;

  // =============================
  // state
  // =============================
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

  // =============================
  // parsing
  // =============================
  const extractNumber = (s: string): number => {
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  };

  // 対応:
  //  - "101114,20.7,1.98"
  //  - "101114,20.7"
  //  - "P=101114,T=20.7,ALT=1.98"
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

  // =============================
  // Chart.js (Altitude only)
  // =============================
  const C: any = (window as any).Chart;
  if (!C) {
    setStatus("Chart.js が読み込めていません（index.htmlの読み込み順/CSPを確認）");
    return;
  }

  console.log("=== renderer.ts LOADED ===", new Date().toISOString());
  console.log("Chart.version =", C.version);

  // global font
  if (C.defaults?.font) {
    C.defaults.font.family = "Times New Roman";
    C.defaults.font.size = 14;
  }

  // legend off (保険)
  if (C.defaults?.plugins?.legend) {
    C.defaults.plugins.legend.display = false;
  }

  const ensureCanvas = (c: HTMLCanvasElement | null) => {
    if (!c) {
      setStatus("canvasが見つかりません: chartAlt（index.htmlのid確認）");
      return false;
    }

    const w = Math.max(700, c.parentElement?.clientWidth ?? 700);
    c.width = w;
    c.height = 260;

    c.style.display = "block";
    c.style.width = "100%";
    c.style.height = "260px";
    c.style.background = "#fff";
    c.style.borderRadius = "6px";
    c.style.margin = "10px 0 30px";
    return true;
  };

  if (!ensureCanvas(canvasAlt)) return;

  const MAX_POINTS = 600;
  const labels: string[] = [];
  const dataAlt: number[] = [];

  const nowLabel = () => new Date().toLocaleTimeString();

  const trimToMax = () => {
    while (labels.length > MAX_POINTS) {
      labels.shift();
      dataAlt.shift();
    }
  };

  // 既存チャートがあれば破棄
  try {
    const existing = C.getChart?.(canvasAlt);
    if (existing) existing.destroy();
  } catch {}

  const ctx = canvasAlt!.getContext("2d");
  if (!ctx) {
    setStatus("canvasのcontextが取得できません");
    return;
  }

  const chartAlt = new C(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Altitude (m)", // 凡例用（非表示）
          data: dataAlt,
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      animation: false,
      responsive: false,
      maintainAspectRatio: false,

      plugins: {
        legend: { display: false }, // 青い箱を消す
        title: {
          display: true,
          text: "Altitude (m)",
          color: "#111",
          font: { family: "Times New Roman", size: 18, weight: "bold" },
          padding: { top: 8, bottom: 6 },
        },
      },

      // 体裁（論文っぽく：grid無し、枠あり）
      scales: {
        x: {
          grid: { display: false },
          border: { display: true },
          ticks: {
            color: "#111",
            padding: 6,
            font: { family: "Times New Roman", size: 12 },
          },
          // 内向きtick風（効く環境では効く）
          tickLength: -6,
        },
        y: {
          grid: { display: false },
          border: { display: true },
          ticks: {
            color: "#111",
            padding: 6,
            font: { family: "Times New Roman", size: 12 },
          },
          tickLength: -6,
        },
      },
    },
  });

  const pushAlt = (a: number) => {
    labels.push(nowLabel());
    dataAlt.push(a);
    trimToMax();
    chartAlt.update();
  };

  // =============================
  // Ports
  // =============================
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

  // =============================
  // Events (main -> renderer)
  // =============================
  api.onError((msg: string) => {
    console.error("serial error:", msg);
    if (!connected) setStatus(`エラー: ${msg}`);
  });

  api.onLine((line: string) => {
    if (rawEl) rawEl.textContent = line;

    const { p, t, a } = parseLine(line);

    // 数値表示
    if (typeof p === "number" && Number.isFinite(p) && pEl) pEl.textContent = String(Math.round(p));
    if (typeof t === "number" && Number.isFinite(t) && tEl) tEl.textContent = t.toFixed(1);
    if (typeof a === "number" && Number.isFinite(a)) {
      if (aEl) aEl.textContent = a.toFixed(2);
      pushAlt(a);
    }

    if (connected) setStatus("受信中");
  });

  // =============================
  // Connect / Disconnect
  // =============================
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

  // 初期
  setStatus("未接続");
  setButtons();
});