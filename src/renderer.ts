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
  const rawEl = document.getElementById("raw");

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

  // 現在位置マーカー（大きくて見やすい赤丸）
  const marker = Lobj.circleMarker([35.0, 135.0], {
    radius: 12,
    color: "#ffffff",
    weight: 3,
    fillColor: "#ff0000",
    fillOpacity: 1.0,
  }).addTo(map);

  // 現在位置のまわりの薄い円
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
  // parsing
  // =============================
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

    if (s === "GPS,NOFIX") {
      if (fixEl) fixEl.textContent = "NO FIX";
      if (connected) setStatus("受信中");
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