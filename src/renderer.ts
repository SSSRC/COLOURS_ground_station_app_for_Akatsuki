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

const logEl = document.getElementById("log") as HTMLPreElement | null;
const altitudeCanvas = document.getElementById("altitudeChart") as HTMLCanvasElement | null;

let baselineStarted = false;

// --- 変更前：既存の変数を以下の新しい変数群に置き換えます ---
let seq1BaselineStarted = false;
let seq1BaselineFixed = false;
let p0_seq1 = 0;
let T0_seq1 = 0;

let seq2BaselineStarted = false;
let seq2BaselineFixed = false;
let p0_seq2 = 0;
let T0_seq2 = 0;

let baselineFixed = false; // 現在のパケットに対して高度計算が可能かどうかのフラグ
let baselinePacketCounter = 0;
const baselinePressures: number[] = [];
const baselineTemps: number[] = [];

let p0 = 0;
let T0 = 0;

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

// ★ グラフの初期化（横軸を数値スケールに変更）
function createAltitudeChart(): void {
  if (!altitudeCanvas) return;
  const ChartRef = (window as any).Chart;
  if (!ChartRef) return;

  altitudeChart = new ChartRef(altitudeCanvas, {
    type: "line",
    data: {
      datasets: [{
        label: "Altitude [m]",
        data: [], // 空の配列として初期化
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
          type: "linear", // ★ 横軸を数値の線形スケールに
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

// --- 変更前：既存の updateBaseline 関数を以下に置き換えます ---
function updateBaseline(data: TelemetryData): void {
  // --- シーケンス1のサンプリング開始 ---
  if (data.seq === 1 && !seq1BaselineStarted) {
    seq1BaselineStarted = true;
    baselinePacketCounter = 0;
    baselinePressures.length = 0;
    baselineTemps.length = 0;
    appendLog("[System] Sequence 1 detected. Collecting baseline 1...");
  }

  // --- シーケンス2のサンプリング開始 ---
  if (data.seq === 2 && !seq2BaselineStarted) {
    seq2BaselineStarted = true;
    baselinePacketCounter = 0;
    baselinePressures.length = 0;
    baselineTemps.length = 0;
    appendLog("[System] Sequence 2 detected. Collecting baseline 2...");
  }

  // --- シーケンス1のデータ収集 ---
  if (seq1BaselineStarted && !seq1BaselineFixed && data.seq === 1) {
    baselinePressures.push(...data.pressures);
    baselineTemps.push(data.temperature);
    baselinePacketCounter++;
    
    if (baselinePacketCounter >= BASELINE_PACKET_COUNT) {
      p0_seq1 = mean(baselinePressures);
      T0_seq1 = mean(baselineTemps);
      seq1BaselineFixed = true;
      appendLog(`[System] Seq 1 Baseline fixed: P0=${formatNum(p0_seq1, 2)} hPa, T0=${formatNum(T0_seq1, 2)} °C`);
    }
  }

  // --- シーケンス2のデータ収集 ---
  if (seq2BaselineStarted && !seq2BaselineFixed && data.seq === 2) {
    baselinePressures.push(...data.pressures);
    baselineTemps.push(data.temperature);
    baselinePacketCounter++;
    
    if (baselinePacketCounter >= BASELINE_PACKET_COUNT) {
      p0_seq2 = mean(baselinePressures);
      T0_seq2 = mean(baselineTemps);
      seq2BaselineFixed = true;
      appendLog(`[System] Seq 2 Baseline fixed: P0=${formatNum(p0_seq2, 2)} hPa, T0=${formatNum(T0_seq2, 2)} °C`);
    }
  }

  // --- 現在のシーケンスに応じて、使用する基準値を切り替える ---
  if (data.seq === 1 && seq1BaselineFixed) {
    p0 = p0_seq1;
    T0 = T0_seq1;
    baselineFixed = true;
  } else if (data.seq >= 2 && seq2BaselineFixed) {
    p0 = p0_seq2;
    T0 = T0_seq2;
    baselineFixed = true;
  } else {
    // 基準値のサンプリング中、または未確定のシーケンスの場合は計算を保留
    baselineFixed = false;
  }

  // --- 画面への反映 ---
  if (baselineFixed) {
    setText(valP0, formatNum(p0, 2));
    setText(valT0, formatNum(T0, 2));
  } else {
    setText(valP0, "--");
    setText(valT0, "--");
  }
}

// ★ グラフへのデータ追加（x, yの座標でプロット）
function appendPacketToAltitudeGraph(data: TelemetryData): void {
  if (!altitudeChart || !baselineFixed) return;

  for (let i = 0; i < data.pressures.length; i++) {
    const p = data.pressures[i];
    const altitude = calcAltitude(p, p0, T0);
    const sampleTime = data.time - (PRESSURE_COUNT - 1 - i) * PRESSURE_DT;
    
    // x(時間), y(高度)の形式でデータをプッシュ
    altitudeChart.data.datasets[0].data.push({ x: sampleTime, y: altitude });
  }

  while (altitudeChart.data.datasets[0].data.length > MAX_POINTS) {
    altitudeChart.data.datasets[0].data.shift();
  }
  altitudeChart.update("none");
}

function handleTelemetry(data: TelemetryData): void {
  const pressAvg = mean(data.pressures);

  setText(valTime, String(data.time));
  setText(valPhase, String(data.seq));
  setText(valPressure, formatNum(pressAvg, 2));
  setText(valTemp, formatNum(data.temperature, 2));
  setText(valRssi, String(data.rssi));
  setText(valLat, Number.isNaN(data.lat) ? "N/A" : data.lat.toFixed(6));
  setText(valLon, Number.isNaN(data.lon) ? "N/A" : data.lon.toFixed(6));

  updateBaseline(data);

  if (!baselineFixed) {
    setText(valAltitude, "--");
  } else {
    appendPacketToAltitudeGraph(data);
    const latestPressure = data.pressures[data.pressures.length - 1];
    const latestAltitude = calcAltitude(latestPressure, p0, T0);
    setText(valAltitude, formatNum(latestAltitude, 2));
  }
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

async function sendCmd(cmdStr: string): Promise<void> {
  try {
    const res = await window.api.sendCommand(cmdStr);
    if (res.ok) {
      appendLog(`[TX] Sent Command: ${cmdStr}`);
    } else {
      appendLog(`[TX Error] ${res.message}`);
    }
  } catch (err) {
    appendLog(`[TX Error] ${String(err)}`);
  }
}

function init(): void {
  setTimeout(() => { createAltitudeChart(); }, 100);
  refreshPorts();

  refreshBtn?.addEventListener("click", () => { void refreshPorts(); });
  
  let isConnected = false;
  connectBtn?.addEventListener("click", async () => {
    if (!isConnected) await connectSerial();
    else await window.api.disconnect();
  });

  window.api.onLine((line: string) => {
    // データ解析前に必ず生データログへ出力する
    appendLog(`[RX] ${line}`);
    const data = parseLoRaLine(line);
    if (!data) return;
    handleTelemetry(data);
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
    if (btn.id === "sendPhaseBtn" || btn.id === "refreshPortsBtn" || btn.id === "connectBtn" || btn.id === "logBtn") return;
    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-cmd");
      if (cmd) void sendCmd(cmd);
    });
  });

  document.getElementById("sendPhaseBtn")?.addEventListener("click", () => {
    const phaseInput = document.getElementById("phaseInput") as HTMLInputElement | null;
    if (phaseInput) void sendCmd(`PHASE${phaseInput.value}`);
  });

  // ★ ログ記録ボタンの制御イベント
  const logBtn = document.getElementById("logBtn") as HTMLButtonElement | null;
  const logFileNameInput = document.getElementById("logFileName") as HTMLInputElement | null;
  let isLogging = false;

  logBtn?.addEventListener("click", async () => {
    if (!isLogging) {
      const customName = logFileNameInput?.value || "";
      const res = await window.api.startLog(customName);
      if (res.ok) {
        isLogging = true;
        logBtn.textContent = "STOP LOG";
        logBtn.classList.add("btn-danger");
        appendLog(`[System] Logging started: ${res.path}`);
      } else {
        appendLog(`[Error] Failed to start logging: ${res.message}`);
      }
    } else {
      const res = await window.api.stopLog();
      if (res.ok) {
        isLogging = false;
        logBtn.textContent = "START LOG";
        logBtn.classList.remove("btn-danger");
        appendLog(`[System] Logging stopped.`);
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", init);