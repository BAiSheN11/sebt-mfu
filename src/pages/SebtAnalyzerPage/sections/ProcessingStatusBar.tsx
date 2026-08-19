import { Activity, AlertCircle, Cpu } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export type ProcessingStatus = 'idle' | 'processing' | 'complete' | 'error';

interface ProcessingStatusBarProps {
  status: ProcessingStatus;
  progress: number; // 0-100
  processedFrames: number;
  totalFrames: number;
  errorMessage?: string;
}

export default function ProcessingStatusBar({
  status,
  progress,
  processedFrames,
  totalFrames,
  errorMessage,
}: ProcessingStatusBarProps) {
  const isIdle = status === 'idle';
  const isProcessing = status === 'processing';
  const isComplete = status === 'complete';
  const isError = status === 'error';

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-4 transition-colors',
        isIdle && 'border-border/50 bg-card/20',
        isProcessing && 'border-primary/40 bg-primary/5',
        isComplete && 'border-emerald-500/40 bg-emerald-500/5',
        isError && 'border-red-500/40 bg-red-500/5',
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-lg',
              isIdle && 'bg-muted text-muted-foreground',
              isProcessing && 'bg-primary/20 text-primary animate-pulse',
              isComplete && 'bg-emerald-500/20 text-emerald-400',
              isError && 'bg-red-500/20 text-red-400',
            )}
          >
            {isError ? (
              <AlertCircle className="size-4" />
            ) : isComplete ? (
              <Activity className="size-4" />
            ) : (
              <Cpu className="size-4" />
            )}
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">
              {isIdle && 'Ready — upload a video to begin'}
              {isProcessing && 'Processing frames…'}
              {isComplete && 'Analysis complete'}
              {isError && 'Processing error'}
            </div>
            {isProcessing && (
              <div className="text-xs text-muted-foreground">
                Estimating pose keypoints across video frames
              </div>
            )}
            {isComplete && (
              <div className="text-xs text-muted-foreground">
                {totalFrames} frames analyzed · {totalFrames > 0 ? (totalFrames / 30).toFixed(1) : 0}s
              </div>
            )}
            {isError && errorMessage && (
              <div className="text-xs text-red-400">{errorMessage}</div>
            )}
          </div>
        </div>
        {isProcessing && (
          <div className="font-mono text-sm text-primary tabular-nums">
            {progress.toFixed(0)}%
          </div>
        )}
      </div>
      {isProcessing && (
        <>
          <Progress value={progress} className="h-1.5" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              Frame {processedFrames} / {totalFrames}
            </span>
            <span>
              {totalFrames > 0 && processedFrames > 0
                ? `~${Math.max(0, Math.round(((totalFrames - processedFrames) / processedFrames) * 3))}s remaining`
                : 'initializing…'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
