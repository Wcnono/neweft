const EFT_POINTS = [
  { id: "crown", label: "头顶" },
  { id: "eyebrow", label: "眉头" },
  { id: "eyeSide", label: "眼侧" },
  { id: "underEye", label: "眼下" },
  { id: "underNose", label: "人中" },
  { id: "chin", label: "下巴" },
  { id: "collarbone", label: "锁骨" },
];

const EMOTIONS = {
  anxiety: {
    label: "焦虑",
    start: "#6F2432",
    deep: "#16080E",
    accent: "#FF8A7A",
    agitation: 1.18,
    density: 1.2,
    drift: 1,
  },
  stress: {
    label: "压力",
    start: "#1F4A3D",
    deep: "#071410",
    accent: "#8AD7BB",
    agitation: 1.05,
    density: 1.08,
    drift: 0.82,
  },
  fatigue: {
    label: "疲惫",
    start: "#244A72",
    deep: "#071021",
    accent: "#8BC7FF",
    agitation: 0.62,
    density: 0.72,
    drift: 0.52,
  },
  sadness: {
    label: "悲伤",
    start: "#4A2F72",
    deep: "#100821",
    accent: "#C9A7FF",
    agitation: 0.82,
    density: 0.9,
    drift: 0.7,
  },
  numbness: {
    label: "麻木",
    start: "#7A641E",
    deep: "#161207",
    accent: "#FFE08A",
    agitation: 0.42,
    density: 0.56,
    drift: 0.36,
  },
};

const REQUIRED_TAPS = 7;
const TIP_INDEXES = [4, 8, 12, 16, 20];

// 页面状态只负责流程切换；视觉强度由 EFT 进度和情绪输入共同驱动。
let appState = "entry";
let selectedEmotion = "anxiety";
let initialIntensity = 8;
let afterIntensity = 4;

let ui = {};
let particles = [];
let visualProgress = 0;
let targetProgress = 0;
let tapFlash = 0;

let currentPointIndex = 0;
let currentTapCount = 0;
let trackedPoints = new Map();
let tapTracker = createTapTracker();

let video;
let poseModel;
let handsModel;
let mediaStarted = false;
let modelsReady = false;
let mediaMode = "none";
let cameraReady = false;
let mediaMessage = "点击后开启摄像头";
let analyzingFrame = false;
let mediaIntervalId = null;
let poseLandmarks = null;
let handLandmarks = [];
let motionCanvas;
let motionContext;
let previousMotionFrame = null;
let lastMotionFrame = -999;
let cameraNeedsRetry = false;
let handFeedback = {
  tips: [],
  nearest: null,
  distance: Infinity,
};

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-holder");
  pixelDensity(1);
  noStroke();
  bindUI();
  buildParticles();
  updatePanels();
}

function draw() {
  updateVisualProgress();
  const palette = makePalette(visualProgress);

  drawGradientBackground(palette);
  drawCameraLayer(palette);
  drawParticleField(palette);
  drawBreathingField(palette);

  if (appState === "session") {
    updateEftTargets();
    drawBodyEnergyMap(palette);
    detectTapGesture();
    drawEftTargets(palette);
    drawHandFeedback(palette);
    updateSessionUI();
  } else if (appState === "complete") {
    drawCompletionLight(palette);
  }

  tapFlash *= 0.88;
}

function bindUI() {
  ui.entryPanel = document.getElementById("entry-panel");
  ui.sessionPanel = document.getElementById("session-panel");
  ui.completePanel = document.getElementById("complete-panel");
  ui.emotionButtons = [...document.querySelectorAll(".emotion-choice")];
  ui.intensitySlider = document.getElementById("intensity-slider");
  ui.intensityValue = document.getElementById("intensity-value");
  ui.startButton = document.getElementById("start-button");
  ui.restartButton = document.getElementById("restart-button");
  ui.sessionEmotion = document.getElementById("session-emotion");
  ui.pointLabel = document.getElementById("point-label");
  ui.tapDots = document.getElementById("tap-dots");
  ui.progressLabel = document.getElementById("progress-label");
  ui.cameraStatus = document.getElementById("camera-status");
  ui.cameraRetry = document.getElementById("camera-retry");
  ui.beforeIntensity = document.getElementById("before-intensity");
  ui.afterIntensity = document.getElementById("after-intensity");

  ui.emotionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedEmotion = button.dataset.emotion;
      ui.emotionButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      buildParticles();
    });
  });

  ui.intensitySlider.addEventListener("input", () => {
    initialIntensity = Number(ui.intensitySlider.value);
    ui.intensityValue.textContent = initialIntensity;
  });

  ui.startButton.addEventListener("click", beginSession);
  ui.restartButton.addEventListener("click", resetToEntry);
  ui.cameraRetry.addEventListener("click", retryCamera);

  renderTapDots();
}

