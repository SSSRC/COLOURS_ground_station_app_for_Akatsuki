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

// --------------------
// DOM
// --------------------
const portSelect = document.getElementById("portSelect") as HTMLSelectElement | null;
const refreshBtn = document.getElementById("refreshPortsBtn") as HTMLButtonElement | null;
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement | null;
const disconnectBtn = document.getElementById("disconnectBtn") as HTMLButtonElement | null;
const baudInput = document.getElementById("baudRate") as HTMLInputElement | null;

const statusEl = document.getElementById("status");
const seqEl = document.getElementById("seq");
const altitudeEl = document.getElementById("altitude");
const tempEl = document.getElementById("temperature");
const latEl = document.getElementById("latitude");
const lonEl = document.getElementById("longitude");
const rssiEl = document.getElementById("rssi");
const p0El = document.getElementById("p0");
const T0El = document.getElementById("T0");
const rawLineEl = document.getElementById("rawLine");

const altitudeCanvas = document.getElementById("altitudeChart") as HTMLCanvasElement | null;

// --------------------
// 基準値管理
// --------------------
let baselineStarted = false;
let baselineFixed = false;
let baselinePacketCounter = 0;

const baselinePressures: number[] = [];
const baselineTemps: number[] = [];

let p0 = 0;
let T0 = 0;

// --------------------
// 共通関数
// --------------------
function setText(el: HTMLElement | null, text: string): void {
  if (el) {
    el.textContent = text;
  }
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function formatNum(x: number, digits = 2): string {
  return Number.isFinite(x) ? x.toFixed(digits) : "--";
}

// --------------------
// 高度計算
// h = ((T0 + 273.15) / 0.0065) * [1 - (p/p0)^(1/5.257)]
// p, p0 は同じ単位であればよい
// --------------------
function calcAltitude(p: number, p0val: number, T0val: number): number {
  if (!Number.isFinite(p) || !Number.isFinite(p0val) || !Number.isFinite(T0val)) {
    return NaN;
  }

  if (p <= 0 || p0val <= 0) {
    return NaN;
  }

  return ((T0val + 273.15) / 0.0065) * (1 - Math.pow(p / p0val, 1 / 5.257));
}

// --------------------
// LoRa受信文字列パース
// 形式:
// time, seq, p1..p25, temp, lat, lon, rssi
// 合計31項目
// --------------------
function parseLoRaLine(line: string): TelemetryData | null {
  const parts = line.trim().split(",");

  if (parts.length !== 31) {
    console.warn("Invalid field count:", parts.length, line);
    return null;
  }

  const time = Number(parts[0]);
  const seq = Number(parts[1]);
  const pressures = parts.slice(2, 27).map(Number);
  const temperature = Number(parts[27]);
  const lat = Number(parts[28]);
  const lon = Number(parts[29]);
  const rssi = Number(parts[30]);

  const values = [time, seq, ...pressures, temperature, lat, lon, rssi];
  if (values.some((v) => Number.isNaN(v))) {
    console.warn("NaN found in line:", line);
    return null;
  }

  if (pressures.length !== PRESSURE_COUNT) {
    console.warn("Pressure count mismatch:", pressures.length);
    return null;
  }

  return {
    time,
    seq,
    pressures,
    temperature,
    lat,
    lon,
    rssi,
  };
}

// --------------------
// Chart.js 初期化
// --------------------
function createAltitudeChart(): void {
  if (!altitudeCanvas) {
    console.error("altitudeChart canvas not found");
    return;
  }

  const ChartRef = (window as any).Chart;
  if (!ChartRef) {
    console.error("Chart.js is not loaded");
    return;
  }

  altitudeChart = new ChartRef(altitudeCanvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Altitude [m]",
          data: [],
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#000",
            font: {
              family: "Times New Roman",
              size: 14,
            },
          },
        },
        title: {
          display: true,
          text: "Altitude",
          color: "#000",
          font: {
            family: "Times New Roman",
            size: 18,
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Time [s]",
            color: "#000",
            font: {
              family: "Times New Roman",
              size: 14,
            },
          },
          ticks: {
            color: "#000",
            maxTicksLimit: 10,
            font: {
              family: "Times New Roman",
              size: 12,
            },
          },
          grid: {
            color: "#cccccc",
          },
          border: {
            color: "#000",
          },
        },
        y: {
          title: {
            display: true,
            text: "Altitude [m]",
            color: "#000",
            font: {
              family: "Times New Roman",
              size: 14,
            },
          },
          ticks: {
            color: "#000",
            font: {
              family: "Times New Roman",
              size: 12,
            },
          },
          grid: {
            color: "#cccccc",
          },
          border: {
            color: "#000",
          },
        },
      },
    },
  });
}

// --------------------
// 基準値更新
// seq=2 に初めて入った瞬間から10パケット収集
// p0: 10パケット×25点の平均
// T0: 10パケット分のtemp平均
// --------------------
function updateBaseline(data: TelemetryData): void {
  if (!baselineStarted && data.seq === 2) {
    baselineStarted = true;
    baselineFixed = false;
    baselinePacketCounter = 0;
    baselinePressures.length = 0;
    baselineTemps.length = 0;

    setText(statusEl, "Status: Collecting baseline...");
    console.log("Baseline collection started");
  }

  if (baselineStarted && !baselineFixed) {
    baselinePressures.push(...data.pressures);
    baselineTemps.push(data.temperature);
    baselinePacketCounter++;

    setText(
      statusEl,
      `Status: Collecting baseline... ${baselinePacketCounter}/${BASELINE_PACKET_COUNT}`
    );

    if (baselinePacketCounter >= BASELINE_PACKET_COUNT) {
      p0 = mean(baselinePressures);
      T0 = mean(baselineTemps);
      baselineFixed = true;

      setText(p0El, `${formatNum(p0, 2)} hPa`);
      setText(T0El, `${formatNum(T0, 2)} °C`);
      setText(statusEl, "Status: Baseline fixed");

      console.log(`Baseline fixed: p0=${p0}, T0=${T0}`);
    }
  }
}

