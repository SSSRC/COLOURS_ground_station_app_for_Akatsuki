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
      
      // ログ操作用APIを追加
      startLog: (customName: string) => Promise<{ ok: boolean; path?: string; message?: string }>;
      stopLog: () => Promise<{ ok: boolean }>;

      onLine: (cb: (line: string) => void) => void;
      onError: (cb: (msg: string) => void) => void;
      onStatus: (cb: (status: string) => void) => void;
    };
  }
}