function beginSession() {
  initialIntensity = Number(ui.intensitySlider.value);
  afterIntensity = max(1, round(initialIntensity * 0.5));
  currentPointIndex = 0;
  currentTapCount = 0;
  targetProgress = 0;
  visualProgress = 0;
  tapTracker = createTapTracker();
  previousMotionFrame = null;
  cameraNeedsRetry = false;
  poseLandmarks = null;
  handLandmarks = [];
  trackedPoints.clear();
  appState = "session";
  mediaMessage = "请允许浏览器使用摄像头";
  updatePanels();
  ensureCameraAndTracking();
}

function resetToEntry() {
  stopCamera();
  appState = "entry";
  targetProgress = 0;
  visualProgress = 0;
  tapFlash = 0;
  updatePanels();
  buildParticles();
}

function completeSession() {
  appState = "complete";
  targetProgress = 1;
  ui.beforeIntensity.textContent = initialIntensity;
  ui.afterIntensity.textContent = afterIntensity;
  updatePanels();
  stopCamera();
}

function updatePanels() {
  ui.entryPanel.classList.toggle("is-hidden", appState !== "entry");
  ui.sessionPanel.classList.toggle("is-hidden", appState !== "session");
  ui.completePanel.classList.toggle("is-hidden", appState !== "complete");

  if (appState === "session") {
    ui.sessionEmotion.textContent = EMOTIONS[selectedEmotion].label;
    updateSessionUI(true);
  }
}

function renderTapDots() {
  ui.tapDots.innerHTML = "";
  for (let index = 0; index < REQUIRED_TAPS; index += 1) {
    const dot = document.createElement("span");
    dot.className = "tap-dot";
    ui.tapDots.appendChild(dot);
  }
}

function updateSessionUI(force = false) {
  if (appState !== "session" && !force) return;

  const point = EFT_POINTS[currentPointIndex] || EFT_POINTS[0];
  ui.pointLabel.textContent = `${currentPointIndex + 1}/${EFT_POINTS.length} · ${point.label}`;
  ui.progressLabel.textContent = `${round(targetProgress * 100)}%`;

  [...ui.tapDots.children].forEach((dot, index) => {
    dot.classList.toggle("is-filled", index < currentTapCount);
  });

  if (!mediaStarted || !cameraReady) {
    ui.cameraStatus.textContent = mediaMessage;
    ui.cameraStatus.classList.remove("is-muted");
  } else if (mediaMode === "mediapipe" && !poseLandmarks) {
    ui.cameraStatus.textContent = "请让上半身进入画面";
    ui.cameraStatus.classList.remove("is-muted");
  } else if (mediaMode === "mediapipe" && !handFeedback.tips.length) {
    ui.cameraStatus.textContent = "手进入画面后会出现指尖光点";
    ui.cameraStatus.classList.remove("is-muted");
  } else if (mediaMode === "motion") {
    ui.cameraStatus.textContent = "对齐光圈，用手敲击发光感应区";
    ui.cameraStatus.classList.remove("is-muted");
  } else {
    ui.cameraStatus.classList.add("is-muted");
  }

  ui.cameraRetry.classList.toggle("is-hidden", !cameraNeedsRetry || appState !== "session");
}

function ensureCameraAndTracking() {
  if (mediaStarted) return;
  mediaStarted = true;

  // 摄像头与识别模型只在开始 EFT 后启动，避免进入页打断沉浸感。
  startCamera()
    .then(() => {
      cameraReady = true;
      cameraNeedsRetry = false;
      mediaMessage = "摄像头已开启";
      ensureMediaPipeModels();
    })
    .catch((error) => {
      cameraReady = false;
      mediaStarted = false;
      mediaMode = "none";
      cameraNeedsRetry = true;
      mediaMessage = getCameraErrorMessage(error);
    });
}

function retryCamera() {
  if (appState !== "session") return;
  stopCamera();
  cameraNeedsRetry = false;
  mediaMessage = "请允许浏览器使用摄像头";
  updateSessionUI(true);
  ensureCameraAndTracking();
}

function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.reject(new Error("unsupported"));
  }

  const videoElement = document.createElement("video");
  videoElement.autoplay = true;
  videoElement.muted = true;
  videoElement.playsInline = true;
  videoElement.setAttribute("playsinline", "");
  videoElement.style.display = "none";
  document.body.appendChild(videoElement);

  video = {
    elt: videoElement,
    hide() {
      videoElement.style.display = "none";
    },
    remove() {
      videoElement.remove();
    },
  };

  return navigator.mediaDevices
    .getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 720 },
        height: { ideal: 960 },
      },
      audio: false,
    })
    .then((stream) => {
      videoElement.srcObject = stream;
      return new Promise((resolve) => {
        videoElement.onloadedmetadata = () => {
          videoElement.play();
          resolve();
        };
      });
    })
    .catch((error) => {
      videoElement.remove();
      video = null;
      throw error;
    });
}

