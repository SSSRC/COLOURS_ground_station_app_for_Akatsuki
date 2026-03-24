const portSelect = document.getElementById("portSelect");
const baudRateInput = document.getElementById("baudRate");
const refreshPortsBtn = document.getElementById("refreshPortsBtn");
const connectBtn = document.getElementById("connectBtn");
const sequenceValue = document.getElementById("sequenceValue");
const altitudeValue = document.getElementById("altitudeValue");
const sequenceInput = document.getElementById("sequenceInput");
const sendSequenceBtn = document.getElementById("sendSequenceBtn");
const log = document.getElementById("log");
const canvas = document.getElementById("altitudeChart");
const ctx = canvas.getContext("2d");
// 追加表示用の要素が index.html にあれば表示する。なくても動作するようにしている。
const p0Value = document.getElementById("p0Value");
const t0Value = document.getElementById("t0Value");
const tempValue = document.getElementById("tempValue");
const pressureValue = document.getElementById("pressureValue");
const points = [];
const MAX_POINTS = 300;
const phaseStats = {
    0: { pressureSum: 0, pressureCount: 0, temperatureSum: 0, temperatureCount: 0 },
    1: { pressureSum: 0, pressureCount: 0, temperatureSum: 0, temperatureCount: 0 },
    2: { pressureSum: 0, pressureCount: 0, temperatureSum: 0, temperatureCount: 0 },
};
async function refreshPorts() {
    const ports = await window.groundStation.listPorts();
    appendLog(`ports: ${JSON.stringify(ports)}`);
    portSelect.innerHTML = "";
    for (const p of ports) {
        const option = document.createElement("option");
        option.value = p.path;
        option.textContent = p.friendlyName ? `${p.path} (${p.friendlyName})` : p.path;
        portSelect.appendChild(option);
    }
}
function appendLog(text) {
    log.textContent += text + "\n";
    log.scrollTop = log.scrollHeight;
}
function mean(values) {
    if (values.length === 0)
        return NaN;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function updatePhaseStats(phase, pressureAvg, temperatureC) {
    if (!(phase in phaseStats))
        return;
    phaseStats[phase].pressureSum += pressureAvg;
    phaseStats[phase].pressureCount += 1;
    phaseStats[phase].temperatureSum += temperatureC;
    phaseStats[phase].temperatureCount += 1;
}
function getPhaseMeanPressure(phase) {
    const stat = phaseStats[phase];
    if (!stat || stat.pressureCount === 0)
        return null;
    return stat.pressureSum / stat.pressureCount;
}
function getPhaseMeanTemperature(phase) {
    const stat = phaseStats[phase];
    if (!stat || stat.temperatureCount === 0)
        return null;
    return stat.temperatureSum / stat.temperatureCount;
}
function getReferenceValues(currentPhase) {
    const refPhase = currentPhase >= 3 ? 2 : currentPhase;
    const p0 = getPhaseMeanPressure(refPhase);
    const T0 = getPhaseMeanTemperature(refPhase);
    if (p0 === null || T0 === null)
        return null;
    return { p0, T0 };
}
function calcAltitude(p, p0, T0) {
    return (T0 + 273.15) * (1 - Math.pow(p / p0, 1 / 5.257)) / 0.0065;
}
function drawChart() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const left = 60;
    const top = 20;
    const right = 20;
    const bottom = 40;
    const chartW = w - left - right;
    const chartH = h - top - bottom;
    // 枠
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, chartW, chartH);
    if (points.length < 2) {
        ctx.fillStyle = "#000";
        ctx.fillText("waiting for telemetry...", left + 10, top + 20);
        return;
    }
    const minT = points[0].timeMs;
    const maxT = points[points.length - 1].timeMs;
    const minA = Math.min(...points.map((p) => p.altitude));
    const maxA = Math.max(...points.map((p) => p.altitude));
    const tSpan = Math.max(maxT - minT, 1);
    let aMin = minA;
    let aMax = maxA;
    if (Math.abs(aMax - aMin) < 1e-9) {
        aMin -= 1;
        aMax += 1;
    }
    const aSpan = aMax - aMin;
    // 軸ラベル
    ctx.fillStyle = "#000";
    ctx.font = "12px sans-serif";
    ctx.fillText(`${minT} ms`, left, h - 10);
    ctx.fillText(`${maxT} ms`, left + chartW - 60, h - 10);
    ctx.fillText(`${aMax.toFixed(2)} m`, 5, top + 10);
    ctx.fillText(`${aMin.toFixed(2)} m`, 5, top + chartH);
    // グラフ
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const x = left + ((p.timeMs - minT) / tSpan) * chartW;
        const y = top + chartH - ((p.altitude - aMin) / aSpan) * chartH;
        if (i === 0)
            ctx.moveTo(x, y);
        else
            ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#0077cc";
    ctx.lineWidth = 2;
    ctx.stroke();
}
refreshPortsBtn.addEventListener("click", async () => {
    try {
        await refreshPorts();
        appendLog("ports refreshed");
    }
    catch (error) {
        appendLog(`refresh error: ${String(error)}`);
    }
});
connectBtn.addEventListener("click", async () => {
    try {
        const path = portSelect.value;
        const baudRate = Number(baudRateInput.value);
        if (!path) {
            appendLog("connect error: no port selected");
            return;
        }
        const result = await window.groundStation.connectSerial({ path, baudRate });
        appendLog(`connect: ${JSON.stringify(result)}`);
    }
    catch (error) {
        appendLog(`connect error: ${String(error)}`);
    }
});
sendSequenceBtn.addEventListener("click", async () => {
    try {
        const seq = Number(sequenceInput.value);
        const result = await window.groundStation.sendSequence(seq);
        appendLog(`sendSequence: ${JSON.stringify(result)}`);
    }
    catch (error) {
        appendLog(`sendSequence error: ${String(error)}`);
    }
});
window.groundStation.onTelemetry((data) => {
    const pressureAvg = mean(data.pressureSamples);
    if (Number.isNaN(pressureAvg)) {
        appendLog("pressure average is NaN");
        return;
    }
    // phase 0,1,2 の統計を更新
    updatePhaseStats(data.phase, pressureAvg, data.temperatureC);
    // 現在 phase 用の基準値を取得
    const ref = getReferenceValues(data.phase);
    if (ref === null) {
        appendLog(`reference not ready for phase ${data.phase}`);
        return;
    }
    const altitude = calcAltitude(pressureAvg, ref.p0, ref.T0);
    sequenceValue.textContent = String(data.phase);
    altitudeValue.textContent = altitude.toFixed(2);
    if (p0Value)
        p0Value.textContent = ref.p0.toFixed(2);
    if (t0Value)
        t0Value.textContent = ref.T0.toFixed(2);
    if (tempValue)
        tempValue.textContent = data.temperatureC.toFixed(2);
    if (pressureValue)
        pressureValue.textContent = pressureAvg.toFixed(2);
    points.push({
        timeMs: data.timeMs,
        altitude,
        phase: data.phase,
    });
    if (points.length > MAX_POINTS) {
        points.shift();
    }
    drawChart();
    appendLog(`t=${data.timeMs} ms, phase=${data.phase}, pAvg=${pressureAvg.toFixed(2)} hPa, T=${data.temperatureC.toFixed(2)} C, p0=${ref.p0.toFixed(2)} hPa, T0=${ref.T0.toFixed(2)} C, alt=${altitude.toFixed(2)} m`);
});
window.groundStation.onSerialError((message) => {
    appendLog(`ERROR: ${message}`);
});
refreshPorts().catch((error) => {
    appendLog(`initial refresh error: ${String(error)}`);
});
export {};
