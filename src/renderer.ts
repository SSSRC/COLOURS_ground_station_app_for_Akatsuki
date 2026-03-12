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

  const latEl = document.getElementById("lat");
  const lonEl = document.getElementById("lon");
  const timeEl = document.getElementById("gpstime");
  const fixEl = document.getElementById("fix");

  const pEl = document.getElementById("pressure");
  const tEl = document.getElementById("temp");
  const aEl = document.getElementById("alt");

  const rawEl = document.getElementById("raw");

  const canvasAlt = document.getElementById("chartAlt") as HTMLCanvasElement | null;

  // =============================
  // state
  // =============================
  let connected = false;
  let firstFix = true;

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
  // Leaflet
  // =============================
  const Lobj = (window as any).L;
  if (!Lobj) {
    setStatus("Leaflet が読み込めていません");
    return;
  }

  const map = Lobj.map("map").setView([35.0, 135.0], 5);

  Lobj.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  // 現在位置
  const marker = Lobj.circleMarker([35.0, 135.0], {
    radius: 12,
    color: "#ffffff",
    weight: 3,
    fillColor: "#ff0000",
    fillOpacity: 1.0,
  }).addTo(map);

  // 位置周辺の薄い円
  const halo = Lobj.circle([35.0, 135.0], {
    radius: 10,
    color: "#ff0000",
    weight: 1,
    fillColor: "#ff0000",
    fillOpacity: 0.15,
  }).addTo(map);

  // 軌跡
  const track: [number, number][] = [];
  const polyline = Lobj.polyline(track, {
    color: "#ffcc00",
    weight: 4,
    opacity: 0.9,
  }).addTo(map);

  // =============================
  // Chart.js
  // =============================
  const C: any = (window as any).Chart;
  if (!C) {
    setStatus("Chart.js が読み込めていません");
    return;
  }

  if (C.defaults?.font) {
    C.defaults.font.family = "Times New Roman";
    C.defaults.font.size = 14;
  }

  if (C.defaults?.plugins?.legend) {
    C.defaults.plugins.legend.display = false;
  }

  const ensureCanvas = (c: HTMLCanvasElement | null) => {
    if (!c) {
      setStatus("canvasが見つかりません: chartAlt");
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
          label: "Altitude (m)",
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
        legend: { display: false },
        title: {
          display: true,
          text: "Altitude (m)",
          color: "#111",
          font: { family: "Times New Roman", size: 18, weight: "bold" },
          padding: { top: 8, bottom: 6 },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: true },
          ticks: {
            color: "#111",
            padding: 6,
            font: { family: "Times New Roman", size: 12 },
          },
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
  // Parsing
  // =============================
  const extractNumber = (s: string): number => {
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  };

  const parseGpsLine = (line: string): { lat: number; lon: number; time: string } | null => {
    const s = (line ?? "").trim();
    if (!s) return null;
    if (!s.startsWith("GPS,")) return null;

    const parts = s.split(",").map((x) => x.trim());

    if (parts.length >= 2 && parts[1] === "NOFIX") {
      return null;
    }

    if (parts.length < 4) {
      return null;
    }

    const lat = Number(parts[1]);
    const lon = Number(parts[2]);
    const time = parts[3];

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }

    return { lat, lon, time };
  };

  const parseBaroLine = (line: string): { p?: number; t?: number; a?: number } => {
    const s = (line ?? "").trim();
    if (!s) return {};
    if (s.startsWith("#")) return {};
    if (s.startsWith("GPS,")) return {};

    // ALT,123.45 に対応
    if (s.startsWith("ALT,")) {
      const parts = s.split(",").map((x) => x.trim());
      if (parts.length >= 2) {
        const a = Number(parts[1]);
        if (Number.isFinite(a)) return { a };
      }
      return {};
    }

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

  const updateGps = (line: string) => {
    const s = (line ?? "").trim();

    if (s === "GPS,NOFIX") {
      if (fixEl) fixEl.textContent = "NO FIX";
      return;
    }

    const gps = parseGpsLine(s);
    if (!gps) return;

    if (latEl) latEl.textContent = gps.lat.toFixed(6);
    if (lonEl) lonEl.textContent = gps.lon.toFixed(6);
    if (timeEl) timeEl.textContent = gps.time;
    if (fixEl) fixEl.textContent = "FIX";

    marker.setLatLng([gps.lat, gps.lon]);
    halo.setLatLng([gps.lat, gps.lon]);

    track.push([gps.lat, gps.lon]);
    if (track.length > 1000) {
      track.shift();
    }
    polyline.setLatLngs(track);

    if (firstFix) {
      map.setView([gps.lat, gps.lon], 17);
      firstFix = false;
    } else {
      map.panTo([gps.lat, gps.lon]);
    }
  };

  const updateBaro = (line: string) => {
    const { p, t, a } = parseBaroLine(line);

    if (typeof p === "number" && Number.isFinite(p) && pEl) {
      pEl.textContent = String(Math.round(p));
    }

    if (typeof t === "number" && Number.isFinite(t) && tEl) {
      tEl.textContent = t.toFixed(1);
    }

    if (typeof a === "number" && Number.isFinite(a)) {
      if (aEl) aEl.textContent = a.toFixed(2);
      pushAlt(a);
    }
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

      if (prev) {
        portSel.value = prev;
      }
    } catch (e: any) {
      setStatus(`ポート一覧取得失敗: ${String(e?.message ?? e)}`);
    }
  };

  await refreshPorts();

  // =============================
  // Events
  // =============================
  api.onError((msg: string) => {
    console.error("serial error:", msg);
    setStatus(`エラー: ${msg}`);
  });

  if (api.onStatus) {
    api.onStatus((st: string) => {
      if (st === "connected") {
        connected = true;
        setStatus("接続中（受信待ち）");
      } else if (st === "disconnected") {
        connected = false;
        setStatus("未接続");
      } else {
        setStatus(st);
      }
      setButtons();
    });
  }

  api.onLine((line: string) => {
    const s = (line ?? "").trim();

    if (rawEl) rawEl.textContent = s;

    updateGps(s);
    updateBaro(s);

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
      firstFix = true;
      setStatus("未接続");
      setButtons();
    }
  });

  // =============================
  // initial
  // =============================
  setStatus("未接続");
  setButtons();
});