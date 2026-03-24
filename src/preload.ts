//import { contextBridge, ipcRenderer } from 'electron';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('groundStation', {
  listPorts: () => ipcRenderer.invoke('serial:list'),
  connectSerial: (config: { path: string; baudRate: number }) =>
    ipcRenderer.invoke('serial:connect', config),
  sendSequence: (sequenceNo: number) =>
    ipcRenderer.invoke('serial:send-sequence', sequenceNo),

  onTelemetry: (
    callback: (data: {
      timeMs: number;
      phase: number;
      pressureSamples: number[];
      temperatureC: number;
      raw: string;
    }) => void
  ) => {
    // ここに型を追加
    ipcRenderer.on('telemetry:data', (_event: any, data: any) => callback(data));
  },

  onSerialError: (callback: (message: string) => void) => {
    // ここにも型を追加
    ipcRenderer.on('serial:error', (_event: any, message: string) => callback(message));
  },
});