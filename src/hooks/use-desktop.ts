import { useEffect, useState } from 'react';

interface DesktopInfo {
  isDesktop: boolean;
  version?: string;
  platform?: string;
}

declare global {
  interface Window {
    desktopAPI?: {
      selectVideoFile: () => Promise<{
        canceled: boolean;
        filePath?: string;
        fileName?: string;
        fileSize?: number;
      }>;
      getAppInfo: () => Promise<DesktopInfo>;
    };
  }
}

export function useDesktop(): DesktopInfo {
  const [info, setInfo] = useState<DesktopInfo>({ isDesktop: false });

  useEffect(() => {
    if (window.desktopAPI?.getAppInfo) {
      window.desktopAPI.getAppInfo().then(setInfo).catch(() => {
        setInfo({ isDesktop: false });
      });
    }
  }, []);

  return info;
}
