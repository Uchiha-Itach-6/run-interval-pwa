'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  planSelect: $('planSelect'), planDescription: $('planDescription'), statusPill: $('statusPill'),
  phaseTag: $('phaseTag'), roundText: $('roundText'), timerDisplay: $('timerDisplay'),
  phaseTitle: $('phaseTitle'), timerHint: $('timerHint'), progressBar: $('progressBar'),
  progressTrack: document.querySelector('[role="progressbar"]'), elapsedText: $('elapsedText'), totalText: $('totalText'),
  startBtn: $('startBtn'), pauseBtn: $('pauseBtn'), skipBtn: $('skipBtn'), stopBtn: $('stopBtn'),
  runMinutes: $('runMinutes'), walkSeconds: $('walkSeconds'), rounds: $('rounds'), extraSeconds: $('extraSeconds'),
  applyCustomBtn: $('applyCustomBtn'), soundToggle: $('soundToggle'), voiceToggle: $('voiceToggle')
};

const PRESETS = {
  week1: { id: 'week1', name: '第 1 周', mode: 'interval', runSec: 180, walkSec: 60, rounds: 4, extraSec: 0,
    description: '先慢跑 3 分钟，再步行 1 分钟，共 4 组。时间目标约 2.2 km。' },
  week2: { id: 'week2', name: '第 2 周', mode: 'interval', runSec: 240, walkSec: 60, rounds: 4, extraSec: 60,
    description: '跑 4 分钟、走 1 分钟，共 4 组；第 4 组跑步额外增加 1 分钟。时间目标约 2.6 km。' },
  week3: { id: 'week3', name: '第 3 周', mode: 'interval', runSec: 360, walkSec: 60, rounds: 3, extraSec: 0,
    description: '先慢跑 6 分钟，再步行 1 分钟，共 3 组。目标约 3.0 km；按身体状态控制配速。' },
  week4a: { id: 'week4a', name: '第 4 周训练 1', mode: 'stopwatch', targetKm: 2.2,
    description: '连续慢跑 2.2 km，不安排自动跑走阶段。此版本不读取 GPS，请到达目标距离后手动结束。' },
  week4b: { id: 'week4b', name: '第 4 周训练 2', mode: 'stopwatch', targetKm: 2.6,
    description: '连续慢跑 2.6 km，计划中最多安排 1 次 30 秒慢走。此版本不读取 GPS，慢走需手动处理。' },
  week4c: { id: 'week4c', name: '第 4 周训练 3', mode: 'stopwatch', targetKm: 3.0,
    description: '连续挑战 3 km，计划配速约 5′40″–6′00″/km。此版本不读取 GPS，请用外部里程工具确认距离。' },
  custom: { id: 'custom', name: '自定义间歇', mode: 'interval', runSec: 180, walkSec: 60, rounds: 4, extraSec: 0,
    description: '自定义跑步时长、步行时长、循环次数和末组额外跑步时间。' }
};

const STORAGE_KEY = 'run-interval-pwa-settings-v1';
let selectedPlan = { ...PRESETS.week1 };
let state = 'ready'; // ready | running | paused | completed
let phases = [];
let phaseIndex = 0;
let sessionStartAt = 0;
let elapsedBeforeStart = 0;
let elapsedMs = 0;
let previousPhaseIndex = -1;
let ticker = null;
let audioContext = null;
let wakeLock = null;
let lastCueSecond = null;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h > 0 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function formatPaceKm(km) {
  return Number.isFinite(km) ? `${km.toFixed(1)} km` : '';
}
function totalPhaseMs() { return phases.reduce((sum, p) => sum + p.durationSec * 1000, 0); }
function totalPhaseSeconds() { return phases.reduce((sum, p) => sum + p.durationSec, 0); }

