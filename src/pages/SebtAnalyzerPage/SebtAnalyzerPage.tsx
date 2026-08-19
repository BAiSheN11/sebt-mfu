import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import UploadSection from './sections/UploadSection';
import PoseVisualizerSection from './sections/PoseVisualizerSection';
import DetectionReportSection from './sections/DetectionReportSection';
import SebtStarDiagram from './sections/SebtStarDiagram';
import ProcessingStatusBar, {
  type ProcessingStatus,
} from './sections/ProcessingStatusBar';
import { usePoseDetection } from '@/hooks/use-pose-detection';
import {
  generateSimulatedFrame,
  generateSimulatedReport,
  type IDetectionReport,
  type IFrameDetection,
  type IKeypointSummary,
  type KeypointName,
  type KeypointStatus,
  KEYPOINT_LABELS,
  SEBT_DIRECTIONS,
} from '@/data/sebt';
import { logger } from '@lark-apaas/client-toolkit-lite';

const COCO_KEYS: KeypointName[] = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

const KEYPOINT_GROUPS: Record<KeypointName, IKeypointSummary['group']> = {
  nose: 'head',
  left_eye: 'head',
  right_eye: 'head',
  left_ear: 'head',
  right_ear: 'head',
  left_shoulder: 'upper_limb',
  right_shoulder: 'upper_limb',
  left_elbow: 'upper_limb',
  right_elbow: 'upper_limb',
  left_wrist: 'upper_limb',
  right_wrist: 'upper_limb',
  left_hip: 'torso',
  right_hip: 'torso',
  left_knee: 'lower_limb',
  right_knee: 'lower_limb',
  left_ankle: 'lower_limb',
  right_ankle: 'lower_limb',
};

function buildReportFromFrames(
  frames: IFrameDetection[],
  videoInfo: { width: number; height: number; duration: number; fps: number },
  isSimulated: boolean,
): IDetectionReport {
  const totalFrames = frames.length;
  const fps = videoInfo.fps || 30;

  const keypointSummaries: IKeypointSummary[] = COCO_KEYS.map((name) => {
    let detectedCount = 0;
    let confidenceSum = 0;
    for (const frame of frames) {
      const kp = frame.keypoints.find((k) => k.name === name);
      if (kp && kp.confidence >= 0.3) {
        detectedCount++;
        confidenceSum += kp.confidence;
      }
    }
    const detectionRate = totalFrames > 0 ? (detectedCount / totalFrames) * 100 : 0;
    const avgConfidence = detectedCount > 0 ? confidenceSum / detectedCount : 0;

    let status: KeypointStatus = 'reliable';
    if (detectionRate < 30 || avgConfidence < 0.3) status = 'missing';
    else if (detectionRate < 70 || avgConfidence < 0.6) status = 'uncertain';

    return {
      name,
      bodyPartLabel: KEYPOINT_LABELS[name],
      detected: detectionRate > 20,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      framesDetected: detectedCount,
      framesMissing: totalFrames - detectedCount,
      detectionRate: Math.round(detectionRate * 10) / 10,
      status,
      group: KEYPOINT_GROUPS[name],
    };
  });

  // Compute flaw metrics
  const lowerLimbKeys: KeypointName[] = ['left_knee', 'right_knee', 'left_ankle', 'right_ankle'];
  const avgAbsenceRate =
    lowerLimbKeys.reduce((s, k) => {
      const kp = keypointSummaries.find((k2) => k2.name === k);
      return s + (kp ? kp.framesMissing / Math.max(1, totalFrames) : 0);
    }, 0) /
    lowerLimbKeys.length *
    100;

  // Pixel distance estimate (max ankle-to-hip distance across frames)
  let maxPixelDist = 0;
  for (const frame of frames) {
    const la = frame.keypoints.find((k) => k.name === 'left_ankle');
    const lh = frame.keypoints.find((k) => k.name === 'left_hip');
    if (la && lh && la.confidence > 0.3 && lh.confidence > 0.3) {
      const dx = (la.x - lh.x) * videoInfo.width;
      const dy = (la.y - lh.y) * videoInfo.height;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxPixelDist) maxPixelDist = dist;
    }
  }

  const baseReport = generateSimulatedReport();
  const mostAffected = SEBT_DIRECTIONS.filter(
    (_, i) => i % 2 === 0,
  ) as typeof baseReport.threeFlaws.flaw3_foreshortening.affectedDirections;

  return {
    totalFrames,
    fps,
    duration: videoInfo.duration,
    videoResolution: { width: videoInfo.width, height: videoInfo.height },
    keypointSummaries,
    threeFlaws: {
      flaw1_selfOcclusion: {
        ...baseReport.threeFlaws.flaw1_selfOcclusion,
        avgAbsenceRate: Math.round(avgAbsenceRate * 10) / 10,
        affectedKeypoints: lowerLimbKeys,
      },
      flaw2_verticalBlindness: baseReport.threeFlaws.flaw2_verticalBlindness,
      flaw3_foreshortening: {
        ...baseReport.threeFlaws.flaw3_foreshortening,
        pixelDistanceMeasured: Math.round(maxPixelDist || 200),
        affectedDirections: mostAffected,
      },
    },
    sebtContext: baseReport.sebtContext,
    verdict: baseReport.verdict,
    isSimulated,
  };
}

