type TelemetryData = {
  time: number;
  seq: number;
  pressures: number[];
  temperature: number;
  howtodeploy: number;
  rssi: number;
};

type ChartLike = any;

const MAX_POINTS = 1200;
const PRESSURE_COUNT = 25;

/*
  25点の圧力データの時間間隔 [ms]
  もし実際のサンプリング間隔が違うならここだけ変更してください．
  例:
  50 Hz -> 20 ms
  100 Hz -> 10 ms
*/
const PRESSURE_DT_MS = 20;

const BASELINE_PACKET_COUNT = 10;

let altitudeChart: ChartLike | null = null;

const portSelect = document.getElementById("portSelect") as HTMLSelectElement | null;
const baudInput = document.getElementById("baudRate") as HTMLInputElement | null;
const refreshBtn = document.getElementById("refreshPortsBtn") as HTMLButtonElement | null;
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement | null;

const valTime = document.getElementById("valTime") as HTMLElement | null;
const valPhase = document.getElementById("valPhase") as HTMLElement | null;
const valPressure = document.getElementById("valPressure") as HTMLElement | null;
const valTemp = document.getElementById("valTemp") as HTMLElement | null;
const valRssi = document.getElementById("valRssi") as HTMLElement | null;
const valAltitude = document.getElementById("valAltitude") as HTMLElement | null;
const valP0 = document.getElementById("valP0") as HTMLElement | null;
const valT0 = document.getElementById("valT0") as HTMLElement | null;
const valDeploy = document.getElementById("valDeploy") as HTMLElement | null;

const logEl = document.getElementById("log") as HTMLPreElement | null;
const altitudeCanvas = document.getElementById("altitudeChart") as HTMLCanvasElement | null;

let baselineStarted = false;
let baselineFixed = false;
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
  if (!logEl) return;
  logEl.textContent += text + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function calcAltitude(p: number, p0val: number, T0val: number): number {
  if (!Number.isFinite(p) || !Number.isFinite(p0val) || !Number.isFinite(T0val)) return NaN;
  if (p <= 0 || p0val <= 0) return NaN;

  return ((T0val + 273.15) / 0.0065) * (1 - Math.pow(p / p0val, 1 / 5.257));
}

function deployModeToText(mode: number): string {
  switch (mode) {
    case 0:
      return "START";
    case 1:
      return "PRES";
    case 2:
      return "TIME";
    case 3:
      return "COMMAND";
    default:
      return String(mode);
  }
}

/*
  受信文字列の例:
  "[RX] 27003,1,1003.20,1003.19,..."
  これを安全に数値列へ変換する
*/
function extractNumericCsv(line: string): number[] | null {
  const cleaned = line
    .replace(/^\s*\[RX\]\s*/i, "")
    .replace(/\r/g, "")
    .trim();

  if (!cleaned) return null;

  const parts = cleaned
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length < 30) return null;

  const nums = parts.map((s) => Number(s));
  if (nums.some((v) => Number.isNaN(v))) return null;

  return nums;
}

function parseLoRaLine(line: string): TelemetryData | null {
  const nums = extractNumericCsv(line);
  if (!nums) return null;

  /*
    想定フォーマット:
    time(1), seq(1), pressures(25), temperature(1), howtodeploy(1), rssi(1)
    合計30個
  */
  if (nums.length < 30) return null;

  const time = nums[0];
  const seq = nums[1];
  const pressures = nums.slice(2, 27);
  const temperature = nums[27];
  const howtodeploy = nums[28];
  const rssi = nums[29];

  if (pressures.length !== PRESSURE_COUNT) return null;

  return {
    time,
    seq,
    pressures,
    temperature,
    howtodeploy,
    rssi,
  };
}

function createAltitudeChart(): void {
  if (!altitudeCanvas) return;

  const ChartRef = (window as any).Chart;
  if (!ChartRef) {
    appendLog("[Error] Chart.js not found.");
    return;
  }

  altitudeChart = new ChartRef(altitudeCanvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Altitude [m]",
          data: [],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
          borderColor: "#ff0055",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      parsing: false,
      plugins: {
        legend: {
          display: false,
        },
      },
      scales: {
        x: {
          type: "linear",
          title: {
            display: true,
            text: "Time [ms]",
            color: "#888",
          },
          ticks: {
            maxTicksLimit: 10,
            color: "#888",
          },
          grid: {
            color: "rgba(255,255,255,0.10)",
          },
        },
        y: {
          title: {
            display: true,
            text: "Altitude [m]",
            color: "#888",
          },
          ticks: {
            color: "#888",
          },
          grid: {
            color: "rgba(255,255,255,0.10)",
          },
        },
      },
    },
  });
}

function resetBaseline(): void {
  baselineStarted = false;
  baselineFixed = false;
  baselinePacketCounter = 0;
  baselinePressures.length = 0;
  baselineTemps.length = 0;
  p0 = 0;
  T0 = 0;

  setText(valP0, "--");
  setText(valT0, "--");
  setText(valAltitude, "--");
}

function clearAltitudeChart(): void {
  if (!altitudeChart) return;
  altitudeChart.data.datasets[0].data = [];
  altitudeChart.update("none");
}

