// EXPORTS: KeypointName, SebtDirection, IFrameKeypoint, IFrameDetection, IKeypointSummary, IThreeFlawsAnalysis, IDetectionReport, KEYPOINT_LABELS, SKELETON_CONNECTIONS, SEBT_DIRECTIONS, generateSimulatedReport, generateSimulatedFrame

export type KeypointName =
  | 'nose'
  | 'left_eye'
  | 'right_eye'
  | 'left_ear'
  | 'right_ear'
  | 'left_shoulder'
  | 'right_shoulder'
  | 'left_elbow'
  | 'right_elbow'
  | 'left_wrist'
  | 'right_wrist'
  | 'left_hip'
  | 'right_hip'
  | 'left_knee'
  | 'right_knee'
  | 'left_ankle'
  | 'right_ankle';

export type SebtDirection =
  | 'anterior'
  | 'anteromedial'
  | 'medial'
  | 'posteromedial'
  | 'posterior'
  | 'posterolateral'
  | 'lateral'
  | 'anterolateral';

export interface IFrameKeypoint {
  name: KeypointName;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  confidence: number; // 0..1
  isHallucinated?: boolean;
}

export interface IFrameDetection {
  frameIndex: number;
  timestamp: number;
  keypoints: IFrameKeypoint[];
}

export type KeypointStatus = 'reliable' | 'uncertain' | 'missing';

export interface IKeypointSummary {
  name: KeypointName;
  bodyPartLabel: string;
  detected: boolean;
  avgConfidence: number;
  framesDetected: number;
  framesMissing: number;
  detectionRate: number;
  status: KeypointStatus;
  group: 'head' | 'upper_limb' | 'torso' | 'lower_limb';
}

export interface IThreeFlawsAnalysis {
  flaw1_selfOcclusion: {
    affectedKeypoints: KeypointName[];
    avgAbsenceRate: number;
    details: string;
  };
  flaw2_verticalBlindness: {
    isDetectable: false;
    affectedMovements: string[];
    details: string;
  };
  flaw3_foreshortening: {
    pixelDistanceMeasured: number;
    isReliableForCm: false;
    affectedDirections: SebtDirection[];
    details: string;
  };
}

export interface IDetectionReport {
  totalFrames: number;
  fps: number;
  duration: number;
  videoResolution: { width: number; height: number };
  keypointSummaries: IKeypointSummary[];
  threeFlaws: IThreeFlawsAnalysis;
  sebtContext: {
    starPattern: SebtDirection[];
    directionFlawImpact: Record<
      SebtDirection,
      { flaw1: boolean; flaw2: boolean; flaw3: boolean; severity: 'high' | 'medium' | 'low' }
    >;
  };
  verdict: string;
  isSimulated?: boolean;
}

export const KEYPOINT_LABELS: Record<KeypointName, string> = {
  nose: 'Nose',
  left_eye: 'Left Eye',
  right_eye: 'Right Eye',
  left_ear: 'Left Ear',
  right_ear: 'Right Ear',
  left_shoulder: 'Left Shoulder',
  right_shoulder: 'Right Shoulder',
  left_elbow: 'Left Elbow',
  right_elbow: 'Right Elbow',
  left_wrist: 'Left Wrist',
  right_wrist: 'Right Wrist',
  left_hip: 'Left Hip',
  right_hip: 'Right Hip',
  left_knee: 'Left Knee',
  right_knee: 'Right Knee',
  left_ankle: 'Left Ankle',
  right_ankle: 'Right Ankle',
};

