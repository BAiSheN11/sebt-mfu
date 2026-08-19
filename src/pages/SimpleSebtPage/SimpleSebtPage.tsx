import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, Play, Pause, Download, CheckCircle2, XCircle,
  Award, Camera, Footprints, AlertTriangle,
  RotateCcw, TrendingDown, Printer, FileSpreadsheet,
  ClipboardList, Activity, FileUp, Info, BarChart3, Eye,
} from 'lucide-react';
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { resolveAppUrl, logger } from '@lark-apaas/client-toolkit-lite';
import { toast } from 'sonner';
import { UniversalLink } from '@lark-apaas/client-toolkit-lite';
import { LandmarkSmoother } from '@/utils/one-euro-filter';
import { FootEstimator } from '@/utils/foot-tracker';
import {
  NORMATIVE_REACH, LSI_THRESHOLD, zScore, clinicalBand, percentileEstimate,
  DATASET_CITATION,
} from '@/data/normativeData';

// ─── Keypoints ───────────────────────────────────────────────────────────────
const KEYPOINT_NAMES = [
  'nose', 'left eye', 'right eye', 'left ear', 'right ear',
  'left shoulder', 'right shoulder', 'left elbow', 'right elbow',
  'left wrist', 'right wrist', 'left hip', 'right hip',
  'left knee', 'right knee', 'left ankle', 'right ankle',
  'left heel', 'right heel', 'left toe', 'right toe',
] as const;

const BLAZEPOSE_TO_KP: Record<number, number> = {
  0: 0, 2: 1, 5: 2, 7: 3, 8: 4,
  11: 5, 12: 6, 13: 7, 14: 8, 15: 9, 16: 10,
  23: 11, 24: 12, 25: 13, 26: 14, 27: 15, 28: 16,
  29: 17, 30: 18, 31: 19, 32: 20,
};

const SKELETON: [number, number][] = [
  [0, 2], [0, 5], [2, 7], [5, 8],
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [28, 30], [30, 32],
];

const SEBT_DIRECTIONS = [
  { key: 'anterior', label: 'Anterior', short: 'ANT', angle: 0 },
  { key: 'anterolateral', label: 'Anterolateral', short: 'AL', angle: 45 },
  { key: 'lateral', label: 'Lateral', short: 'LAT', angle: 90 },
  { key: 'posterolateral', label: 'Posterolateral', short: 'PL', angle: 135 },
  { key: 'posterior', label: 'Posterior', short: 'POST', angle: 180 },
  { key: 'posteromedial', label: 'Posteromedial', short: 'PM', angle: 225 },
  { key: 'medial', label: 'Medial', short: 'MED', angle: 270 },
  { key: 'anteromedial', label: 'Anteromedial', short: 'AM', angle: 315 },
] as const;

type DirectionKey = typeof SEBT_DIRECTIONS[number]['key'];

const MODEL_PATHS = {
  lite: '/models/pose_landmarker_lite.task',
  full: '/models/pose_landmarker_full.task',
  heavy: '/models/pose_landmarker_heavy.task',
} as const;
type ModelQuality = keyof typeof MODEL_PATHS;
type StanceLeg = 'auto' | 'left' | 'right';

// ─── Thresholds ──────────────────────────────────────────────────────────────
const IMPACT_VELOCITY_SOFT = 0.8;
const IMPACT_VELOCITY_HARD = 1.5;
const BOUNCE_THRESHOLD = 0.03;
const CONTACT_FLOOR_TOLERANCE = 0.04;
const REACH_MIN_RATIO = 0.35;

// ─── Types ───────────────────────────────────────────────────────────────────
interface ContactEvent {
  direction: DirectionKey;
  timestamp: number;
  reachRatio: number;
  reachCm: number;
  impactVelocity: number;
  bounce: number;
  touchType: 'soft' | 'moderate' | 'hard';
  contactQuality: number;
  /** Fraction of contact frames where toe was directly observed (0–1) */
  measurementConfidence: number;
}

interface DirectionScore {
  key: DirectionKey;
  label: string;
  short: string;
  detected: boolean;
  maxReach: number;
  maxReachCm: number;
  bestContact: ContactEvent | null;
  contactCount: number;
  hardTouchCount: number;
  stability: number;
  reachScore: number;
  status: 'good' | 'partial' | 'fail';
  zScore: number;
  percentile: number;
  band: 'below-average' | 'average' | 'above-average';
  normative: { mean: number; sd: number };
  /** Fraction of peak-reach contact frames directly observed (0–1) */
  measurementConfidence: number;
}

interface BodyAxes {
  mlX: number; mlY: number;
  apX: number; apY: number;
  lateralSign: number;
  apFlip: number;
}

interface FootTrackState {
  prevY: number; prevTime: number;
  smoothedVelocity: number;
  peakDescendVelocity: number;
  state: 'idle' | 'descending' | 'at_contact' | 'rising';
  contactFrames: number; contactY: number;
  postContactRise: number;
  contactDir: DirectionKey | null;
  nearFloorCount: number;
  contactReaches: number[];
  /** Number of contact frames where the toe was directly observed */
  contactObservedFrames: number;
  /** Total contact frames with valid measurement */
  contactTotalFrames: number;
}

interface SessionInfo {
  patientId: string;
  age: string;
  sex: string;
  stanceLeg: StanceLeg;
  trial: string;
  tester: string;
  notes: string;
  apFlip: boolean;
}

function createFootTrack(): FootTrackState {
  return {
    prevY: 0, prevTime: 0, smoothedVelocity: 0,
    peakDescendVelocity: 0, state: 'idle', contactFrames: 0,
    contactY: 0, postContactRise: 0, contactDir: null,
    nearFloorCount: 0, contactReaches: [],
    contactObservedFrames: 0, contactTotalFrames: 0,
  };
}

// ─── Body-relative direction classification ──────────────────────────────────
function classifyDirection(dx: number, dy: number, axes: BodyAxes): DirectionKey {
  const mlComp = dx * axes.mlX + dy * axes.mlY;
  const apComp = dx * axes.apX + dy * axes.apY;
  const lateral = mlComp * axes.lateralSign;
  const anterior = apComp * axes.apFlip;
  let angleDeg = Math.atan2(lateral, anterior) * 180 / Math.PI;
  if (angleDeg < 0) angleDeg += 360;
  let best: DirectionKey = 'anterior';
  let bestDiff = 360;
  SEBT_DIRECTIONS.forEach(d => {
    let diff = Math.abs(angleDeg - d.angle);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = d.key; }
  });
  return best;
}

function classifyTouch(impactVel: number, bounce: number): { type: 'soft' | 'moderate' | 'hard'; quality: number } {
  if (impactVel >= IMPACT_VELOCITY_HARD || bounce >= BOUNCE_THRESHOLD * 2) {
    const severity = Math.min(1, Math.max(
      (impactVel - IMPACT_VELOCITY_HARD) / 1.5,
      (bounce - BOUNCE_THRESHOLD * 2) / 0.05));
    return { type: 'hard', quality: Math.round(40 - severity * 30) };
  }
  if (impactVel < IMPACT_VELOCITY_SOFT && bounce < BOUNCE_THRESHOLD) {
    return { type: 'soft', quality: Math.round(Math.max(85, 100 - (impactVel / IMPACT_VELOCITY_SOFT) * 15)) };
  }
  const q = 60 + ((IMPACT_VELOCITY_HARD - Math.max(impactVel, IMPACT_VELOCITY_SOFT)) /
    (IMPACT_VELOCITY_HARD - IMPACT_VELOCITY_SOFT)) * 25;
  return { type: 'moderate', quality: Math.round(Math.max(45, Math.min(75, q))) };
}

function trackFoot(
  track: FootTrackState,
  toeImgY: number, confidence: number, wasObserved: boolean,
  reachRatio: number, dir: DirectionKey,
  floorY: number, legLen: number, legCm: number, now: number,
): ContactEvent | null {
  if (confidence < 0.15) { track.state = 'idle'; return null; }
  let contactEvent: ContactEvent | null = null;

  if (now > track.prevTime && track.prevTime > 0) {
    const dt = Math.max((now - track.prevTime) / 1000, 0.001);
    const rawVelocity = ((toeImgY - track.prevY) / legLen) / dt;
    track.smoothedVelocity = track.smoothedVelocity * 0.5 + rawVelocity * 0.5;

    const distFromFloor = toeImgY - floorY;
    const atFloor = distFromFloor >= -CONTACT_FLOOR_TOLERANCE && distFromFloor < 0.08;
    track.nearFloorCount = atFloor ? track.nearFloorCount + 1 : Math.max(0, track.nearFloorCount - 1);

    switch (track.state) {
      case 'idle':
        if (track.smoothedVelocity > 0.3 && reachRatio > REACH_MIN_RATIO) {
          track.state = 'descending';
          track.peakDescendVelocity = track.smoothedVelocity;
          track.contactDir = dir;
          track.contactReaches = [];
          track.contactObservedFrames = 0;
          track.contactTotalFrames = 0;
        }
        break;
      case 'descending':
        track.peakDescendVelocity = Math.max(track.peakDescendVelocity, track.smoothedVelocity);
        track.contactDir = dir;
        if (track.nearFloorCount >= 2 && track.smoothedVelocity < 0.5) {
          track.state = 'at_contact';
          track.contactFrames = 0;
          track.contactY = toeImgY;
          track.postContactRise = 0;
          track.contactReaches = [reachRatio];
          track.contactObservedFrames = wasObserved ? 1 : 0;
          track.contactTotalFrames = 1;
        }
        if (reachRatio < REACH_MIN_RATIO * 0.7) {
          track.state = 'idle'; track.peakDescendVelocity = 0; track.nearFloorCount = 0;
        }
        break;
      case 'at_contact': {
        track.contactFrames++;
        track.contactTotalFrames++;
        if (wasObserved) track.contactObservedFrames++;
        if (atFloor) track.contactReaches.push(reachRatio);
        const rise = track.contactY - toeImgY;
        if (rise > track.postContactRise) track.postContactRise = rise;
        if (track.contactFrames > 5 || (track.smoothedVelocity < -0.3 && track.contactFrames > 2)) {
          const bounceNorm = track.postContactRise / legLen;
          const { type, quality } = classifyTouch(track.peakDescendVelocity, bounceNorm);
          // Trimmed mean: discard top and bottom 20% to reject outliers,
          // then average the central 60% for a robust peak reach.
          const sorted = [...track.contactReaches].sort((a, b) => a - b);
          const n = sorted.length;
          const trim = Math.max(1, Math.floor(n * 0.2));
          const central = n > 4 ? sorted.slice(trim, n - trim) : sorted;
          const robustReach = central.reduce((s, v) => s + v, 0) / central.length;
          const measConf = track.contactTotalFrames > 0
            ? track.contactObservedFrames / track.contactTotalFrames : 0;
          contactEvent = {
            direction: track.contactDir || dir,
            timestamp: now,
            reachRatio: Math.round(robustReach * 1000) / 1000,
            reachCm: legCm > 0 ? Math.round(robustReach * legCm * 10) / 10 : 0,
            impactVelocity: Math.round(track.peakDescendVelocity * 100) / 100,
            bounce: Math.round(bounceNorm * 1000) / 1000,
            touchType: type,
            contactQuality: quality,
            measurementConfidence: Math.round(measConf * 100) / 100,
          };
          track.state = 'rising';
        }
        break;
      }
      case 'rising':
        if (reachRatio < REACH_MIN_RATIO || track.smoothedVelocity > 0.2) {
          track.state = 'idle';
          track.peakDescendVelocity = 0;
          track.postContactRise = 0;
          track.nearFloorCount = 0;
          track.contactReaches = [];
          track.contactObservedFrames = 0;
          track.contactTotalFrames = 0;
        }
        break;
    }
  }
  track.prevY = toeImgY; track.prevTime = now;
  return contactEvent;
}

