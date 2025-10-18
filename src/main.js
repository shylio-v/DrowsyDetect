const videoEl = document.getElementById('video');
const canvasEl = document.getElementById('overlay');
const ctx = canvasEl.getContext('2d');

const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnRetry = document.getElementById('btnRetry');
const cbOverlay = document.getElementById('cbOverlay');
const selCamera = document.getElementById('selCamera');

const inpConfidence = document.getElementById('inpConfidence');
const lblConfidence = document.getElementById('lblConfidence');
const inpEarThresh = document.getElementById('inpEarThresh');
const lblEarThresh = document.getElementById('lblEarThresh');
const inpConsec = document.getElementById('inpConsec');
const lblConsec = document.getElementById('lblConsec');

const lblStatus = document.getElementById('lblStatus');
const lblFps = document.getElementById('lblFps');
const lblEar = document.getElementById('lblEar');
const lblDetection = document.getElementById('lblDetection');
const lblModel = document.getElementById('lblModel');
const alertEl = document.getElementById('alert');

let camera = null;
let faceMesh = null;
let running = false;
let lastFrameTs = performance.now();
let consecClosedFrames = 0;
let rafId = null;
let devices = [];

function format(num, digits = 2) {
  return Number(num).toFixed(digits);
}

function updateCanvasSize() {
  const rect = videoEl.getBoundingClientRect();
  canvasEl.width = rect.width * devicePixelRatio;
  canvasEl.height = rect.height * devicePixelRatio;
  canvasEl.style.width = rect.width + 'px';
  canvasEl.style.height = rect.height + 'px';
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// Compute Eye Aspect Ratio (EAR) from FaceMesh landmarks for one eye
// Using indices similar to dlib but adapted to MediaPipe:
// Left eye: [33, 246, 161, 160, 159, 158, 157, 173]
// Right eye: [263, 466, 388, 387, 386, 385, 384, 398]
function computeEyeEAR(landmarks, isLeft) {
  const idx = isLeft
    ? { outer: 33, inner: 133, top1: 159, top2: 158, bot1: 145, bot2: 153 }
    : { outer: 263, inner: 362, top1: 386, top2: 385, bot1: 374, bot2: 380 };

  const outer = landmarks[idx.outer];
  const inner = landmarks[idx.inner];
  const topAvg = { x: (landmarks[idx.top1].x + landmarks[idx.top2].x) / 2, y: (landmarks[idx.top1].y + landmarks[idx.top2].y) / 2 };
  const botAvg = { x: (landmarks[idx.bot1].x + landmarks[idx.bot2].x) / 2, y: (landmarks[idx.bot1].y + landmarks[idx.bot2].y) / 2 };

  const vertical = dist(topAvg, botAvg);
  const horizontal = dist(outer, inner);
  if (horizontal === 0) return 0;
  return vertical / horizontal;
}

function computeEAR(landmarks) {
  const left = computeEyeEAR(landmarks, true);
  const right = computeEyeEAR(landmarks, false);
  return (left + right) / 2;
}

function setStatus(text, ok = false) {
  lblStatus.textContent = text;
  lblStatus.className = ok ? 'ok' : '';
}

function setDetection(text, ok = false) {
  lblDetection.textContent = text;
  lblDetection.className = ok ? 'ok' : '';
}

function setModel(text, ok = false) {
  lblModel.textContent = text;
  lblModel.className = ok ? 'ok' : '';
}

function setAlert(visible) {
  alertEl.style.display = visible ? 'block' : 'none';
}

function drawLandmarks(landmarks) {
  if (!cbOverlay.checked) return;
  const w = canvasEl.width / devicePixelRatio;
  const h = canvasEl.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#22d3ee';
  ctx.fillStyle = '#22d3ee';
  ctx.lineWidth = 2;
  landmarks.forEach(pt => {
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, 2.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

async function initFaceMesh() {
  return new Promise((resolve, reject) => {
    try {
      setModel('正在加载...', false);
      
      // Check if MediaPipe is loaded
      if (typeof FaceMesh === 'undefined') {
        setModel('MediaPipe未加载', false);
        btnRetry.style.display = 'inline-block';
        reject(new Error('MediaPipe FaceMesh not loaded'));
        return;
      }
      
      console.log('开始初始化FaceMesh...');
      
      try {
        faceMesh = new FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });
        
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: parseFloat(inpConfidence.value),
          minTrackingConfidence: parseFloat(inpConfidence.value),
        });
        
        faceMesh.onResults(onResults);
        
        // Test if the model actually loads by trying to send a test image
        const testCanvas = document.createElement('canvas');
        testCanvas.width = 100;
        testCanvas.height = 100;
        const testCtx = testCanvas.getContext('2d');
        testCtx.fillRect(0, 0, 100, 100);
        
        faceMesh.send({ image: testCanvas }).then(() => {
          setModel('已加载', true);
          btnRetry.style.display = 'none';
          console.log('FaceMesh模型成功加载');
          resolve();
        }).catch((error) => {
          console.warn('FaceMesh测试失败:', error);
          setModel('模型测试失败', false);
          btnRetry.style.display = 'inline-block';
          reject(error);
        });
        
      } catch (error) {
        console.error('FaceMesh初始化失败:', error);
        setModel('初始化失败', false);
        btnRetry.style.display = 'inline-block';
        reject(error);
      }
      
    } catch (error) {
      setModel('初始化失败', false);
      reject(error);
    }
  });
}