function ensureMediaPipeModels() {
  if (typeof Pose !== "function" || typeof Hands !== "function") {
    mediaMode = "motion";
    mediaMessage = "摄像头已开启：对齐光点真实敲击";
    return;
  }

  poseModel = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });
  poseModel.setOptions({
    modelComplexity: 0,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });
  poseModel.onResults((results) => {
    poseLandmarks = results.poseLandmarks || null;
  });

  handsModel = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });
  handsModel.setOptions({
    maxNumHands: 2,
    modelComplexity: 0,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.5,
  });
  handsModel.onResults((results) => {
    handLandmarks = results.multiHandLandmarks || [];
  });

  modelsReady = true;
  mediaMode = "mediapipe";
  mediaIntervalId = window.setInterval(processMediaFrame, 70);
}

async function processMediaFrame() {
  if (
    appState !== "session" ||
    !modelsReady ||
    analyzingFrame ||
    !video ||
    video.elt.readyState < 2
  ) {
    return;
  }

  analyzingFrame = true;
  try {
    await poseModel.send({ image: video.elt });
    await handsModel.send({ image: video.elt });
  } catch (error) {
    mediaMode = "motion";
    modelsReady = false;
    mediaMessage = "识别不稳定，已切换真实敲击检测";
    console.warn(error);
  } finally {
    analyzingFrame = false;
  }
}

function stopCamera() {
  if (mediaIntervalId) {
    window.clearInterval(mediaIntervalId);
  }
  if (video && video.elt && video.elt.srcObject) {
    video.elt.srcObject.getTracks().forEach((track) => track.stop());
  }
  if (video) {
    video.remove();
  }
  video = null;
  cameraReady = false;
  mediaStarted = false;
  modelsReady = false;
  mediaMode = "none";
  mediaIntervalId = null;
  cameraNeedsRetry = false;
  poseModel = null;
  handsModel = null;
  poseLandmarks = null;
  handLandmarks = [];
  handFeedback = { tips: [], nearest: null, distance: Infinity };
  previousMotionFrame = null;
}

function updateVisualProgress() {
  if (appState === "entry") {
    targetProgress = 0;
  }
  visualProgress = lerp(visualProgress, targetProgress, 0.018);
}

function updateProgressTarget() {
  targetProgress = constrain(
    (currentPointIndex + currentTapCount / REQUIRED_TAPS) / EFT_POINTS.length,
    0,
    1,
  );
}

function registerTap() {
  if (frameCount - tapTracker.lastFrame < 14) return;
  tapTracker.lastFrame = frameCount;
  tapFlash = 1;
  currentTapCount += 1;

  if (currentTapCount >= REQUIRED_TAPS) {
    currentTapCount = REQUIRED_TAPS;
    updateProgressTarget();
    window.setTimeout(() => {
      currentPointIndex += 1;
      currentTapCount = 0;
      if (currentPointIndex >= EFT_POINTS.length) {
        completeSession();
      } else {
        updateProgressTarget();
        tapTracker.near = false;
        tapTracker.motionActive = false;
        tapTracker.minDistance = Infinity;
        tapTracker.lastTip = null;
        previousMotionFrame = null;
        renderTapDots();
      }
    }, 260);
  } else {
    updateProgressTarget();
  }
}

function makePalette(progress) {
  // 每种情绪拥有自己的起始色，EFT 推进后都收束到同一个平静色。
  const profile = EMOTIONS[selectedEmotion];
  const start = color(profile.start);
  const middle = color("#5B7C88");
  const end = color("#DDF3EA");
  const warm = color("#FFF8EE");
  const night = color(profile.deep);
  const deepTeal = color("#243F44");
  const startAccent = color(profile.accent);
  const calmAccent = color("#95D5D0");

  const firstLeg = easeInOut(constrain(progress / 0.58, 0, 1));
  const secondLeg = easeInOut(constrain((progress - 0.58) / 0.42, 0, 1));
  const base = progress < 0.58 ? lerpColor(start, middle, firstLeg) : lerpColor(middle, end, secondLeg);
  const deep = progress < 0.58 ? lerpColor(night, deepTeal, firstLeg) : lerpColor(deepTeal, color("#EAF7F2"), secondLeg);
  const glow = progress < 0.5
    ? lerpColor(startAccent, calmAccent, easeInOut(progress * 2))
    : lerpColor(calmAccent, warm, easeInOut((progress - 0.5) * 2));
  const accent = progress < 0.5
    ? lerpColor(startAccent, calmAccent, progress * 2)
    : lerpColor(calmAccent, warm, (progress - 0.5) * 2);

  return { base, deep, glow, accent, end, warm, start };
}

function drawGradientBackground(palette) {
  const breath = getBreath();
  const ctx = drawingContext;
  const outer = max(width, height) * 0.85;

  ctx.save();
  const gradient = ctx.createRadialGradient(
    width * 0.5,
    height * (0.42 + breath * 0.03),
    max(width, height) * 0.04,
    width * 0.5,
    height * 0.52,
    outer,
  );
  gradient.addColorStop(0, rgba(palette.glow, 0.22 + breath * 0.1));
  gradient.addColorStop(0.35, rgba(palette.base, 0.94));
  gradient.addColorStop(1, rgba(palette.deep, 1));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  noStroke();
  fill(255, 255, 255, 10 + visualProgress * 18);
  rect(0, 0, width, height);
}

