# SEBT 2D Top-Down Pose Estimation Tester - 需求拆解文档

## 产品概述

- **产品类型**: 科学研究工具 / 视频姿态检测分析工具
- **场景类型**: <scene_type>prototype-app</scene_type>
- **目标用户**: 康复医学研究员、生物力学研究者、临床评估工具开发者
- **核心价值**: 通过浏览器端姿态估计可视化证明「单台俯视 2D 相机 + 标准姿态估计」用于 SEBT 评估存在三大物理缺陷（自遮挡、Z 轴盲区、透视压缩），为多相机/3D 方案提供实证依据
- **界面语言**: 英文（核心术语保留 COCO/SEBT 英文，必要辅助中文说明）
- **主题偏好**: 深色主题（Dark theme —— 用于视频分析工作）
- **导航模式**: 无导航（单页工具型应用）
- **导航布局**: 无

---

## 场景识别说明

本需求为**前端科学研究工具**，核心流程为「上传视频 → 浏览器端姿态检测 → 输出检测报告与可视化」，属于 prototype - app 子场景（工具类单页应用）。

虽涉及数据报告和图表，但用户核心目的是**使用工具进行检测分析**而非阅读现成报告，故归类为 prototype 而非 info_viz。

---

## 页面结构总览

**页面文件**: `SebtAnalyzerPage.tsx`（单页应用）

| 区域 | 说明 |
|-----|------|
| Header 区 | 应用标题、版本标识（V1 Research Tool）、简要用途说明 |
| 视频上传区 | 拖拽上传 + 选择文件按钮 + 文件信息展示 + Demo/示例模式入口 |
| 视频预览与叠加区 | 左侧：原始/结果视频播放器（带骨骼关键点叠加）；右侧：实时置信度面板 |
| 检测报告面板 | 核心输出区：关键点检测表 + 三大缺陷分析 + SEBT 星形图参考 + 结论判定 |
| 处理状态栏 | 处理进度、帧计数、当前状态（待上传/处理中/完成/错误） |

---

## 页面布局建议

- **布局模式**: **左右分栏（主从布局）**——左侧为视频可视化主区，右侧为检测报告与数据面板
  - 理由：用户需要**对照观看视频与检测结果**，视频是源材料需持续参照，报告是核心输出需同步阅读。左右分栏符合科研工具「左图右表」的经典布局。
- **视觉重心**: **检测报告面板**（右侧）——这是用户原话强调的 "the most important output" 和 "key deliverable"，需醒目不可忽略
- **结果承载区**: 
  - 视频叠加区：Canvas 叠加在 `<video>` 上，实时渲染关键点与骨架
  - 置信度面板：17 个 COCO 关键点的实时置信度条形图
  - 检测报告面板：关键点检测表 + 三大缺陷分析卡片 + SEBT 星形图 + 总结结论
- **初始态**: 空状态展示——上传区居中醒目，附带说明文字和「Demo Mode（演示模式）」按钮，点击后加载模拟结果展示三大缺陷
- **处理中态**: 进度条 + 当前处理帧数 + 状态提示
- **完成态**: 左右分栏完整展示，自动滚动/聚焦到检测报告面板

---

## 技术选型

- **姿态检测方案**: TensorFlow.js + MoveNet（或 MediaPipe BlazePose，由实现阶段评估选型，优先选浏览器端性能最优者）
- **视频处理**: HTML5 `<video>` + `<canvas>` 逐帧采样绘制叠加
- **状态管理**: React useState/useRef（单页应用无需额外状态库）
- **新增依赖**: `@tensorflow/tfjs`, `@tensorflow-models/pose-detection`（具体模型包由实现阶段确定）
- **降级方案**: 若实时检测不可行，使用预设的模拟数据演示顶视图失败模式（上半身高置信、下半身频繁缺失、Z 轴标注盲区）

---

## 数据来源声明