function readCustomForm() {
  return {
    id: 'custom', name: '自定义间歇', mode: 'interval',
    runSec: clampInt(els.runMinutes.value, 1, 60, 3) * 60,
    walkSec: clampInt(els.walkSeconds.value, 0, 900, 60),
    rounds: clampInt(els.rounds.value, 1, 30, 4),
    extraSec: clampInt(els.extraSeconds.value, 0, 900, 0),
    description: '自定义间歇已应用。计时器会自动切换跑步与步行阶段。'
  };
}
function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      selectedId: selectedPlan.id,
      runMinutes: els.runMinutes.value,
      walkSeconds: els.walkSeconds.value,
      rounds: els.rounds.value,
      extraSeconds: els.extraSeconds.value,
      sound: els.soundToggle.checked,
      voice: els.voiceToggle.checked
    }));
  } catch (error) { console.warn('无法保存本地设置', error); }
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    els.runMinutes.value = saved.runMinutes ?? '3';
    els.walkSeconds.value = saved.walkSeconds ?? '60';
    els.rounds.value = saved.rounds ?? '4';
    els.extraSeconds.value = saved.extraSeconds ?? '0';
    els.soundToggle.checked = saved.sound !== false;
    els.voiceToggle.checked = saved.voice !== false;
    if (PRESETS[saved.selectedId]) {
      selectedPlan = { ...PRESETS[saved.selectedId] };
      els.planSelect.value = saved.selectedId;
    }
  } catch (error) { console.warn('无法读取本地设置', error); }
}
function setFormFromPlan(plan) {
  if (plan.mode !== 'interval') return;
  els.runMinutes.value = String(Math.max(1, Math.round(plan.runSec / 60)));
  els.walkSeconds.value = String(plan.walkSec);
  els.rounds.value = String(plan.rounds);
  els.extraSeconds.value = String(plan.extraSec || 0);
}
function updatePlanDescription() {
  els.planDescription.textContent = selectedPlan.description || '';
  els.settingsPanelHidden = selectedPlan.mode !== 'interval';
  $('settingsPanel').style.display = selectedPlan.mode === 'interval' ? '' : 'none';
  renderReadyPreview();
}
function buildPhases(plan) {
  if (plan.mode !== 'interval') return [];
  const result = [];
  for (let round = 1; round <= plan.rounds; round += 1) {
    const runSeconds = plan.runSec + (round === plan.rounds ? plan.extraSec : 0);
    result.push({ type: 'run', label: '跑步', durationSec: runSeconds, round, rounds: plan.rounds });
    if (plan.walkSec > 0) result.push({ type: 'walk', label: '步行', durationSec: plan.walkSec, round, rounds: plan.rounds });
  }
  return result;
}
function currentPhaseInfo(msElapsed) {
  let accumulated = 0;
  for (let i = 0; i < phases.length; i += 1) {
    const end = accumulated + phases[i].durationSec * 1000;
    if (msElapsed < end || i === phases.length - 1) {
      return { index: i, phase: phases[i], phaseStartMs: accumulated, phaseEndMs: end };
    }
    accumulated = end;
  }
  return null;
}
function renderReadyPreview() {
  const interval = selectedPlan.mode === 'interval';
  const preview = interval ? selectedPlan.runSec : 180;
  if (state !== 'ready') return;
  els.timerDisplay.textContent = formatTime(preview);
  els.phaseTag.textContent = interval ? 'RUN' : 'STOPWATCH';
  els.phaseTag.classList.toggle('walk', false);
  els.roundText.textContent = interval ? `共 ${selectedPlan.rounds} 组` : `目标 ${formatPaceKm(selectedPlan.targetKm)}`;
  els.phaseTitle.textContent = interval ? '准备开始训练' : '连续跑计时';
  els.timerHint.textContent = interval ? '点击开始后，计时会自动切换阶段' : '点击开始后计时；达到目标距离后手动结束';
  els.elapsedText.textContent = '已用时 00:00';
  els.totalText.textContent = interval ? `总时长 ${formatTime(buildPhases(selectedPlan).reduce((sum, p) => sum + p.durationSec, 0))}` : `目标 ${formatPaceKm(selectedPlan.targetKm)}`;
  els.progressBar.style.width = '0%';
  els.progressTrack.setAttribute('aria-valuenow', '0');
}
function updateButtons() {
  els.startBtn.disabled = state === 'running' || state === 'paused';
  els.pauseBtn.disabled = state !== 'running';
  els.pauseBtn.textContent = '暂停';
  els.skipBtn.disabled = state !== 'running' || selectedPlan.mode !== 'interval' || phaseIndex >= phases.length - 1;
  els.stopBtn.disabled = state === 'ready' || state === 'completed';
  if (state === 'paused') {
    els.startBtn.disabled = true;
    els.pauseBtn.disabled = false;
    els.pauseBtn.textContent = '继续';
  }
  if (state === 'completed') {
    els.startBtn.disabled = false;
    els.startBtn.textContent = '再练一次';
  } else {
    els.startBtn.textContent = state === 'paused' ? '继续训练' : (state === 'running' ? '训练中' : '开始训练');
  }
  document.body.classList.toggle('is-running', state === 'running');
  els.statusPill.className = `status-pill ${state === 'running' ? 'running' : state === 'paused' ? 'paused' : state === 'completed' ? 'completed' : ''}`;
  els.statusPill.textContent = state === 'running' ? '训练中' : state === 'paused' ? '已暂停' : state === 'completed' ? '已完成' : '准备就绪';
}
function render() {
  updateButtons();
  if (state === 'ready') { renderReadyPreview(); return; }
  if (state === 'completed') {
    const durationSec = Math.floor(elapsedMs / 1000);
    els.phaseTag.textContent = 'DONE';
    els.phaseTag.classList.remove('walk');
    els.roundText.textContent = '训练已完成';
    els.timerDisplay.textContent = '00:00';
    els.phaseTitle.textContent = '本次训练完成';
    els.timerHint.textContent = `总用时 ${formatTime(durationSec)}。先放慢节奏，再做舒缓整理。`;
    els.elapsedText.textContent = `已用时 ${formatTime(durationSec)}`;
    if (selectedPlan.mode === 'interval') {
      els.totalText.textContent = `计划 ${formatTime(totalPhaseSeconds())}`;
      els.progressBar.style.width = '100%';
      els.progressTrack.setAttribute('aria-valuenow', '100');
    }
    return;
  }
  if (selectedPlan.mode === 'stopwatch') {
    const seconds = Math.floor(elapsedMs / 1000);
    els.phaseTag.textContent = 'RUN';
    els.phaseTag.classList.remove('walk');
    els.roundText.textContent = `目标 ${formatPaceKm(selectedPlan.targetKm)}`;
    els.timerDisplay.textContent = formatTime(seconds);
    els.phaseTitle.textContent = '连续跑';
    els.timerHint.textContent = state === 'paused' ? '已暂停，准备好后继续' : '保持舒适、可控的呼吸；到达目标距离后手动结束';
    els.elapsedText.textContent = `已用时 ${formatTime(seconds)}`;
    els.totalText.textContent = `目标 ${formatPaceKm(selectedPlan.targetKm)}`;
    return;
  }
  const info = currentPhaseInfo(elapsedMs);
  if (!info) return;
  phaseIndex = info.index;
  const phaseRemainingMs = Math.max(0, info.phaseEndMs - elapsedMs);
  const remaining = Math.ceil(phaseRemainingMs / 1000);
  const isWalk = info.phase.type === 'walk';
  els.phaseTag.textContent = isWalk ? 'WALK' : 'RUN';
  els.phaseTag.classList.toggle('walk', isWalk);
  els.roundText.textContent = `第 ${info.phase.round} / ${info.phase.rounds} 组`;
  els.timerDisplay.textContent = formatTime(remaining);
  els.phaseTitle.textContent = isWalk ? '步行恢复' : (info.phase.round === info.phase.rounds && selectedPlan.extraSec > 0 ? '跑步 · 末组加时' : '慢跑');
  els.timerHint.textContent = isWalk ? '放松肩部，调整呼吸，为下一组做准备' : '小步幅、放松肩颈；速度以能控制呼吸为准';
  const totalMs = totalPhaseMs();
  const pct = totalMs > 0 ? Math.min(100, (elapsedMs / totalMs) * 100) : 0;
  els.progressBar.style.width = `${pct}%`;
  els.progressTrack.setAttribute('aria-valuenow', String(Math.round(pct)));
  els.elapsedText.textContent = `已用时 ${formatTime(elapsedMs / 1000)}`;
  els.totalText.textContent = `总时长 ${formatTime(totalMs / 1000)}`;
}
function getElapsedNow() {
  if (state === 'running') return elapsedBeforeStart + (Date.now() - sessionStartAt);
  return elapsedMs;
}
function startTicker() {
  stopTicker();
  ticker = window.setInterval(tick, 200);
  tick();
}
function stopTicker() {
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
}
function tick() {
  if (state !== 'running') return;
  const nextElapsed = Math.max(0, getElapsedNow());
  if (selectedPlan.mode === 'interval') {
    const totalMs = totalPhaseMs();
    elapsedMs = Math.min(nextElapsed, totalMs);
    const info = currentPhaseInfo(elapsedMs);
    const nextIndex = info ? info.index : phases.length;
    if (previousPhaseIndex !== -1 && nextIndex !== previousPhaseIndex && nextIndex < phases.length) {
      cueForPhase(phases[nextIndex]);
    }
    previousPhaseIndex = nextIndex;
    if (nextElapsed >= totalMs) {
      elapsedMs = totalMs;
      state = 'completed';
      stopTicker();
      releaseWakeLock();
      speak('训练完成');
      playTone('complete');
    }
  } else {
    elapsedMs = nextElapsed;
  }
  render();
}
async function requestWakeLock() {
  // 能力检测即可；iOS 主屏幕网页应用不保证支持此能力。
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (error) {
    console.info('屏幕常亮不可用，保持页面前台使用。', error?.message || error);
  }
}
async function releaseWakeLock() {
  if (wakeLock) {
    try { await wakeLock.release(); } catch (_) { /* ignore */ }
    wakeLock = null;
  }
}
function unlockAudio() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && !audioContext) audioContext = new AudioCtx();
    if (audioContext?.state === 'suspended') audioContext.resume();
  } catch (error) { console.info('音频初始化失败', error); }
}
function playTone(kind = 'switch') {
  if (!els.soundToggle.checked) return;
  unlockAudio();
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const count = kind === 'complete' ? 3 : 1;
  for (let i = 0; i < count; i += 1) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'complete' ? 660 + i * 120 : 740;
    gain.gain.setValueAtTime(0.0001, now + i * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.13);
    osc.connect(gain); gain.connect(audioContext.destination);
    osc.start(now + i * 0.16); osc.stop(now + i * 0.16 + 0.14);
  }
}
function speak(text) {
  if (!els.voiceToggle.checked || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.05;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  } catch (error) { console.info('语音播报不可用', error); }
}
function cueForPhase(phase) {
  playTone('switch');
  speak(phase.type === 'run' ? '开始跑步' : '开始步行恢复');
}
function startNewSession() {
  if (state === 'paused') { resumeSession(); return; }
  if (state === 'running') return;
  if (selectedPlan.mode === 'interval') {
    phases = buildPhases(selectedPlan);
    if (!phases.length) return;
    phaseIndex = 0;
    elapsedMs = 0;
    elapsedBeforeStart = 0;
    previousPhaseIndex = 0;
  } else {
    phases = [];
    phaseIndex = 0;
    elapsedMs = 0;
    elapsedBeforeStart = 0;
    previousPhaseIndex = -1;
  }
  state = 'running';
  sessionStartAt = Date.now();
  unlockAudio();
  requestWakeLock();
  saveSettings();
  if (selectedPlan.mode === 'interval') cueForPhase(phases[0]);
  else { playTone('switch'); speak('开始连续跑计时'); }
  startTicker();
}
function pauseSession() {
  if (state === 'paused') { resumeSession(); return; }
  if (state !== 'running') return;
  elapsedMs = getElapsedNow();
  elapsedBeforeStart = elapsedMs;
  state = 'paused';
  stopTicker();
  releaseWakeLock();
  render();
}
function resumeSession() {
  if (state !== 'paused') return;
  state = 'running';
  sessionStartAt = Date.now();
  unlockAudio();
  requestWakeLock();
  startTicker();
}
function stopSession(completed = false) {
  if (state === 'ready') return;
  if (state === 'running') elapsedMs = getElapsedNow();
  stopTicker();
  releaseWakeLock();
  if (completed && selectedPlan.mode === 'interval') elapsedMs = totalPhaseMs();
  state = completed ? 'completed' : 'ready';
  elapsedBeforeStart = 0;
  sessionStartAt = 0;
  previousPhaseIndex = -1;
  if (!completed) elapsedMs = 0;
  render();
}
function skipPhase() {
  if (state !== 'running' || selectedPlan.mode !== 'interval') return;
  const info = currentPhaseInfo(getElapsedNow());
  const current = info ? info.index : phaseIndex;
  const next = Math.min(phases.length - 1, current + 1);
  if (next === current) return;
  const nextElapsed = phases.slice(0, next).reduce((sum, p) => sum + p.durationSec * 1000, 0);
  elapsedBeforeStart = nextElapsed;
  sessionStartAt = Date.now();
  elapsedMs = nextElapsed;
  phaseIndex = next;
  previousPhaseIndex = next;
  cueForPhase(phases[next]);
  render();
}
function choosePlan(id) {
  selectedPlan = id === 'custom' ? readCustomForm() : { ...PRESETS[id] };
  if (selectedPlan.mode === 'interval') setFormFromPlan(selectedPlan);
  updatePlanDescription();
  saveSettings();
}

