export {};

declare global {
  interface Window {
    api: {
      listPorts: () => Promise<Array<{ path: string; manufacturer: string }>>;
      connect: (path: string, baudRate: number) => Promise<{ ok: boolean; message?: string; already?: boolean }>;
      disconnect: () => Promise<{ ok: boolean }>;
      onLine: (cb: (line: string) => void) => void;
      onError: (cb: (msg: string) => void) => void;
      onStatus: (cb: (st: string) => void) => void;
    };
  }
}