| 数据/操作 | 来源类型 | 实现要求 | mock 兜底 |
|---|---|---|---|
| SEBT 视频上传 | real-file | 通过 `<input type="file">` + 拖拽 API 获取用户视频文件（MP4/WebM），创建 ObjectURL 供 video 元素播放 | 无（用户需自行上传视频） |
| 姿态关键点检测 | real-plugin 思路但前端实现 | 浏览器端 TensorFlow.js 加载 MoveNet/BlazePose 模型，逐帧检测 COCO 17 关键点，记录每帧置信度 | **模拟模式**：预置符合顶视图失败模式的模拟关键点数据（上半身高置信、下肢频繁缺失），供 Demo Mode 和无视频时演示 |
| 检测结果数据（报告） | local-computed | 前端根据检测帧数据聚合计算：每关键点平均置信度、检测帧数、缺失帧数、状态分级 | 使用模拟数据生成完整示例报告 |
| SEBT 星形参考图 | demo-mock | 前端 SVG/Canvas 绘制 8 方向星形模式示意图 | 本身就是静态资源 |
| 三大缺陷分析结论 | local-computed | 根据检测数据按规则映射到三类缺陷（自遮挡=下肢缺失率；Z轴盲区=固定声明；透视压缩=距离标注不可靠） | 模拟模式下展示预设的缺陷分析示例 |

> **说明**：姿态检测使用前端 ML 库（TensorFlow.js）在浏览器本地运行，不调用平台插件服务，因此类型为「前端本地计算 + real-file 输入」。mock 兜底仅用于 Demo 模式和初始空状态演示。

---

## 功能列表

### 区域1: 视频上传区

- **页面目标**: 让研究者快速上传 SEBT 视频或进入演示模式
- **功能点**:
  - **拖拽上传**: 支持拖拽视频文件到上传区域，高亮反馈；支持 MP4/WebM 等浏览器可播放格式
  - **文件选择按钮**: 点击唤起系统文件选择器，限视频格式
  - **文件信息展示**: 上传后显示文件名、时长、分辨率、大小
  - **演示模式入口**: "Try Demo Mode" 按钮，加载模拟结果直接展示三大缺陷（无需上传视频）
  - **空状态引导**: 清晰的说明文字介绍工具用途和使用步骤

### 区域2: 视频预览与叠加区

- **页面目标**: 可视化展示姿态检测结果，让用户直观看到检测效果
- **功能点**:
  - **视频播放器**: 播放/暂停、进度条、倍速控制、全屏
  - **关键点叠加渲染**: Canvas 叠加层，在视频画面上绘制 COCO 17 关键点和骨架连线
  - **颜色编码系统**: 绿色=可靠检测（置信度≥0.7）、黄色=不确定（0.3~0.7）、红色=缺失/幻觉（<0.3 或解剖学不可能位置）
  - **实时置信度面板**: 右侧/下方显示 17 个关键点的当前帧置信度条形图，随播放实时更新
  - **幻觉检测标注**: 当关键点位置在解剖学上不可能（如顶视图中脚踝出现在躯干上方）时，用红色闪烁+感叹号图标标注
  - **逐帧处理进度**: 处理中显示进度条、已处理帧数、总帧数、预计剩余时间

### 区域3: 检测报告面板（核心输出）

- **页面目标**: 清晰、不可忽视地呈现检测结果与三大缺陷分析，是工具的核心交付物
- **功能点**:
  - **关键点检测总表**: 17 个 COCO 关键点逐一展示：是否检测到、平均置信度、检测帧数、缺失帧数、状态标签（绿/黄/红）
  - **缺陷一分析卡片（自遮挡 - 消失的脚）**: 统计下肢关键点（膝盖、脚踝）的缺失率，列出具体缺失百分比，配文字说明「躯干遮挡导致相机物理不可见」
  - **缺陷二分析卡片（Z 轴盲区 - 脚跟抬起）**: 醒目的 "BLIND" 红色标识，明确声明 2D 顶视无法检测 Z 轴运动（脚跟抬起），配示意图说明 X/Y 像素位移近乎为零
  - **缺陷三分析卡片（透视压缩 - 距离失真）**: 展示 2D 像素距离测量值，但用醒目的黄色/红色警告标注「UNRELIABLE for cm conversion」，说明透视压缩导致真实距离不可靠
  - **SEBT 星形参考图**: 8 方向星形图（anterior, anteromedial, medial, posteromedial, posterior, posterolateral, lateral, anterolateral），标注哪些方向受各缺陷影响最大
  - **总结/结论面板**: 醒目地展示结论「2D overhead pose estimation is NOT sufficient for clinical SEBT evaluation」，并列出三条证据要点，支持多相机/3D 方案的必要性