// --------------------
// グラフ更新
// time はその行の最後のサンプル時刻
// pressures[0]  -> time - 0.48
// pressures[24] -> time
// --------------------
function appendPacketToAltitudeGraph(data: TelemetryData): void {
  if (!altitudeChart || !baselineFixed) return;

  for (let i = 0; i < data.pressures.length; i++) {
    const p = data.pressures[i];
    const altitude = calcAltitude(p, p0, T0);
    const sampleTime = data.time - (PRESSURE_COUNT - 1 - i) * PRESSURE_DT;

    altitudeChart.data.labels.push(sampleTime.toFixed(2));
    altitudeChart.data.datasets[0].data.push(altitude);
  }

  while (altitudeChart.data.labels.length > MAX_POINTS) {
    altitudeChart.data.labels.shift();
    altitudeChart.data.datasets[0].data.shift();
  }

  altitudeChart.update("none");
}

// --------------------
// テレメトリ処理
// --------------------
function handleTelemetry(data: TelemetryData, rawLine: string): void {
  setText(rawLineEl, rawLine);
  setText(seqEl, String(data.seq));
  setText(tempEl, `${formatNum(data.temperature, 2)} °C`);
  setText(latEl, formatNum(data.lat, 6));
  setText(lonEl, formatNum(data.lon, 6));
  setText(rssiEl, `${formatNum(data.rssi, 0)} dBm`);

  updateBaseline(data);

  if (!baselineStarted) {
    setText(statusEl, "Status: Waiting for sequence 2");
    setText(altitudeEl, "--");
    return;
  }

  if (!baselineFixed) {
    setText(altitudeEl, "--");
    return;
  }

  appendPacketToAltitudeGraph(data);

  const latestPressure = data.pressures[data.pressures.length - 1];
  const latestAltitude = calcAltitude(latestPressure, p0, T0);
  setText(altitudeEl, `${formatNum(latestAltitude, 2)} m`);
}

// --------------------
// ポート一覧更新
// listPorts() は
// [{ path: string, manufacturer: string }, ...]
// を返す
// --------------------
async function refreshPorts(): Promise<void> {
  if (!portSelect) return;

  try {
    const ports = await window.api.listPorts();
    portSelect.innerHTML = "";

    for (const port of ports) {
      const option = document.createElement("option");
      option.value = port.path;
      option.textContent = port.manufacturer
        ? `${port.path} (${port.manufacturer})`
        : port.path;
      portSelect.appendChild(option);
    }

    if (ports.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No ports";
      portSelect.appendChild(option);
    }
  } catch (err) {
    console.error(err);
    setText(statusEl, "Status: Failed to list ports");
  }
}

// --------------------
// 接続
// --------------------
async function connectSerial(): Promise<void> {
  if (!portSelect || !baudInput) return;

  const path = portSelect.value;
  const baudRate = Number(baudInput.value);

  if (!path) {
    setText(statusEl, "Status: Select a serial port");
    return;
  }

  if (!Number.isFinite(baudRate) || baudRate <= 0) {
    setText(statusEl, "Status: Invalid baud rate");
    return;
  }

  try {
    const result = await window.api.connect(path, baudRate);

    if (result.ok) {
      setText(statusEl, "Status: Connected");
    } else {
      setText(statusEl, `Status: Connection failed - ${result.message ?? ""}`);
    }
  } catch (err) {
    console.error(err);
    setText(statusEl, "Status: Connection failed");
  }
}

// --------------------
// 切断
// --------------------
async function disconnectSerial(): Promise<void> {
  try {
    const result = await window.api.disconnect();

    if (result.ok) {
      setText(statusEl, "Status: Disconnected");
    } else {
      setText(statusEl, "Status: Disconnect failed");
    }
  } catch (err) {
    console.error(err);
    setText(statusEl, "Status: Disconnect failed");
  }
}

// --------------------
// 初期化
// --------------------
function init(): void {
  createAltitudeChart();
  refreshPorts();

  refreshBtn?.addEventListener("click", () => {
    void refreshPorts();
  });

  connectBtn?.addEventListener("click", () => {
    void connectSerial();
  });

  disconnectBtn?.addEventListener("click", () => {
    void disconnectSerial();
  });

  window.api.onLine((line: string) => {
    const data = parseLoRaLine(line);
    if (!data) return;
    handleTelemetry(data, line);
  });

  window.api.onError((msg: string) => {
    console.error("Serial error:", msg);
    setText(statusEl, `Status: Error - ${msg}`);
  });

  window.api.onStatus((status: string) => {
    if (status === "connected") {
      setText(statusEl, "Status: Connected");
    } else if (status === "disconnected") {
      setText(statusEl, "Status: Disconnected");
    }
  });

  setText(statusEl, "Status: Waiting for sequence 2");
  setText(seqEl, "--");
  setText(altitudeEl, "--");
  setText(tempEl, "--");
  setText(latEl, "--");
  setText(lonEl, "--");
  setText(rssiEl, "--");
  setText(p0El, "--");
  setText(T0El, "--");
  setText(rawLineEl, "--");
}

document.addEventListener("DOMContentLoaded", init);

