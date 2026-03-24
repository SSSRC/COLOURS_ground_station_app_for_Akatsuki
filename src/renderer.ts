// ★ ここに export {}; は絶対に書かない！
console.log("★★★ 画面のプログラムが正常に読み込まれました！ ★★★");

type TelemetryData = {
  timeMs: number;
  phase: number;
  pressureSamples: number[];
  temperatureC: number;
  raw: string;
};

// Windowオブジェクトの拡張（TypeScript用）
interface Window {
  groundStation: {
    listPorts: () => Promise<Array<{ path: string; friendlyName?: string }>>;
    connectSerial: (config: { path: string; baudRate: number }) => Promise<{ ok: boolean }>;
    sendSequence: (sequenceNo: number) => Promise<{ ok: boolean; command?: string; message?: string }>;
    onTelemetry: (callback: (data: TelemetryData) => void) => void;
    onSerialError: (callback: (message: string) => void) => void;
  };
}

type ChartPoint = { timeMs: number; altitude: number; phase: number; };
type PhaseAccumulator = { pressureSum: number; pressureCount: number; temperatureSum: number; temperatureCount: number; };

const portSelect = document.getElementById("portSelect") as HTMLSelectElement;
const baudRateInput = document.getElementById("baudRate") as HTMLInputElement;
const refreshPortsBtn = document.getElementById("refreshPortsBtn") as HTMLButtonElement;
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement;
const sequenceValue = document.getElementById("sequenceValue") as HTMLSpanElement;
const altitudeValue = document.getElementById("altitudeValue") as HTMLSpanElement;
const sequenceInput = document.getElementById("sequenceInput") as HTMLInputElement;
const sendSequenceBtn = document.getElementById("sendSequenceBtn") as HTMLButtonElement;
const log = document.getElementById("log") as HTMLPreElement;
const canvas = document.getElementById("altitudeChart") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

const points: ChartPoint[] = [];
const MAX_POINTS = 300;

const phaseStats: Record<number, PhaseAccumulator> = {
  0: { pressureSum: 0, pressureCount: 0, temperatureSum: 0, temperatureCount: 0 },
  1: { pressureSum: 0, pressureCount: 0, temperatureSum: 0, temperatureCount: 0 },
  2: { pressureSum: 0, pressureCount: 0, temperatureSum: 0, temperatureCount: 0 },
};

function appendLog(text: string): void {
  log.textContent += text + "\n";
  log.scrollTop = log.scrollHeight;
}

async function refreshPorts(): Promise<void> {
  const ports = await window.groundStation.listPorts();
  appendLog(`[System] Ports refreshed: ${ports.length} found.`);
  portSelect.innerHTML = "";
  for (const p of ports) {
    const option = document.createElement("option");
    option.value = p.path;
    option.textContent = p.friendlyName ? `${p.path} (${p.friendlyName})` : p.path;
    portSelect.appendChild(option);
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calcAltitude(p: number, p0: number, T0: number): number {
  return (T0 + 273.15) * (1 - Math.pow(p / p0, 1 / 5.257)) / 0.0065;
}

function drawChart(): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const left = 60;
  const top = 20;
  const right = 20;
  const bottom = 40;
  const chartW = w - left - right;
  const chartH = h - top - bottom;

  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, chartW, chartH);

  if (points.length < 2) {
    ctx.fillStyle = "#666";
    ctx.font = "16px sans-serif";
    ctx.fillText("Waiting for telemetry data...", left + 20, top + 30);
    return;
  }

  const minT = points[0].timeMs;
  const maxT = points[points.length - 1].timeMs;
  const minA = Math.min(...points.map((p) => p.altitude));
  const maxA = Math.max(...points.map((p) => p.altitude));

  const tSpan = Math.max(maxT - minT, 1);
  let aMin = minA;
  let aMax = maxA;
  if (Math.abs(aMax - aMin) < 1e-9) { aMin -= 1; aMax += 1; }
  const aSpan = aMax - aMin;

  ctx.fillStyle = "#000";
  ctx.font = "12px sans-serif";
  ctx.fillText(`${minT} ms`, left, h - 10);
  ctx.fillText(`${maxT} ms`, left + chartW - 40, h - 10);
  ctx.fillText(`${aMax.toFixed(1)} m`, 5, top + 10);
  ctx.fillText(`${aMin.toFixed(1)} m`, 5, top + chartH);

  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = left + ((p.timeMs - minT) / tSpan) * chartW;
    const y = top + chartH - ((p.altitude - aMin) / aSpan) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#e63946";
  ctx.lineWidth = 2;
  ctx.stroke();
}

refreshPortsBtn.addEventListener("click", async () => {
  try {
    await refreshPorts();
  } catch (error) {
    appendLog(`[Error] Refresh failed: ${String(error)}`);
  }
});

connectBtn.addEventListener("click", async () => {
  try {
    const path = portSelect.value;
    const baudRate = Number(baudRateInput.value);
    if (!path) {
      appendLog("[Error] No port selected!");
      return;
    }
    appendLog(`[System] Connecting to ${path} at ${baudRate} bps...`);
    const result = await window.groundStation.connectSerial({ path, baudRate });
    if (result.ok) {
      appendLog(`[System] Successfully connected to ${path}.`);
    } else {
      appendLog(`[Error] Connection failed.`);
    }
  } catch (error) {
    appendLog(`[Error] Connection error: ${String(error)}`);
  }
});

sendSequenceBtn.addEventListener("click", async () => {
  try {
    const seq = Number(sequenceInput.value);
    const result = await window.groundStation.sendSequence(seq);
    appendLog(`[Command] Sent Sequence ${seq}: ${JSON.stringify(result)}`);
  } catch (error) {
    appendLog(`[Error] Send command error: ${String(error)}`);
  }
});

window.groundStation.onTelemetry((data: TelemetryData) => {
  const pressureAvg = mean(data.pressureSamples);
  if (Number.isNaN(pressureAvg)) return;

  if (data.phase in phaseStats) {
    phaseStats[data.phase].pressureSum += pressureAvg;
    phaseStats[data.phase].pressureCount += 1;
    phaseStats[data.phase].temperatureSum += data.temperatureC;
    phaseStats[data.phase].temperatureCount += 1;
  }

  const refPhase = data.phase >= 3 ? 2 : data.phase;
  const stat = phaseStats[refPhase];
  
  let p0 = 1013.25; // 初期値（海面気圧）
  let T0 = 15.0;    // 初期値
  
  if (stat && stat.pressureCount > 0) {
    p0 = stat.pressureSum / stat.pressureCount;
    T0 = stat.temperatureSum / stat.temperatureCount;
  }

  const altitude = calcAltitude(pressureAvg, p0, T0);
  
  sequenceValue.textContent = String(data.phase);
  altitudeValue.textContent = altitude.toFixed(2);

  points.push({ timeMs: data.timeMs, altitude, phase: data.phase });
  if (points.length > MAX_POINTS) points.shift();

  drawChart();
});

window.groundStation.onSerialError((message: string) => {
  appendLog(`[Serial Error] ${message}`);
});

// 起動時に自動でポートを読み込む
refreshPorts().catch((error) => {
  appendLog(`[Error] Initial port refresh failed: ${String(error)}`);
});