function drawCameraLayer() {
  if (appState !== "session" || !video || !cameraReady) return;

  push();
  translate(width, 0);
  scale(-1, 1);
  tint(255, 46 + visualProgress * 28);
  image(video, 0, 0, width, height);
  noTint();
  pop();

  push();
  blendMode(MULTIPLY);
  fill(20, 10, 36, 58 - visualProgress * 32);
  rect(0, 0, width, height);
  pop();
}

function buildParticles() {
  particles = [];
  const profile = EMOTIONS[selectedEmotion];
  const count = floor(constrain((width * height) / 9800, 58, 135) * profile.density);
  for (let index = 0; index < count; index += 1) {
    particles.push(new EmotionalParticle());
  }
}

function drawParticleField(palette) {
  // 粒子形态随进度从尖锐高频，过渡到液态流动，再收束为柔和漂浮。
  const energy = getEmotionEnergy();
  push();
  blendMode(SCREEN);
  particles.forEach((particle) => {
    particle.update(visualProgress, energy);
    particle.draw(palette, visualProgress, energy);
  });
  pop();
}

class EmotionalParticle {
  constructor() {
    this.reset(true);
  }

  reset(randomizeY = false) {
    this.x = random(width);
    this.y = randomizeY ? random(height) : height + random(20, 80);
    this.seed = random(1000);
    this.angle = random(TWO_PI);
    this.speed = random(0.18, 1.05);
    this.size = random(1.5, 5.2);
  }

  update(progress, energy) {
    const profile = EMOTIONS[selectedEmotion];
    const anxiety = pow(1 - progress, 1.4) * energy * profile.agitation;
    const flow = noise(this.x * 0.0022, this.y * 0.0022, frameCount * 0.004 + this.seed);
    const flowAngle = flow * TWO_PI * 2.2 + progress * 1.4;
    const lift = map(progress, 0, 1, 0.05, 0.58) * profile.drift;

    if (progress < 0.36) {
      this.angle += random(-0.16, 0.16) * anxiety;
      this.x += cos(this.angle) * this.speed + random(-2.5, 2.5) * anxiety;
      this.y += sin(this.angle) * this.speed + random(-2.5, 2.5) * anxiety;
    } else {
      this.x += cos(flowAngle) * (0.28 + energy * 0.52) + sin(frameCount * 0.01 + this.seed) * 0.18;
      this.y += sin(flowAngle) * (0.22 + energy * 0.34) - lift;
    }

    const margin = 24;
    if (this.x < -margin) this.x = width + margin;
    if (this.x > width + margin) this.x = -margin;
    if (this.y < -margin) this.y = height + margin;
    if (this.y > height + margin) this.y = -margin;
  }

  draw(palette, progress, energy) {
    const calm = easeInOut(progress);
    const alpha = map(progress, 0, 1, 62, 30) * (0.42 + energy * 0.5);
    const size = this.size * map(progress, 0, 1, 0.7, 1.8);

    push();
    translate(this.x, this.y);
    rotate(this.angle + frameCount * 0.003);
    noStroke();

    if (progress < 0.32) {
      fill(red(palette.accent), green(palette.accent), blue(palette.accent), alpha);
      const spike = size * (1.8 + energy * 2.2);
      triangle(-size, size, size, size * 0.3, random(-0.4, 0.4) * size, -spike);
    } else if (progress < 0.78) {
      noFill();
      stroke(red(palette.accent), green(palette.accent), blue(palette.accent), alpha * 0.7);
      strokeWeight(1);
      arc(0, 0, size * (4 + calm * 2), size * (2.4 + calm * 2), 0, PI + calm * PI * 0.4);
    } else {
      fill(red(palette.warm), green(palette.warm), blue(palette.warm), alpha * 0.48);
      ellipse(0, 0, size * 2.6, size * 2.6);
    }

    pop();
  }
}

function drawBreathingField(palette) {
  const center = getFieldCenter();
  const breath = getBreath();
  const energy = getEmotionEnergy();
  const baseRadius = min(width, height) * map(visualProgress, 0, 1, 0.18, 0.26);
  const roughness = map(visualProgress, 0, 1, 38, 6) * (0.65 + energy * 0.5);

  push();
  noFill();
  blendMode(SCREEN);
  for (let ring = 0; ring < 4; ring += 1) {
    const radius = baseRadius + ring * min(width, height) * 0.095 + breath * (24 + ring * 6);
    const alpha = map(ring, 0, 3, 92, 22) * (0.9 - visualProgress * 0.18);
    drawOrganicRing(center.x, center.y, radius, roughness / (ring + 1), palette.accent, alpha);
  }
  pop();
}

