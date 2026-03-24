console.log("★★★ 画面のプログラムが正常に読み込まれました！ ★★★");

interface Window {
  groundStation: {
    listPorts: () => Promise<Array<{ path: string; friendlyName?: string }>>;
    connectSerial: (config: { path: string; baudRate: number }) => Promise<{ ok: boolean }>;
    sendCommand: (commandStr: string) => Promise<{ ok: boolean; command?: string; message?: string }>;
    onTelemetry: (callback: (rawData: string) => void) => void;
    onSerialError: (callback: (message: string) => void) => void;
  };
}

const portSelect = document.getElementById("portSelect") as HTMLSelectElement;
const baudRateInput = document.getElementById("baudRate") as HTMLInputElement;
const log = document.getElementById("log") as HTMLPreElement;
const canvas = document.getElementById("altitudeChart") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

// パラメータ表示用要素
const valTime = document.getElementById("valTime") as HTMLSpanElement;
const valPhase = document.getElementById("valPhase") as HTMLSpanElement;
const valPressure = document.getElementById("valPressure") as HTMLSpanElement;
const valTemp = document.getElementById("valTemp") as HTMLSpanElement;
const valAltitude = document.getElementById("valAltitude") as HTMLSpanElement;
const valP0 = document.getElementById("valP0") as HTMLSpanElement;
const valT0 = document.getElementById("valT0") as HTMLSpanElement;

const phaseInput = document.getElementById("phaseInput") as HTMLInputElement;

// グラフ描画用データ
type ChartPoint = { timeMs: number; altitude: number; phase: number; };
const points: ChartPoint[] = [];
const MAX_POINTS = 500;

// フェーズごとの平均値を記録するオブジェクト (0, 1, 2 のみ)
type PhaseAccumulator = { pressureSum: number; temperatureSum: number; count: number; };
const phaseStats: Record<number, PhaseAccumulator> = {
  0: { pressureSum: 0, temperatureSum: 0, count: 0 },
  1: { pressureSum: 0, temperatureSum: 0, count: 0 },
  2: { pressureSum: 0, temperatureSum: 0, count: 0 },
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

// 高度計算 (ポアソンの式の変形)
function calcAltitude(p: number, p0: number, T0: number): number {
  return (T0 + 273.15) * (1 - Math.pow(p / p0, 1 / 5.257)) / 0.0065;
}

function drawChart(): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const left = 60, top = 20, right = 20, bottom = 40;
  const chartW = w - left - right;
  const chartH = h - top - bottom;

  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, chartW, chartH);

  if (points.length < 2) {
    ctx.fillStyle = "#aaa";
    ctx.font = "16px sans-serif";
    ctx.fillText("Waiting for telemetry data...", left + 20, top + 30);
    return;
  }

  const minT = points[0].timeMs;
  const maxT = points[points.length - 1].timeMs;
  const minA = Math.min(...points.map((p) => p.altitude));
  const maxA = Math.max(...points.map((p) => p.altitude));

  const tSpan = Math.max(maxT - minT, 1);
  let aMin = minA - 5;
  let aMax = maxA + 10;
  if (Math.abs(aMax - aMin) < 1e-9) { aMin -= 10; aMax += 10; }
  const aSpan = aMax - aMin;

  ctx.fillStyle = "#000";
  ctx.font = "12px sans-serif";
  ctx.fillText(`${minT} ms`, left, h - 10);
  ctx.fillText(`${maxT} ms`, left + chartW - 60, h - 10);
  ctx.fillText(`${aMax.toFixed(1)} m`, 5, top + 10);
  ctx.fillText(`${aMin.toFixed(1)} m`, 5, top + chartH);

  // 0mラインの描画
  if (aMin < 0 && aMax > 0) {
    const zeroY = top + chartH - ((0 - aMin) / aSpan) * chartH;
    ctx.beginPath();
    ctx.moveTo(left, zeroY); ctx.lineTo(left + chartW, zeroY);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.1)"; ctx.stroke();
  }

  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = left + ((p.timeMs - minT) / tSpan) * chartW;
    const y = top + chartH - ((p.altitude - aMin) / aSpan) * chartH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#e63946";
  ctx.lineWidth = 2;
  ctx.stroke();
}

