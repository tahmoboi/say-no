// SAY NO — game logic

const GAME_DURATION = 20;

const screens = {
  landing: document.getElementById('screen-landing'),
  game:    document.getElementById('screen-game'),
  result:  document.getElementById('screen-result'),
};

const videoEl          = document.getElementById('video');
const canvasEl         = document.getElementById('canvas');
const ctx              = canvasEl.getContext('2d');
const hudEl            = document.getElementById('hud');
const hudTime          = document.getElementById('hud-time');
const hudScore         = document.getElementById('hud-score');
const countdownEl      = document.getElementById('countdown-overlay');
const countdownNum     = document.getElementById('countdown-number');
const xFlash           = document.getElementById('x-flash');
const errorOverlay     = document.getElementById('error-overlay');
const errorMsg         = document.getElementById('error-msg');
const detectionOverlay = document.getElementById('detection-overlay');
const detDot           = document.getElementById('det-dot');
const detLabel         = document.getElementById('det-label');
const detReady         = document.getElementById('det-ready');
const btnBegin         = document.getElementById('btn-begin');
const resultScore      = document.getElementById('result-score');
const resultCount      = document.getElementById('result-xcount');
const resultMsg        = document.getElementById('result-message');
const shareConfirm     = document.getElementById('share-confirm');
const btnQuit          = document.getElementById('btn-quit');

let poseModel       = null;
let camera          = null;
let gameActive      = false;
let score           = 0;
let xCount          = 0;
let timeLeft        = GAME_DURATION;
let gameTimer       = null;
let audioCtx        = null;
let armsCrossed     = false;
let detectingForUser = false;

// ─── AUDIO ───
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTing() {
  if (!audioCtx) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1800, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(2400, audioCtx.currentTime + 0.05);
  osc.frequency.exponentialRampToValueAtTime(800,  audioCtx.currentTime + 0.18);
  gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.22);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.22);
}

// ─── SCREEN MANAGEMENT ───
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('active', k === name);
  });
}

// ─── DETECTION PHASE UI ───
function setDetectingUI() {
  detDot.className   = 'det-dot scanning';
  detLabel.textContent = 'DETECTING YOU...';
  detReady.textContent = '';
  btnBegin.classList.add('hidden');
}

function setDetectedUI() {
  detDot.className     = 'det-dot detected';
  detLabel.textContent = 'YOU ARE DETECTED';
  detReady.textContent = 'READY?';
  btnBegin.classList.remove('hidden');
}

function checkForUser(results) {
  if (!detectingForUser) return;
  if (!results.poseLandmarks) return;
  detectingForUser = false;
  setDetectedUI();
}

// ─── GESTURE DETECTION ───
function detectX(results) {
  if (!gameActive) return;
  if (!results.poseLandmarks) return;

  const leftWrist  = results.poseLandmarks[15];
  const rightWrist = results.poseLandmarks[16];
  if (!leftWrist || !rightWrist) return;

  // Raw MediaPipe coords (non-mirrored frame):
  // normally rightWrist.x < leftWrist.x; when arms cross, rightWrist.x > leftWrist.x
  const crossed = rightWrist.x > leftWrist.x;

  if (crossed && !armsCrossed) {
    armsCrossed = true;
    registerX();
  }
  if (!crossed && armsCrossed) {
    armsCrossed = false;
  }
}

function registerX() {
  xCount++;
  score = xCount;
  hudScore.textContent = score;
  xFlash.classList.remove('hidden');
  xFlash.style.animation = 'none';
  void xFlash.offsetWidth;
  xFlash.style.animation = '';
  xFlash.classList.remove('hidden');
  setTimeout(() => xFlash.classList.add('hidden'), 420);
  playTing();
}

// ─── DRAWING ───
// Canvas is NOT CSS-mirrored; flip x to match the mirrored video display
function lmPx(lm) {
  return { x: (1 - lm.x) * canvasEl.width, y: lm.y * canvasEl.height };
}

