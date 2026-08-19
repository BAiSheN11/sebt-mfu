import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  KEYPOINT_LABELS,
  SKELETON_CONNECTIONS,
  type IFrameDetection,
  type KeypointName,
  type KeypointStatus,
} from '@/data/sebt';
import { cn } from '@/lib/utils';

interface PoseVisualizerSectionProps {
  videoUrl: string | null;
  frames: IFrameDetection[];
  isSimulated: boolean;
  currentFrameIndex: number;
  onFrameChange: (idx: number) => void;
  totalFrames: number;
}

function getStatusFromConfidence(conf: number): KeypointStatus {
  if (conf >= 0.7) return 'reliable';
  if (conf >= 0.3) return 'uncertain';
  return 'missing';
}

function statusColor(status: KeypointStatus): string {
  switch (status) {
    case 'reliable':
      return '#34d399'; // emerald-400
    case 'uncertain':
      return '#fbbf24'; // amber-400
    case 'missing':
      return '#f87171'; // red-400
  }
}

export default function PoseVisualizerSection({
  videoUrl,
  frames,
  isSimulated,
  currentFrameIndex,
  onFrameChange,
  totalFrames,
}: PoseVisualizerSectionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  // Get current frame keypoints
  const currentFrame =
    frames.length > 0 ? frames[Math.min(currentFrameIndex, frames.length - 1)] : null;

  // Draw skeleton on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!currentFrame) return;

    const w = canvas.width;
    const h = canvas.height;

    // Draw skeleton connections
    ctx.lineWidth = 2.5;
    for (const [a, b] of SKELETON_CONNECTIONS) {
      const kpA = currentFrame.keypoints.find((k) => k.name === a);
      const kpB = currentFrame.keypoints.find((k) => k.name === b);
      if (!kpA || !kpB) continue;
      if (kpA.confidence < 0.25 || kpB.confidence < 0.25) continue;

      const confAvg = (kpA.confidence + kpB.confidence) / 2;
      const status = getStatusFromConfidence(confAvg);
      ctx.strokeStyle = statusColor(status);
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(kpA.x * w, kpA.y * h);
      ctx.lineTo(kpB.x * w, kpB.y * h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Draw keypoints
    for (const kp of currentFrame.keypoints) {
      if (kp.confidence < 0.15 && !kp.isHallucinated) continue;
      const status = kp.isHallucinated ? 'missing' : getStatusFromConfidence(kp.confidence);
      const color = statusColor(status);
      const radius = kp.isHallucinated ? 7 : kp.confidence > 0.7 ? 5 : 4;

      // Outer glow
      const gradient = ctx.createRadialGradient(kp.x * w, kp.y * h, 0, kp.x * w, kp.y * h, radius * 3);
      gradient.addColorStop(0, color + 'cc');
      gradient.addColorStop(1, color + '00');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(kp.x * w, kp.y * h, radius * 3, 0, Math.PI * 2);
      ctx.fill();

      // Solid dot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(kp.x * w, kp.y * h, radius, 0, Math.PI * 2);
      ctx.fill();

      // Hallucination indicator
      if (kp.isHallucinated) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(kp.x * w, kp.y * h, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [currentFrame]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying || isSimulated) return;

    const video = videoRef.current;
    if (!video) return;

    const loop = () => {
      if (!video.paused && !video.ended && video.duration) {
        const idx = Math.floor((video.currentTime / video.duration) * totalFrames);
        if (idx !== currentFrameIndex && idx < totalFrames) {
          onFrameChange(idx);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, isSimulated, totalFrames, currentFrameIndex, onFrameChange]);

  // Simulated playback
  useEffect(() => {
    if (!isPlaying || !isSimulated) return;

    let lastTs = performance.now();
    const fps = 30;
    const frameDuration = 1000 / fps;

    const loop = (ts: number) => {
      const dt = ts - lastTs;
      if (dt >= frameDuration) {
        lastTs = ts;
        const next = currentFrameIndex + 1;
        if (next >= totalFrames) {
          setIsPlaying(false);
          onFrameChange(0);
          return;
        }
        onFrameChange(next);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, isSimulated, totalFrames, currentFrameIndex, onFrameChange]);

  // Sync video position on seek
  const handleSeek = (value: number[]) => {
    const idx = value[0];
    onFrameChange(idx);
    const video = videoRef.current;
    if (video && video.duration && !isSimulated) {
      video.currentTime = (idx / totalFrames) * video.duration;
    }
  };

  const togglePlay = () => {
    if (isSimulated) {
      setIsPlaying(!isPlaying);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleRestart = () => {
    onFrameChange(0);
    const video = videoRef.current;
    if (video && !isSimulated) {
      video.currentTime = 0;
    }
    setIsPlaying(false);
  };

  const formatTime = (frameIdx: number) => {
    const seconds = frameIdx / 30;
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(1);
    return `${m}:${s.padStart(4, '0')}`;
  };

  // Confidence readout - top 8 keypoints
  const confidenceList = currentFrame
    ? currentFrame.keypoints
        .filter((k) =>
          [
            'nose',
            'left_shoulder',
            'right_shoulder',
            'left_elbow',
            'left_hip',
            'right_hip',
            'left_knee',
            'left_ankle',
          ].includes(k.name),
        )
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={containerRef}
        className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/60 border border-border/40"
      >
        {videoUrl && !isSimulated ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="absolute inset-0 h-full w-full object-contain"
            onLoadedMetadata={() => setVideoReady(true)}
            onEnded={() => setIsPlaying(false)}
            muted
            playsInline
          />
        ) : (
          isSimulated && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg
                viewBox="0 0 400 300"
                className="h-full w-full opacity-40"
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Simulated floor grid */}
                <defs>
                  <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="hsl(220 5% 25%)" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="400" height="300" fill="url(#grid)" />
                {/* Star pattern */}
                <g stroke="hsl(220 5% 35%)" strokeWidth="0.8" fill="none">
                  {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                    <line
                      key={deg}
                      x1="200"
                      y1="150"
                      x2={200 + 120 * Math.cos((deg * Math.PI) / 180)}
                      y2={150 + 120 * Math.sin((deg * Math.PI) / 180)}
                    />
                  ))}
                  <circle cx="200" cy="150" r="30" />
                </g>
                <text x="200" y="20" textAnchor="middle" fill="hsl(215 8% 60%)" fontSize="10">
                  SIMULATED TOP-DOWN VIEW
                </text>
              </svg>
            </div>
          )
        )}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
        />
        {/* Legend overlay */}
        <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-lg bg-background/80 px-3 py-2 text-xs backdrop-blur-sm">
          <div className="mb-1 font-semibold text-foreground">Detection Legend</div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-400" />
            <span className="text-muted-foreground">Reliable (≥0.7)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-amber-400" />
            <span className="text-muted-foreground">Uncertain (0.3–0.7)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-red-400" />
            <span className="text-muted-foreground">Missing / Hallucinated</span>
          </div>
        </div>
        {isSimulated && (
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-amber-500/20 px-2.5 py-1 text-xs text-amber-300 border border-amber-500/40">
            <AlertTriangle className="size-3.5" />
            Demo / Simulated
          </div>
        )}
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-3">
        <Button size="icon" variant="outline" onClick={handleRestart} aria-label="Restart">
          <SkipBack className="size-4" />
        </Button>
        <Button size="icon" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <div className="flex-1">
          <Slider
            value={[currentFrameIndex]}
            min={0}
            max={Math.max(1, totalFrames - 1)}
            step={1}
            onValueChange={handleSeek}
            className="w-full"
          />
        </div>
        <div className="w-24 text-right font-mono text-xs text-muted-foreground tabular-nums">
          {formatTime(currentFrameIndex)} / {formatTime(totalFrames - 1)}
        </div>
        <div className="w-20 text-right text-xs text-muted-foreground">
          Frame {currentFrameIndex + 1}/{totalFrames}
        </div>
      </div>

      {/* Realtime confidence panel */}
      {confidenceList.length > 0 && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/40 bg-card/30 p-3 md:grid-cols-4">
          {confidenceList.map((kp) => {
            const status = getStatusFromConfidence(kp.confidence);
            const pct = Math.round(kp.confidence * 100);
            return (
              <div key={kp.name} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate text-muted-foreground">
                    {KEYPOINT_LABELS[kp.name as KeypointName]}
                  </span>
                  <span
                    className={cn(
                      'font-mono tabular-nums',
                      status === 'reliable' && 'text-emerald-400',
                      status === 'uncertain' && 'text-amber-400',
                      status === 'missing' && 'text-red-400',
                    )}
                  >
                    {pct}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      status === 'reliable' && 'bg-emerald-400',
                      status === 'uncertain' && 'bg-amber-400',
                      status === 'missing' && 'bg-red-400',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