function drawOrganicRing(cx, cy, radius, roughness, strokeColor, alpha) {
  const points = visualProgress < 0.3 ? 72 : 124;
  stroke(red(strokeColor), green(strokeColor), blue(strokeColor), alpha);
  strokeWeight(0.9 + pow(1 - visualProgress, 1.4) * 0.48);
  beginShape();
  for (let index = 0; index <= points; index += 1) {
    const angle = (index / points) * TWO_PI;
    const noiseValue = noise(cos(angle) + 3.1, sin(angle) + 9.4, frameCount * 0.008);
    const sharp = sin(angle * 9 + frameCount * 0.22) * roughness * pow(1 - visualProgress, 2);
    const r = radius + (noiseValue - 0.5) * roughness + sharp;
    curveVertex(cx + cos(angle) * r, cy + sin(angle) * r);
  }
  endShape(CLOSE);
}

function drawBodyEnergyMap(palette) {
  const points = EFT_POINTS
    .map((point) => trackedPoints.get(point.id))
    .filter(Boolean);
  if (points.length < 2) return;

  const breath = getBreath();
  const energy = getEmotionEnergy();
  const instability = pow(1 - visualProgress, 1.45) * energy;
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const current = EFT_POINTS[currentPointIndex];
  const active = current && trackedPoints.get(current.id);
  const collarbone = trackedPoints.get("collarbone") || points[points.length - 1];
  const crown = trackedPoints.get("crown") || points[0];

  push();
  blendMode(SCREEN);
  drawingContext.shadowColor = rgba(palette.accent, 0.28);
  drawingContext.shadowBlur = 14 + breath * 16 + tapFlash * 18;

  noFill();
  for (let layer = 0; layer < 3; layer += 1) {
    stroke(red(palette.accent), green(palette.accent), blue(palette.accent), 38 - layer * 10);
    strokeWeight(1.2 - layer * 0.18);
    beginShape();
    points.forEach((point, index) => {
      const drift = getEnergyDrift(point, instability * (8 - layer * 2), index + layer * 11);
      curveVertex(point.x + drift.x, point.y + drift.y);
    });
    endShape();
  }

  points.forEach((point, index) => {
    const phase = frameCount * 0.018 + index * 0.72;
    const radius = 7 + sin(phase) * 1.7 + visualProgress * 2;
    noFill();
    stroke(red(palette.glow), green(palette.glow), blue(palette.glow), 28);
    strokeWeight(1);
    ellipse(point.x, point.y, radius * 3.8, radius * 3.8);
    noStroke();
    fill(red(palette.warm), green(palette.warm), blue(palette.warm), 36);
    ellipse(point.x, point.y, radius, radius);
  });

  const fieldHeight = max(120, collarbone.y - crown.y + getTapRadius() * 2.4);
  const fieldWidth = min(width, height) * (0.38 + breath * 0.03);
  stroke(red(palette.accent), green(palette.accent), blue(palette.accent), poseLandmarks ? 18 : 30);
  strokeWeight(1);
  ellipse(centerX, (crown.y + collarbone.y) * 0.5, fieldWidth, fieldHeight);

  if (active) {
    stroke(red(palette.glow), green(palette.glow), blue(palette.glow), 40 + tapFlash * 90);
    strokeWeight(1 + tapFlash);
    line(centerX, collarbone.y, active.x, active.y);
  }

  pop();
}

function getEnergyDrift(point, amount, seed) {
  return {
    x:
      (noise(point.x * 0.006 + seed, point.y * 0.006, frameCount * 0.011) - 0.5) *
      amount,
    y:
      (noise(point.x * 0.006, point.y * 0.006 + seed, frameCount * 0.011) - 0.5) *
      amount,
  };
}

function drawCompletionLight(palette) {
  const breath = getBreath();
  push();
  blendMode(SCREEN);
  noStroke();
  for (let index = 0; index < 5; index += 1) {
    const radius = min(width, height) * (0.18 + index * 0.16 + breath * 0.04);
    fill(red(palette.warm), green(palette.warm), blue(palette.warm), 16 - index * 2);
    ellipse(width * 0.5, height * 0.52, radius * 2.1, radius * 2.1);
  }
  pop();
}

function updateEftTargets() {
  const targets = poseLandmarks ? getPoseTargets() : getFallbackTargets();

  EFT_POINTS.forEach((point) => {
    const target = targets[point.id];
    const previous = trackedPoints.get(point.id) || target;
    trackedPoints.set(point.id, {
      x: lerp(previous.x, target.x, 0.22),
      y: lerp(previous.y, target.y, 0.22),
    });
  });
}

