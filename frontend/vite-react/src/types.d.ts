export {};

declare global {
  type DesktopConfig = {
    deepseekApiKey?: string;
    qwenApiKey?: string;
    kbRootPath?: string;
    apiPort?: number;
  };

  interface Window {
    desktopApi?: {
      getConfig: () => Promise<DesktopConfig>;
      saveConfig: (config: DesktopConfig) => Promise<DesktopConfig>;
      selectKbRoot: () => Promise<string | null>;
    };
  }
}