export default function SebtAnalyzerPage() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [frames, setFrames] = useState<IFrameDetection[]>([]);
  const [report, setReport] = useState<IDetectionReport | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const { loadModel, processVideo, isModelLoading, modelError, isModelReady } =
    usePoseDetection();

  const totalFrames = report?.totalFrames ?? frames.length;

  const handleVideoLoaded = useCallback(
    async (file: File, url: string) => {
      setVideoFile(file);
      setVideoUrl(url);
      setIsSimulated(false);
      setFrames([]);
      setReport(null);
      setCurrentFrameIndex(0);
      setStatus('processing');
      setProgress(0);
      setErrorMessage(null);

      // Wait a tick for video element to mount with new src
      setTimeout(async () => {
        const video = videoRef.current;
        if (!video) {
          startSimulatedProcessing();
          return;
        }

        video.src = url;
        video.load();

        const onLoaded = async () => {
          video.removeEventListener('loadedmetadata', onLoaded);

          try {
            // Load TF.js model
            if (!isModelReady) {
              await loadModel();
            }

            // Process video frames
            const allFrames: IFrameDetection[] = [];
            const fps = 30;
            const totalF = Math.max(1, Math.floor(video.duration * fps));

            await processVideo(video, (processed, total, frame) => {
              allFrames.push(frame);
              setFrames([...allFrames]);
              setProgress((processed / total) * 100);
            });

            // Build report
            const finalReport = buildReportFromFrames(
              allFrames,
              {
                width: video.videoWidth,
                height: video.videoHeight,
                duration: video.duration,
                fps,
              },
              false,
            );
            setReport(finalReport);
            setStatus('complete');
            setProgress(100);
            setTimeout(() => {
              reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 200);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Pose detection failed, falling back to simulation:', msg);
            setErrorMessage(`Detection error — showing simulated results: ${msg.slice(0, 80)}`);
            // Fall back to simulated results
            startSimulatedProcessing();
          }
        };

        video.addEventListener('loadedmetadata', onLoaded);
      }, 100);
    },
    [isModelReady, loadModel, processVideo],
  );

  const handleDemoMode = useCallback(() => {
    setVideoFile(null);
    setVideoUrl(null);
    setIsSimulated(true);
    setCurrentFrameIndex(0);
    setErrorMessage(null);
    startSimulatedProcessing();
  }, []);

  const startSimulatedProcessing = useCallback(() => {
    setStatus('processing');
    setProgress(0);
    setFrames([]);
    setReport(null);

    const totalF = 180;
    const batchSize = 8;
    let processed = 0;

    const processBatch = () => {
      const batch: IFrameDetection[] = [];
      const end = Math.min(processed + batchSize, totalF);
      for (let i = processed; i < end; i++) {
        batch.push(generateSimulatedFrame(i, totalF));
      }
      setFrames((prev) => [...prev, ...batch]);
      processed = end;
      setProgress((processed / totalF) * 100);

      if (processed < totalF) {
        requestAnimationFrame(processBatch);
      } else {
        const finalReport = generateSimulatedReport();
        setReport(finalReport);
        setStatus('complete');
        setProgress(100);
        setTimeout(() => {
          reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
      }
    };

    processBatch();
  }, []);

  const displayFrames = useMemo(() => {
    if (frames.length > 0) return frames;
    if (isSimulated && report) {
      const sample: IFrameDetection[] = [];
      for (let i = 0; i < report.totalFrames; i++) {
        sample.push(generateSimulatedFrame(i, report.totalFrames));
      }
      return sample;
    }
    return [];
  }, [frames, isSimulated, report]);

  const handleFrameChange = useCallback((idx: number) => {
    setCurrentFrameIndex(idx);
  }, []);

  // Hidden video element for frame processing
  const processingVideo = (
    <video
      ref={videoRef}
      className="hidden"
      muted
      playsInline
      crossOrigin="anonymous"
    />
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      {processingVideo}
      <main className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 md:px-6">
        {/* Upload area */}
        <section className="w-full">
          <UploadSection
            videoFile={videoFile}
            videoUrl={videoUrl}
            onVideoLoaded={handleVideoLoaded}
            onDemoMode={handleDemoMode}
            isProcessing={status === 'processing' || isModelLoading}
          />
        </section>

        {/* Processing status */}
        {status !== 'idle' && (
          <ProcessingStatusBar
            status={status}
            progress={progress}
            processedFrames={frames.length}
            totalFrames={totalFrames || 180}
            errorMessage={errorMessage ?? modelError ?? undefined}
          />
        )}

        {/* Main content: left video + right report */}
        {status !== 'idle' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            {/* Left: Video visualizer (3/5) */}
            <div className="xl:col-span-3 space-y-6">
              <PoseVisualizerSection
                videoUrl={videoUrl}
                frames={displayFrames}
                isSimulated={isSimulated}
                currentFrameIndex={currentFrameIndex}
                onFrameChange={handleFrameChange}
                totalFrames={totalFrames || displayFrames.length || 1}
              />
              <SebtStarDiagram report={report} />
            </div>

            {/* Right: Detection report (2/5) */}
            <div ref={reportRef} className="xl:col-span-2">
              <div className="xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
                <DetectionReportSection report={report} />
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="border-t border-border/30 pt-4 text-center text-xs text-muted-foreground">
          <p>
            SEBT 2D Top-Down Tester v1.0 · Research Prototype · Powered by TensorFlow.js + MoveNet
            · For demonstrative purposes only — Not a clinical medical device
          </p>
        </footer>
      </main>
    </div>
  );
}