function getPoseTargets() {
  // 使用 MediaPipe Pose 的面部/肩部关键点估算 EFT 穴位位置。
  const nose = lmPoint(0);
  const leftEyeInner = lmPoint(1);
  const leftEyeOuter = lmPoint(3);
  const rightEyeInner = lmPoint(4);
  const rightEyeOuter = lmPoint(6);
  const leftEar = lmPoint(7);
  const rightEar = lmPoint(8);
  const mouthLeft = lmPoint(9);
  const mouthRight = lmPoint(10);
  const leftShoulder = lmPoint(11);
  const rightShoulder = lmPoint(12);

  if (!nose || !leftShoulder || !rightShoulder) return getFallbackTargets();

  const eyeCenter = averagePoint([leftEyeInner, rightEyeInner, leftEyeOuter, rightEyeOuter]) || nose;
  const browCenter = averagePoint([leftEyeInner, rightEyeInner]) || eyeCenter;
  const mouthCenter = averagePoint([mouthLeft, mouthRight]) || { x: nose.x, y: nose.y + 50 };
  const shoulderCenter = averagePoint([leftShoulder, rightShoulder]);
  const shoulderWidth = dist(leftShoulder.x, leftShoulder.y, rightShoulder.x, rightShoulder.y);
  const earWidth = leftEar && rightEar ? dist(leftEar.x, leftEar.y, rightEar.x, rightEar.y) : 0;
  const eyeWidth = leftEyeOuter && rightEyeOuter ? dist(leftEyeOuter.x, leftEyeOuter.y, rightEyeOuter.x, rightEyeOuter.y) : 0;
  const faceWidth = max(earWidth, eyeWidth * 2.3, width * 0.12);

  const eyeSide = leftEyeOuter && rightEyeOuter
    ? (leftEyeOuter.x < rightEyeOuter.x ? leftEyeOuter : rightEyeOuter)
    : { x: eyeCenter.x + faceWidth * 0.35, y: eyeCenter.y };

  return {
    crown: { x: nose.x, y: nose.y - faceWidth * 0.95 },
    eyebrow: { x: browCenter.x, y: browCenter.y - faceWidth * 0.08 },
    eyeSide: { x: eyeSide.x, y: eyeSide.y },
    underEye: { x: eyeCenter.x, y: eyeCenter.y + faceWidth * 0.22 },
    underNose: { x: nose.x, y: nose.y + faceWidth * 0.16 },
    chin: { x: mouthCenter.x, y: mouthCenter.y + faceWidth * 0.24 },
    collarbone: {
      x: shoulderCenter.x,
      y: shoulderCenter.y + shoulderWidth * 0.17,
    },
  };
}

function getFallbackTargets() {
  const cx = width * 0.5;
  const top = height * 0.25;
  const unit = min(width, height) * 0.085;
  return {
    crown: { x: cx, y: top - unit * 1.2 },
    eyebrow: { x: cx, y: top },
    eyeSide: { x: cx + unit * 1.05, y: top + unit * 0.58 },
    underEye: { x: cx, y: top + unit * 1.08 },
    underNose: { x: cx, y: top + unit * 1.72 },
    chin: { x: cx, y: top + unit * 2.38 },
    collarbone: { x: cx, y: top + unit * 4.22 },
  };
}

function drawEftTargets(palette) {
  const current = EFT_POINTS[currentPointIndex];
  const active = trackedPoints.get(current.id);
  if (!active) return;

  push();
  blendMode(SCREEN);
  EFT_POINTS.forEach((point) => {
    const position = trackedPoints.get(point.id);
    if (!position) return;
    const isCurrent = point.id === current.id;
    const pulse = isCurrent ? getBreath() : 0;
    const radius = isCurrent ? getTapRadius() * (0.92 + pulse * 0.16 + tapFlash * 0.22) : 6;

    noFill();
    stroke(red(palette.accent), green(palette.accent), blue(palette.accent), isCurrent ? 132 : 28);
    strokeWeight(isCurrent ? 1.6 : 1);
    ellipse(position.x, position.y, radius * 2, radius * 2);

    if (isCurrent) {
      noStroke();
      fill(red(palette.accent), green(palette.accent), blue(palette.accent), 13 + tapFlash * 32);
      ellipse(position.x, position.y, radius * 2.1, radius * 2.1);
    }

    noStroke();
    fill(red(palette.warm), green(palette.warm), blue(palette.warm), isCurrent ? 168 : 72);
    ellipse(position.x, position.y, isCurrent ? 9 + tapFlash * 8 : 5, isCurrent ? 9 + tapFlash * 8 : 5);
  });

  drawCurrentTargetAura(active, palette);
  pop();
}

function drawCurrentTargetAura(position, palette) {
  const breath = getBreath();
  const motionLevel = constrain(tapTracker.motionScore / getMotionThreshold(), 0, 1);
  noFill();
  for (let ring = 0; ring < 3; ring += 1) {
    const r = getTapRadius() * (0.95 + ring * 0.35 + breath * 0.22 + tapFlash * 0.28);
    stroke(red(palette.glow), green(palette.glow), blue(palette.glow), 54 - ring * 13);
    strokeWeight(1);
    ellipse(position.x, position.y, r * 2, r * 2);
  }

  if (mediaMode === "motion" && cameraReady) {
    stroke(red(palette.warm), green(palette.warm), blue(palette.warm), 32 + motionLevel * 98);
    strokeWeight(1.4 + motionLevel * 2.2);
    ellipse(
      position.x,
      position.y,
      getTapRadius() * (2.7 + motionLevel * 0.55),
      getTapRadius() * (2.7 + motionLevel * 0.55),
    );
  }
}

