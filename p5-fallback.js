(function () {
  // 课堂或展陈环境没有外网时，补齐本项目用到的 p5 全局绘图函数。
  // 一旦真正的 p5.js 成功加载，这个文件会直接退出。
  if (window.p5) return;

  const TAU = Math.PI * 2;
  let canvas = null;
  let ctx = null;
  let doFill = true;
  let doStroke = false;
  let currentFill = "rgba(255,255,255,1)";
  let currentStroke = "rgba(255,255,255,1)";
  let currentWeight = 1;
  let imageAlpha = 1;
  let shapePoints = [];
  const stateStack = [];

  Object.defineProperties(window, {
    windowWidth: { get: () => window.innerWidth },
    windowHeight: { get: () => window.innerHeight },
    drawingContext: { get: () => ctx },
    PI: { value: Math.PI },
    TWO_PI: { value: TAU },
    SCREEN: { value: "screen" },
    MULTIPLY: { value: "multiply" },
    CLOSE: { value: "close" },
  });

  window.frameCount = 0;
  window.mouseX = 0;
  window.mouseY = 0;

  window.createCanvas = function (width, height) {
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
    resizeBackingStore(width, height);
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    canvas.addEventListener("pointermove", updateMouse);
    canvas.addEventListener("pointerdown", (event) => {
      updateMouse(event);
      if (typeof window.mousePressed === "function") window.mousePressed();
    });

    document.body.prepend(canvas);
    return {
      elt: canvas,
      parent(id) {
        const parent = typeof id === "string" ? document.getElementById(id) : id;
        if (parent) parent.appendChild(canvas);
      },
    };
  };

  window.resizeCanvas = function (width, height) {
    if (!canvas) return;
    resizeBackingStore(width, height);
  };

  window.pixelDensity = function () {};

  window.createCapture = function (constraints, ready) {
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.display = "none";
    document.body.appendChild(video);

    const capture = {
      elt: video,
      width: 640,
      height: 480,
      hide() {
        video.style.display = "none";
      },
      size(width, height) {
        this.width = width;
        this.height = height;
        video.width = width;
        video.height = height;
      },
      remove() {
        video.remove();
      },
    };

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia(constraints)
        .then((stream) => {
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            capture.width = video.videoWidth || capture.width;
            capture.height = video.videoHeight || capture.height;
            if (ready) ready();
          };
        })
        .catch(() => {});
    } else if (ready) {
      ready();
    }

    return capture;
  };

  window.color = function (value) {
    if (typeof value === "object") return value;
    const hex = String(value).replace("#", "").trim();
    const normalized =
      hex.length === 3
        ? hex
            .split("")
            .map((char) => char + char)
            .join("")
        : hex;
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16),
      a: 255,
    };
  };

  window.lerpColor = function (from, to, amount) {
    const a = clamp01(amount);
    return {
      r: lerpValue(from.r, to.r, a),
      g: lerpValue(from.g, to.g, a),
      b: lerpValue(from.b, to.b, a),
      a: lerpValue(from.a || 255, to.a || 255, a),
    };
  };

  window.red = (value) => value.r;
  window.green = (value) => value.g;
  window.blue = (value) => value.b;
  window.lerp = lerpValue;
  window.constrain = (value, low, high) => Math.min(Math.max(value, low), high);
  window.map = (value, start1, stop1, start2, stop2) =>
    start2 + ((value - start1) / (stop1 - start1)) * (stop2 - start2);
  window.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  window.random = random;
  window.noise = noise;

  [
    "sin",
    "cos",
    "pow",
    "abs",
    "max",
    "min",
    "round",
    "floor",
  ].forEach((name) => {
    window[name] = Math[name];
  });

  window.noFill = function () {
    doFill = false;
  };

  window.noStroke = function () {
    doStroke = false;
  };

  window.fill = function (...args) {
    doFill = true;
    currentFill = makeRgba(args);
  };

  window.stroke = function (...args) {
    doStroke = true;
    currentStroke = makeRgba(args);
  };

  window.strokeWeight = function (weight) {
    currentWeight = weight;
  };

  window.rect = function (x, y, width, height) {
    applyPaint();
    if (doFill) ctx.fillRect(x, y, width, height);
    if (doStroke) ctx.strokeRect(x, y, width, height);
  };

  window.ellipse = function (x, y, width, height) {
    applyPaint();
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, TAU);
    paintPath();
  };

  window.triangle = function (x1, y1, x2, y2, x3, y3) {
    applyPaint();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    paintPath();
  };

  window.line = function (x1, y1, x2, y2) {
    applyPaint();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    if (doStroke) ctx.stroke();
  };

  window.arc = function (x, y, width, height, start, stop) {
    applyPaint();
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(width) / 2, Math.abs(height) / 2, 0, start, stop);
    paintPath(false);
  };

  window.beginShape = function () {
    shapePoints = [];
  };

  window.curveVertex = function (x, y) {
    shapePoints.push({ x, y });
  };

  window.endShape = function (mode) {
    if (!shapePoints.length) return;
    applyPaint();
    ctx.beginPath();
    ctx.moveTo(shapePoints[0].x, shapePoints[0].y);
    for (let index = 1; index < shapePoints.length; index += 1) {
      ctx.lineTo(shapePoints[index].x, shapePoints[index].y);
    }
    if (mode === "close") ctx.closePath();
    paintPath();
  };

  window.image = function (source, x, y, width, height) {
    const element = source && source.elt ? source.elt : source;
    if (!element) return;
    try {
      ctx.save();
      ctx.globalAlpha *= imageAlpha;
      ctx.drawImage(element, x, y, width, height);
      ctx.restore();
    } catch (_) {
      // The video may not have a drawable frame yet.
    }
  };

  window.tint = function (...args) {
    imageAlpha = args.length > 1 ? args[1] / 255 : 1;
  };

  window.noTint = function () {
    imageAlpha = 1;
  };

  window.push = function () {
    stateStack.push({ doFill, doStroke, currentFill, currentStroke, currentWeight, imageAlpha });
    ctx.save();
  };

  window.pop = function () {
    const state = stateStack.pop();
    if (state) {
      doFill = state.doFill;
      doStroke = state.doStroke;
      currentFill = state.currentFill;
      currentStroke = state.currentStroke;
      currentWeight = state.currentWeight;
      imageAlpha = state.imageAlpha;
    }
    ctx.restore();
  };

  window.translate = (x, y) => ctx.translate(x, y);
  window.scale = (x, y) => ctx.scale(x, y == null ? x : y);
  window.rotate = (angle) => ctx.rotate(angle);

  window.blendMode = function (mode) {
    const modes = {
      screen: "screen",
      multiply: "multiply",
    };
    ctx.globalCompositeOperation = modes[mode] || "source-over";
  };

  window.addEventListener("resize", () => {
    if (typeof window.windowResized === "function") window.windowResized();
  });

  window.requestAnimationFrame(function startFallback() {
    if (typeof window.setup === "function") window.setup();
    loop();
  });

  function loop() {
    window.frameCount += 1;
    if (typeof window.draw === "function") window.draw();
    window.requestAnimationFrame(loop);
  }

  function resizeBackingStore(width, height) {
    const ratio = window.devicePixelRatio || 1;
    window.width = width;
    window.height = height;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function updateMouse(event) {
    window.mouseX = event.clientX;
    window.mouseY = event.clientY;
  }

  function makeRgba(args) {
    if (typeof args[0] === "object") {
      const colorValue = args[0];
      const alpha = args.length > 1 ? args[1] : colorValue.a == null ? 255 : colorValue.a;
      return `rgba(${colorValue.r},${colorValue.g},${colorValue.b},${alpha / 255})`;
    }
    const [r = 255, g = r, b = r, a = 255] = args;
    return `rgba(${r},${g},${b},${a / 255})`;
  }

  function applyPaint() {
    ctx.fillStyle = currentFill;
    ctx.strokeStyle = currentStroke;
    ctx.lineWidth = currentWeight;
  }

  function paintPath(allowFill = true) {
    if (allowFill && doFill) ctx.fill();
    if (doStroke) ctx.stroke();
  }

  function random(minOrMax, maybeMax) {
    if (Array.isArray(minOrMax)) {
      return minOrMax[Math.floor(Math.random() * minOrMax.length)];
    }
    if (minOrMax == null) return Math.random();
    if (maybeMax == null) return Math.random() * minOrMax;
    return minOrMax + Math.random() * (maybeMax - minOrMax);
  }

  function noise(x = 0, y = 0, z = 0) {
    const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return value - Math.floor(value);
  }

  function lerpValue(from, to, amount) {
    return from + (to - from) * amount;
  }

  function clamp01(value) {
    return Math.min(Math.max(value, 0), 1);
  }
})();