export const SKELETON_CONNECTIONS: Array<[KeypointName, KeypointName]> = [
  ['nose', 'left_eye'],
  ['nose', 'right_eye'],
  ['left_eye', 'left_ear'],
  ['right_eye', 'right_ear'],
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['right_shoulder', 'right_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['right_hip', 'right_knee'],
  ['left_knee', 'left_ankle'],
  ['right_knee', 'right_ankle'],
];

export const SEBT_DIRECTIONS: SebtDirection[] = [
  'anterior',
  'anteromedial',
  'medial',
  'posteromedial',
  'posterior',
  'posterolateral',
  'lateral',
  'anterolateral',
];

export const SEBT_DIRECTION_LABELS: Record<SebtDirection, string> = {
  anterior: 'Anterior (A)',
  anteromedial: 'Anteromedial (AM)',
  medial: 'Medial (M)',
  posteromedial: 'Posteromedial (PM)',
  posterior: 'Posterior (P)',
  posterolateral: 'Posterolateral (PL)',
  lateral: 'Lateral (L)',
  anterolateral: 'Anterolateral (AL)',
};

// ----- Confidence profiles for top-down camera -----
// Profile: base confidence + variance + missing probability
const KEYPOINT_PROFILES: Record<KeypointName, { base: number; variance: number; missProb: number; hallucProb: number }> = {
  nose: { base: 0.92, variance: 0.05, missProb: 0.02, hallucProb: 0 },
  left_eye: { base: 0.88, variance: 0.07, missProb: 0.05, hallucProb: 0 },
  right_eye: { base: 0.88, variance: 0.07, missProb: 0.05, hallucProb: 0 },
  left_ear: { base: 0.75, variance: 0.12, missProb: 0.15, hallucProb: 0 },
  right_ear: { base: 0.75, variance: 0.12, missProb: 0.15, hallucProb: 0 },
  left_shoulder: { base: 0.85, variance: 0.08, missProb: 0.05, hallucProb: 0 },
  right_shoulder: { base: 0.85, variance: 0.08, missProb: 0.05, hallucProb: 0 },
  left_elbow: { base: 0.65, variance: 0.18, missProb: 0.25, hallucProb: 0.03 },
  right_elbow: { base: 0.65, variance: 0.18, missProb: 0.25, hallucProb: 0.03 },
  left_wrist: { base: 0.45, variance: 0.22, missProb: 0.40, hallucProb: 0.08 },
  right_wrist: { base: 0.45, variance: 0.22, missProb: 0.40, hallucProb: 0.08 },
  left_hip: { base: 0.55, variance: 0.20, missProb: 0.35, hallucProb: 0.05 },
  right_hip: { base: 0.55, variance: 0.20, missProb: 0.35, hallucProb: 0.05 },
  left_knee: { base: 0.28, variance: 0.18, missProb: 0.65, hallucProb: 0.12 },
  right_knee: { base: 0.28, variance: 0.18, missProb: 0.65, hallucProb: 0.12 },
  left_ankle: { base: 0.15, variance: 0.12, missProb: 0.82, hallucProb: 0.18 },
  right_ankle: { base: 0.15, variance: 0.12, missProb: 0.82, hallucProb: 0.18 },
};

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

// Simple pseudo-random with seed for deterministic demo
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate a single simulated frame of top-down keypoints */
export function generateSimulatedFrame(frameIndex: number, totalFrames: number): IFrameDetection {
  const rand = mulberry32(1000 + frameIndex);
  const t = frameIndex / Math.max(1, totalFrames - 1); // 0..1 progress
  // Simulate a reaching motion: the person rotates slightly and reaches with one leg
  const reachAngle = t * Math.PI * 1.6; // sweep through reach directions
  const reachExtent = 0.18 + 0.05 * Math.sin(t * Math.PI * 3);

  // Top-down body center
  const cx = 0.5;
  const cy = 0.5;

  const keypoints: IFrameKeypoint[] = [];

  // Generate each keypoint with position + confidence
  const allKeys = Object.keys(KEYPOINT_PROFILES) as KeypointName[];

  for (const name of allKeys) {
    const profile = KEYPOINT_PROFILES[name];
    const r = rand();

    let confidence = profile.base + (rand() - 0.5) * 2 * profile.variance;
    confidence = Math.max(0, Math.min(1, confidence));

    // Missing?
    const missing = r < profile.missProb;
    if (missing) {
      confidence = Math.min(confidence, 0.15 + rand() * 0.1);
    }

    // Hallucinated position (anatomically impossible from top-down)
    const isHallucinated = !missing && rand() < profile.hallucProb;

    // Compute approximate top-down position
    let x = cx;
    let y = cy;

    const isLeft = name.startsWith('left_');
    const side = isLeft ? 1 : -1;

    if (name === 'nose') {
      x = cx + 0.02 * Math.cos(reachAngle);
      y = cy - 0.06 + 0.01 * Math.sin(reachAngle * 2);
    } else if (name.includes('eye')) {
      x = cx + side * 0.025;
      y = cy - 0.055;
    } else if (name.includes('ear')) {
      x = cx + side * 0.05;
      y = cy - 0.05;
    } else if (name.includes('shoulder')) {
      x = cx + side * 0.09;
      y = cy - 0.01;
    } else if (name.includes('elbow')) {
      x = cx + side * (0.14 + 0.03 * Math.sin(t * 5));
      y = cy + 0.05 + 0.02 * Math.cos(t * 4);
    } else if (name.includes('wrist')) {
      x = cx + side * (0.18 + 0.05 * Math.sin(t * 5 + 1));
      y = cy + 0.12 + 0.03 * Math.cos(t * 4 + 1);
    } else if (name.includes('hip')) {
      x = cx + side * 0.06;
      y = cy + 0.08;
    } else if (name.includes('knee')) {
      // Stance leg = right, reach leg = left
      if (isLeft) {
        // Reach leg — moves in reach direction
        x = cx + Math.cos(reachAngle) * reachExtent * 0.7;
        y = cy + 0.08 + Math.sin(reachAngle) * reachExtent * 0.5;
      } else {
        // Stance leg — under torso
        x = cx + side * 0.03;
        y = cy + 0.14;
      }
    } else if (name.includes('ankle')) {
      if (isLeft) {
        x = cx + Math.cos(reachAngle) * reachExtent;
        y = cy + 0.08 + Math.sin(reachAngle) * reachExtent * 0.8;
      } else {
        x = cx + side * 0.02;
        y = cy + 0.18;
      }
    }

    // Add jitter
    x += (rand() - 0.5) * 0.01;
    y += (rand() - 0.5) * 0.01;

    // Hallucinated: random position far from expected
    if (isHallucinated) {
      x = cx + (rand() - 0.5) * 0.6;
      y = cy + (rand() - 0.5) * 0.6;
      confidence = Math.max(0.2, confidence - 0.1);
    }

    keypoints.push({
      name,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      confidence,
      isHallucinated,
    });
  }

  return {
    frameIndex,
    timestamp: frameIndex / 30,
    keypoints,
  };
}

/** Compute full simulated detection report */
export function generateSimulatedReport(): IDetectionReport {
  const totalFrames = 180; // 6s @ 30fps
  const fps = 30;
  const duration = totalFrames / fps;

  const allKeys = Object.keys(KEYPOINT_PROFILES) as KeypointName[];
  const keypointSummaries: IKeypointSummary[] = allKeys.map((name) => {
    const profile = KEYPOINT_PROFILES[name];
    const detectionRate = Math.round((1 - profile.missProb) * 1000) / 10;
    const framesDetected = Math.round(totalFrames * (1 - profile.missProb));
    const framesMissing = totalFrames - framesDetected;
    // avg confidence of detected frames
    const avgConfidence = Math.round(profile.base * 100) / 100;
    let status: KeypointStatus = 'reliable';
    if (detectionRate < 30 || avgConfidence < 0.3) status = 'missing';
    else if (detectionRate < 70 || avgConfidence < 0.6) status = 'uncertain';

    return {
      name,
      bodyPartLabel: KEYPOINT_LABELS[name],
      detected: detectionRate > 20,
      avgConfidence,
      framesDetected,
      framesMissing,
      detectionRate,
      status,
      group: KEYPOINT_GROUPS[name],
    };
  });

  // Lower limb keypoints
  const lowerLimbKeys: KeypointName[] = ['left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_hip', 'right_hip'];
  const avgAbsenceRate = Math.round(
    (lowerLimbKeys.reduce((s, k) => {
      const sum = keypointSummaries.find((kp) => kp.name === k)?.framesMissing ?? 0;
      return s + sum / totalFrames;
    }, 0) /
      lowerLimbKeys.length) *
      1000,
  ) / 10;

  const affectedDirections: SebtDirection[] = ['anterior', 'posterior', 'medial', 'lateral'];

  // Direction flaw impact
  const directionFlawImpact: IDetectionReport['sebtContext']['directionFlawImpact'] = {
    anterior: { flaw1: true, flaw2: true, flaw3: true, severity: 'high' },
    anteromedial: { flaw1: true, flaw2: true, flaw3: true, severity: 'high' },
    medial: { flaw1: true, flaw2: true, flaw3: false, severity: 'medium' },
    posteromedial: { flaw1: true, flaw2: true, flaw3: true, severity: 'high' },
    posterior: { flaw1: true, flaw2: true, flaw3: true, severity: 'high' },
    posterolateral: { flaw1: true, flaw2: true, flaw3: true, severity: 'high' },
    lateral: { flaw1: true, flaw2: true, flaw3: false, severity: 'medium' },
    anterolateral: { flaw1: true, flaw2: true, flaw3: true, severity: 'high' },
  };

  return {
    totalFrames,
    fps,
    duration,
    videoResolution: { width: 1920, height: 1080 },
    keypointSummaries,
    threeFlaws: {
      flaw1_selfOcclusion: {
        affectedKeypoints: ['left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
        avgAbsenceRate,
        details:
          'From an overhead (top-down) perspective, the torso physically occludes the stance foot and reaching leg. Lower-limb keypoints (knees, ankles) are absent or unreliable across the majority of frames because the camera cannot see them through the body mass.',
      },
      flaw2_verticalBlindness: {
        isDetectable: false,
        affectedMovements: ['heel_lift', 'ankle_dorsiflexion', 'z_axis_translation'],
        details:
          'A 2D overhead camera captures only X/Y pixel coordinates. Vertical (Z-axis) movement such as heel lift, ankle dorsiflexion, or weight shift toward the camera produces near-zero pixel displacement. This critical clinical fault — lifting the stance heel during reach — is completely invisible to a single 2D top-down camera.',
      },
      flaw3_foreshortening: {
        pixelDistanceMeasured: 214,
        isReliableForCm: false,
        affectedDirections,
        details:
          'Limbs pointing toward or away from the overhead camera appear foreshortened. Reach distances measured in 2D pixels are mathematically unreliable for conversion to real-world centimeters because depth information is lost. Anterior/posterior directions suffer the most compression.',
      },
    },
    sebtContext: {
      starPattern: SEBT_DIRECTIONS,
      directionFlawImpact,
    },
    verdict:
      '2D overhead single-camera pose estimation is NOT sufficient for clinical SEBT evaluation. A multi-camera 3D motion capture or depth-sensing solution is required to reliably measure reach distance, detect heel lift, and resolve lower-limb kinematics.',
    isSimulated: true,
  };
}

/** Get status color class for tailwind */
export function getStatusColor(status: KeypointStatus): string {
  switch (status) {
    case 'reliable':
      return 'text-emerald-400';
    case 'uncertain':
      return 'text-amber-400';
    case 'missing':
      return 'text-red-400';
  }
}

export function getStatusBg(status: KeypointStatus): string {
  switch (status) {
    case 'reliable':
      return 'bg-emerald-500/20 border-emerald-500/40';
    case 'uncertain':
      return 'bg-amber-500/20 border-amber-500/40';
    case 'missing':
      return 'bg-red-500/20 border-red-500/40';
  }
}
