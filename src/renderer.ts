type TelemetryData = {
  time: number;
  seq: number;
  pressures: number[];
  temperature: number;
  lat: number;
  lon: number;
  rssi: number;
};

type ChartLike = any;

const MAX_POINTS = 1200;
const PRESSURE_COUNT = 25;
const PRESSURE_DT = 0.02;
const BASELINE_PACKET_COUNT = 10;

let altitudeChart: ChartLike | null = null;

// DOM Elements
const portSelect = document.getElementById("portSelect") as HTMLSelectElement | null;
const baudInput = document.getElementById("baudRate") as HTMLInputElement | null;
const refreshBtn = document.getElementById("refreshPortsBtn") as HTMLButtonElement | null;
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement | null;

const valTime = document.getElementById("valTime");
const valPhase = document.getElementById("valPhase");
const valPressure = document.getElementById("valPressure");
const valTemp = document.getElementById("valTemp");
const valRssi = document.getElementById("valRssi");
const valLat = document.getElementById("valLat");
const valLon = document.getElementById("valLon");
const valAltitude = document.getElementById("valAltitude");
const valP0 = document.getElementById("valP0");
const valT0 = document.getElementById("valT0");

// ★ 復活させた生データ用枠
const rawLineEl = document.getElementById("rawLine");
const logEl = document.getElementById("log") as HTMLPreElement | null;
const altitudeCanvas = document.getElementById("altitudeChart") as HTMLCanvasElement | null;

// 基準値管理
let baselineStarted = false;
let baselineFixed = false;
let baselinePacketCounter = 0;

const baselinePressures: number[] = [];
const baselineTemps: number[] = [];

let p0 = 1013.25;
let T0 = 15.0;

