import { useState } from 'react';
import {
  MonitorPlay,
  X,
  Download,
  Terminal,
  FileCode,
  CheckCircle2,
  Copy,
  ArrowRight,
  Zap,
  Code2,
  FolderDown,
  Sparkles,
} from 'lucide-react';
import { resolveAppUrl } from '@lark-apaas/client-toolkit-lite';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useDesktop } from '@/hooks/use-desktop';
import { UniversalLink } from '@lark-apaas/client-toolkit-lite';

export default function DesktopDownloadBadge() {
  const { isDesktop, version, platform } = useDesktop();
  const [open, setOpen] = useState(false);

  const copyCommand = (cmd: string) => {
    navigator.clipboard?.writeText(cmd);
    toast.success('命令已复制到剪贴板');
  };

  if (isDesktop) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-400 border border-emerald-500/30">
        <CheckCircle2 className="size-3.5" />
        Desktop App v{version}
        {platform && <span className="text-emerald-400/70">· {platform}</span>}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
      >
        <MonitorPlay className="size-3.5" />
        Download & Run Locally
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl border-border bg-card sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <MonitorPlay className="size-5 text-primary" />
            Run SEBT Tester on Your Desktop
          </DialogTitle>
          <DialogDescription>
            Run this tool as a standalone desktop application — fully offline, with local video
            file access and privacy-safe pose detection.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="electron" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="electron" className="gap-1.5">
              <Download className="size-3.5" />
              Desktop App
            </TabsTrigger>
            <TabsTrigger value="source-zip" className="gap-1.5">
              <FolderDown className="size-3.5" />
              Download Source
            </TabsTrigger>
            <TabsTrigger value="source" className="gap-1.5">
              <Terminal className="size-3.5" />
              Run from Git
            </TabsTrigger>
          </TabsList>

          <TabsContent value="electron" className="space-y-4 pt-4">
            <div className="space-y-2 rounded-lg border border-border/60 bg-background/50 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Zap className="size-4 text-primary" />
                Why Desktop?
              </h4>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                  <span><strong className="text-foreground">Fully offline</strong> — pose model and WASM run locally, no server needed</span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                  <span><strong className="text-foreground">Privacy-first</strong> — patient video files never leave your computer</span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                  <span><strong className="text-foreground">Native file picker</strong> — access any local video file on your machine</span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                  <span><strong className="text-foreground">Dedicated window</strong> — no browser tabs, focus on analysis</span>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Step 1: Clone & Install</h4>
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2.5 font-mono text-xs">
                <code className="flex-1 text-foreground/90">
                  git clone &lt;repo-url&gt; && cd sebt-tester && npm install
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyCommand('git clone <repo-url> && cd sebt-tester && npm install')}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>

              <h4 className="text-sm font-semibold text-foreground">Step 2: Run in Dev Mode</h4>
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2.5 font-mono text-xs">
                <code className="flex-1 text-foreground/90">npm run electron:dev</code>
                <Button size="sm" variant="ghost" onClick={() => copyCommand('npm run electron:dev')}>
                  <Copy className="size-3.5" />
                </Button>
              </div>

              <h4 className="text-sm font-semibold text-foreground">Step 3: Build Installer</h4>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-[11px]">
                  <code className="flex-1 truncate">npm run electron:build:mac</code>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copyCommand('npm run electron:build:mac')}>
                    <Copy className="size-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-[11px]">
                  <code className="flex-1 truncate">npm run electron:build:win</code>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copyCommand('npm run electron:build:win')}>
                    <Copy className="size-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-[11px]">
                  <code className="flex-1 truncate">npm run electron:build:linux</code>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copyCommand('npm run electron:build:linux')}>
                    <Copy className="size-3" />
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Built installers appear in the <code className="text-foreground/80">release/</code> directory.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="source-zip" className="space-y-4 pt-4">
            <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FolderDown className="size-4 text-primary" />
                Download Complete Source Code
              </h4>
              <p className="text-xs text-muted-foreground">
                Download the full project as a ZIP file. Extract it, open in VS Code, and run
                <code className="mx-1 rounded bg-muted/50 px-1 text-[11px] text-foreground/90">npm install</code> + <code className="mx-1 rounded bg-muted/50 px-1 text-[11px] text-foreground/90">npm run dev</code>.
              </p>
            </div>

            <div className="space-y-3">
              <UniversalLink
                to={resolveAppUrl('/sebt-tester-source.zip')}
                download="sebt-tester-source.zip"
                className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Download className="size-4" />
                Download Source Code (ZIP)
                <span className="ml-1 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-medium">~5 MB</span>
              </UniversalLink>

              <div className="space-y-2 rounded-lg border border-border/60 bg-background/50 p-4">
                <h4 className="text-sm font-semibold text-foreground">What's Inside</h4>
                <ul className="grid grid-cols-2 gap-1.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-400" />
                    React + TypeScript source
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-400" />
                    MediaPipe pose model (5.6MB)
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-400" />
                    Electron desktop config
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-400" />
                    Vite + Tailwind config
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-400" />
                    package.json (all deps)
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3 text-emerald-400" />
                    README with instructions
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Code2 className="size-4 text-primary" />
                  3-Step Quick Start in VS Code
                </h4>
                <ol className="space-y-1.5 text-xs text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">1</span>
                    <span>Extract the ZIP and open the folder in <strong className="text-foreground">VS Code</strong></span>
                  </li>
                  <li className="flex gap-2">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">2</span>
                    <span>Open Terminal and run <code className="rounded bg-muted/50 px-1 text-foreground/90">npm install</code></span>
                  </li>
                  <li className="flex gap-2">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">3</span>
                    <span>Run <code className="rounded bg-muted/50 px-1 text-foreground/90">npm run dev</code> — app opens in your browser</span>
                  </li>
                </ol>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="source" className="space-y-4 pt-4">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                If you prefer running directly from source code (no Electron wrapper):
              </p>

              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FileCode className="size-4 text-primary" />
                  Option A: Vite Dev Server
                </h4>
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2.5 font-mono text-xs">
                  <code className="flex-1 text-foreground/90">npm install && npm run dev</code>
                  <Button size="sm" variant="ghost" onClick={() => copyCommand('npm install && npm run dev')}>
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Open <span className="text-foreground/80">http://localhost:5173</span> in your browser.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Download className="size-4 text-primary" />
                  Option B: Static Build (Open Offline)
                </h4>
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 p-2.5 font-mono text-xs">
                  <code className="flex-1 text-foreground/90">npm run build</code>
                  <Button size="sm" variant="ghost" onClick={() => copyCommand('npm run build')}>
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Open <span className="text-foreground/80">dist/index.html</span> in any modern browser —
                  pose detection runs entirely in-browser.
                </p>
              </div>

              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-[11px] text-amber-300/90">
                  <strong>Note:</strong> The MediaPipe WASM and pose model need an internet connection
                  the first time they load. For full offline capability, use the Electron build (Option A
                  in the other tab), which bundles everything locally.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between border-t border-border/50 pt-3">
          <div className="text-[11px] text-muted-foreground">
            Requires Node.js 18+ · ~200MB install (includes model file)
          </div>
          <Button size="sm" onClick={() => setOpen(false)}>
            Got it <ArrowRight className="ml-1 size-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
