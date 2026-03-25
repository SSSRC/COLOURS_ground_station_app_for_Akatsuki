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
      
      sendCommand: (cmd: string) => Promise<{ ok: boolean; message?: string }>;
      
      // ★追加：ログ操作用のAPI
      startLog: (customName: string) => Promise<{ ok: boolean; path?: string; message?: string }>;
      stopLog: () => Promise<{ ok: boolean }>;

      onLine: (cb: (line: string) => void) => void;
      onError: (cb: (msg: string) => void) => void;
      onStatus: (cb: (status: string) => void) => void;
    };
  }
}