function drawHandFeedback(palette) {
  const current = EFT_POINTS[currentPointIndex];
  const active = current && trackedPoints.get(current.id);
  if (!active) return;

  if (!poseLandmarks) {
    drawAlignmentGuide(palette);
  }

  if (!handFeedback.tips.length) return;

  const radius = getTapRadius();
  const closeness = constrain(1 - handFeedback.distance / (radius * 2.6), 0, 1);

  push();
  blendMode(SCREEN);
  noFill();

  handFeedback.tips.forEach((tip) => {
    const tipCloseness = constrain(1 - dist(tip.x, tip.y, active.x, active.y) / (radius * 2.7), 0, 1);
    stroke(red(palette.warm), green(palette.warm), blue(palette.warm), 36 + tipCloseness * 108);
    strokeWeight(1);
    ellipse(tip.x, tip.y, 12 + tipCloseness * 8, 12 + tipCloseness * 8);
  });

  if (handFeedback.nearest) {
    stroke(red(palette.accent), green(palette.accent), blue(palette.accent), 24 + closeness * 96);
    strokeWeight(1 + closeness * 1.5);
    line(handFeedback.nearest.x, handFeedback.nearest.y, active.x, active.y);

    noStroke();
    fill(red(palette.warm), green(palette.warm), blue(palette.warm), 72 + closeness * 120);
    ellipse(handFeedback.nearest.x, handFeedback.nearest.y, 9 + closeness * 10, 9 + closeness * 10);
  }

  pop();
}

function drawAlignmentGuide(palette) {
  if (!cameraReady) return;
  const fallback = getFallbackTargets();
  const points = EFT_POINTS.map((point) => fallback[point.id]).filter(Boolean);
  const centerX = width * 0.5;

  push();
  blendMode(SCREEN);
  noFill();
  stroke(red(palette.accent), green(palette.accent), blue(palette.accent), 22);
  strokeWeight(1);
  beginShape();
  points.forEach((point, index) => {
    const offset = sin(frameCount * 0.012 + index * 0.8) * getTapRadius() * 0.08;
    curveVertex(point.x + offset, point.y);
  });
  endShape();

  points.forEach((point, index) => {
    const pulse = getBreath() * 4 + sin(frameCount * 0.018 + index) * 1.5;
    stroke(red(palette.glow), green(palette.glow), blue(palette.glow), 20);
    ellipse(point.x, point.y, getTapRadius() * 0.55 + pulse, getTapRadius() * 0.55 + pulse);
  });

  stroke(red(palette.warm), green(palette.warm), blue(palette.warm), 18);
  line(centerX, fallback.crown.y - getTapRadius() * 0.8, centerX, fallback.collarbone.y + getTapRadius() * 0.9);
  pop();
}

function detectTapGesture() {
  const current = EFT_POINTS[currentPointIndex];
  const active = trackedPoints.get(current.id);
  if (!active) return;

  const fingertips = getFingertips();
  handFeedback = {
    tips: fingertips,
    nearest: null,
    distance: Infinity,
  };

  if (!fingertips.length) {
    if (cameraReady && detectMotionTap(active)) {
      registerTap();
    }
    return;
  }

  let minDistance = Infinity;
  let nearest = null;
  fingertips.forEach((tip) => {
    const distance = dist(tip.x, tip.y, active.x, active.y);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = tip;
    }
  });

  handFeedback.nearest = nearest;
  handFeedback.distance = minDistance;

  const radius = getTapRadius() * 1.18;
  const near = minDistance < radius;
  const movedIn = tapTracker.minDistance - minDistance > radius * 0.13;
  const tipMotion = tapTracker.lastTip
    ? dist(nearest.x, nearest.y, tapTracker.lastTip.x, tapTracker.lastTip.y)
    : 0;
  const rhythmicTap = near && tipMotion > constrain(min(width, height) * 0.011, 5, 11);

  if (near && (!tapTracker.near || movedIn || rhythmicTap)) {
    registerTap();
  }

  tapTracker.near = near;
  tapTracker.minDistance = minDistance;
  tapTracker.lastTip = nearest;
}

function detectMotionTap(active) {
  if (!video || !video.elt || video.elt.readyState < 2) return false;
  if (frameCount - lastMotionFrame < 3) return false;
  lastMotionFrame = frameCount;

  const sample = getMotionSample(active);
  if (!sample) return false;

  const threshold = getMotionThreshold();
  const activeMotion = sample.score > threshold;
  const isNewTapMotion = activeMotion && !tapTracker.motionActive;

  tapTracker.motionActive = activeMotion;
  tapTracker.motionScore = sample.score;
  return isNewTapMotion;
}