### 区域4: 处理状态区

- **页面目标**: 让用户了解当前处理进度和状态
- **功能点**:
  - **状态指示器**: 待上传 / 处理中 / 已完成 / 错误 四种状态，用图标+颜色区分
  - **进度反馈**: 处理中显示百分比进度条和帧数统计
  - **错误提示**: 视频格式不支持、模型加载失败等异常情况的友好提示

---

## 数据结构定义

### 核心数据接口

```ts
/** COCO 17 关键点名称 */
type KeypointName = 
  | 'nose' | 'left_eye' | 'right_eye' | 'left_ear' | 'right_ear'
  | 'left_shoulder' | 'right_shoulder' | 'left_elbow' | 'right_elbow'
  | 'left_wrist' | 'right_wrist' | 'left_hip' | 'right_hip'
  | 'left_knee' | 'right_knee' | 'left_ankle' | 'right_ankle';

/** 单帧单个关键点检测结果 */
interface FrameKeypoint {
  name: KeypointName;
  x: number;      // 像素坐标
  y: number;
  confidence: number;  // 0.0 ~ 1.0
  isHallucinated?: boolean;  // 是否为解剖学不可能位置
}

/** 单帧检测结果 */
interface FrameDetection {
  frameIndex: number;
  timestamp: number;  // 秒
  keypoints: FrameKeypoint[];
}

/** 单关键点汇总统计 */
interface KeypointSummary {
  name: KeypointName;
  bodyPartLabel: string;  // 显示用名称
  detected: boolean;      // 是否整体可检测
  avgConfidence: number;  // 平均置信度（仅统计检测到的帧）
  framesDetected: number; // 检测到的帧数
  framesMissing: number;  // 缺失的帧数
  detectionRate: number;  // 检测率 %
  status: 'reliable' | 'uncertain' | 'missing';  // 绿/黄/红
}

/** 三大缺陷分析结果 */
interface ThreeFlawsAnalysis {
  flaw1_selfOcclusion: {
    affectedKeypoints: KeypointName[];
    avgAbsenceRate: number;  // 平均缺失率 %
    details: string;
  };
  flaw2_verticalBlindness: {
    isDetectable: false;  // 固定为不可检测
    affectedMovements: string[];  // ['heel_lift', 'z_axis_motion']
    details: string;
  };
  flaw3_foreshortening: {
    pixelDistanceMeasured: number;  // 像素距离
    isReliableForCm: false;  // 固定为不可靠
    affectedDirections: string[];  // 受影响最大的 SEBT 方向
    details: string;
  };
}

/** SEBT 8 方向 */
type SebtDirection = 'anterior' | 'anteromedial' | 'medial' | 'posteromedial' 
  | 'posterior' | 'posterolateral' | 'lateral' | 'anterolateral';

/** 完整检测报告 */
interface DetectionReport {
  totalFrames: number;
  fps: number;
  duration: number;
  videoResolution: { width: number; height: number };
  keypointSummaries: KeypointSummary[];
  threeFlaws: ThreeFlawsAnalysis;
  sebtContext: {
    starPattern: SebtDirection[];
    directionFlawImpact: Record<SebtDirection, { flaw1: boolean; flaw2: boolean; flaw3: boolean; severity: 'high'|'medium'|'low' }>;
  };
  verdict: string;  // 结论文本
}
```

---

## 质量基线确认

- [x] 核心功能完整可用（视频上传 + 姿态检测处理 + 报告输出，非空壳）
- [x] 有基本的视觉层次（深色科研 UI、左右分栏、颜色编码系统）
- [x] 交互有反馈（拖拽高亮、处理进度、状态提示、关键点颜色反馈）
- [x] 边界状态有处理（空状态/Demo 模式、处理中、错误态、无视频初始态）
- [x] 检测报告不可忽视（右侧大面积固定面板、结论醒目展示）

-------

<scene_type>prototype-app</scene_type>

# UI 设计指南

## 1. 设计推导依据

- **参考意图**: Free Direction —— 无参考材料，从科研工具语义和视频分析场景自主建立视觉系统
- **核心情绪 / 应用类型**: 深色科研工具——冷静、数据密集、以证据为中心，用于证明 2D 俯视姿态估计在 SEBT 评估中的物理局限
- **独特记忆点**: 绿/黄/红三色关键点状态系统 + Z轴「BLIND」红色盲区标记 + 俯视星形 SEBT 示意图，三者共同构成「视觉化证据」的核心记忆锚点