function updateBaseline(data: TelemetryData): void {
  /*
    seq === 2 で基準気圧取得開始としている
    必要ならこの条件は変更してください
  */
  if (!baselineStarted && data.seq === 2) {
    baselineStarted = true;
    baselineFixed = false;
    baselinePacketCounter = 0;
    baselinePressures.length = 0;
    baselineTemps.length = 0;

    appendLog("[System] Sequence 2 detected. Collecting baseline...");
  }

  if (!baselineStarted || baselineFixed) return;

  baselinePressures.push(...data.pressures);
  baselineTemps.push(data.temperature);
  baselinePacketCounter++;

  if (baselinePacketCounter >= BASELINE_PACKET_COUNT) {
    p0 = mean(baselinePressures);
    T0 = mean(baselineTemps);
    baselineFixed = true;

    setText(valP0, formatNum(p0, 2));
    setText(valT0, formatNum(T0, 2));

    appendLog(
      `[System] Baseline fixed: P0=${formatNum(p0, 2)} hPa, T0=${formatNum(T0, 2)} °C`
    );
  }
}

function appendPacketToAltitudeGraph(data: TelemetryData): void {
  if (!altitudeChart || !baselineFixed) return;

  const dataset = altitudeChart.data.datasets[0].data as { x: number; y: number }[];

  for (let i = 0; i < data.pressures.length; i++) {
    const p = data.pressures[i];
    const altitude = calcAltitude(p, p0, T0);

    if (!Number.isFinite(altitude)) continue;

    const sampleTime = data.time - (PRESSURE_COUNT - 1 - i) * PRESSURE_DT_MS;
    dataset.push({ x: sampleTime, y: altitude });
  }

  while (dataset.length > MAX_POINTS) {
    dataset.shift();
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
  setText(valDeploy, deployModeToText(data.howtodeploy));

  updateBaseline(data);

  if (!baselineFixed) {
    setText(valAltitude, "--");
    return;
  }

  appendPacketToAltitudeGraph(data);

  const latestPressure = data.pressures[data.pressures.length - 1];
  const latestAltitude = calcAltitude(latestPressure, p0, T0);
  setText(valAltitude, formatNum(latestAltitude, 2));
}

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

    appendLog("[System] Ports refreshed.");
  } catch (err) {
    appendLog(`[Error] Failed to list ports: ${String(err)}`);
  }
}

async function connectSerial(): Promise<void> {
  if (!portSelect || !baudInput) return;

  const path = portSelect.value;
  const baudRate = Number(baudInput.value);

  if (!path) {
    appendLog("[Error] Select a serial port.");
    return;
  }

  appendLog(`[System] Connecting to ${path} ...`);

  try {
    const result = await window.api.connect(path, baudRate);
    if (!result.ok) {
      appendLog(`[Error] Connection failed: ${result.message ?? "unknown error"}`);
    }
  } catch (err) {
    appendLog(`[Error] Connection failed: ${String(err)}`);
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
  setTimeout(() => {
    createAltitudeChart();
  }, 100);

  void refreshPorts();

  refreshBtn?.addEventListener("click", () => {
    void refreshPorts();
  });

  let isConnected = false;

  connectBtn?.addEventListener("click", async () => {
    if (!isConnected) {
      resetBaseline();
      clearAltitudeChart();
      await connectSerial();
    } else {
      await window.api.disconnect();
    }
  });

  window.api.onLine((line: string) => {
    appendLog(`[RX] ${line}`);

    const data = parseLoRaLine(line);
    if (!data) return;

    handleTelemetry(data);
  });

  window.api.onError((msg: string) => {
    appendLog(`[Serial Error] ${msg}`);
  });

  window.api.onStatus((status: string) => {
    appendLog(`[System] Status: ${status}`);

    if (!connectBtn) return;

    if (status === "connected") {
      isConnected = true;
      connectBtn.textContent = "DISCONNECT";
      connectBtn.style.borderColor = "#ff0055";
    } else {
      isConnected = false;
      connectBtn.textContent = "CONNECT";
      connectBtn.style.borderColor = "";
    }
  });

  document.querySelectorAll(".cmd-btn").forEach((btn) => {
    if (
      btn.id === "sendPhaseBtn" ||
      btn.id === "refreshPortsBtn" ||
      btn.id === "connectBtn" ||
      btn.id === "logBtn"
    ) {
      return;
    }

    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-cmd");
      if (cmd) void sendCmd(cmd);
    });
  });

  document.getElementById("sendPhaseBtn")?.addEventListener("click", () => {
    const phaseInput = document.getElementById("phaseInput") as HTMLInputElement | null;
    if (phaseInput) {
      void sendCmd(`PHASE${phaseInput.value}`);
    }
  });

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
        appendLog("[System] Logging stopped.");
      } else {
        appendLog("[Error] Failed to stop logging.");
      }
    }
  });
    }
  });

  setText(valTime, "--");
  setText(valPhase, "--");
  setText(valPressure, "--");
  setText(valTemp, "--");
  setText(valRssi, "--");
  setText(valAltitude, "--");
  setText(valP0, "--");
  setText(valT0, "--");
  setText(valDeploy, "--");
}

document.addEventListener("DOMContentLoaded", init);