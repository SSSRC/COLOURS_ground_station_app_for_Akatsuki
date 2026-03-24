import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
let mainWindow = null;
let port = null;
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.loadFile(path.join(__dirname, "../src/index.html"));
}
function closeCurrentPort() {
    return new Promise((resolve) => {
        if (!port) {
            resolve();
            return;
        }
        if (!port.isOpen) {
            port = null;
            resolve();
            return;
        }
        port.close(() => {
            port = null;
            resolve();
        });
    });
}
function parseTelemetryLine(line) {
    const trimmed = line.trim();
    if (trimmed.length === 0)
        return null;
    const parts = trimmed.split(",").map((s) => s.trim());
    // 想定:
    // [0] timeMs
    // [1] phase
    // [2 ... n-5] pressure samples
    // [n-4] temperatureC
    // [n-3], [n-2], [n-1] は今回は無視
    if (parts.length < 7) {
        return null;
    }
    const timeMs = Number(parts[0]);
    const phase = Number(parts[1]);
    if (Number.isNaN(timeMs) || Number.isNaN(phase)) {
        return null;
    }
    const temperatureIndex = parts.length - 4;
    const temperatureC = Number(parts[temperatureIndex]);
    if (Number.isNaN(temperatureC)) {
        return null;
    }
    const pressureSamples = parts
        .slice(2, temperatureIndex)
        .map((value) => Number(value))
        .filter((value) => !Number.isNaN(value));
    if (pressureSamples.length === 0) {
        return null;
    }
    return {
        timeMs,
        phase,
        pressureSamples,
        temperatureC,
        raw: trimmed,
    };
}
function setupSerialListeners(targetPort) {
    const parser = targetPort.pipe(new ReadlineParser({ delimiter: "\n" }));
    parser.on("data", (line) => {
        const packet = parseTelemetryLine(line);
        if (!packet)
            return;
        mainWindow?.webContents.send("telemetry:data", packet);
    });
    targetPort.on("error", (err) => {
        mainWindow?.webContents.send("serial:error", err.message);
    });
    targetPort.on("close", () => {
        mainWindow?.webContents.send("serial:error", "serial port closed");
    });
}
app.whenReady().then(() => {
    createWindow();
    ipcMain.handle("serial:list", async () => {
        const ports = await SerialPort.list();
        console.log("serial ports from SerialPort.list() =", ports);
        return ports.map((p) => ({
            path: p.path,
            friendlyName: p.manufacturer ?? p.serialNumber ?? "",
        }));
    });
    ipcMain.handle("serial:connect", async (_event, config) => {
        try {
            await closeCurrentPort();
            const newPort = new SerialPort({
                path: config.path,
                baudRate: config.baudRate,
                autoOpen: false,
            });
            await new Promise((resolve, reject) => {
                newPort.open((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            port = newPort;
            setupSerialListeners(newPort);
            return {
                ok: true,
                path: config.path,
                baudRate: config.baudRate,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            mainWindow?.webContents.send("serial:error", message);
            return {
                ok: false,
                message,
            };
        }
    });
    ipcMain.handle("serial:send-sequence", async (_event, sequenceNo) => {
        try {
            if (!port || !port.isOpen) {
                return {
                    ok: false,
                    message: "serial port is not open",
                };
            }
            const command = `SEQ,${sequenceNo}\n`;
            await new Promise((resolve, reject) => {
                port.write(command, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    port.drain((drainErr) => {
                        if (drainErr)
                            reject(drainErr);
                        else
                            resolve();
                    });
                });
            });
            return {
                ok: true,
                command: command.trim(),
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            mainWindow?.webContents.send("serial:error", message);
            return {
                ok: false,
                message,
            };
        }
    });
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
app.on("window-all-closed", async () => {
    await closeCurrentPort();
    if (process.platform !== "darwin") {
        app.quit();
    }
});
app.on("before-quit", async () => {
    await closeCurrentPort();
});
