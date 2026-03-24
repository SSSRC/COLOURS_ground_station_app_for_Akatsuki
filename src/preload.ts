const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('groundStation', {
  listPorts: () => ipcRenderer.invoke('serial:list'),
  connectSerial: (config: { path: string; baudRate: number }) =>
    ipcRenderer.invoke('serial:connect', config),
  
  // 文字列コマンドを送信する関数
  sendCommand: (commandStr: string) =>
    ipcRenderer.invoke('serial:send-command', commandStr),

  // 生の文字列データを受信する関数
  onTelemetry: (callback: (rawData: string) => void) => {
    ipcRenderer.on('telemetry:data', (_event: any, rawData: string) => callback(rawData));
  },

  onSerialError: (callback: (message: string) => void) => {
    ipcRenderer.on('serial:error', (_event: any, message: string) => callback(message));
  },
});