## 2. Art Direction

- **方向名**: 深色科研观测台
- **Design Style**: Dark Clinical Research + Grid Data Dense —— 深色底降低视频分析环境光干扰，网格排版承载密集检测数据，冷静克制的科研气质
- **DNA 参数**: 圆角 subtle (`rounded-md`) / 阴影 subtle (`shadow-sm`，卡片用内发光替代外阴影) / 间距 compact (`gap-3`/`p-5`) / 字体方向：等宽数据 + 无衬线正文 / 装饰手法：细线分割、点阵状态指示、荧光式语义高亮
- **应用类型**: Tool —— 左侧视频主画布 + 右侧检测报告面板的工作台布局

## 3. Color System

**色彩关系**: 深空灰底 + 冷蓝主交互 + 荧光绿/琥珀黄/警示红三态检测色
**配色设计理由**: 深色背景服务于长时间视频分析工作；冷蓝作为主交互色，与临床科研的冷静感一致；绿/黄/红三态专用于关键点检测状态，形成强语义映射且不与主色竞争
**主色推导**: 从科研仪器的冷调蓝绿色谱中提取，偏青的冷蓝避免了高饱和蓝的视觉疲劳，适合深色界面的长时间使用
**使用比例**: 70% 中性深灰 / 20% 语义状态色 / 10% primary 冷蓝；primary 仅用于 CTA、激活 tab 和主进度指示；检测状态由绿/黄/红独立承担

| 角色 | CSS 变量 | Tailwind Class | HSL 值 | 设计说明 |
|---|---|---|---|---|
| bg | `--background` | `bg-background` | hsl(220 8% 8%) | 页面深空灰底，视频分析环境 |
| card | `--card` | `bg-card` | hsl(220 7% 12%) | 报告面板、表单、侧边卡片承载面 |
| text | `--foreground` | `text-foreground` | hsl(210 12% 92%) | 标题与正文，高对比可读 |
| textMuted | `--muted-foreground` | `text-muted-foreground` | hsl(215 8% 60%) | 辅助说明、元信息、表头标签 |
| primary | `--primary` | `bg-primary` / `text-primary` | hsl(195 85% 55%) | 主交互、CTA、上传按钮、进度条 |
| primaryForeground | `--primary-foreground` | `text-primary-foreground` | hsl(220 20% 98%) | primary 上的文字图标 |
| accent | `--accent` | `bg-accent` | hsl(220 6% 18%) | hover/focus 浅底、选中项、骨架屏 |
| accentForeground | `--accent-foreground` | `text-accent-foreground` | hsl(210 10% 85%) | accent 上的文字和图标 |
| border | `--border` | `border-border` | hsl(220 5% 20%) | 输入框、卡片、表格、菜单边界 |

**语义色提示**: 三态检测色独立于主色系统，饱和度与 primary 对齐 ±10%
- 可靠检测（绿）: bg `hsl(142 65% 40%)` / border `hsl(142 60% 32%)` / text `hsl(142 70% 75%)`
- 不确定（黄）: bg `hsl(42 90% 55%)` / border `hsl(42 80% 42%)` / text `hsl(42 95% 75%)`
- 缺失/盲区（红）: bg `hsl(0 75% 55%)` / border `hsl(0 65% 40%)` / text `hsl(0 80% 78%)`
- BLIND 盲区标记使用红色带脉冲光晕，UNRELIABLE 警告使用琥珀黄带斜纹底纹

## 4. 字体与节奏

- **font-display**: Space Grotesk —— 几何感强，适合科研仪器界面的标题与数据头，强化精密观测气质
- **font-body**: Inter + Noto Sans SC —— 清晰中性，适合密集数据表格与长报告阅读；IBM Plex Mono 用于置信度数值、帧数、百分比等数据列
- **字号**: H1 text-3xl；H2 text-xl；body text-sm（数据密集场景）；muted text-xs。数据数值使用 font-mono 保持对齐
- **圆角**: 小 —— `rounded-md` 为主，关键数据徽章 `rounded-sm`，保持临床工具的锐利与秩序感

