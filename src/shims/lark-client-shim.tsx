/**
 * Standalone shim for @lark-apaas/client-toolkit-lite.
 * Provides no-op fallbacks so the app runs outside the Lark platform.
 */
import React from 'react';

/** Resolve an asset URL — in standalone mode, paths are used as-is. */
export function resolveAppUrl(url: string): string {
  return url;
}

/** Logger shim — maps to console. */
export const logger = {
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
  debug: (...args: unknown[]) => console.debug(...args),
};

/** AppContainer shim — renders children directly. */
export function AppContainer({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

/** ErrorRender shim — shows a simple error message. */
interface ErrorRenderProps {
  error: Error;
  resetErrorBoundary: () => void;
}
export function ErrorRender({ error, resetErrorBoundary }: ErrorRenderProps) {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2 style={{ color: '#dc2626' }}>Something went wrong</h2>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{error.message}</pre>
      <button onClick={resetErrorBoundary} style={{ marginTop: 12, padding: '6px 16px' }}>
        Try again
      </button>
    </div>
  );
}

/** UniversalLink shim — renders a plain <a> tag. */
interface UniversalLinkProps {
  to: string;
  download?: string;
  className?: string;
  children?: React.ReactNode;
}
export function UniversalLink({ to, download, className, children }: UniversalLinkProps) {
  return (
    <a href={to} download={download} className={className}>
      {children}
    </a>
  );
}
