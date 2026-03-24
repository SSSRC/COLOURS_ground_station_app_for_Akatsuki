"use strict";
//import { contextBridge, ipcRenderer } from 'electron';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('groundStation', {
    listPorts: () => ipcRenderer.invoke('serial:list'),
    connectSerial: (config) => ipcRenderer.invoke('serial:connect', config),
    sendSequence: (sequenceNo) => ipcRenderer.invoke('serial:send-sequence', sequenceNo),
    onTelemetry: (callback) => {
        // ここに型を追加
        ipcRenderer.on('telemetry:data', (_event, data) => callback(data));
    },
    onSerialError: (callback) => {
        // ここにも型を追加
        ipcRenderer.on('serial:error', (_event, message) => callback(message));
    },
});
