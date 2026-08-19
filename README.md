# SEBT.mfu

AI-powered **Star Excursion Balance Test** video analysis tool — 3D reach measurement, Kalman-filter occlusion handling, floor-contact classification, and population-normative comparison.

Built for the Gait & Balance Research Lab at Mae Fah Luang University.

## Features

- **3D reach measurement** — MediaPipe world landmarks (meters), horizontal floor-plane distance normalized to 3D stance-leg length
- **Kalman filter + kinematic chain** — adaptive 2D/3D Kalman tracking with rigid-foot toe estimation during occlusion; velocity-aware prediction and re-acquisition blending
- **Floor-contact detection** — state machine classifies soft / moderate / hard touch via impact velocity and bounce
- **8-direction scoring** — reach (35%), balance (25%), contact quality (20%), form/posture (20%) with PASS/FAIL
- **Normative comparison** — UCD YBT dataset (407 subjects, 7,262 trials) with z-scores, percentiles, and clinical bands
- **Measurement quality panel** — per-direction confidence, max occlusion streak, re-record recommendations
- **Export** — CSV report, JSON data, printable report
- **Privacy-first** — all processing runs in-browser via WebAssembly; no video leaves the device

## Quick start

### Requirements
- Node.js >= 18
- npm >= 9

### Run locally

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (Vite default or port 8001 with the Lark preset).

### Build for production

```bash
npm run build
```

Output goes to `dist/`.

## How to record a valid test

1. **3/4 oblique view** — camera at 45° between front and side (not straight front)
2. **Height 1.2–1.5 m**, tilted 30–45° downward
3. **Distance 3–4 m** — full body + all reaches visible
4. **Even lighting**, no backlight, feet clearly visible
5. If directions appear reversed, enable **Flip A/P** in Session Information

## Measurement pipeline

1. BlazePose detects 33 landmarks (heavy model)
2. One-Euro filter smooths 2D image and 3D world landmarks
3. Stance foot auto-detected via 45-frame ankle variance
4. 3D leg length and stance ankle origin calibrated (median, locked)
5. Toe tracked via Kalman filter; kinematic chain estimates during occlusion
6. Reach = horizontal 3D distance / leg length, projected onto direction axis
7. Peak reach = trimmed mean of contact frames (top/bottom 20% discarded)
8. Floor contact classified by descent velocity and post-contact bounce

## Tech stack

- React 19 + TypeScript + Vite
- MediaPipe Tasks Vision (BlazePose Heavy)
- Tailwind CSS + Framer Motion
- Lucide icons

## Project structure

```
├── public/models/              # BlazePose model files (lite/full/heavy)
├── src/
│   ├── pages/SimpleSebtPage/
│   │   └── SimpleSebtPage.tsx  # Main application
│   ├── utils/
│   │   ├── foot-tracker.ts     # Kalman filter + kinematic chain
│   │   └── one-euro-filter.ts  # Temporal landmark smoothing
│   ├── data/
│   │   └── normativeData.ts    # UCD YBT normative values
│   └── index.css
├── index.html
├── vite.config.ts
└── package.json
```

## Normative data citation

UCD YBT Dataset — P. Grant et al., University College Dublin.
407 subjects, 7,262 trials. http://mlg.ucd.ie/ybt/

## Disclaimer

For research and educational use.
