import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

let mainWindow: BrowserWindow | null = null;

let port: SerialPort | null = null;
let parser: ReadlineParser | null = null;

let connecting = false; // 二重connect防止

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // nodeIntegration は OFF のまま（安全）
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../index.html"));
  mainWindow.webContents.openDevTools();
}

function sendToRenderer(channel: string, payload: unknown) {
  if (!mainWindow) return;
  mainWindow.webContents.send(channel, payload);
}

async function closePortIfOpen() {
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

// COM一覧
ipcMain.handle("serial:list", async () => {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer ?? "",
  }));
});

// 接続
ipcMain.handle("serial:connect", async (_e, args: { path: string; baudRate: number }) => {
  if (connecting) return { ok: false, message: "Already connecting" };
  connecting = true;

  try {
    if (!args?.path) throw new Error("Port path is empty");
    if (!Number.isFinite(args.baudRate) || args.baudRate <= 0) {
      throw new Error("Invalid baudRate");
    }

    // すでに同じポートが開いてるなら何もしない（連打対策）
    if (port && port.isOpen && (port as any).path === args.path) {
      return { ok: true, already: true };
    }

    // 既存ポートは閉じる
    await closePortIfOpen();

    // 新規オープン
    port = new SerialPort({
      path: args.path,
      baudRate: args.baudRate,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      port!.open((err) => (err ? reject(err) : resolve()));
    });

    // 1行ずつ読む
    parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    parser.on("data", (line: string) => {
      const s = (line ?? "").trim();
      // rendererへ「生の1行」を送る
      sendToRenderer("telemetry:line", s);
    });

    port.on("error", (err) => {
      sendToRenderer("telemetry:error", String(err));
    });

    port.on("close", () => {
      sendToRenderer("telemetry:status", "disconnected");
    });

    sendToRenderer("telemetry:status", "connected");
    return { ok: true };
  } catch (err: any) {
    // rendererへも送る（UIに出る）
    sendToRenderer("telemetry:error", String(err?.message ?? err));
    // invoke側にも失敗を返す
    return { ok: false, message: String(err?.message ?? err) };
  } finally {
    connecting = false;
  }
});

// 切断
ipcMain.handle("serial:disconnect", async () => {
  await closePortIfOpen();
  sendToRenderer("telemetry:status", "disconnected");
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await closePortIfOpen();
  if (process.platform !== "darwin") app.quit();
});