import { useCallback, useRef, useState, type DragEvent } from 'react';
import { Upload, Film, PlayCircle, FileVideo, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDesktop } from '@/hooks/use-desktop';

interface UploadSectionProps {
  videoFile: File | null;
  videoUrl: string | null;
  onVideoLoaded: (file: File, url: string) => void;
  onDemoMode: () => void;
  isProcessing: boolean;
}

export default function UploadSection({
  videoFile,
  videoUrl,
  onVideoLoaded,
  onDemoMode,
  isProcessing,
}: UploadSectionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isDesktop } = useDesktop();

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.type.startsWith('video/')) return;
      const url = URL.createObjectURL(file);
      onVideoLoaded(file, url);
    },
    [onVideoLoaded],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const handleDesktopFilePick = async () => {
    if (!window.desktopAPI?.selectVideoFile) return;
    try {
      const result = await window.desktopAPI.selectVideoFile();
      if (result.canceled || !result.filePath) return;

      // In Electron desktop builds, load local file via file:// URL wrapped in a blob
      try {
        const fileUrl = `file://${result.filePath.replace(/\\/g, '/')}`;
        const blob = await fetch(fileUrl).then((r) => r.blob());
        const file = new File([blob], result.fileName ?? 'video.mp4', {
          type: blob.type || 'video/mp4',
        });
        const url = URL.createObjectURL(file);
        onVideoLoaded(file, url);
        return;
      } catch {
        // Fall through to drag-drop hint if file:// fetch blocked
      }

      // Fallback: minimal File stub with name only
      const stubFile = new File([], result.fileName ?? 'video.mp4', {
        type: 'video/mp4',
      });
      onVideoLoaded(stubFile, `file://${result.filePath}`);
    } catch {
      // Fall back to browser file input
      inputRef.current?.click();
    }
  };

  return (
    <div className="w-full">
      {!videoUrl ? (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={cn(
            'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 md:p-14 transition-all duration-200',
            isDragging
              ? 'border-primary bg-primary/10 scale-[1.01]'
              : 'border-border/60 bg-card/30 hover:border-primary/50 hover:bg-card/60',
          )}
        >
          <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Upload className="size-7" />
          </div>
          <h3 className="mb-2 text-xl font-semibold text-foreground">Upload SEBT Video</h3>
          <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
            Drag and drop a top-down SEBT test video file here, or click to browse. Supported
            formats: MP4, WebM, MOV (browser-compatible).
          </p>
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              {isDesktop ? (
              <Button
                size="lg"
                onClick={handleDesktopFilePick}
                className="min-w-[180px]"
              >
                <FolderOpen className="mr-2 size-4" />
                Browse Video File
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={() => inputRef.current?.click()}
                className="min-w-[160px]"
              >
                <FileVideo className="mr-2 size-4" />
                Choose Video
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              onClick={onDemoMode}
              className="min-w-[160px]"
            >
              <PlayCircle className="mr-2 size-4" />
              Try Demo Mode
            </Button>
            </div>

            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Film className="size-3.5" />
              <span>Or download the full source code to run locally in VS Code — fully offline capable.</span>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="mt-8 grid w-full max-w-lg grid-cols-3 gap-4 text-center text-xs">
            <div className="rounded-lg border border-border/50 bg-background/40 p-3">
              <div className="mb-1 font-semibold text-foreground">Step 1</div>
              <div className="text-muted-foreground">Upload top-down video</div>
            </div>
            <div className="rounded-lg border border-border/50 bg-background/40 p-3">
              <div className="mb-1 font-semibold text-foreground">Step 2</div>
              <div className="text-muted-foreground">Pose estimation runs</div>
            </div>
            <div className="rounded-lg border border-border/50 bg-background/40 p-3">
              <div className="mb-1 font-semibold text-foreground">Step 3</div>
              <div className="text-muted-foreground">Review flaw analysis</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl border border-border/50 bg-card/30 p-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Film className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{videoFile?.name}</div>
              <div className="text-xs text-muted-foreground">
                {videoFile ? formatSize(videoFile.size) : ''}
                {videoFile?.type ? ` · ${videoFile.type}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isProcessing && (
              <span className="text-xs text-primary">Processing…</span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={isProcessing}
            >
              Replace
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