function setText(el: HTMLElement | null, text: string): void {
  if (el) el.textContent = text;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function formatNum(x: number, digits = 2): string {
  return Number.isFinite(x) ? x.toFixed(digits) : "--";
}

function appendLog(text: string): void {
  if (logEl) {
    logEl.textContent += text + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function calcAltitude(p: number, p0val: number, T0val: number): number {
  if (!Number.isFinite(p) || !Number.isFinite(p0val) || !Number.isFinite(T0val)) return NaN;
  if (p <= 0 || p0val <= 0) return NaN;
  return ((T0val + 273.15) / 0.0065) * (1 - Math.pow(p / p0val, 1 / 5.257));
}

function parseLoRaLine(line: string): TelemetryData | null {
  const parts = line.trim().split(",");
  if (parts.length !== 31) return null;

  const time = Number(parts[0]);
  const seq = Number(parts[1]);
  const pressures = parts.slice(2, 27).map(Number);
  const temperature = Number(parts[27]);
  const lat = Number(parts[28]);
  const lon = Number(parts[29]);
  const rssi = Number(parts[30]);

  const requiredValues = [time, seq, ...pressures, temperature, rssi];
  if (requiredValues.some((v) => Number.isNaN(v))) return null;
  
  if (pressures.length !== PRESSURE_COUNT) return null;

  return { time, seq, pressures, temperature, lat, lon, rssi };
}

// ★ 元の正常な初期化ロジックに戻しました
function createAltitudeChart(): void {
  if (!altitudeCanvas) return;
  const ChartRef = (window as any).Chart;
  if (!ChartRef) return;

  altitudeChart = new ChartRef(altitudeCanvas, {
    type: "line",
    data: {
      datasets: [{
        label: "Altitude [m]",
        data: [], // 初期値は空の配列
        borderWidth: 2,
        pointRadius: 0,
        tension: 0,
        borderColor: "#ff0055",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { 
          type: "linear", // 横軸を数値スケールに設定
          title: { display: true, text: "Time [ms]", color: "#888" },
          ticks: { maxTicksLimit: 10, color: "#888" }, 
          grid: { color: "rgba(255, 255, 255, 0.1)" } 
        },
        y: { 
          title: { display: true, text: "Altitude [m]", color: "#888" },
          ticks: { color: "#888" }, 
          grid: { color: "rgba(255, 255, 255, 0.1)" } 
        },
      },
    },
  });
}

function updateBaseline(data: TelemetryData): void {
  if (!baselineStarted && data.seq === 2) {
    baselineStarted = true;
    baselineFixed = false;
    baselinePacketCounter = 0;
    baselinePressures.length = 0;
    baselineTemps.length = 0;
    appendLog("[System] Sequence 2 detected. Collecting baseline...");
  }

  if (baselineStarted && !baselineFixed) {
    baselinePressures.push(...data.pressures);
    baselineTemps.push(data.temperature);
    baselinePacketCounter++;
    
    if (baselinePacketCounter >= BASELINE_PACKET_COUNT) {
      p0 = mean(baselinePressures);
      T0 = mean(baselineTemps);
      baselineFixed = true;
      setText(valP0, formatNum(p0, 2));
      setText(valT0, formatNum(T0, 2));
      appendLog(`[System] Baseline fixed: P0=${formatNum(p0, 2)} hPa, T0=${formatNum(T0, 2)} °C`);
    }
  }
}

function appendPacketToAltitudeGraph(data: TelemetryData): void {
  if (!altitudeChart) return;

  for (let i = 0; i < data.pressures.length; i++) {
    const p = data.pressures[i];
    const altitude = calcAltitude(p, p0, T0);
    const sampleTime = data.time - (PRESSURE_COUNT - 1 - i) * PRESSURE_DT;
    
    // {x: 時間, y: 高度} の形式でデータを追加
    altitudeChart.data.datasets[0].data.push({
      x: sampleTime,
      y: altitude
    });
  }

  // 1200ポイントを超えたら古いデータを削除
  while (altitudeChart.data.datasets[0].data.length > MAX_POINTS) {
    altitudeChart.data.datasets[0].data.shift();
  }
  
  altitudeChart.update();
}

function handleTelemetry(data: TelemetryData, rawLine: string): void {
  // ★ ここが重要！生データは「追記」ではなく専用枠を「上書き」する（負荷小）
  setText(rawLineEl, rawLine);

  const pressAvg = mean(data.pressures);

  if (valTime) valTime.textContent = String(data.time);
  if (valPhase) valPhase.textContent = String(data.seq);
  if (valPressure) valPressure.textContent = formatNum(pressAvg, 2);
  if (valTemp) valTemp.textContent = formatNum(data.temperature, 2);
  if (valRssi) valRssi.textContent = String(data.rssi);
  if (valLat) valLat.textContent = Number.isNaN(data.lat) ? "N/A" : data.lat.toFixed(6);
  if (valLon) valLon.textContent = Number.isNaN(data.lon) ? "N/A" : data.lon.toFixed(6);

  updateBaseline(data);

  appendPacketToAltitudeGraph(data);
  const latestPressure = data.pressures[data.pressures.length - 1];
  const latestAltitude = calcAltitude(latestPressure, p0, T0);
  if (valAltitude) valAltitude.textContent = formatNum(latestAltitude, 2);
}

async function refreshPorts(): Promise<void> {
  if (!portSelect) return;
  try {
    const ports = await window.api.listPorts();
    portSelect.innerHTML = "";
    for (const port of ports) {
      const option = document.createElement("option");
      option.value = port.path;
      option.textContent = port.manufacturer ? `${port.path} (${port.manufacturer})` : port.path;
      portSelect.appendChild(option);
    }
    if (ports.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No ports";
      portSelect.appendChild(option);
    }
    appendLog("[System] Ports refreshed.");
  } catch (err) {
    appendLog("[Error] Failed to list ports.");
  }
}

async function connectSerial(): Promise<void> {
  if (!portSelect || !baudInput) return;
  const path = portSelect.value;
  const baudRate = Number(baudInput.value);

  if (!path) {
    appendLog("[Error] Select a serial port");
    return;
  }

  appendLog(`[System] Connecting to ${path}...`);
  try {
    const result = await window.api.connect(path, baudRate);
    if (!result.ok) {
      appendLog(`[Error] Connection failed: ${result.message}`);
    }
  } catch (err) {
    appendLog(`[Error] Connection failed: ${err}`);
  }
}

// 連打送信（バースト）
async function sendCmd(cmdStr: string): Promise<void> {
  try {
    appendLog(`[System] Burst-TX [${cmdStr}]`);
    for (let i = 0; i < 3; i++) {
      const res = await window.api.sendCommand(cmdStr);
      if (res.ok) {
        appendLog(`[TX] Sent: ${cmdStr} (${i + 1}/3)`);
      } else {
        appendLog(`[TX Error] ${res.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 160));
    }
  } catch (err) {
    appendLog(`[TX Error] ${String(err)}`);
  }
}

function init(): void {
  // ★ 初期化も元のシンプルな形に戻しました
  createAltitudeChart();
  refreshPorts();

  refreshBtn?.addEventListener("click", () => { void refreshPorts(); });
  
  let isConnected = false;
  connectBtn?.addEventListener("click", async () => {
    if (!isConnected) await connectSerial();
    else await window.api.disconnect();
  });

  window.api.onLine((line: string) => {
    appendLog(`[DEBUG RX] ${line}`);

    // ★ パース（解析）処理の前に、まずは生データ枠へ即座に表示！
    if (rawLineEl) {
      rawLineEl.textContent = line;
    }

    const data = parseLoRaLine(line);
    // 不完全なデータの場合はここで処理を止める（生データは表示済み）
    if (!data) return; 
    
    // データが完全な場合のみパラメータとグラフを更新
    handleTelemetry(data, line); 
  });

  window.api.onError((msg: string) => appendLog(`[Serial Error] ${msg}`));

  window.api.onStatus((status: string) => {
    appendLog(`[System] Status: ${status}`);
    if (connectBtn) {
      if (status === "connected") {
        isConnected = true;
        connectBtn.textContent = "DISCONNECT";
        connectBtn.style.borderColor = "#ff0055";
      } else {
        isConnected = false;
        connectBtn.textContent = "CONNECT";
        connectBtn.style.borderColor = "";
      }
    }
  });

  document.querySelectorAll(".cmd-btn").forEach((btn) => {
    if (btn.id === "sendPhaseBtn" || btn.id === "refreshPortsBtn" || btn.id === "connectBtn") return;
    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-cmd");
      if (cmd) void sendCmd(cmd);
    });
  });

  document.getElementById("sendPhaseBtn")?.addEventListener("click", () => {
    const phaseInput = document.getElementById("phaseInput") as HTMLInputElement | null;
    if (phaseInput) void sendCmd(`PHASE${phaseInput.value}`);
  });
}

document.addEventListener("DOMContentLoaded", init);