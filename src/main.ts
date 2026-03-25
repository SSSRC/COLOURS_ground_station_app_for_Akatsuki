import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

let mainWindow: BrowserWindow | null = null;

let port: SerialPort | null = null;
let parser: ReadlineParser | null = null;

let connecting = false;
let logStream: fs.WriteStream | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../index.html"));
}

function sendToRenderer(channel: string, payload: unknown) {
  if (!mainWindow) return;
  mainWindow.webContents.send(channel, payload);
}

async function closePortIfOpen() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }

  if (parser) {
    parser.removeAllListeners();
    parser = null;
  }

  if (port && port.isOpen) {
    await new Promise<void>((resolve) => {
      port!.close(() => resolve());
    });
  }

  if (port) {
    port.removeAllListeners();
    port = null;
  }
}

ipcMain.handle("serial:list", async () => {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer ?? "",
  }));
});

ipcMain.handle(
  "serial:connect",
  async (_e, args: { path: string; baudRate: number }) => {
    if (connecting) {
      return { ok: false, message: "Already connecting" };
    }
    connecting = true;

    try {
      if (!args?.path) {
        throw new Error("Port path is empty");
      }

      if (!Number.isFinite(args.baudRate) || args.baudRate <= 0) {
        throw new Error("Invalid baudRate");
      }

      if (port && port.isOpen && (port as any).path === args.path) {
        return { ok: true, already: true };
      }

      await closePortIfOpen();

      // ログファイルの準備
      const logsDir = path.join(process.cwd(), "logs");
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
      }
      const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
      const logPath = path.join(logsDir, `telemetry_${dateStr}.csv`);
      logStream = fs.createWriteStream(logPath, { flags: "a" });

      port = new SerialPort({
        path: args.path,
        baudRate: args.baudRate,
        autoOpen: false,
      });

      await new Promise<void>((resolve, reject) => {
        port!.open((err) => (err ? reject(err) : resolve()));
      });

      parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

      parser.on("data", (line: string) => {
        const s = (line ?? "").trim();
        if (s) {
          // ディスクへ直接1行書き込む（末尾に改行を足す）
          if (logStream) logStream.write(s + "\n");
          
          sendToRenderer("telemetry:line", s);
        }
      });

      port.on("error", (err) => {
        sendToRenderer("telemetry:error", String(err?.message ?? err));
      });

      port.on("close", () => {
        sendToRenderer("telemetry:status", "disconnected");
      });

      sendToRenderer("telemetry:status", "connected");
      return { ok: true };
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      sendToRenderer("telemetry:error", msg);
      return { ok: false, message: msg };
    } finally {
      connecting = false;
    }
  }
);

ipcMain.handle("serial:disconnect", async () => {
  await closePortIfOpen();
  sendToRenderer("telemetry:status", "disconnected");
  return { ok: true };
});

ipcMain.handle("serial:send-command", async (_event, commandStr: string) => {
  if (!port || !port.isOpen) {
    return { ok: false, message: "Port is not open" };
  }
  const command = `${commandStr}\n`;
  try {
    await new Promise<void>((resolve, reject) => {
      port!.write(command, (err) => {
        if (err) return reject(err);
        port!.drain((drainErr) => (drainErr ? reject(drainErr) : resolve()));
      });
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  await closePortIfOpen();
  if (process.platform !== "darwin") {
    app.quit();
  }
});