// ★ import ではなく require を使う（エラー防止）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('groundStation', {
  listPorts: () => ipcRenderer.invoke('serial:list'),
  connectSerial: (config: { path: string; baudRate: number }) =>
    ipcRenderer.invoke('serial:connect', config),
  sendSequence: (sequenceNo: number) =>
    ipcRenderer.invoke('serial:send-sequence', sequenceNo),

  onTelemetry: (callback: (data: any) => void) => {
    // ★ TypeScriptの型エラーを防ぐために _event: any, data: any を明記
    ipcRenderer.on('telemetry:data', (_event: any, data: any) => callback(data));
  },

  onSerialError: (callback: (message: string) => void) => {
    // ★ こちらも型を明記
    ipcRenderer.on('serial:error', (_event: any, message: string) => callback(message));
  },
});