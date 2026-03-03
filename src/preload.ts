// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import { contextBridge, ipcRenderer } from "electron";

window.addEventListener("DOMContentLoaded", () => {
  const replaceText = (selector: string, text: string) => {
    const element = document.getElementById(selector);
    if (element) {
      element.innerText = text;
    }
  };

  for (const type of ["chrome", "node", "electron"]) {
    replaceText(`${type}-version`, process.versions[type as keyof NodeJS.ProcessVersions]);
  }
});

contextBridge.exposeInMainWorld("api", {
  listPorts: () => ipcRenderer.invoke("serial:list"),
  connect: (path: string, baudRate: number) => ipcRenderer.invoke("serial:connect", { path, baudRate }),
  disconnect: () => ipcRenderer.invoke("serial:disconnect"),
  onLine: (callback: (line: string) => void) => ipcRenderer.on("telemetry:line", (_e, line) => callback(line)),
  onError: (callback: (msg: string) => void) => ipcRenderer.on("telemetry:error", (_e, msg) => callback(msg)),
  onStatus: (callback: (st: string) => void) => ipcRenderer.on("telemetry:status", (_e, st) => callback(st)),
});