function getMotionSample(active) {
  const ctx = getMotionContext();
  if (!ctx) return null;

  const sampleWidth = motionCanvas.width;
  const sampleHeight = motionCanvas.height;

  ctx.clearRect(0, 0, sampleWidth, sampleHeight);
  ctx.save();
  ctx.translate(sampleWidth, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video.elt, 0, 0, sampleWidth, sampleHeight);
  ctx.restore();

  const frame = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
  if (!previousMotionFrame) {
    previousMotionFrame = frame;
    return null;
  }

  const targetX = floor(constrain((active.x / width) * sampleWidth, 0, sampleWidth - 1));
  const targetY = floor(constrain((active.y / height) * sampleHeight, 0, sampleHeight - 1));
  const radius = floor(constrain((getTapRadius() / width) * sampleWidth * 2.15, 11, 32));
  const radiusSq = radius * radius;
  let totalDiff = 0;
  let peakDiff = 0;
  let count = 0;

  for (let y = max(0, targetY - radius); y <= min(sampleHeight - 1, targetY + radius); y += 2) {
    for (let x = max(0, targetX - radius); x <= min(sampleWidth - 1, targetX + radius); x += 2) {
      const dx = x - targetX;
      const dy = y - targetY;
      if (dx * dx + dy * dy > radiusSq) continue;

      const index = (y * sampleWidth + x) * 4;
      const diff =
        (abs(frame.data[index] - previousMotionFrame.data[index]) +
          abs(frame.data[index + 1] - previousMotionFrame.data[index + 1]) +
          abs(frame.data[index + 2] - previousMotionFrame.data[index + 2])) /
        3;

      totalDiff += diff;
      peakDiff = max(peakDiff, diff);
      count += 1;
    }
  }

  previousMotionFrame = frame;
  if (!count) return null;

  return {
    average: totalDiff / count,
    peak: peakDiff,
    score: totalDiff / count + peakDiff * 0.16,
  };
}

function getMotionThreshold() {
  return 12 + pow(1 - visualProgress, 1.25) * 3.5;
}

function getMotionContext() {
  if (!motionCanvas) {
    motionCanvas = document.createElement("canvas");
    motionCanvas.width = 96;
    motionCanvas.height = max(120, round((96 * height) / width));
    motionContext = motionCanvas.getContext("2d", { willReadFrequently: true });
  }
  return motionContext;
}

function getFingertips() {
  const tips = [];
  handLandmarks.forEach((hand) => {
    TIP_INDEXES.forEach((index) => {
      const landmark = hand[index];
      if (!landmark) return;
      tips.push({
        x: width - landmark.x * width,
        y: landmark.y * height,
      });
    });
  });
  return tips;
}

function mousePressed() {
  if (appState !== "session") return;
  const current = EFT_POINTS[currentPointIndex];
  const active = trackedPoints.get(current.id);
  if (active && dist(mouseX, mouseY, active.x, active.y) < getTapRadius()) {
    registerTap();
  }
}

function createTapTracker() {
  return {
    near: false,
    minDistance: Infinity,
    lastFrame: -999,
    motionActive: false,
    motionScore: 0,
    lastTip: null,
  };
}

function getCameraErrorMessage(error) {
  if (!window.isSecureContext && location.hostname !== "localhost") {
    return "需要在 localhost 或 HTTPS 页面中开启摄像头";
  }
  if (error && error.name === "NotAllowedError") {
    return "摄像头被拒绝，请在地址栏允许后重新开始";
  }
  if (error && error.name === "NotFoundError") {
    return "没有检测到摄像头";
  }
  return "摄像头不可用，请检查浏览器权限";
}

function lmPoint(index) {
  const landmark = poseLandmarks && poseLandmarks[index];
  if (!landmark) return null;
  const visibility = landmark.visibility == null ? 1 : landmark.visibility;
  if (visibility < 0.35) return null;
  return {
    x: width - landmark.x * width,
    y: landmark.y * height,
  };
}

function averagePoint(points) {
  const visible = points.filter(Boolean);
  if (!visible.length) return null;
  return {
    x: visible.reduce((sum, point) => sum + point.x, 0) / visible.length,
    y: visible.reduce((sum, point) => sum + point.y, 0) / visible.length,
  };
}

function getFieldCenter() {
  if (appState === "session") {
    const collarbone = trackedPoints.get("collarbone");
    const current = EFT_POINTS[currentPointIndex];
    const active = current && trackedPoints.get(current.id);
    if (active && collarbone) {
      return {
        x: lerp(active.x, collarbone.x, 0.34),
        y: lerp(active.y, collarbone.y, 0.34),
      };
    }
    if (active) return active;
  }
  return { x: width * 0.5, y: height * 0.5 };
}

function getTapRadius() {
  return constrain(min(width, height) * 0.075, 34, 58);
}

function getBreath() {
  return (sin(frameCount * 0.018) + 1) * 0.5;
}

function getEmotionEnergy() {
  const profile = EMOTIONS[selectedEmotion];
  const intensity = initialIntensity / 10;
  const release = pow(1 - visualProgress, 1.15);
  return constrain((0.24 + intensity * 0.86) * (0.22 + release * 0.78) * profile.agitation, 0.08, 1.28);
}

function easeInOut(value) {
  const x = constrain(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function rgba(p5Color, alpha = 1) {
  const value = alpha > 1 ? alpha / 255 : alpha;
  return `rgba(${round(red(p5Color))}, ${round(green(p5Color))}, ${round(blue(p5Color))}, ${value})`;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildParticles();
  trackedPoints.clear();
  motionCanvas = null;
  previousMotionFrame = null;
}