function onResults(results) {
  const now = performance.now();
  const dt = (now - lastFrameTs) / 1000;
  lastFrameTs = now;
  const fps = dt > 0 ? 1 / dt : 0;
  lblFps.textContent = format(fps, 1);

  const w = canvasEl.width / devicePixelRatio;
  const h = canvasEl.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    lblEar.textContent = '-';
    consecClosedFrames = 0;
    setAlert(false);
    setDetection('未检测到人脸', false);
    return;
  }

  const landmarks = results.multiFaceLandmarks[0];
  const ear = computeEAR(landmarks);
  lblEar.textContent = format(ear, 3);
  setDetection('检测到人脸', true);

  drawLandmarks(landmarks);

  const earThresh = parseFloat(inpEarThresh.value);
  const consecNeeded = parseInt(inpConsec.value, 10);
  if (ear < earThresh) {
    consecClosedFrames += 1;
  } else {
    consecClosedFrames = 0;
  }
  setAlert(consecClosedFrames >= consecNeeded);
}

async function startCamera() {
  if (running) return;
  updateCanvasSize();
  
  // Initialize model in parallel; do not block camera permission prompt
  const modelReady = initFaceMesh().then(() => {
    setStatus('模型已加载，开始推理', true);
  }).catch((e) => {
    console.error('FaceMesh 初始化失败', e);
    setStatus('模型加载失败，使用基础检测', false);
    // Continue without FaceMesh - we'll show a basic status
  });
  
  try {
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      console.warn('非安全上下文，可能无法访问摄像头。请使用 localhost 或 HTTPS。');
    }

    videoEl.autoplay = true;
    
    // Get camera constraints based on selection
    const constraints = {
      video: {
        width: 640,
        height: 480,
        facingMode: 'user'
      }
    };
    
    if (selCamera.value) {
      constraints.video.deviceId = { exact: selCamera.value };
    }
    
    // Check if Camera is available
    if (typeof Camera === 'undefined') {
      throw new Error('MediaPipe Camera not loaded');
    }
    
    camera = new Camera(videoEl, {
      onFrame: async () => {
        if (!running || !faceMesh) return;
        try {
          await faceMesh.send({ image: videoEl });
        } catch (e) {
          console.warn('FaceMesh 处理失败:', e);
        }
      },
      width: 640,
      height: 480,
    });
    await camera.start();
    running = true;
    setStatus('已获取摄像头，加载模型中…', true);
    btnStart.disabled = true;
    btnStop.disabled = false;
  } catch (err) {
    console.error('CameraUtils.Camera 启动失败，尝试使用 getUserMedia 回退', err);
    setStatus('尝试回退到系统摄像头...', false);
    await startFallbackStream();
  }
}