function drawDot(lm, radius, fill) {
  if (!lm) return;
  const { x, y } = lmPx(lm);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawArmLine(a, b) {
  if (!a || !b) return;
  const pa = lmPx(a), pb = lmPx(b);
  ctx.beginPath();
  ctx.moveTo(pa.x, pa.y);
  ctx.lineTo(pb.x, pb.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawPose(results) {
  const w = videoEl.videoWidth  || canvasEl.offsetWidth;
  const h = videoEl.videoHeight || canvasEl.offsetHeight;
  if (canvasEl.width !== w)  canvasEl.width  = w;
  if (canvasEl.height !== h) canvasEl.height = h;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  if (!results.poseLandmarks) return;

  const lm = results.poseLandmarks;
  // 13 = left elbow, 14 = right elbow, 15 = left wrist, 16 = right wrist
  drawArmLine(lm[13], lm[15]);
  drawArmLine(lm[14], lm[16]);
  drawDot(lm[13], 10, '#ff8800');
  drawDot(lm[14], 10, '#ff8800');
  drawDot(lm[15], 12, '#ff2d2d');
  drawDot(lm[16], 12, '#ff2d2d');
}

// ─── MEDIAPIPE POSE INIT ───
function initPose() {
  return new Promise((resolve, reject) => {
    if (typeof Pose === 'undefined') {
      reject(new Error('MediaPipe Pose library not found.'));
      return;
    }
    poseModel = new Pose({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`,
    });
    poseModel.setOptions({
      modelComplexity:        0,
      smoothLandmarks:        true,
      enableSegmentation:     false,
      minDetectionConfidence: 0.4,
      minTrackingConfidence:  0.4,
    });
    poseModel.onResults((results) => {
      drawPose(results);
      checkForUser(results);
      detectX(results);
    });
    poseModel.initialize().then(resolve).catch(reject);
  });
}

// ─── POSE WARMUP ───
let poseReady       = false;
let poseInitPromise = null;

function ensurePose() {
  if (poseReady) return Promise.resolve();
  if (!poseInitPromise) {
    poseInitPromise = initPose()
      .then(() => { poseReady = true; })
      .catch((err) => { poseInitPromise = null; throw err; });
  }
  return poseInitPromise;
}

function waitForVideo() {
  return new Promise((resolve) => {
    if (videoEl.readyState >= 2) { resolve(); return; }
    videoEl.addEventListener('loadeddata', resolve, { once: true });
  });
}

function initCamera() {
  return new Promise((resolve, reject) => {
    if (typeof Camera === 'undefined') {
      reject(new Error('Camera utils not found.'));
      return;
    }
    camera = new Camera(videoEl, {
      onFrame: async () => {
        if (!poseModel || videoEl.readyState < 2) return;
        try {
          await poseModel.send({ image: videoEl });
        } catch (e) {
          // skip frames that fail silently
        }
      },
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    });
    camera.start().then(resolve).catch(reject);
  });
}

// ─── COUNTDOWN ───
function runCountdown() {
  return new Promise((resolve) => {
    countdownEl.classList.remove('hidden');
    hudEl.classList.add('hidden');
    let count = 3;
    countdownNum.textContent = count;
    countdownNum.style.animation = 'none';
    void countdownNum.offsetWidth;
    countdownNum.style.animation = '';

    const tick = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(tick);
        countdownEl.classList.add('hidden');
        resolve();
        return;
      }
      countdownNum.textContent = count;
      countdownNum.style.animation = 'none';
      void countdownNum.offsetWidth;
      countdownNum.style.animation = 'pop-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    }, 1000);
  });
}

// ─── GAME LOOP ───
function startGame() {
  score = 0; xCount = 0; timeLeft = GAME_DURATION;
  armsCrossed = false;
  hudScore.textContent = '0';
  hudTime.textContent = GAME_DURATION;
  hudTime.classList.remove('time-warning');
  xFlash.classList.add('hidden');
  gameActive = true;
  hudEl.classList.remove('hidden');
  btnQuit.classList.remove('hidden');

  gameTimer = setInterval(() => {
    timeLeft--;
    hudTime.textContent = timeLeft;
    if (timeLeft <= 5) hudTime.classList.add('time-warning');
    if (timeLeft <= 0) {
      clearInterval(gameTimer);
      endGame();
    }
  }, 1000);
}

function endGame() {
  gameActive = false;
  btnQuit.classList.add('hidden');
  setTimeout(() => showResult(), 400);
}

// ─── RESULT ───
const MESSAGES = [
  { min: 0,  max: 2,  text: "You barely said no." },
  { min: 3,  max: 5,  text: "Getting there. Keep saying no." },
  { min: 6,  max: 9,  text: "Solid rejection skills." },
  { min: 10, max: 14, text: "No means no — and you mean it." },
  { min: 15, max: 19, text: "Boundaries? You've mastered them." },
  { min: 20, max: Infinity, text: "Absolute refusal machine." },
];

function showResult() {
  resultScore.textContent = score;
  resultCount.textContent = xCount;
  const msg = MESSAGES.find(m => xCount >= m.min && xCount <= m.max);
  resultMsg.textContent = msg ? msg.text : '';
  shareConfirm.classList.add('hidden');
  showScreen('result');
}

// ─── DETECTION PHASE START ───
async function startDetectionPhase() {
  detectionOverlay.classList.remove('hidden');
  setDetectingUI();
  try {
    await ensurePose();
    if (!camera) await initCamera();
    await waitForVideo();
    detectingForUser = true;
  } catch (err) {
    console.error('Init error:', err);
    detectionOverlay.classList.add('hidden');
    showError(err.message || 'Could not load pose detection.');
  }
}

// ─── SHARE ───
document.getElementById('btn-share').addEventListener('click', () => {
  const text = `SAY NO Challenge\nScore: ${score} X gestures in 20s\nCan you beat me? https://say-no.vercel.app`;
  navigator.clipboard.writeText(text).then(() => {
    shareConfirm.classList.remove('hidden');
    setTimeout(() => shareConfirm.classList.add('hidden'), 2500);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    shareConfirm.classList.remove('hidden');
    setTimeout(() => shareConfirm.classList.add('hidden'), 2500);
  });
});

// ─── START (stage 1) ───
document.getElementById('btn-start').addEventListener('click', () => {
  initAudio();
  showScreen('game');
  startDetectionPhase();
});

// ─── BEGIN (stage 2) ───
btnBegin.addEventListener('click', async () => {
  detectionOverlay.classList.add('hidden');
  detectingForUser = false;
  armsCrossed = false;
  await runCountdown();
  startGame();
});

// ─── PLAY AGAIN (skip detection, camera already running) ───
document.getElementById('btn-play-again').addEventListener('click', async () => {
  showScreen('game');
  armsCrossed = false;
  await runCountdown();
  startGame();
});

// ─── HOME ───
document.getElementById('btn-home').addEventListener('click', () => {
  gameActive = false;
  clearInterval(gameTimer);
  if (camera) { camera.stop(); camera = null; }
  detectingForUser = false;
  showScreen('landing');
});

// ─── QUIT (mid-game) ───
btnQuit.addEventListener('click', () => {
  gameActive = false;
  clearInterval(gameTimer);
  if (camera) { camera.stop(); camera = null; }
  detectingForUser = false;
  btnQuit.classList.add('hidden');
  hudEl.classList.add('hidden');
  showScreen('landing');
});

// ─── RETRY ───
document.getElementById('btn-retry').addEventListener('click', () => {
  errorOverlay.classList.add('hidden');
  startDetectionPhase();
});

function showError(msg) {
  errorMsg.textContent = msg;
  errorOverlay.classList.remove('hidden');
  hudEl.classList.add('hidden');
  countdownEl.classList.add('hidden');
}

// Begin loading the pose model immediately so it's ready before the user clicks Start
ensurePose().catch(() => {});

// Keep canvas CSS size in sync with the screen
function syncCanvasSize() {
  const rect = videoEl.getBoundingClientRect();
  canvasEl.style.width  = rect.width  + 'px';
  canvasEl.style.height = rect.height + 'px';
}
window.addEventListener('resize', syncCanvasSize);
syncCanvasSize();
