// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
/*window.addEventListener("DOMContentLoaded", () => {
  const replaceText = (selector: string, text: string) => {
    const element = document.getElementById(selector);
    if (element) {
      element.innerText = text;
    }
  };

  for (const type of ["chrome", "node", "electron"]) {
    replaceText(`${type}-version`, process.versions[type as keyof NodeJS.ProcessVersions]);
  }
});*/
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // メインプロセスから 'gnss-data' という名前でデータが来たら実行する
  onGNSSReceived: (callback: (data: string) => void) => 
    ipcRenderer.on('gnss-data', (_event, value) => callback(value))
});