async function stopCamera() {
  if (!running) return;
  running = false;
  try { await camera.stop(); } catch {}
  try { if (videoEl.srcObject) videoEl.srcObject.getTracks().forEach(t => t.stop()); } catch {}
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  setStatus('已停止');
  btnStart.disabled = false;
  btnStop.disabled = true;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  setAlert(false);
}

btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);
btnRetry.addEventListener('click', async () => {
  btnRetry.style.display = 'none';
  setModel('正在重试...', false);
  try {
    await initFaceMesh();
    setStatus('模型重试成功', true);
  } catch (e) {
    console.error('重试失败:', e);
    setStatus('重试失败，请检查网络', false);
  }
});

inpConfidence.addEventListener('input', () => {
  lblConfidence.textContent = format(inpConfidence.value, 2);
  if (faceMesh) {
    faceMesh.setOptions({
      minDetectionConfidence: parseFloat(inpConfidence.value),
      minTrackingConfidence: parseFloat(inpConfidence.value),
    });
  }
});
inpEarThresh.addEventListener('input', () => lblEarThresh.textContent = format(inpEarThresh.value, 3));
inpConsec.addEventListener('input', () => lblConsec.textContent = inpConsec.value);

window.addEventListener('resize', updateCanvasSize);

// Initialize labels
lblConfidence.textContent = format(inpConfidence.value, 2);
lblEarThresh.textContent = format(inpEarThresh.value, 3);
lblConsec.textContent = inpConsec.value;
setStatus('未启动');
setDetection('无');
setModel('未加载');

// Load camera devices
async function loadCameraDevices() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      console.warn('浏览器不支持设备枚举');
      return;
    }
    
    const deviceList = await navigator.mediaDevices.enumerateDevices();
    devices = deviceList.filter(device => device.kind === 'videoinput');
    
    // Clear existing options except the first one
    while (selCamera.children.length > 1) {
      selCamera.removeChild(selCamera.lastChild);
    }
    
    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `摄像头 ${index + 1}`;
      selCamera.appendChild(option);
    });
    
    console.log(`找到 ${devices.length} 个摄像头设备`);
  } catch (error) {
    console.error('枚举摄像头设备失败:', error);
  }
}

// Load devices on page load
loadCameraDevices();

// Check MediaPipe availability on page load
window.addEventListener('load', () => {
  setTimeout(() => {
    if (typeof FaceMesh === 'undefined') {
      setModel('MediaPipe未加载', false);
      btnRetry.style.display = 'inline-block';
      console.error('MediaPipe FaceMesh not available');
    }
    if (typeof Camera === 'undefined') {
      console.error('MediaPipe Camera not available');
    }
  }, 2000); // Wait 2 seconds for scripts to load
});

async function startFallbackStream() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('该浏览器不支持摄像头 API', false);
      return;
    }
    
    const constraints = {
      video: {
        width: 640,
        height: 480,
        facingMode: 'user'
      },
      audio: false
    };
    
    if (selCamera.value) {
      constraints.video.deviceId = { exact: selCamera.value };
    }
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await videoEl.play().catch(() => {});
    running = true;
    setStatus('运行中(回退模式)', true);
    btnStart.disabled = true;
    btnStop.disabled = false;
    const loop = async () => {
      if (!running) return;
      try {
        if (faceMesh) {
          await faceMesh.send({ image: videoEl });
        }
      } catch (e) {
        // ignore per-frame errors
      }
      rafId = requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    console.error('getUserMedia 启动失败', e);
    const msg = e && e.name === 'NotAllowedError' ? '被拒绝访问摄像头' : '无法启动摄像头';
    setStatus(msg, false);
    alert(msg + '。若为本地文件，请改用本地服务器(如 http://localhost:8000) 并允许权限。');
  }
}