## 5. 全局布局契约

- **Reference Layout Use**: 按需求结构推导——视频分析区 + 检测报告区 + 结论区的三栏/二段式工作台
- **Page / Section Order**: 顶部标题栏 → 上传区（空状态）/ 视频+报告工作台（处理后）→ 三缺陷分析 → SEBT 星形图参考 → 总结论
- **Standard Content Zone**: Tool max-w-[1400px] + `mx-auto`，承载视频画布与报告面板的并排布局
- **Shell / Frame Alignment**: 同宽——内容容器与框架同宽，工作台内左右面板独立滚动
- **Padding & Rhythm**: `px-4 md:px-6 lg:px-8 py-6 md:py-8`，区块间距 `gap-6`，卡片内距 `p-5`
- **Full-bleed Zones**: 视频画布容器全宽受 card 约束，不做页面级全宽；上传区拖拽态可临时扩展视觉边界
- **Local Narrowing**: 上传说明、结论文本可局部收窄至 `max-w-3xl` 居中，提升可读性
- **Overflow Strategy**: 关键点检测表格使用 `overflow-x-auto`；右侧报告面板独立纵向滚动
- **Flexibility Boundary**: 允许移动端改为上下堆叠布局、调整卡片内边距；不允许切换主色、圆角系统或状态色映射

## 6. 视觉与动效

- **装饰**: 细线网格、点阵状态指示、荧光色微光边框
- **阴影/边界**: 轻——以 1px border 和 subtle inner glow 为主，避免深色界面的灰雾感；卡片用 `border border-border` 而非阴影区分层级
- **动效**: 克制——hover 用背景色微变 + 边框高亮；BLIND 标记有缓慢脉冲呼吸（2s 周期）；视频处理进度条用平滑填充；避免弹跳、缩放等浮夸动效

## 7. 组件原则

- 按钮、上传区、表格行、状态徽章必须有 Default / Hover / Active / Focus-visible / Disabled 状态
- Primary 冷蓝承担上传、处理、主操作；Outline 用于次要操作；Ghost 用于表格行内操作和面板切换
- 状态徽章（绿/黄/红）必须同时包含颜色 + 文字标签 + 形状（圆点/方块），不依赖纯颜色表达
- 空状态、加载中、处理中状态延续深色科研语言，用点阵进度、骨架屏和等宽计数呈现

## 8. Image Direction

- **Image Role**: 内容插画（SEBT 星形示意图）+ 状态图形（Z 轴盲区示意）
- **Image Art Direction**: 俯视视角的极简线描科技插画，深底荧光色线条；SEBT 星形图为 8 向辐射的细线星芒，标注 8 个方向英文名；Z 轴盲区示意用俯视人物剪影 + 红色虚线 Z 轴箭头 + BLIND 横条标记；整体风格统一为细线 + 荧光色点缀 + 深色底
- **Image Prompt Keywords**: top-down view diagram, SEBT star pattern 8 directions, minimal line art, dark background, cyan and amber accent lines, clinical research illustration, orthographic projection, thin strokes, technical drawing style, Z-axis blind spot indicator
- **Image Avoidance**: 避免 3D 渲染人物、写实医护照片、卡通风格、彩色渐变填充、俯视角度不准确的示意、过于装饰性的图标

## 9. Anti-patterns

- **Split personality**: 上传页用浅色、报告页用深色；全站统一深空灰基底与冷蓝主交互
- **Phantom tokens**: 编造不存在的 status-success 等 shadcn 变量；语义色通过自定义 class 或语义色 token 统一管理
- **Default SaaS drift**: 回到默认蓝紫渐变按钮和通用卡片堆叠；用冷青蓝 + 荧光三态检测色建立科研工具识别
- **Invisible interaction**: 只做 hover 不做 focus-visible；每个可交互元素都要有明确的键盘焦点环（冷蓝外发光）
- **Mono-hue tyranny**: 主按钮、tab、icon、边框、链接全用 primary；按 70-20-10 把 primary 收回到 CTA 与进度指示，检测状态由独立三色系统承担
- **Status color drift**: 绿/黄/红饱和度过高，在深色底上刺眼；语义色饱和度与 primary 对齐 ±10%，兼顾辨识度与舒适度