// ─── Animation helpers ───────────────────────────────────────────────────────
const fadeInUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

function AnimatedCounter({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    const start = performance.now();
    const dur = 600;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toFixed(decimals)}</>;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function SimpleSebtPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number>(0);
  const uiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const smootherRef = useRef<LandmarkSmoother>(new LandmarkSmoother(33, 1.2, 0.04));
  const worldSmootherRef = useRef<LandmarkSmoother>(new LandmarkSmoother(33, 1.2, 0.04));

  const legLengthCalibRef = useRef<number[]>([]);
  const calibratedLegLengthRef = useRef<number>(0);
  const stanceOriginXRef = useRef<number>(0);
  const stanceOriginYRef = useRef<number>(0);
  const worldLegLenRef = useRef<number>(0);
  const worldStanceAnkleRef = useRef<{ x: number; y: number; z: number } | null>(null);
  // Robust 3D calibration (median of first N frames, locked)
  const worldLegLenSamplesRef = useRef<number[]>([]);
  const worldAnkleXSamplesRef = useRef<number[]>([]);
  const worldAnkleYSamplesRef = useRef<number[]>([]);
  const worldAnkleZSamplesRef = useRef<number[]>([]);
  const worldCalibLockedRef = useRef(false);
  const worldAnkleLockedRef = useRef(false);
  // Per-direction measurement confidence (fraction of contact frames directly observed)
  const dirObservedFramesRef = useRef<Record<string, { observed: number; total: number }>>({});

  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [keypoints, setKeypoints] = useState<{ name: string; x: number; y: number; confidence: number }[]>([]);
  const [frameCount, setFrameCount] = useState(0);
  const [missingStats, setMissingStats] = useState<Record<string, number>>({});
  const [detectedFrames, setDetectedFrames] = useState<Record<string, number>>({});
  const [showCameraGuide, setShowCameraGuide] = useState(false);
  const [modelQuality, setModelQuality] = useState<ModelQuality>('full');
  const [showSessionForm, setShowSessionForm] = useState(true);

  const [session, setSession] = useState<SessionInfo>({
    patientId: '', age: '', sex: '', stanceLeg: 'auto',
    trial: '1', tester: '', notes: '', apFlip: false,
  });

  const latestKeypointsRef = useRef<{ name: string; x: number; y: number; confidence: number }[]>([]);
  const frameCountRef = useRef(0);
  const missingStatsRef = useRef<Record<string, number>>({});
  const detectedFramesRef = useRef<Record<string, number>>({});

  const maxReachRef = useRef<Record<DirectionKey, number>>({} as Record<DirectionKey, number>);
  const bestContactRef = useRef<Record<DirectionKey, ContactEvent | null>>({} as Record<DirectionKey, ContactEvent | null>);
  const contactCountRef = useRef<Record<DirectionKey, number>>({} as Record<DirectionKey, number>);
  const hardTouchCountRef = useRef<Record<DirectionKey, number>>({} as Record<DirectionKey, number>);
  const swayDataRef = useRef<{ comX: number; comY: number; timestamp: number }[]>([]);
  const legLengthRef = useRef<number>(0.1);
  const floorYRef = useRef<number>(0);
  const floorCalibratedRef = useRef(false);
  const floorCalibrationFrames = useRef<number[]>([]);

  const leftAnkleHistory = useRef<{ x: number; y: number }[]>([]);
  const rightAnkleHistory = useRef<{ x: number; y: number }[]>([]);
  const stanceFootRef = useRef<'left' | 'right' | null>(null);
  const stanceHeelLiftRef = useRef(0);
  const stanceMoveSumRef = useRef(0);
  const stanceMoveSamplesRef = useRef(0);

  const leftFootTrack = useRef<FootTrackState>(createFootTrack());
  const rightFootTrack = useRef<FootTrackState>(createFootTrack());
  const leftFootEstimator = useRef(new FootEstimator());
  const rightFootEstimator = useRef(new FootEstimator());

  const trunkLeanSumRef = useRef(0);
  const trunkLeanSamplesRef = useRef(0);

  const [directionScores, setDirectionScores] = useState<DirectionScore[]>(
    SEBT_DIRECTIONS.map(d => ({
      key: d.key, label: d.label, short: d.short, detected: false,
      maxReach: 0, maxReachCm: 0, bestContact: null,
      contactCount: 0, hardTouchCount: 0,
      stability: 0, reachScore: 0, status: 'fail' as const,
      zScore: 0, percentile: 0, band: 'average' as const,
      normative: { mean: NORMATIVE_REACH[d.key].mean, sd: NORMATIVE_REACH[d.key].sd },
      measurementConfidence: 1,
    }))
  );
  const [contactLog, setContactLog] = useState<ContactEvent[]>([]);
  const [occlusionStats, setOcclusionStats] = useState({
    leftOcc: 0, rightOcc: 0, leftEst: 0, rightEst: 0,
    leftMaxStreak: 0, rightMaxStreak: 0, leftEvents: 0, rightEvents: 0,
  });
  const contactLogRef = useRef<ContactEvent[]>([]);

  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const legLengthCmRef = useRef(0);
  const [legLengthCm, setLegLengthCmState] = useState('');
  const setLegLengthCm = (v: string) => { setLegLengthCmState(v); legLengthCmRef.current = parseFloat(v) || 0; };

  const emptyScores = () => SEBT_DIRECTIONS.map(d => ({
    key: d.key, label: d.label, short: d.short, detected: false,
    maxReach: 0, maxReachCm: 0, bestContact: null,
    contactCount: 0, hardTouchCount: 0,
    stability: 0, reachScore: 0, status: 'fail' as const,
    zScore: 0, percentile: 0, band: 'average' as const,
    normative: { mean: NORMATIVE_REACH[d.key].mean, sd: NORMATIVE_REACH[d.key].sd },
    measurementConfidence: 1,
  }));

  const loadModel = useCallback(async () => {
    if (landmarkerRef.current || modelLoading) return;
    setModelLoading(true);
    setModelError(false);
    try {
      const wasmUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
      const vision = await FilesetResolver.forVisionTasks(wasmUrl);
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: resolveAppUrl(MODEL_PATHS[modelQuality]),
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      landmarkerRef.current = landmarker;
      setModelReady(true);
    } catch (err) {
      logger.error('Failed to load model:', String(err));
      setModelError(true);
      toast('Failed to load pose model. Check internet connection.');
    } finally {
      setModelLoading(false);
    }
  }, [modelLoading, modelQuality]);

  const resetAnalysis = useCallback(() => {
    const video = videoRef.current;
    if (video) { video.pause(); video.currentTime = 0; }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (uiTimerRef.current) { clearInterval(uiTimerRef.current); uiTimerRef.current = null; }

    setFrameCount(0); setMissingStats({}); setDetectedFrames({}); setKeypoints([]);
    setContactLog([]); setIsPlaying(false);

    frameCountRef.current = 0;
    missingStatsRef.current = {};
    detectedFramesRef.current = {};
    latestKeypointsRef.current = [];
    contactLogRef.current = [];
    swayDataRef.current = [];
    legLengthRef.current = 0.1;
    floorYRef.current = 0;
    floorCalibratedRef.current = false;
    floorCalibrationFrames.current = [];
    leftAnkleHistory.current = [];
    rightAnkleHistory.current = [];
    stanceFootRef.current = null;
    stanceHeelLiftRef.current = 0;
    stanceMoveSumRef.current = 0;
    stanceMoveSamplesRef.current = 0;
    trunkLeanSumRef.current = 0;
    trunkLeanSamplesRef.current = 0;
    leftFootTrack.current = createFootTrack();
    rightFootTrack.current = createFootTrack();
    leftFootEstimator.current.reset();
    rightFootEstimator.current.reset();
    smootherRef.current.reset();
    worldSmootherRef.current.reset();
    legLengthCalibRef.current = [];
    calibratedLegLengthRef.current = 0;
    stanceOriginXRef.current = 0;
    stanceOriginYRef.current = 0;
    worldLegLenRef.current = 0;
    worldStanceAnkleRef.current = null;
    worldLegLenSamplesRef.current = [];
    worldAnkleXSamplesRef.current = [];
    worldAnkleYSamplesRef.current = [];
    worldAnkleZSamplesRef.current = [];
    worldCalibLockedRef.current = false;
    worldAnkleLockedRef.current = false;
    dirObservedFramesRef.current = {};

    maxReachRef.current = Object.fromEntries(SEBT_DIRECTIONS.map(d => [d.key, 0])) as Record<DirectionKey, number>;
    bestContactRef.current = Object.fromEntries(SEBT_DIRECTIONS.map(d => [d.key, null])) as Record<DirectionKey, ContactEvent | null>;
    contactCountRef.current = Object.fromEntries(SEBT_DIRECTIONS.map(d => [d.key, 0])) as Record<DirectionKey, number>;
    hardTouchCountRef.current = Object.fromEntries(SEBT_DIRECTIONS.map(d => [d.key, 0])) as Record<DirectionKey, number>;
    setDirectionScores(emptyScores());

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  /** Load a new video file (used by New Session button too) */
  const handleFile = (file: File) => {
    if (!file.type.startsWith('video/')) { toast('Please select a video file.'); return; }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    setVideoName(file.name);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoUrl(url);
    resetAnalysis();
    loadModel();
  };

  const startNewSession = () => {
    // Tear down current video
    const video = videoRef.current;
    if (video) video.pause();
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    setVideoUrl(null);
    setVideoName('');
    resetAnalysis();
    // Trigger file picker
    setTimeout(() => fileInputRef.current?.click(), 100);
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const processAndDraw = useCallback((result: PoseLandmarkerResult, width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!result.landmarks || result.landmarks.length === 0) return;
    const now = performance.now();

    const rawLm = result.landmarks[0];
    const lm = smootherRef.current.smooth(rawLm, now);

    // World landmarks (3D, meters) — used for accurate reach measurement
    const rawW = result.worldLandmarks?.[0];
    const w = rawW ? worldSmootherRef.current.smooth(rawW, now) : null;

    // Draw skeleton
    ctx.lineWidth = 3;
    SKELETON.forEach(([a, b]) => {
      const pA = lm[a], pB = lm[b];
      if (!pA || !pB) return;
      const avgConf = ((pA.visibility ?? 0.5) + (pB.visibility ?? 0.5)) / 2;
      ctx.strokeStyle = avgConf >= 0.5 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.5)';
      ctx.beginPath();
      ctx.moveTo(pA.x * width, pA.y * height);
      ctx.lineTo(pB.x * width, pB.y * height);
      ctx.stroke();
    });

    // Keypoints
    const kps = KEYPOINT_NAMES.map((name) => ({ name, x: 0, y: 0, confidence: 0 }));
    for (const [bpStr, kpIdx] of Object.entries(BLAZEPOSE_TO_KP)) {
      const pt = lm[parseInt(bpStr, 10)];
      if (!pt) continue;
      const conf = pt.visibility ?? 0.5;
      kps[kpIdx] = { name: KEYPOINT_NAMES[kpIdx], x: pt.x, y: pt.y, confidence: conf };
      ctx.fillStyle = conf >= 0.7 ? '#22c55e' : conf >= 0.3 ? '#eab308' : '#ef4444';
      ctx.beginPath();
      ctx.arc(pt.x * width, pt.y * height, (kpIdx === 19 || kpIdx === 20) ? 7 : (conf >= 0.3 ? 5 : 3), 0, Math.PI * 2);
      ctx.fill();
    }
    latestKeypointsRef.current = kps;
    frameCountRef.current++;
    kps.forEach(k => {
      if (k.confidence < 0.3) missingStatsRef.current[k.name] = (missingStatsRef.current[k.name] || 0) + 1;
      else detectedFramesRef.current[k.name] = (detectedFramesRef.current[k.name] || 0) + 1;
    });

    const lHip = lm[23], rHip = lm[24];
    const lKnee = lm[25], rKnee = lm[26];
    const lAnkle = lm[27], rAnkle = lm[28];
    const lHeel = lm[29], rHeel = lm[30];
    const lToe = lm[31], rToe = lm[32];
    const lShoulder = lm[11], rShoulder = lm[12];
    if (!lHip || !rHip || (lHip.visibility ?? 0) < 0.3 || (rHip.visibility ?? 0) < 0.3) return;

    // ── Body axes (image-space) ──
    const hipDx = lHip.x - rHip.x, hipDy = lHip.y - rHip.y;
    const hipLen = Math.max(Math.hypot(hipDx, hipDy), 0.001);
    const mlX = hipDx / hipLen, mlY = hipDy / hipLen;
    const apX = -mlY, apY = mlX;

    // ── Stance leg ──
    const manualStance = sessionRef.current.stanceLeg;
    let effectiveStance: 'left' | 'right' | null = null;
    if (manualStance !== 'auto') {
      effectiveStance = manualStance;
    } else {
      if (lAnkle && (lAnkle.visibility ?? 0) >= 0.3) {
        leftAnkleHistory.current.push({ x: lAnkle.x, y: lAnkle.y });
        if (leftAnkleHistory.current.length > 45) leftAnkleHistory.current.shift();
      }
      if (rAnkle && (rAnkle.visibility ?? 0) >= 0.3) {
        rightAnkleHistory.current.push({ x: rAnkle.x, y: rAnkle.y });
        if (rightAnkleHistory.current.length > 45) rightAnkleHistory.current.shift();
      }
      if (!stanceFootRef.current || frameCountRef.current % 60 === 0) {
        if (leftAnkleHistory.current.length >= 20 && rightAnkleHistory.current.length >= 20) {
          const variance = (h: { x: number; y: number }[]) => {
            const mx = h.reduce((s, p) => s + p.x, 0) / h.length;
            const my = h.reduce((s, p) => s + p.y, 0) / h.length;
            return h.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / h.length;
          };
          stanceFootRef.current = variance(leftAnkleHistory.current) < variance(rightAnkleHistory.current) ? 'left' : 'right';
        }
      }
      effectiveStance = stanceFootRef.current;
    }
    stanceFootRef.current = effectiveStance;

    const lateralSign = effectiveStance === 'right' ? 1 : effectiveStance === 'left' ? -1 : 1;
    const apFlip = sessionRef.current.apFlip ? -1 : 1;
    const axes: BodyAxes = { mlX, mlY, apX, apY, lateralSign, apFlip };

    // ── 3D world-coordinate leg length (meters) — stance leg preferred ──
    let worldLegLen = 0;
    if (w && w[23] && w[24] && w[25] && w[26] && w[27] && w[28]) {
      const wl = Math.hypot(w[25].x - w[23].x, w[25].y - w[23].y, (w[25].z ?? 0) - (w[23].z ?? 0)) +
                 Math.hypot(w[27].x - w[25].x, w[27].y - w[25].y, (w[27].z ?? 0) - (w[25].z ?? 0));
      const rl = Math.hypot(w[26].x - w[24].x, w[26].y - w[24].y, (w[26].z ?? 0) - (w[24].z ?? 0)) +
                 Math.hypot(w[28].x - w[26].x, w[28].y - w[26].y, (w[28].z ?? 0) - (w[26].z ?? 0));
      // Use the stance leg when known; that is the reach reference limb.
      worldLegLen = effectiveStance === 'left' ? wl : effectiveStance === 'right' ? rl : Math.max(wl, rl);
    }
    // Collect samples during calibration window, lock to median once enough.
    if (worldLegLen > 0.05 && frameCountRef.current <= 45) {
      worldLegLenSamplesRef.current.push(worldLegLen);
    }
    if (!worldCalibLockedRef.current && worldLegLenSamplesRef.current.length >= 15) {
      const sorted = [...worldLegLenSamplesRef.current].sort((a, b) => a - b);
      worldLegLenRef.current = sorted[Math.floor(sorted.length / 2)];
      worldCalibLockedRef.current = true;
    } else if (!worldCalibLockedRef.current && worldLegLen > 0.05) {
      worldLegLenRef.current = worldLegLen;
    }
    // Calibrate image-space leg length too
    let legLen = 0;
    if (lKnee && lAnkle && (lKnee.visibility ?? 0) >= 0.3 && (lAnkle.visibility ?? 0) >= 0.3)
      legLen = Math.hypot(lKnee.x - lHip.x, lKnee.y - lHip.y) + Math.hypot(lAnkle.x - lKnee.x, lAnkle.y - lKnee.y);
    if (rKnee && rAnkle && (rKnee.visibility ?? 0) >= 0.3 && (rAnkle.visibility ?? 0) >= 0.3) {
      const rLen = Math.hypot(rKnee.x - rHip.x, rKnee.y - rHip.y) + Math.hypot(rAnkle.x - rKnee.x, rAnkle.y - rKnee.y);
      legLen = Math.max(legLen, rLen);
    }
    if (legLen > 0.05 && frameCountRef.current <= 30) legLengthCalibRef.current.push(legLen);
    if (calibratedLegLengthRef.current === 0 && legLengthCalibRef.current.length >= 10) {
      const sorted = [...legLengthCalibRef.current].sort((a, b) => a - b);
      calibratedLegLengthRef.current = sorted[Math.floor(sorted.length / 2)];
    }
    const refLen = calibratedLegLengthRef.current > 0 ? calibratedLegLengthRef.current : (legLen > 0.05 ? legLen : legLengthRef.current);
    if (calibratedLegLengthRef.current === 0 && legLen > 0.05) legLengthRef.current = Math.max(legLengthRef.current, legLen);
    const legCmValue = legLengthCmRef.current;

    // ── 3D world-coordinate stance ankle (reach origin) — locked median ──
    if (w && effectiveStance) {
      const wAnkle = effectiveStance === 'left' ? w[27] : w[28];
      if (wAnkle) {
        if (!worldCalibLockedRef.current && frameCountRef.current <= 45) {
          worldAnkleXSamplesRef.current.push(wAnkle.x);
          worldAnkleYSamplesRef.current.push(wAnkle.y);
          worldAnkleZSamplesRef.current.push(wAnkle.z ?? 0);
        }
        if (!worldStanceAnkleRef.current) {
          worldStanceAnkleRef.current = { x: wAnkle.x, y: wAnkle.y, z: wAnkle.z ?? 0 };
        } else if (!worldCalibLockedRef.current) {
          // Slow EMA during calibration
          worldStanceAnkleRef.current.x = worldStanceAnkleRef.current.x * 0.95 + wAnkle.x * 0.05;
          worldStanceAnkleRef.current.y = worldStanceAnkleRef.current.y * 0.95 + wAnkle.y * 0.05;
          worldStanceAnkleRef.current.z = worldStanceAnkleRef.current.z * 0.95 + (wAnkle.z ?? 0) * 0.05;
        }
        // Once locked, the origin stays fixed (set below when leg length locks)
      }
    }
    // Lock stance ankle origin to median when leg-length calibration locks
    if (worldCalibLockedRef.current && !worldAnkleLockedRef.current &&
        worldAnkleXSamplesRef.current.length >= 15 && worldStanceAnkleRef.current) {
      const med = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
      worldStanceAnkleRef.current = {
        x: med(worldAnkleXSamplesRef.current),
        y: med(worldAnkleYSamplesRef.current),
        z: med(worldAnkleZSamplesRef.current),
      };
      worldAnkleLockedRef.current = true;
    }

    // ── Floor detection (image-space, for contact timing) ──
    const floorSamples: number[] = [];
    if (lHeel && (lHeel.visibility ?? 0) >= 0.3 && lHeel.y > 0) floorSamples.push(lHeel.y);
    if (rHeel && (rHeel.visibility ?? 0) >= 0.3 && rHeel.y > 0) floorSamples.push(rHeel.y);
    if (lToe && (lToe.visibility ?? 0) >= 0.3 && lToe.y > 0) floorSamples.push(lToe.y);
    if (rToe && (rToe.visibility ?? 0) >= 0.3 && rToe.y > 0) floorSamples.push(rToe.y);
    if (frameCountRef.current < 30) floorCalibrationFrames.current.push(...floorSamples);
    if (!floorCalibratedRef.current && floorCalibrationFrames.current.length >= 10) {
      const sorted = [...floorCalibrationFrames.current].sort((a, b) => a - b);
      floorYRef.current = sorted[Math.floor(sorted.length / 2)];
      floorCalibratedRef.current = true;
    }
    if (floorCalibratedRef.current) {
      const lowestY = floorSamples.length > 0 ? Math.max(...floorSamples) : 0;
      if (lowestY > 0) floorYRef.current = floorYRef.current * 0.995 + lowestY * 0.005;
    }

    if (floorCalibratedRef.current) {
      const fy = floorYRef.current * height;
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(width, fy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.7)';
      ctx.font = 'bold 11px system-ui';
      ctx.fillText('FLOOR', 8, fy - 5);
    }

    // ── CoM sway ──
    const comX = (lHip.x + rHip.x) / 2, comY = (lHip.y + rHip.y) / 2;
    swayDataRef.current.push({ comX, comY, timestamp: now });
    if (swayDataRef.current.length > 600) swayDataRef.current.shift();

    // ── Stance stability ──
    if (effectiveStance) {
      const stanceAnkle = effectiveStance === 'left' ? lAnkle : rAnkle;
      const stanceHeel = effectiveStance === 'left' ? lHeel : rHeel;
      if (stanceAnkle && (stanceAnkle.visibility ?? 0) >= 0.3) {
        const hist = effectiveStance === 'left' ? leftAnkleHistory.current : rightAnkleHistory.current;
        if (hist.length >= 10) {
          const mx = hist.reduce((s, p) => s + p.x, 0) / hist.length;
          const my = hist.reduce((s, p) => s + p.y, 0) / hist.length;
          stanceMoveSumRef.current += Math.hypot(stanceAnkle.x - mx, stanceAnkle.y - my);
          stanceMoveSamplesRef.current++;
        }
        if (stanceHeel && (stanceHeel.visibility ?? 0) >= 0.3 && floorCalibratedRef.current) {
          const heelLift = floorYRef.current - stanceHeel.y;
          if (heelLift > 0.02) stanceHeelLiftRef.current = Math.max(stanceHeelLiftRef.current, heelLift);
        }
      }
    }

    // Trunk lean
    if (lShoulder && rShoulder && (lShoulder.visibility ?? 0) >= 0.3 && (rShoulder.visibility ?? 0) >= 0.3) {
      trunkLeanSumRef.current += Math.abs((lShoulder.x + rShoulder.x) / 2 - comX);
      trunkLeanSamplesRef.current++;
    }

    // ── Reach origin (image-space, EMA stance ankle) ──
    let originX = comX, originY = comY;
    if (effectiveStance) {
      const sa = effectiveStance === 'left' ? lAnkle : rAnkle;
      if (sa && (sa.visibility ?? 0) >= 0.3) {
        if (stanceOriginXRef.current === 0 && stanceOriginYRef.current === 0) {
          stanceOriginXRef.current = sa.x; stanceOriginYRef.current = sa.y;
        } else {
          stanceOriginXRef.current = stanceOriginXRef.current * 0.95 + sa.x * 0.05;
          stanceOriginYRef.current = stanceOriginYRef.current * 0.95 + sa.y * 0.05;
        }
        originX = stanceOriginXRef.current; originY = stanceOriginYRef.current;
      }
    }

    // ── Contact detection ──
    const recordContact = (ev: ContactEvent) => {
      contactLogRef.current.push(ev);
      if (contactLogRef.current.length > 50) contactLogRef.current.shift();
      contactCountRef.current[ev.direction]++;
      if (ev.touchType === 'hard') hardTouchCountRef.current[ev.direction]++;
      const existing = bestContactRef.current[ev.direction];
      if (!existing || ev.reachRatio > existing.reachRatio ||
          (ev.reachRatio >= existing.reachRatio * 0.95 && ev.contactQuality > existing.contactQuality)) {
        bestContactRef.current[ev.direction] = ev;
      }
      if (ev.reachRatio > maxReachRef.current[ev.direction]) maxReachRef.current[ev.direction] = ev.reachRatio;
    };

    // ── Toe estimation (Kalman + kinematic chain) + contact detection ──
    const processToe = (
      toeImg: { x: number; y: number; visibility?: number } | undefined,
      toeW: { x: number; y: number; z?: number } | undefined,
      ankleImg: { x: number; y: number; visibility?: number } | undefined,
      ankleW: { x: number; y: number; z?: number } | undefined,
      estimator: FootEstimator,
      track: FootTrackState,
    ) => {
      const est = estimator.update(
        toeImg, toeW, toeImg?.visibility ?? 0,
        ankleImg, ankleW, ankleImg?.visibility ?? 0,
        now,
      );
      if (est.confidence < 0.12) return null;

      // 3D world-coordinate reach (horizontal floor-plane), fall back to 2D
      let reachRatio = 0;
      let used3D = false;
      if (worldStanceAnkleRef.current && worldLegLenRef.current >= 0.05 && estimator.has3D) {
        const dx = est.worldX - worldStanceAnkleRef.current.x;
        const dz = est.worldZ - worldStanceAnkleRef.current.z;
        reachRatio = Math.hypot(dx, dz) / worldLegLenRef.current;
        used3D = true;
      }
      if (reachRatio < REACH_MIN_RATIO) {
        const dx = est.imgX - originX, dy = est.imgY - originY;
        reachRatio = Math.hypot(dx, dy) / refLen;
        used3D = false;
      }

      const dx = est.imgX - originX, dy = est.imgY - originY;
      const dir = classifyDirection(dx, dy, axes);

      // Direction projection validation: project reach onto the expected
      // direction axis. If the foot is reaching but mostly perpendicular to
      // the classified direction, damp the ratio to avoid over-crediting.
      const dirDef = SEBT_DIRECTIONS.find(d => d.key === dir);
      if (dirDef && reachRatio > REACH_MIN_RATIO) {
        const reachAngle = dirDef.angle * Math.PI / 180;
        // Expected unit vector in body-relative space
        const expLat = Math.sin(reachAngle) * axes.lateralSign;
        const expAp = Math.cos(reachAngle) * axes.apFlip;
        // Actual components
        const mlComp = dx * axes.mlX + dy * axes.mlY;
        const apComp = dx * axes.apX + dy * axes.apY;
        const reachMag = Math.hypot(mlComp, apComp) || 1;
        const proj = (mlComp * expLat + apComp * expAp) / reachMag;
        // proj ranges -1..1; only credit the forward-aligned component
        const alignment = Math.max(0.5, proj);
        reachRatio *= alignment;
      }

      // Track per-direction observation ratio
      if (reachRatio > REACH_MIN_RATIO) {
        const slot = dirObservedFramesRef.current[dir] || { observed: 0, total: 0 };
        slot.total++;
        if (est.wasObserved) slot.observed++;
        dirObservedFramesRef.current[dir] = slot;
      }

      const ev = trackFoot(track, est.imgY, est.confidence, est.wasObserved,
        reachRatio, dir, floorYRef.current, refLen, legCmValue, now);
      if (ev) {
        // Attach 3D flag and per-direction confidence
        (ev as any).used3D = used3D;
        recordContact(ev);
      }
      return est;
    };

    const leftEst = effectiveStance !== 'left'
      ? processToe(lToe, w?.[31], lAnkle, w?.[27], leftFootEstimator.current, leftFootTrack.current)
      : null;
    const rightEst = effectiveStance !== 'right'
      ? processToe(rToe, w?.[32], rAnkle, w?.[28], rightFootEstimator.current, rightFootTrack.current)
      : null;

    // ── Draw stance highlight ──
    if (effectiveStance) {
      const sa = effectiveStance === 'left' ? lAnkle : rAnkle;
      if (sa) {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(sa.x * width, sa.y * height, 14, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
        ctx.font = 'bold 11px system-ui';
        ctx.fillText('STANCE', sa.x * width + 16, sa.y * height + 4);
      }
    }

    // ── Draw reach vector + estimated toe marker ──
    const reachEst = effectiveStance === 'left' ? rightEst : effectiveStance === 'right' ? leftEst : null;
    if (reachEst && reachEst.confidence >= 0.15) {
      const dx = reachEst.imgX - originX, dy = reachEst.imgY - originY;
      if (Math.hypot(dx, dy) / refLen > REACH_MIN_RATIO) {
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(originX * width, originY * height);
        ctx.lineTo(reachEst.imgX * width, reachEst.imgY * height);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Draw estimated toe: hollow orange ring when occluded, filled violet when observed
      if (reachEst.wasEstimated) {
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(reachEst.imgX * width, reachEst.imgY * height, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(249, 115, 22, 0.3)';
        ctx.fill();
      }
    }
  }, []);

  const updateDirectionScores = useCallback(() => {
    const maxReaches = maxReachRef.current;
    const swayData = swayDataRef.current;
    const contacts = bestContactRef.current;
    const contactCounts = contactCountRef.current;
    const hardCounts = hardTouchCountRef.current;
    const legCm = legLengthCmRef.current;

    let stability = 100;
    if (swayData.length > 10) {
      let sumX = 0, sumY = 0;
      swayData.forEach(d => { sumX += d.comX; sumY += d.comY; });
      const meanX = sumX / swayData.length, meanY = sumY / swayData.length;
      let variance = 0;
      swayData.forEach(d => { variance += Math.hypot(d.comX - meanX, d.comY - meanY); });
      variance /= swayData.length;
      stability = Math.round(100 * (1 - Math.min(1, variance / 0.04)));
      stability = Math.max(0, Math.min(100, stability));
    }

    const scores: DirectionScore[] = SEBT_DIRECTIONS.map(d => {
      const reach = maxReaches[d.key] || 0;
      const contact = contacts[d.key];
      const reachScore = Math.round(Math.min(110, reach * 100));
      let status: 'good' | 'partial' | 'fail' = 'fail';
      if (reach >= 0.8 && (!contact || contact.contactQuality >= 50)) status = 'good';
      else if (reach >= 0.5) status = 'partial';
      const cm = legCm > 0 ? Math.round(reach * legCm * 10) / 10 : 0;
      const norm = NORMATIVE_REACH[d.key];
      // Measurement confidence: from best contact event, or from frame tracking
      const measConf = contact?.measurementConfidence
        ?? (() => {
          const slot = dirObservedFramesRef.current[d.key];
          return slot && slot.total > 0 ? slot.observed / slot.total : 1;
        })();
      return {
        key: d.key, label: d.label, short: d.short,
        detected: reach > REACH_MIN_RATIO,
        maxReach: reach, maxReachCm: cm,
        bestContact: contact,
        contactCount: contactCounts[d.key] || 0,
        hardTouchCount: hardCounts[d.key] || 0,
        stability, reachScore, status,
        zScore: +zScore(reach, d.key).toFixed(2),
        percentile: percentileEstimate(reach, d.key),
        band: clinicalBand(reach, d.key),
        normative: { mean: norm.mean, sd: norm.sd },
        measurementConfidence: Math.round(measConf * 100) / 100,
      };
    });
    setDirectionScores(scores);
    setContactLog([...contactLogRef.current].reverse());
  }, []);

  const flushUiState = useCallback(() => {
    setKeypoints([...latestKeypointsRef.current]);
    setFrameCount(frameCountRef.current);
    setMissingStats({ ...missingStatsRef.current });
    setDetectedFrames({ ...detectedFramesRef.current });
    setOcclusionStats({
      leftOcc: leftFootEstimator.current.occlusionPercent,
      rightOcc: rightFootEstimator.current.occlusionPercent,
      leftEst: leftFootEstimator.current.estimatedPercent,
      rightEst: rightFootEstimator.current.estimatedPercent,
      leftMaxStreak: leftFootEstimator.current.maxOcclusionStreak,
      rightMaxStreak: rightFootEstimator.current.maxOcclusionStreak,
      leftEvents: leftFootEstimator.current.occlusionEventCount,
      rightEvents: rightFootEstimator.current.occlusionEventCount,
    });
    updateDirectionScores();
  }, [updateDirectionScores]);

  const detectLoop = useCallback(() => {
    const video = videoRef.current, canvas = canvasRef.current, landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.paused || video.ended) return;
    if (video.readyState >= 2) {
      const result = landmarker.detectForVideo(video, performance.now());
      processAndDraw(result, canvas.width, canvas.height);
    }
    rafRef.current = requestAnimationFrame(detectLoop);
  }, [processAndDraw]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => {
      setIsPlaying(true);
      if (landmarkerRef.current) {
        rafRef.current = requestAnimationFrame(detectLoop);
        uiTimerRef.current = setInterval(flushUiState, 200);
      }
    };
    const onPause = () => {
      setIsPlaying(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (uiTimerRef.current) { clearInterval(uiTimerRef.current); uiTimerRef.current = null; }
      flushUiState();
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onPause);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (uiTimerRef.current) clearInterval(uiTimerRef.current);
    };
  }, [detectLoop, flushUiState, videoUrl]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate, videoUrl]);

  const handleLoadedMetadata = () => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play(); else video.pause();
  };

  // ── Exports ─────────────────────────────────────────────────────────────
  const buildExportBase = () => ({
    session: { ...session, date: new Date().toISOString(), videoFile: videoName, legLengthCm: legLengthCmRef.current || null },
    normativeDataset: DATASET_CITATION,
    framesProcessed: frameCountRef.current,
    measurementMethod: '3D world landmarks (MediaPipe) horizontal floor-plane distance, normalized to 3D stance-leg length; trimmed-mean peak over contact frames; direction-aligned projection',
    occlusion: {
      leftToeOccludedPct: leftFootEstimator.current.occlusionPercent,
      rightToeOccludedPct: rightFootEstimator.current.occlusionPercent,
      maxOcclusionStreakFrames: Math.max(leftFootEstimator.current.maxOcclusionStreak, rightFootEstimator.current.maxOcclusionStreak),
      occlusionEvents: Math.max(leftFootEstimator.current.occlusionEventCount, rightFootEstimator.current.occlusionEventCount),
    },
  });

  const exportCSV = () => {
    const rows: string[] = [];
    rows.push('SEBT Clinical Analysis Report');
    rows.push(`Participant ID,${session.patientId}`);
    rows.push(`Age,${session.age}`);
    rows.push(`Sex,${session.sex}`);
    rows.push(`Stance Leg,${session.stanceLeg}`);
    rows.push(`Trial,${session.trial}`);
    rows.push(`Tester,${session.tester}`);
    rows.push(`Date,${new Date().toISOString()}`);
    rows.push(`Video,${videoName}`);
    rows.push(`Leg Length (cm),${legLengthCmRef.current || 'not calibrated'}`);
    rows.push(`Measurement,3D world-coordinate horizontal reach / leg length`);
    rows.push(`Normative Dataset,${DATASET_CITATION.name} (${DATASET_CITATION.subjects} subjects)`);
    rows.push('');
    rows.push('Direction,Reach Ratio,Reach (cm),Reach Score,Contact Type,Contact Quality,Impact Velocity,Bounce,Contacts,Hard Touches,Status,Z-Score,Percentile,Norm Mean,Norm SD,Measurement Confidence');
    directionScores.forEach(d => {
      rows.push([
        d.label, d.maxReach.toFixed(3), d.maxReachCm || '', d.reachScore,
        d.bestContact?.touchType || 'none', d.bestContact?.contactQuality ?? '',
        d.bestContact?.impactVelocity ?? '', d.bestContact?.bounce ?? '',
        d.contactCount, d.hardTouchCount, d.status,
        d.zScore, d.percentile, d.normative.mean, d.normative.sd,
        Math.round(d.measurementConfidence * 100) + '%',
      ].join(','));
    });
    rows.push('');
    rows.push('Overall');
    rows.push(`Total Score,${overallScores.totalScore}`);
    rows.push(`Reach Score,${overallScores.avgReach}`);
    rows.push(`Balance Score,${overallScores.balanceScore}`);
    rows.push(`Contact Quality,${overallScores.contactQuality}`);
    rows.push(`Form Score,${overallScores.formScore}`);
    rows.push(`Success Rate,${overallScores.successRate}%`);
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sebt-${session.patientId || 'report'}-trial${session.trial || '1'}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast('CSV exported.');
  };

  const exportJSON = () => {
    const data = {
      ...buildExportBase(),
      overall: overallScores,
      perDirection: directionScores.map(d => ({
        direction: d.label, maxReachRatio: d.maxReach, maxReachCm: d.maxReachCm || null,
        reachScore: d.reachScore, status: d.status,
        zScore: d.zScore, percentile: d.percentile, band: d.band,
        normativeRange: d.normative,
        bestContact: d.bestContact ? {
          touchType: d.bestContact.touchType, contactQuality: d.bestContact.contactQuality,
          impactVelocity: d.bestContact.impactVelocity, bounce: d.bestContact.bounce,
        } : null,
        contactCount: d.contactCount, hardTouchCount: d.hardTouchCount,
        measurementConfidence: d.measurementConfidence,
      })),
      contactEvents: contactLogRef.current,
      formFaults: {
        stanceFootMovement: stanceMoveSamplesRef.current > 0 ? +(stanceMoveSumRef.current / stanceMoveSamplesRef.current).toFixed(4) : 0,
        stanceHeelLift: +stanceHeelLiftRef.current.toFixed(4),
        trunkLean: trunkLeanSamplesRef.current > 0 ? +(trunkLeanSumRef.current / trunkLeanSamplesRef.current).toFixed(4) : 0,
      },
      occlusion: {
        leftToeOccludedPct: leftFootEstimator.current.occlusionPercent,
        rightToeOccludedPct: rightFootEstimator.current.occlusionPercent,
        leftToeEstimatedPct: leftFootEstimator.current.estimatedPercent,
        rightToeEstimatedPct: rightFootEstimator.current.estimatedPercent,
        method: 'Kalman filter (constant-velocity) + kinematic chain (ankle + calibrated foot vector)',
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sebt-${session.patientId || 'report'}-trial${session.trial || '1'}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast('JSON exported.');
  };

  const keypointRows = KEYPOINT_NAMES.map((name, i) => {
    const kp = keypoints[i];
    const conf = kp?.confidence ?? 0;
    const missing = missingStats[name] || 0;
    const detected = detectedFrames[name] || 0;
    const total = detected + missing;
    const missingPct = total > 0 ? Math.round((missing / total) * 100) : 0;
    return { name, conf, missingPct };
  });

  const overallScores = useMemo(() => {
    const total = SEBT_DIRECTIONS.length;
    const succeeded = directionScores.filter(d => d.status === 'good' || d.status === 'partial').length;
    const successRate = Math.round((succeeded / total) * 100);
    const avgReach = directionScores.length > 0
      ? Math.round(directionScores.reduce((s, d) => s + d.reachScore, 0) / directionScores.length) : 0;
    const balanceScore = directionScores.length > 0 ? directionScores[0].stability : 0;
    const contactDirs = directionScores.filter(d => d.bestContact);
    const contactQuality = contactDirs.length > 0
      ? Math.round(contactDirs.reduce((s, d) => s + (d.bestContact?.contactQuality ?? 0), 0) / contactDirs.length) : 0;
    const stanceMoveAvg = stanceMoveSamplesRef.current > 0 ? stanceMoveSumRef.current / stanceMoveSamplesRef.current : 0;
    const trunkLeanAvg = trunkLeanSamplesRef.current > 0 ? trunkLeanSumRef.current / trunkLeanSamplesRef.current : 0;
    const formPenalty = Math.min(60,
      Math.min(20, stanceMoveAvg / 0.02 * 20) +
      Math.min(25, (stanceHeelLiftRef.current / 0.05) * 25) +
      Math.min(15, (trunkLeanAvg / 0.08) * 15));
    const formScore = Math.round(Math.max(0, 100 - formPenalty));
    const totalScore = Math.round(avgReach * 0.35 + balanceScore * 0.25 + contactQuality * 0.20 + formScore * 0.20);
    const pass = successRate >= 60 && balanceScore >= 50 && totalScore >= 55;
    return { successRate, failRate: 100 - successRate, avgReach, balanceScore, contactQuality, formScore, totalScore, pass };
  }, [directionScores, frameCount]);

  const hasData = frameCount > 0;

  // Radar
  const radarSize = 240, radarCenter = radarSize / 2, radarMaxR = 82;
  const radarPoints = SEBT_DIRECTIONS.map((d, i) => {
    const angle = (d.angle - 90) * (Math.PI / 180);
    const score = directionScores[i]?.maxReach ?? 0;
    const r = Math.min(score, 1.2) * radarMaxR;
    return {
      x: radarCenter + r * Math.cos(angle), y: radarCenter + r * Math.sin(angle),
      lx: radarCenter + (radarMaxR + 18) * Math.cos(angle),
      ly: radarCenter + (radarMaxR + 18) * Math.sin(angle),
      label: d.short, ratio: score,
    };
  });
  const radarPolygon = radarPoints.map(p => `${p.x},${p.y}`).join(' ');
  // Normative band polygon (mean values)
  const normPolygon = SEBT_DIRECTIONS.map((d) => {
    const angle = (d.angle - 90) * (Math.PI / 180);
    const r = Math.min(NORMATIVE_REACH[d.key].mean, 1.2) * radarMaxR;
    return `${radarCenter + r * Math.cos(angle)},${radarCenter + r * Math.sin(angle)}`;
  }).join(' ');

  const bandColor = (band: string) =>
    band === 'below-average' ? 'text-red-600 bg-red-50'
    : band === 'above-average' ? 'text-emerald-600 bg-emerald-50'
    : 'text-blue-600 bg-blue-50';

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50/30 text-slate-900 print:bg-white">
      <input ref={fileInputRef} type="file" accept="video/*" onChange={onFileInput} className="hidden" />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-md print:static print:border-0 print:bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ rotate: 12, scale: 1.08 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
              className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-200">
              <Activity className="size-5" />
            </motion.div>
            <div>
              <h1 className="text-base font-bold leading-tight tracking-tight">SEBT Clinical Analysis System</h1>
              <p className="text-[11px] text-slate-500">Mae Fah Luang University</p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            {videoUrl && (
              <motion.button onClick={startNewSession}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
                <FileUp className="size-4" /> New Session
              </motion.button>
            )}
            <span className="hidden rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500 md:inline">v2.1</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 py-6 print:max-w-none print:px-0 print:py-0">
        {/* ── Upload screen ── */}
        {!videoUrl && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-2xl pt-8"
          >
            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
              <div className="mb-6 text-center">
                <motion.div
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.15 }}
                  className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-200"
                >
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Footprints className="size-8" />
                  </motion.div>
                </motion.div>
                <motion.h2
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-xl font-bold tracking-tight"
                >
                  Star Excursion Balance Test
                </motion.h2>
              </div>

              {/* Camera setup visual */}
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => setShowCameraGuide(!showCameraGuide)}
                className="mb-5 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
              >
                <div className="flex items-center gap-2.5">
                  <motion.span animate={{ rotate: showCameraGuide ? [0, -10, 10, 0] : 0 }} transition={{ duration: 0.4 }}>
                    <Camera className="size-4 text-blue-600" />
                  </motion.span>
                  <span className="text-sm font-medium text-slate-700">Camera setup instructions</span>
                </div>
                <motion.span
                  animate={{ rotate: showCameraGuide ? 180 : 0 }}
                  transition={{ duration: 0.25 }}
                  className="text-xs text-blue-600"
                >
                  {showCameraGuide ? 'Hide' : 'Show'}
                </motion.span>
              </motion.button>

              <AnimatePresence initial={false}>
                {showCameraGuide && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        {/* SVG diagram */}
                        <div className="flex items-center justify-center">
                          <svg viewBox="0 0 240 160" className="w-full max-w-[240px]">
                            <line x1="20" y1="130" x2="220" y2="130" stroke="#94a3b8" strokeWidth="1.5" />
                            <text x="120" y="145" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 9 }}>floor</text>
                            <circle cx="120" cy="50" r="8" fill="#3b82f6" opacity="0.8" />
                            <line x1="120" y1="58" x2="120" y2="95" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
                            <line x1="120" y1="70" x2="100" y2="85" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
                            <line x1="120" y1="70" x2="140" y2="85" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
                            <line x1="120" y1="95" x2="110" y2="130" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
                            <motion.line
                              x1="120" y1="95" x2="155" y2="125"
                              stroke="#8b5cf6" strokeWidth="2" strokeDasharray="3,2" strokeLinecap="round"
                              initial={{ pathLength: 0 }}
                              animate={{ pathLength: 1 }}
                              transition={{ duration: 0.8, delay: 0.3 }}
                            />
                            <text x="158" y="122" className="fill-violet-600" style={{ fontSize: 8 }}>reach</text>
                            <rect x="30" y="25" width="26" height="18" rx="3" fill="#1e293b" />
                            <circle cx="43" cy="34" r="5" fill="#60a5fa" />
                            <text x="43" y="55" textAnchor="middle" className="fill-slate-600" style={{ fontSize: 8, fontWeight: 600 }}>Camera</text>
                            <path d="M 56 34 A 80 80 0 0 1 110 100" fill="none" stroke="#f59e0b" strokeWidth="1" strokeDasharray="2,2" />
                            <text x="60" y="80" className="fill-amber-600" style={{ fontSize: 8 }}>30–45°</text>
                            <line x1="43" y1="140" x2="120" y2="140" stroke="#94a3b8" strokeWidth="1" markerEnd="url(#arr)" />
                            <text x="80" y="153" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 8 }}>3–4 m</text>
                            <defs>
                              <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                                <path d="M0,0 L6,3 L0,6" fill="#94a3b8" />
                              </marker>
                            </defs>
                          </svg>
                        </div>
                        <div className="space-y-2 text-sm text-slate-700">
                          {[
                            '3/4 oblique view — 45° between front and side, not straight front',
                            'Height 1.2–1.5 m, tilted 30–45° downward',
                            'Distance 3–4 m — full body + all reaches visible',
                            'Even lighting, no backlight, feet clearly visible',
                            'If directions look reversed, enable Flip A/P in Session Info',
                          ].map((text, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.15 + i * 0.06 }}
                              className="flex gap-2"
                            >
                              <span className="font-bold text-blue-600">{i + 1}.</span>
                              <span><strong>{text.split('—')[0]}</strong>{text.includes('—') ? '—' + text.split('—')[1] : ''}</span>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.label
                whileHover={{ scale: 1.015, borderColor: '#60a5fa' }}
                whileTap={{ scale: 0.985 }}
                className="group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 transition-colors hover:border-blue-400 hover:bg-blue-50/50"
              >
                <motion.div
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Upload className="mb-3 size-8 text-slate-400 transition-colors group-hover:text-blue-500" />
                </motion.div>
                <span className="text-sm font-semibold text-slate-700">Click to upload video</span>
                <span className="mt-1 text-xs text-slate-400">MP4 · WebM · MOV — front or 3/4 view</span>
                <input type="file" accept="video/*" onChange={onFileInput} className="hidden" />
              </motion.label>

              <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-slate-400">
                <Info className="size-3" />
                Uses MediaPipe 3D world landmarks · Normative data from UCD YBT dataset (407 subjects)
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Analysis screen ── */}
        {videoUrl && (
          <>
            {/* Session bar */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
              <motion.button onClick={() => setShowSessionForm(!showSessionForm)}
                whileHover={{ x: 2 }}
                className="mb-3 flex w-full items-center gap-2 text-left">
                <ClipboardList className="size-4 text-slate-500" />
                <span className="text-sm font-semibold text-slate-700">Session Information</span>
                <motion.span
                  animate={{ rotate: showSessionForm ? 180 : 0 }}
                  transition={{ duration: 0.25 }}
                  className="ml-auto text-xs text-slate-400">▼</motion.span>
              </motion.button>
              <AnimatePresence initial={false}>
                {showSessionForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden">
                    <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-6">
                  {[
                    { label: 'Participant ID', val: session.patientId, key: 'patientId', ph: 'P001' },
                    { label: 'Age', val: session.age, key: 'age', ph: '22', type: 'number' },
                    { label: 'Sex', val: session.sex, key: 'sex', select: true },
                    { label: 'Trial #', val: session.trial, key: 'trial', ph: '1', type: 'number' },
                    { label: 'Tester', val: session.tester, key: 'tester', ph: 'Name' },
                    { label: 'Leg length (cm)', val: legLengthCm, key: '_leg', ph: '85', type: 'number', setter: setLegLengthCm },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">{f.label}</label>
                      {f.select ? (
                        <select value={f.val} onChange={e => setSession({ ...session, [f.key]: e.target.value })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100">
                          <option value="">—</option><option value="M">M</option><option value="F">F</option>
                        </select>
                      ) : (
                        <input type={f.type || 'text'} value={f.val}
                          onChange={e => f.setter ? f.setter(e.target.value) : setSession({ ...session, [f.key]: e.target.value })}
                          placeholder={f.ph}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                      )}
                    </div>
                  ))}
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Stance leg</label>
                    <select value={session.stanceLeg} onChange={e => setSession({ ...session, stanceLeg: e.target.value as StanceLeg })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100">
                      <option value="auto">Auto-detect</option><option value="left">Left</option><option value="right">Right</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Model</label>
                    <select value={modelQuality} onChange={e => {
                      setModelQuality(e.target.value as ModelQuality);
                      landmarkerRef.current = null; setModelReady(false);
                    }} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100">
                      <option value="full">Full (recommended)</option>
                      <option value="heavy">Heavy (max accuracy)</option>
                      <option value="lite">Lite (fast)</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={session.apFlip}
                        onChange={e => setSession({ ...session, apFlip: e.target.checked })}
                        className="rounded border-slate-300" />
                      Flip A/P
                    </label>
                  </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Toolbar */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm print:hidden">
              <div className="flex items-center gap-2">
                <motion.button onClick={togglePlay}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
                  {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                  {isPlaying ? 'Pause' : 'Play'}
                  {isPlaying && (
                    <span className="ml-1 flex items-center gap-1">
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-white" />
                      </span>
                    </span>
                  )}
                </motion.button>
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
                  {[0.25, 0.5, 1].map(rate => (
                    <motion.button key={rate} onClick={() => setPlaybackRate(rate)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                        playbackRate === rate ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                      {rate}x
                    </motion.button>
                  ))}
                </div>
                <motion.button onClick={resetAnalysis}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50">
                  <RotateCcw className="size-4" /> Reset
                </motion.button>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden max-w-[200px] truncate text-xs text-slate-400 md:inline">{videoName}</span>
                <AnimatePresence>
                  {modelReady && (
                    <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                      className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                      <span className="size-1.5 rounded-full bg-emerald-500" /> Model ready
                    </motion.span>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {modelLoading && (
                    <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                      className="flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                      <span className="size-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" /> Loading…
                    </motion.span>
                  )}
                </AnimatePresence>
                {modelError && <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">Model error</span>}
                <div className="mx-1 h-5 w-px bg-slate-200" />
                {[
                  { fn: exportCSV, icon: <FileSpreadsheet className="size-4" />, label: 'CSV' },
                  { fn: exportJSON, icon: <Download className="size-4" />, label: 'JSON' },
                  { fn: () => window.print(), icon: <Printer className="size-4" />, label: 'Print' },
                ].map(b => (
                  <motion.button key={b.label} onClick={b.fn} disabled={!hasData}
                    whileHover={{ scale: hasData ? 1.05 : 1 }}
                    whileTap={{ scale: hasData ? 0.95 : 1 }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40">
                    {b.icon} <span className="hidden sm:inline">{b.label}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="grid gap-5 lg:grid-cols-5">
              {/* Video */}
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.15 }}
                className="lg:col-span-3 print:col-span-5">
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-black shadow-sm">
                  <div className="relative">
                    <video ref={videoRef} src={videoUrl} onLoadedMetadata={handleLoadedMetadata}
                      className="w-full" crossOrigin="anonymous" playsInline />
                    <canvas ref={canvasRef} className="pointer-events-none absolute left-0 top-0 h-full w-full" />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
                  <span>Frames: <strong className="text-slate-700">{frameCount}</strong></span>
                  <span>Calibration: {calibratedLegLengthRef.current > 0 ? (
                    <strong className="text-emerald-600">locked</strong>
                  ) : frameCount > 0 ? <strong className="text-amber-600">{Math.min(frameCount, 30)}/30</strong> : '—'}</span>
                  <span>Stance: <strong className="text-amber-600">{stanceFootRef.current?.toUpperCase() || '…'}</strong></span>
                  <span>Floor: <strong className="text-blue-600">{floorCalibratedRef.current ? 'detected' : '…'}</strong></span>
                  <span>3D: <strong className="text-violet-600">{worldLegLenRef.current > 0 ? 'active' : '…'}</strong></span>
                  {hasData && (occlusionStats.leftEst > 0 || occlusionStats.rightEst > 0) && (
                    <span title="Percentage of frames where toe position was estimated due to occlusion">
                      <strong className={
                        Math.max(occlusionStats.leftEst, occlusionStats.rightEst) > 30 ? 'text-red-500'
                        : Math.max(occlusionStats.leftEst, occlusionStats.rightEst) > 10 ? 'text-amber-500'
                        : 'text-orange-500'
                      }>
                        est. {Math.max(occlusionStats.leftEst, occlusionStats.rightEst)}%
                      </strong>
                    </span>
                  )}
                </div>
              </motion.section>

              {/* Results */}
              <motion.section
                variants={stagger}
                initial="hidden"
                animate="show"
                className="space-y-4 lg:col-span-2"
              >
                {/* Overall */}
                <motion.div variants={fadeInUp} whileHover={{ y: -2 }}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md print:break-inside-avoid">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-800">Overall Assessment</h2>
                    <motion.div
                      key={overallScores.pass ? 'pass' : 'fail'}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                      className={`rounded-lg px-3 py-1 text-sm font-bold text-white ${
                        overallScores.pass ? 'bg-emerald-500' : 'bg-red-500'}`}>
                      {overallScores.pass ? 'PASS' : 'FAIL'}
                    </motion.div>
                  </div>
                  <div className="mb-4 text-center">
                    <div className="bg-gradient-to-br from-slate-900 to-slate-700 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
                      {hasData ? <AnimatedCounter value={overallScores.totalScore} /> : '—'}
                    </div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Composite Score</div>
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: 'Reach Distance', value: overallScores.avgReach, color: 'bg-violet-500', w: '35%' },
                      { label: 'Balance / Stability', value: overallScores.balanceScore, color: 'bg-blue-500', w: '25%' },
                      { label: 'Contact Quality', value: overallScores.contactQuality, color: 'bg-emerald-500', w: '20%' },
                      { label: 'Form / Posture', value: overallScores.formScore, color: 'bg-amber-500', w: '20%' },
                    ].map((m, i) => (
                      <motion.div key={m.label}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 + i * 0.08 }}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-slate-600">{m.label} <span className="text-slate-300">{m.w}</span></span>
                          <span className="font-mono font-semibold">{hasData ? <><AnimatedCounter value={m.value} />%</> : '—'}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <motion.div
                            className={`h-full rounded-full ${m.color}`}
                            initial={{ width: 0 }}
                            animate={{ width: hasData ? `${m.value}%` : '0%' }}
                            transition={{ duration: 0.8, delay: 0.3 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                          />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>

                {/* Radar */}
                {hasData && (
                  <motion.div variants={fadeInUp} whileHover={{ y: -2 }}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md print:break-inside-avoid">
                    <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <BarChart3 className="size-4 text-violet-500" /> Reach Profile
                    </h3>
                    <p className="mb-2 text-[10px] text-slate-400">Solid = subject · Dashed = population mean (UCD YBT dataset)</p>
                    <div className="flex justify-center">
                      <svg width={radarSize} height={radarSize} viewBox={`0 0 ${radarSize} ${radarSize}`}>
                        {[0.25, 0.5, 0.75, 1.0].map(level => (
                          <circle key={level} cx={radarCenter} cy={radarCenter} r={level * radarMaxR}
                            fill="none" stroke="#e2e8f0" strokeWidth="1" />
                        ))}
                        {SEBT_DIRECTIONS.map((d) => {
                          const angle = (d.angle - 90) * (Math.PI / 180);
                          return <line key={d.key} x1={radarCenter} y1={radarCenter}
                            x2={radarCenter + radarMaxR * Math.cos(angle)} y2={radarCenter + radarMaxR * Math.sin(angle)}
                            stroke="#e2e8f0" strokeWidth="1" />;
                        })}
                        <polygon points={normPolygon} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4,3" />
                        <motion.polygon
                          points={radarPolygon}
                          fill="rgba(139, 92, 246, 0.15)" stroke="#8b5cf6" strokeWidth="2"
                          initial={{ opacity: 0, scale: 0.3 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                          style={{ transformOrigin: `${radarCenter}px ${radarCenter}px` }}
                        />
                        {radarPoints.map((p, i) => (
                          <motion.circle key={i} cx={p.x} cy={p.y} r="4" fill="#8b5cf6"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.6 + i * 0.04 }}
                            style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                          />
                        ))}
                        {radarPoints.map((p, i) => (
                          <text key={i} x={p.lx} y={p.ly} textAnchor="middle" dominantBaseline="middle"
                            style={{ fontSize: '9px', fontWeight: 700 }} className="fill-slate-500">{p.label}</text>
                        ))}
                      </svg>
                    </div>
                  </motion.div>
                )}

                {/* Per-direction */}
                <motion.div variants={fadeInUp} whileHover={{ y: -2 }}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md print:break-inside-avoid">
                  <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <Award className="size-4 text-amber-500" /> Per-Direction Results
                  </h3>
                  <div className="space-y-2">
                    {directionScores.map((d, i) => (
                      <motion.div key={d.key}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 + i * 0.05 }}
                        whileHover={{ x: 3, backgroundColor: 'rgba(248,250,252,1)' }}
                        className="flex items-center gap-3 rounded-lg bg-slate-50/50 px-3 py-2 transition-colors">
                        <div className="w-24 shrink-0">
                          <div className="text-xs font-semibold text-slate-700">{d.label}</div>
                          <div className="text-[10px] text-slate-400">norm {Math.round(d.normative.mean * 100)}%</div>
                        </div>
                        <div className="flex-1">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                            <motion.div
                              className={`h-full rounded-full ${
                                d.status === 'good' ? 'bg-emerald-500' : d.status === 'partial' ? 'bg-amber-400' : 'bg-red-300'
                              }`}
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(100, d.maxReach * 100)}%` }}
                              transition={{ duration: 0.6, delay: 0.4 + i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                            />
                          </div>
                          <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
                            <span>{hasData ? `${Math.round(d.maxReach * 100)}% leg` : '—'}</span>
                            <span>{d.maxReachCm > 0 ? `${d.maxReachCm} cm` : ''}</span>
                          </div>
                        </div>
                        <div className="w-16 shrink-0 text-right">
                          {hasData && d.maxReach > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <span
                                title={`Measurement confidence: ${Math.round(d.measurementConfidence * 100)}%`}
                                className={`inline-block size-1.5 rounded-full ${
                                  d.measurementConfidence >= 0.75 ? 'bg-emerald-500'
                                  : d.measurementConfidence >= 0.5 ? 'bg-amber-400'
                                  : 'bg-red-400'}`}
                              />
                              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${bandColor(d.band)}`}>
                                {d.percentile}th
                              </span>
                            </span>
                          ) : <span className="text-[10px] text-slate-300">—</span>}
                        </div>
                        <div className="w-14 shrink-0 text-right">
                          {d.bestContact ? (
                            <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold ${
                              d.bestContact.touchType === 'soft' ? 'bg-emerald-100 text-emerald-700'
                              : d.bestContact.touchType === 'hard' ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'}`}>
                              {d.bestContact.touchType}
                            </span>
                          ) : <span className="text-[10px] text-slate-300">—</span>}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>

                {/* Movement quality */}
                {hasData && (
                  <motion.div variants={fadeInUp} whileHover={{ y: -2 }}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md print:break-inside-avoid">
                    <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <AlertTriangle className="size-4 text-amber-500" /> Movement Quality
                    </h3>
                    <div className="space-y-2.5 text-xs">
                      {[
                        { label: 'Stance foot stability', val: stanceMoveSamplesRef.current > 0 ? stanceMoveSumRef.current / stanceMoveSamplesRef.current : 0, thresh: 0.02 },
                        { label: 'Stance heel lift', val: stanceHeelLiftRef.current, thresh: 0.03 },
                        { label: 'Trunk lean', val: trunkLeanSamplesRef.current > 0 ? trunkLeanSumRef.current / trunkLeanSamplesRef.current : 0, thresh: 0.06 },
                      ].map((f, fi) => {
                        const ok = f.val < f.thresh;
                        return (
                          <motion.div key={f.label}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.5 + fi * 0.08 }}
                            className="flex items-center justify-between">
                            <span className="text-slate-600">{f.label}</span>
                            <span className={`flex items-center gap-1 font-mono font-medium ${ok ? 'text-emerald-600' : 'text-red-500'}`}>
                              {f.val > 0 ? f.val.toFixed(3) : '—'}
                              {ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                            </span>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}

                {/* Occlusion / estimation quality */}
                {hasData && (() => {
                  const maxStreak = Math.max(occlusionStats.leftMaxStreak, occlusionStats.rightMaxStreak);
                  const maxOcc = Math.max(occlusionStats.leftOcc, occlusionStats.rightOcc);
                  const maxEst = Math.max(occlusionStats.leftEst, occlusionStats.rightEst);
                  const events = Math.max(occlusionStats.leftEvents, occlusionStats.rightEvents);
                  // Directions with measured reaches and their confidence
                  const measuredDirs = directionScores.filter(d => d.maxReach > REACH_MIN_RATIO);
                  const avgDirConf = measuredDirs.length > 0
                    ? measuredDirs.reduce((s, d) => s + d.measurementConfidence, 0) / measuredDirs.length
                    : 1;
                  const verdict =
                    maxOcc > 30 || maxStreak > 15 || avgDirConf < 0.5
                      ? { text: 'Re-record recommended', color: 'text-red-600 bg-red-50' }
                    : maxOcc > 10 || maxStreak > 8 || avgDirConf < 0.75
                      ? { text: 'Acceptable — review flagged directions', color: 'text-amber-600 bg-amber-50' }
                      : { text: 'Good measurement quality', color: 'text-emerald-600 bg-emerald-50' };
                  return (
                  <motion.div variants={fadeInUp} whileHover={{ y: -2 }}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md print:break-inside-avoid">
                    <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <Eye className="size-4 text-orange-500" /> Measurement Quality
                    </h3>
                    <div className="space-y-2.5 text-xs">
                      {[
                        { label: 'L-toe occluded', val: occlusionStats.leftOcc, warn: 10, bad: 30 },
                        { label: 'R-toe occluded', val: occlusionStats.rightOcc, warn: 10, bad: 30 },
                      ].map((row, ri) => (
                        <motion.div key={row.label}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.6 + ri * 0.08 }}
                          className="flex items-center justify-between">
                          <span className="text-slate-600">{row.label}</span>
                          <span className={`font-mono font-medium ${row.val > row.bad ? 'text-red-500' : row.val > row.warn ? 'text-amber-500' : 'text-emerald-600'}`}>
                            {row.val}%
                          </span>
                        </motion.div>
                      ))}
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.76 }}
                        className="flex items-center justify-between">
                        <span className="text-slate-600">Estimated frames</span>
                        <span className={`font-mono font-medium ${maxEst > 30 ? 'text-red-500' : maxEst > 10 ? 'text-amber-500' : 'text-orange-500'}`}>
                          {maxEst}%
                        </span>
                      </motion.div>
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.82 }}
                        className="flex items-center justify-between">
                        <span className="text-slate-600">Max occlusion streak</span>
                        <span className={`font-mono font-medium ${maxStreak > 15 ? 'text-red-500' : maxStreak > 8 ? 'text-amber-500' : 'text-slate-600'}`}>
                          {maxStreak}f {maxStreak > 0 && `(~${Math.round(maxStreak / 30 * 10) / 10}s)`}
                        </span>
                      </motion.div>
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.88 }}
                        className="flex items-center justify-between">
                        <span className="text-slate-600">Occlusion events</span>
                        <span className="font-mono font-medium text-slate-600">{events}</span>
                      </motion.div>

                      {/* Per-direction measurement confidence */}
                      {measuredDirs.length > 0 && (
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Reach confidence by direction
                          </div>
                          {measuredDirs.map((d, di) => (
                            <motion.div key={d.key}
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.9 + di * 0.06 }}
                              className="mb-1.5 flex items-center gap-2">
                              <span className="w-16 shrink-0 text-[10px] font-medium text-slate-500">{d.short}</span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                <motion.div
                                  className={`h-full rounded-full ${d.measurementConfidence >= 0.75 ? 'bg-emerald-500' : d.measurementConfidence >= 0.5 ? 'bg-amber-400' : 'bg-red-400'}`}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.round(d.measurementConfidence * 100)}%` }}
                                  transition={{ duration: 0.6, delay: 1 + di * 0.06 }}
                                />
                              </div>
                              <span className="w-9 shrink-0 text-right font-mono text-[10px] text-slate-500">
                                {Math.round(d.measurementConfidence * 100)}%
                              </span>
                            </motion.div>
                          ))}
                        </div>
                      )}

                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 1.1 }}
                        className={`mt-2 rounded-lg px-2.5 py-1.5 text-center text-[11px] font-semibold ${verdict.color}`}>
                        {verdict.text}
                      </motion.div>
                      <p className="pt-1 text-[10px] leading-relaxed text-slate-400">
                        Orange ring = Kalman-predicted toe. Green = directly observed.
                        Reach confidence = % of contact frames with direct toe observation.
                      </p>
                    </div>
                  </motion.div>
                  );
                })}
              </motion.section>
            </motion.div>

            {/* Contact events */}
            {contactLog.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <Footprints className="size-4" /> Contact Events ({contactLog.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[10px] uppercase text-slate-400">
                        <th className="py-2 pr-4">Direction</th>
                        <th className="py-2 pr-4">Reach</th>
                        <th className="py-2 pr-4">cm</th>
                        <th className="py-2 pr-4">Impact vel.</th>
                        <th className="py-2 pr-4">Bounce</th>
                        <th className="py-2 pr-4">Quality</th>
                        <th className="py-2 pr-4">Conf</th>
                        <th className="py-2">Touch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contactLog.slice(0, 20).map((c, i) => (
                        <motion.tr key={i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: Math.min(i * 0.03, 0.4) }}
                          whileHover={{ backgroundColor: 'rgba(248,250,252,1)' }}
                          className="border-b border-slate-50 transition-colors">
                          <td className="py-1.5 pr-4 font-medium capitalize">{c.direction}</td>
                          <td className="py-1.5 pr-4 font-mono text-slate-500">{Math.round(c.reachRatio * 100)}%</td>
                          <td className="py-1.5 pr-4 font-mono text-slate-500">{c.reachCm || '—'}</td>
                          <td className="py-1.5 pr-4 font-mono text-slate-500">{c.impactVelocity}</td>
                          <td className="py-1.5 pr-4 font-mono text-slate-500">{c.bounce}</td>
                          <td className="py-1.5 pr-4 font-mono text-slate-500">{c.contactQuality}</td>
                          <td className="py-1.5 pr-4 font-mono" title="Measurement confidence (% contact frames directly observed)">
                            <span className={
                              c.measurementConfidence >= 0.75 ? 'text-emerald-600'
                              : c.measurementConfidence >= 0.5 ? 'text-amber-600'
                              : 'text-red-500'
                            }>{Math.round(c.measurementConfidence * 100)}%</span>
                          </td>
                          <td className="py-1.5">
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                              c.touchType === 'soft' ? 'bg-emerald-100 text-emerald-700'
                              : c.touchType === 'hard' ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'}`}>{c.touchType}</span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.section>
            )}

            {/* Detection quality */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Detection Quality</h2>
              <div className="grid gap-x-6 gap-y-1 md:grid-cols-3 lg:grid-cols-4">
                {keypointRows.map((row, i) => (
                  <motion.div key={row.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15 + i * 0.02 }}
                    className="flex items-center justify-between border-b border-slate-50 py-1 text-xs">
                    <span className="font-mono text-slate-600">{row.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-400">{row.conf.toFixed(2)}</span>
                      {hasData && (
                        <span className={`font-mono ${row.missingPct > 30 ? 'text-red-500' : row.missingPct > 10 ? 'text-amber-500' : 'text-emerald-600'}`}>
                          {row.missingPct}%
                        </span>
                      )}
                      {row.conf >= 0.5 ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <XCircle className="size-3.5 text-red-400" />}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.section>

            {/* Methodology */}
            <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:break-inside-avoid">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Methodology &amp; References</h2>
              <div className="grid gap-3 text-xs leading-relaxed text-slate-600 md:grid-cols-2">
                <div>
                  <p><strong className="text-slate-800">Reach measurement (3D):</strong> Horizontal floor-plane distance from stance ankle to reaching toe tip using MediaPipe world landmarks (3D coordinates in meters), normalized to 3D leg length. This corrects perspective foreshortening that affects 2D image distance. Only floor-contact-verified reaches are scored.</p>
                </div>
                <div>
                  <p><strong className="text-slate-800">Contact classification:</strong> Vertical velocity state machine with One-Euro temporal smoothing. Soft = low impact, no bounce; Hard = high impact or rebound. Reach uses median across contact frames.</p>
                </div>
                <div>
                  <p><strong className="text-slate-800">Direction classification:</strong> Body-relative using the hip axis — correct for any camera rotation. Flip A/P toggle handles the single 2D depth ambiguity.</p>
                </div>
                <div>
                  <p><strong className="text-slate-800">Occlusion handling:</strong> Kalman filter (constant-velocity model) tracks toe position through brief occlusions. When the toe is hidden but the ankle is visible, a kinematic chain estimates toe position as ankle + calibrated foot vector. Confidence decays with occlusion duration; positions below threshold are rejected. Estimated positions are marked on the video.</p>
                </div>
                <div>
                  <p><strong className="text-slate-800">Normative data:</strong> {DATASET_CITATION.name} ({DATASET_CITATION.subjects} subjects, {DATASET_CITATION.trials} trials). Percentiles estimated from published mean ± SD. Remaining directions from pooled SEBT literature.</p>
                </div>
              </div>
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                <strong>Limitations:</strong> Single-camera 3D estimation is approximate; z-depth from monocular video is noisy. For clinical diagnosis or publication, validate against manual tape measurements and consider dual-camera or marker-based motion capture. This tool is intended for research, screening, and educational use.
              </div>
            </section>
          </>
        )}

        {/* Print-only report header */}
        <div className="hidden print:block print:mb-4">
          <h1 className="text-xl font-bold">SEBT Analysis Report</h1>
          <table className="mt-2 text-sm">
            <tbody>
              <tr><td className="pr-4 font-medium">Participant:</td><td>{session.patientId || '—'}</td>
                  <td className="pl-8 pr-4 font-medium">Age/Sex:</td><td>{session.age || '—'} / {session.sex || '—'}</td></tr>
              <tr><td className="pr-4 font-medium">Stance leg:</td><td>{session.stanceLeg}</td>
                  <td className="pl-8 pr-4 font-medium">Trial:</td><td>{session.trial || '—'}</td></tr>
              <tr><td className="pr-4 font-medium">Tester:</td><td>{session.tester || '—'}</td>
                  <td className="pl-8 pr-4 font-medium">Date:</td><td>{new Date().toLocaleDateString()}</td></tr>
              <tr><td className="pr-4 font-medium">Video:</td><td>{videoName}</td>
                  <td className="pl-8 pr-4 font-medium">Leg length:</td><td>{legLengthCmRef.current ? `${legLengthCmRef.current} cm` : 'not calibrated'}</td></tr>
            </tbody>
          </table>
        </div>

        <footer className="mt-10 border-t border-slate-200 pt-4 text-center text-[11px] text-slate-400 print:hidden">
          <p>
            Normative data: <a href={DATASET_CITATION.url} className="text-blue-500 hover:underline" target="_blank" rel="noreferrer">UCD YBT Dataset</a>
            {' · '}<UniversalLink to={resolveAppUrl('/sebt-tester-source.zip')} download="sebt-tester-source.zip"
              className="text-blue-500 hover:underline">Download source</UniversalLink>
          </p>
        </footer>
      </main>
    </div>
  );
}
