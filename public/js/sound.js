// Sound effects. Real mp3s in /assets/sounds/ are used when present;
// anything missing falls back to a small Web Audio synth so nothing is silent.
const SOUNDS = {
  dice: '/assets/sounds/dice.mp3',
  cash: '/assets/sounds/cash.mp3',
  card: '/assets/sounds/card.mp3',
  step: '/assets/sounds/step.mp3',
  jail: '/assets/sounds/jail.mp3',
  build: '/assets/sounds/build.mp3',
  win: '/assets/sounds/win.mp3',
};

const cache = {};
const available = {};

// ask the server which files exist — avoids 404 noise from probing each one
fetch('/api/sounds').then(r => r.json()).then(files => {
  for (const key of Object.keys(SOUNDS)) available[key] = files.includes(`${key}.mp3`);
}).catch(() => { /* keep synth fallbacks */ });

// Browsers block audio until the user interacts with the page — unlock on first input.
let ctx = null;
function audioCtx() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
for (const ev of ['pointerdown', 'keydown']) {
  window.addEventListener(ev, () => audioCtx(), { once: true, passive: true });
}

export function sfx(name) {
  if (available[name]) {
    try {
      const a = cache[name] ??= new Audio(SOUNDS[name]);
      a.currentTime = 0;
      a.volume = 0.5;
      a.play().catch(() => {});
    } catch { /* ignore */ }
  } else {
    synth(name);
  }
}

// ---- tiny synthesized fallbacks ----
function synth(name) {
  let c;
  try { c = audioCtx(); } catch { return; }
  if (c.state === 'suspended') return; // not unlocked yet
  const t = c.currentTime;
  switch (name) {
    case 'step': blip(c, t, 900, 0.04, 0.12); break;
    case 'card': whoosh(c, t, 0.16); break;
    case 'build': { blip(c, t, 200, 0.08, 0.25); blip(c, t + 0.09, 150, 0.08, 0.2); break; }
    case 'dice': { for (let i = 0; i < 5; i++) blip(c, t + i * 0.07, 500 + Math.random() * 800, 0.03, 0.1); break; }
    case 'cash': { blip(c, t, 1200, 0.05, 0.15); blip(c, t + 0.08, 1600, 0.09, 0.15); break; }
    case 'jail': blip(c, t, 90, 0.3, 0.35); break;
    case 'win': { [523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.14, f, 0.25, 0.18)); break; }
  }
}

function tone(c, t, freq, dur, vol) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur);
}

function blip(c, t, freq, dur, vol) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur);
}

function whoosh(c, t, dur) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 0.8;
  const g = c.createGain(); g.gain.value = 0.25;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}
