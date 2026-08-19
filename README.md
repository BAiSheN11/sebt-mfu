# SEBT 2D Top-Down Pose Tester

A simple web tool that demonstrates the limitations of 2D top-down pose estimation
for SEBT (Star Excursion Balance Test) evaluation.

## What it does

1. Upload a top-down video
2. MediaPipe BlazePose runs locally in your browser
3. See which body keypoints are detected (green) vs missing (red)
4. Understand the three key flaws of 2D overhead pose estimation for SEBT

## Quick start

### Requirements
- Node.js >= 18
- npm >= 9

### Run in VS Code

1. Open the project folder in VS Code (**File → Open Folder**)
2. Open the terminal (**Terminal → New Terminal**)
3. Install dependencies:

```bash
npm install
```

4. Start the dev server:

```bash
npm run dev
```

5. Open `http://localhost:8001` in your browser. The custom dev launcher uses port 8001.

### Run the desktop version (Electron)

```bash
npm run electron:dev
```

This starts Vite and opens the Electron desktop window automatically.

### Build for production

```bash
npm run build
```

Output goes to `dist/`.

---

## How it works

The tool uses **MediaPipe BlazePose Lite** running entirely in the browser via
WebAssembly + WebGL. No video data leaves your device.

### The three flaws

1. **Self-Occlusion** — The torso blocks the camera's view of lower body parts.
   Ankles and knees frequently disappear when the body is between the overhead
   camera and the feet.

2. **Z-Axis Blindness** — A 2D top-down camera cannot detect vertical (Z-axis)
   motion. Heel raises, knee flexion depth, and weight shifts are completely
   invisible.

3. **Foreshortening** — Perspective projection compresses distances based on
   body height and limb angle. Pixel measurements cannot reliably be converted
   to real centimeter distances.

---

## Tech stack

- React 19 + TypeScript
- Vite
- MediaPipe Tasks Vision (BlazePose)
- Tailwind CSS
- Lucide icons

---

## Project structure

```
.
├── public/
│   └── models/
│       └── pose_landmarker_lite.task   # Pose model (5.6MB)
├── src/
│   ├── pages/
│   │   └── SimpleSebtPage/
│   │       └── SimpleSebtPage.tsx       # Main page
│   ├── app.tsx
│   ├── index.tsx
│   ├── index.css
│   └── tailwind-theme.css
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

## Notes

- The pose model file is included in `public/models/` so the app works offline
  once loaded.
- All processing happens in the browser. Your video files never leave your device.
- For research use only. Not for clinical diagnosis.