// コマンド送信関数
async function sendCmd(cmdStr: string) {
  try {
    const res = await window.groundStation.sendCommand(cmdStr);
    appendLog(`[TX] Sent Command: ${cmdStr} (Result: ${res.ok ? "OK" : res.message})`);
  } catch (err) {
    appendLog(`[TX Error] ${String(err)}`);
  }
}

// UIイベント設定
document.getElementById("refreshPortsBtn")!.addEventListener("click", refreshPorts);

document.getElementById("connectBtn")!.addEventListener("click", async () => {
  const path = portSelect.value;
  const baudRate = Number(baudRateInput.value);
  if (!path) return;
  appendLog(`[System] Connecting to ${path}...`);
  const result = await window.groundStation.connectSerial({ path, baudRate });
  appendLog(`[System] Connect Result: ${result.ok}`);
});

// 各コマンドボタンにイベントを割り当て
document.querySelectorAll(".cmd-btn").forEach((btn) => {
  if (btn.id === "sendPhaseBtn") return; // PHASE手動指定は別枠
  btn.addEventListener("click", () => {
    const cmd = btn.getAttribute("data-cmd");
    if (cmd) sendCmd(cmd);
  });
});

document.getElementById("sendPhaseBtn")!.addEventListener("click", () => {
  sendCmd(`PHASE${phaseInput.value}`);
});

// ===== 受信した生データを処理 =====
window.groundStation.onTelemetry((rawData: string) => {
  appendLog(`[RX] ${rawData}`);

  const parts = rawData.split(",");
  if (parts.length < 28) return; // 最低限のデータが揃っていない場合は弾く

  const timeMs = Number(parts[0]);
  const phase = Number(parts[1]);
  
  // 気圧データの平均を計算 (Index 2 ~ 26 の 25個分)
  let pressSum = 0;
  let pressCount = 0;
  for (let i = 2; i <= 26; i++) {
    const pVal = Number(parts[i]);
    if (!Number.isNaN(pVal)) {
      pressSum += pVal;
      pressCount++;
    }
  }
  if (pressCount === 0) return;
  const currentPressure = pressSum / pressCount;
  
  const currentTemp = Number(parts[27]);
  if (Number.isNaN(currentTemp)) return;

  // フェーズ 0, 1, 2 の時は、基準値の統計を取り続ける
  if (phase === 0 || phase === 1 || phase === 2) {
    phaseStats[phase].pressureSum += currentPressure;
    phaseStats[phase].temperatureSum += currentTemp;
    phaseStats[phase].count += 1;
  }

  // 基準値 (p0, T0) を決定
  const refPhase = phase >= 3 ? 2 : phase;
  const stat = phaseStats[refPhase];
  
  let p0 = 1013.25;
  let T0 = 15.0;
  
  if (stat && stat.count > 0) {
    // 蓄積されたデータがあればその平均を使う
    p0 = stat.pressureSum / stat.count;
    T0 = stat.temperatureSum / stat.count;
  } else {
    // もしそのフェーズのデータがまだ何も受信されていない場合は、現在の値を仮の基準にする
    p0 = currentPressure;
    T0 = currentTemp;
  }

  // 高度計算
  const altitude = calcAltitude(currentPressure, p0, T0);

  // 画面の数値を更新
  valTime.textContent = String(timeMs);
  valPhase.textContent = String(phase);
  valPressure.textContent = currentPressure.toFixed(2);
  valTemp.textContent = currentTemp.toFixed(2);
  valAltitude.textContent = altitude.toFixed(2);
  valP0.textContent = p0.toFixed(2);
  valT0.textContent = T0.toFixed(2);

  // グラフにプロット
  points.push({ timeMs, altitude, phase });
  if (points.length > MAX_POINTS) points.shift();
  drawChart();
});

window.groundStation.onSerialError((msg: string) => appendLog(`[Serial Error] ${msg}`));
refreshPorts();