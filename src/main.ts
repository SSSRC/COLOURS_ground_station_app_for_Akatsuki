import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from "electron";
import * as path from "node:path";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

let mainWindow: BrowserWindow | null = null;
let port: SerialPort | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 950,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "../index.html"));
}

function closeCurrentPort(): Promise<void> {
  return new Promise((resolve) => {
    if (!port || !port.isOpen) { port = null; resolve(); return; }
    port.close(() => { port = null; resolve(); });
  });
}

function setupSerialListeners(targetPort: SerialPort): void {
  const parser = targetPort.pipe(new ReadlineParser({ delimiter: "\n" }));

  parser.on("data", (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      // 受信したカンマ区切りの文字列をそのまま画面に送る
      mainWindow?.webContents.send("telemetry:data", trimmed);
    }
  });

  targetPort.on("error", (err: Error) => mainWindow?.webContents.send("serial:error", err.message));
  targetPort.on("close", () => mainWindow?.webContents.send("serial:error", "serial port closed"));
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("serial:list", async () => {
    const ports = await SerialPort.list();
    return ports.map((p) => ({ path: p.path, friendlyName: p.manufacturer ?? p.serialNumber ?? "" }));
  });

  ipcMain.handle("serial:connect", async (_event: IpcMainInvokeEvent, config: { path: string; baudRate: number }) => {
    try {
      await closeCurrentPort();
      const newPort = new SerialPort({ path: config.path, baudRate: config.baudRate, autoOpen: false });
      await new Promise<void>((resolve, reject) => {
        newPort.open((err?: Error | null) => (err ? reject(err) : resolve()));
      });
      port = newPort;
      setupSerialListeners(newPort);
      return { ok: true, path: config.path, baudRate: config.baudRate };
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  });

  // ロケットへのコマンド送信処理
  ipcMain.handle("serial:send-command", async (_event: IpcMainInvokeEvent, commandStr: string) => {
    try {
      if (!port || !port.isOpen) return { ok: false, message: "Port not open" };
      const command = `${commandStr}\n`;
      await new Promise<void>((resolve, reject) => {
        port!.write(command, (err?: Error | null) => {
          if (err) reject(err);
          else port!.drain((drainErr?: Error | null) => (drainErr ? reject(drainErr) : resolve()));
        });
      });
      return { ok: true, command: commandStr };
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  });

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", async () => {
  await closeCurrentPort();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", async () => { await closeCurrentPort(); });