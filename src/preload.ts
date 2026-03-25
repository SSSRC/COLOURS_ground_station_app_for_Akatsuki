const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listPorts: async () => {
    return await ipcRenderer.invoke("serial:list");
  },

  connect: async (path: string, baudRate: number) => {
    return await ipcRenderer.invoke("serial:connect", { path, baudRate });
  },

  disconnect: async () => {
    return await ipcRenderer.invoke("serial:disconnect");
  },

  sendCommand: async (commandStr: string) => {
    return await ipcRenderer.invoke("serial:send-command", commandStr);
  },

  // ログ操作用の通信を追加
  startLog: async (customName: string) => {
    return await ipcRenderer.invoke("serial:start-log", customName);
  },
  
  stopLog: async () => {
    return await ipcRenderer.invoke("serial:stop-log");
  },

  onLine: (callback: (line: string) => void) => {
    ipcRenderer.on("telemetry:line", (_event: any, line: string) => callback(line));
  },

  onError: (callback: (msg: string) => void) => {
    ipcRenderer.on("telemetry:error", (_event: any, msg: string) => callback(msg));
  },

  onStatus: (callback: (status: string) => void) => {
    ipcRenderer.on("telemetry:status", (_event: any, status: string) => callback(status));
  },
});