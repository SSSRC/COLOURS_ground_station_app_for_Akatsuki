export {};

declare global {
  interface Window {
    api: {
      listPorts: () => Promise<Array<{ path: string; manufacturer: string }>>;
      connect: (
        path: string,
        baudRate: number
      ) => Promise<{ ok: boolean; message?: string; already?: boolean }>;
      disconnect: () => Promise<{ ok: boolean }>;
      
      // コマンド動作用
      sendCommand: (cmd: string) => Promise<{ ok: boolean; message?: string }>;
      
      onLine: (cb: (line: string) => void) => void;
      onError: (cb: (msg: string) => void) => void;
      onStatus: (cb: (status: string) => void) => void;
    };
  }
}