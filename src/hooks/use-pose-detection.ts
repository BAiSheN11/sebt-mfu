import { useCallback, useRef, useState } from 'react';
import { logger, resolveAppUrl } from '@lark-apaas/client-toolkit-lite';
import {
  type IFrameDetection,
  type IFrameKeypoint,
  type KeypointName,
} from '@/data/sebt';
import type { PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision';

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

// MediaPipe Pose landmark indices (33 landmarks) → COCO 17 mapping
// Reference: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
// 0 nose, 2 left_eye, 5 right_eye, 7 left_ear, 8 right_ear
// 11 left_shoulder, 12 right_shoulder, 13 left_elbow, 14 right_elbow, 15 left_wrist, 16 right_wrist
// 23 left_hip, 24 right_hip, 25 left_knee, 26 right_knee, 27 left_ankle, 28 right_ankle
const MEDIAPIPE_TO_COCO: Record<number, KeypointName> = {
  0: 'nose',
  2: 'left_eye',
  5: 'right_eye',
  7: 'left_ear',
  8: 'right_ear',
  11: 'left_shoulder',
  12: 'right_shoulder',
  13: 'left_elbow',
  14: 'right_elbow',
  15: 'left_wrist',
  16: 'right_wrist',
  23: 'left_hip',
  24: 'right_hip',
  25: 'left_knee',
  26: 'right_knee',
  27: 'left_ankle',
  28: 'right_ankle',
};

// MediaPipe BlazePose pose landmarker lite (CDN fallback)
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// Pose landmark model path — prefer local bundled file (offline-capable in desktop / self-hosted),
// fall back to CDN for online web usage.
function getModelUrl(): string {
  try {
    // resolveAppUrl handles basePath correctly for both web and electron builds
    return resolveAppUrl('/models/pose_landmarker_lite.task');
  } catch {
    return MODEL_URL;
  }
}

function getWasmBaseUrl(): string {
  // Use jsDelivr CDN as default; desktop build bundles WASM via @mediapipe/tasks-vision package
  return 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
}

export interface UsePoseDetectionResult {
  loadModel: () => Promise<void>;
  processVideo: (
    videoEl: HTMLVideoElement,
    onProgress: (framesProcessed: number, totalFrames: number, frame: IFrameDetection) => void,
  ) => Promise<IFrameDetection[]>;
  isModelLoading: boolean;
  modelError: string | null;
  isModelReady: boolean;
}

export function usePoseDetection(): UsePoseDetectionResult {
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isModelReady, setIsModelReady] = useState(false);

  const loadModel = useCallback(async () => {
    if (landmarkerRef.current) return;
    setIsModelLoading(true);
    setModelError(null);
    try {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');

      const vision = await FilesetResolver.forVisionTasks(
        getWasmBaseUrl(),
      );

      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: getModelUrl(),
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.3,
        minPosePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });

      landmarkerRef.current = landmarker;
      setIsModelReady(true);
      logger.info('MediaPipe PoseLandmarker loaded successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setModelError(msg);
      logger.error('Failed to load PoseLandmarker:', msg);
      throw err;
    } finally {
      setIsModelLoading(false);
    }
  }, []);

  const mapLandmarks = (
    result: PoseLandmarkerResult,
    vw: number,
    vh: number,
  ): IFrameKeypoint[] => {
    if (!result.landmarks || result.landmarks.length === 0) {
      return COCO_KEYS.map((name) => ({
        name,
        x: 0.5,
        y: 0.5,
        confidence: 0,
      }));
    }

    const landmarks = result.landmarks[0]; // normalized coordinates 0..1
    const kpMap = new Map<KeypointName, { x: number; y: number; visibility?: number }>();

    for (const [mpIdx, cocoName] of Object.entries(MEDIAPIPE_TO_COCO)) {
      const lm = landmarks[parseInt(mpIdx, 10)];
      if (lm) {
        kpMap.set(cocoName, {
          x: lm.x,
          y: lm.y,
          visibility: lm.visibility,
        });
      }
    }

    return COCO_KEYS.map((name) => {
      const src = kpMap.get(name);
      const visibility = src?.visibility ?? 0;
      // Use visibility as confidence proxy (MediaPipe doesn't give per-point score directly)
      const confidence = Math.max(0, Math.min(1, visibility));
      return {
        name,
        x: src ? Math.max(0, Math.min(1, src.x)) : 0,
        y: src ? Math.max(0, Math.min(1, src.y)) : 0,
        confidence,
        isHallucinated: confidence > 0.05 && confidence < 0.2,
      };
    });
  };

  const processVideo = useCallback(
    async (
      videoEl: HTMLVideoElement,
      onProgress: (framesProcessed: number, totalFrames: number, frame: IFrameDetection) => void,
    ): Promise<IFrameDetection[]> => {
      const landmarker = landmarkerRef.current;
      if (!landmarker) {
        throw new Error('Model not loaded');
      }

      const duration = videoEl.duration;
      if (!duration || isNaN(duration)) {
        throw new Error('Video duration not available');
      }

      const fps = 10; // 10fps for reasonable processing speed in-browser
      const totalFrames = Math.max(1, Math.floor(duration * fps));
      const results: IFrameDetection[] = [];
      const vw = videoEl.videoWidth || 640;
      const vh = videoEl.videoHeight || 480;

      logger.info(`Processing ${totalFrames} frames from ${duration.toFixed(2)}s video (${vw}x${vh})`);
      videoEl.pause();

      for (let i = 0; i < totalFrames; i++) {
        const time = (i / totalFrames) * duration;

        // Seek to frame
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            videoEl.removeEventListener('seeked', onSeeked);
            resolve();
          };
          videoEl.addEventListener('seeked', onSeeked);
          videoEl.currentTime = time;
          setTimeout(() => {
            videoEl.removeEventListener('seeked', onSeeked);
            resolve();
          }, 300);
        });

        try {
          const timestampMs = time * 1000;
          const result = landmarker.detectForVideo(videoEl, timestampMs);
          const frameKeypoints = mapLandmarks(result, vw, vh);

          const frame: IFrameDetection = {
            frameIndex: i,
            timestamp: time,
            keypoints: frameKeypoints,
          };
          results.push(frame);
          onProgress(i + 1, totalFrames, frame);
        } catch (err) {
          logger.error(`Frame ${i} detection error:`, String(err));
          const fallback: IFrameDetection = {
            frameIndex: i,
            timestamp: time,
            keypoints: COCO_KEYS.map((name) => ({
              name,
              x: 0.5,
              y: 0.5,
              confidence: 0,
            })),
          };
          results.push(fallback);
          onProgress(i + 1, totalFrames, fallback);
        }

        // Yield to UI
        if (i % 3 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      return results;
    },
    [],
  );

  return {
    loadModel,
    processVideo,
    isModelLoading,
    modelError,
    isModelReady,
  };
}
