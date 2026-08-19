import { FlaskConical, ScanEye } from 'lucide-react';
import DesktopDownloadBadge from './DesktopDownloadBadge';

export default function AppHeader() {
  return (
    <header className="w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ScanEye className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-foreground">SEBT 2D Top-Down Tester</h1>
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary border border-primary/20">
                V1 Research
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Pose Estimation Feasibility Analysis Tool — Star Excursion Balance Test
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <DesktopDownloadBadge />
          <div className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400 border border-amber-500/30">
            <FlaskConical className="size-3.5" />
            Research Prototype — Not for Clinical Use
          </div>
        </div>
      </div>
    </header>
  );
}