els.planSelect.addEventListener('change', () => {
  if (state === 'running' || state === 'paused') {
    els.planSelect.value = selectedPlan.id;
    return;
  }
  choosePlan(els.planSelect.value);
});
els.applyCustomBtn.addEventListener('click', () => {
  if (state === 'running' || state === 'paused') return;
  selectedPlan = readCustomForm();
  els.planSelect.value = 'custom';
  updatePlanDescription();
  saveSettings();
});
[els.runMinutes, els.walkSeconds, els.rounds, els.extraSeconds, els.soundToggle, els.voiceToggle].forEach((el) => {
  el.addEventListener('change', saveSettings);
});
els.startBtn.addEventListener('click', startNewSession);
els.pauseBtn.addEventListener('click', pauseSession);
els.skipBtn.addEventListener('click', skipPhase);
els.stopBtn.addEventListener('click', () => {
  if (window.confirm('确定结束本次训练吗？')) stopSession(false);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state === 'running') {
    // 重新进入页面时根据绝对时间校正显示；系统不保证后台期间播放提示。
    tick();
    requestWakeLock();
  }
});
window.addEventListener('pagehide', () => { saveSettings(); releaseWakeLock(); });

loadSettings();
if (selectedPlan.mode === 'interval') setFormFromPlan(selectedPlan);
if (els.planSelect.value !== selectedPlan.id) els.planSelect.value = selectedPlan.id;
updatePlanDescription();
phases = buildPhases(selectedPlan);
render();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker 注册失败', error));
  });
}
