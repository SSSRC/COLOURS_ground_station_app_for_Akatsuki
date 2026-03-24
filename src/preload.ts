import { contextBridge, ipcRenderer } from "electron";

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

  onLine: (callback: (line: string) => void) => {
    ipcRenderer.on("telemetry:line", (_event, line: string) => callback(line));
  },

  onError: (callback: (msg: string) => void) => {
    ipcRenderer.on("telemetry:error", (_event, msg: string) => callback(msg));
  },

  onStatus: (callback: (status: string) => void) => {
    ipcRenderer.on("telemetry:status", (_event, status: string) => callback(status));
  },
});