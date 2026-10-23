"use strict";
// Synthesized audio: sound effects, a small step sequencer for music, and spoken callouts.

let ac = null, masterGain = null, musicGain = null, sfxGain = null, noiseBuf = null, gtrBus = null;

function initAudio() {
  if (ac) { if (ac.state === "suspended") ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ac.createGain(); masterGain.connect(ac.destination);
    musicGain = ac.createGain();
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    musicGain.connect(comp); comp.connect(masterGain);
    // rhythm guitar bus: soft-clip distortion, then a lowpass so the chugs stay warm under the lead
    const shaper = ac.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
    shaper.curve = curve;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
    gtrBus = ac.createGain(); gtrBus.gain.value = 0.3;
    shaper.connect(lp); lp.connect(gtrBus); gtrBus.connect(musicGain);
    gtrBus.input = shaper;
    sfxGain = ac.createGain(); sfxGain.connect(masterGain);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
  } catch { ac = null; }
}
function applyVolumes() {
  if (!ac) return;
  const s = save.settings;
  masterGain.gain.value = 0.55;
  musicGain.gain.value = 0.32 * s.music;
  sfxGain.gain.value = s.sfx;
}
function noise(dur, freq, q, vol, type = "bandpass", t0 = 0, dest) {
  if (!ac) return;
  const t = ac.currentTime + Math.max(0, t0);
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const gn = ac.createGain(); gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(gn); gn.connect(dest || sfxGain);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
function tone(type, f0, f1, dur, vol, t0 = 0, dest) {
  if (!ac) return;
  const t = ac.currentTime + Math.max(0, t0);
  const o = ac.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  const gn = ac.createGain(); gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(gn); gn.connect(dest || sfxGain); o.start(t); o.stop(t + dur + 0.02);
}
const arp = (notes, step, type = "square", vol = 0.09, len = 0.12) => notes.forEach((f, i) => tone(type, f, f, len, vol, i * step));

let coinStreak = 0, coinT = 0, lastSfx = {};
// Throttle very frequent effects so a heavy machine gun does not flood the mixer
function throttled(name, gap) { const t = realClock; if (lastSfx[name] && t - lastSfx[name] < gap) return true; lastSfx[name] = t; return false; }

const sfx = {
  pistol() { noise(0.08, 2400, 1, 0.35); tone("square", 420, 120, 0.06, 0.1); },
  hmg() { if (throttled("hmg", 0.05)) return; noise(0.05, 1700, 0.8, 0.3); tone("square", 300, 90, 0.04, 0.08); },
  shotgun() { noise(0.35, 900, 0.6, 0.8, "lowpass"); tone("sawtooth", 180, 40, 0.22, 0.2); },
  rocket() { noise(0.4, 600, 0.5, 0.35); tone("sawtooth", 200, 600, 0.25, 0.06); },
  flame() { if (throttled("flame", 0.12)) return; noise(0.4, 500, 0.4, 0.45, "lowpass"); },
  boom(big) { if (!big && throttled("boom", 0.04)) return; noise(big ? 1.2 : 0.6, big ? 240 : 420, 0.5, big ? 1 : 0.7, "lowpass"); tone("sine", big ? 90 : 130, 30, big ? 0.8 : 0.4, 0.55); },
  cannon() { noise(0.4, 300, 0.7, 0.8, "lowpass"); tone("square", 160, 40, 0.25, 0.2); },
  jump() { tone("square", 220, 520, 0.1, 0.06); },
  land() { noise(0.06, 400, 1, 0.15, "lowpass"); },
  pick() { arp([660, 880, 1320], 0.07); },
  coin() {
    coinStreak = realClock - coinT < 0.6 ? Math.min(coinStreak + 1, 12) : 0; coinT = realClock;
    if (throttled("coin", 0.03)) return;
    const f = 1200 * Math.pow(2, coinStreak / 24);
    tone("square", f, f, 0.05, 0.05); tone("square", f * 1.5, f * 1.5, 0.08, 0.05, 0.05);
  },
  scream() { if (throttled("scream", 0.15)) return; const f = rand(480, 720); tone("sawtooth", f, f * 0.35, 0.45, 0.09); tone("square", f * 1.5, f * 0.5, 0.4, 0.03); },
  clink() { if (throttled("clink", 0.05)) return; tone("triangle", 2200, 1800, 0.06, 0.15); },
  knife() { noise(0.08, 5000, 2, 0.3, "highpass"); },
  hurt() { tone("square", 300, 90, 0.25, 0.18); noise(0.2, 900, 0.7, 0.4, "lowpass"); },
  die() { tone("sawtooth", 400, 60, 0.7, 0.22); noise(0.5, 800, 0.5, 0.4, "lowpass"); },
  enemyShot() { if (throttled("es", 0.04)) return; noise(0.06, 1300, 1, 0.14); },
  sniper() { noise(0.12, 3000, 0.8, 0.5); tone("square", 900, 200, 0.1, 0.1); },
  beep() { if (throttled("beep", 0.12)) return; tone("square", 1800, 1800, 0.04, 0.05); },
  thanks() { arp([784, 1047], 0.1, "square", 0.08, 0.09); },
  toss() { tone("triangle", 300, 700, 0.12, 0.08); },
  tick() { tone("square", 1200, 1200, 0.04, 0.06); },
  ui() { tone("square", 880, 1320, 0.05, 0.06); },
  back() { tone("square", 660, 440, 0.06, 0.06); },
  deny() { tone("square", 200, 150, 0.15, 0.08); },
  buy() { arp([1047, 1319, 1568, 2093], 0.05, "square", 0.07, 0.08); noise(0.08, 6000, 2, 0.15, "highpass", 0.2); },
  levelUp() { arp([523, 659, 784, 1047, 1319, 1568], 0.07, "square", 0.09, 0.14); },
  star() { tone("triangle", 1568, 1568, 0.3, 0.16); tone("triangle", 2093, 2093, 0.4, 0.1, 0.06); },
  achieve() { arp([784, 1047, 1319, 1568], 0.08, "triangle", 0.12, 0.2); },
  checkpoint() { arp([523, 784, 1047], 0.08, "triangle", 0.12, 0.16); },
  charge() { tone("sawtooth", 200, 900, 0.7, 0.07); },
  laser() { noise(0.55, 3000, 0.5, 0.4, "bandpass"); tone("square", 880, 440, 0.5, 0.1); },
  engine() { tone("sawtooth", 70, 140, 0.6, 0.08); noise(0.6, 300, 0.6, 0.15, "lowpass"); },
  whistle() { tone("sine", 1800, 500, 0.9, 0.08); },
  alarm() { for (let i = 0; i < 3; i++) { tone("square", 880, 660, 0.25, 0.08, i * 0.32); } },
  slug() { tone("sawtooth", 90, 160, 0.4, 0.12); noise(0.3, 400, 0.5, 0.3, "lowpass"); },
  vest() { arp([392, 523, 659], 0.06, "triangle", 0.12, 0.12); },
};

function say(textLine) {
  if (!save.settings.voice || save.settings.sfx <= 0) return;
  try {
    const u = new SpeechSynthesisUtterance(textLine);
    u.lang = "en-US"; u.rate = 0.95; u.pitch = 0.4; u.volume = Math.min(1, save.settings.sfx);
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch {}
}
function vibrate(ms) { if (!save.settings.haptics) return; if (NATIVE) return nativeHaptic(ms >= 50 ? "heavy" : "medium"); try { navigator.vibrate?.(ms); } catch {} }

// ---------- Music ----------
// 32 eighth-note steps per pattern; "." is a rest. Drums: k kick, s snare, h hat, t tom.
const TRACKS = {
  menu: { bpm: 132, lead: "square", leadVol: 0.09, bassLen: 0.9, gtr: true,
    bass: "E2 . E2 E2 . E2 E2 . G2 . G2 G2 . G2 A2 . C3 . C3 C3 . C3 C3 . B2 . B2 B2 A2 . G2 .",
    mel: "E5 . . B4 E5 . F#5 G5 . . F#5 . E5 . D5 . E5 . . . G5 . A5 B5 . . A5 . G5 . F#5 .",
    drums: "k.h.s.h.k.k.s.h.k.h.s.h.k.k.s.ss" },
  desert: { bpm: 156, lead: "square", leadVol: 0.1, bassLen: 0.9, gtr: true,
    bass: "A2 . A2 A2 C3 . A2 . G2 . G2 G2 E2 . G2 . F2 . F2 F2 A2 . F2 . E2 . E2 G#2 E2 . E2 .",
    mel: "A4 . E5 . D5 C5 B4 . C5 . D5 . E5 . . . F5 . E5 D5 C5 . A4 . B4 . G#4 . E4 . . .",
    drums: "k.h.s.h.k.h.s.h.k.h.s.h.k.k.s.hh" },
  jungle: { bpm: 148, lead: "square", leadVol: 0.09, bassLen: 0.9, gtr: true,
    bass: "D2 . D3 . D2 . C3 . D2 . D3 . F2 . G2 . A2 . A3 . A2 . G2 . F2 . E2 . D2 . C2 .",
    mel: "A4 . . C5 D5 . A4 . G4 . A4 . . . F4 G4 A4 . C5 . D5 . E5 . D5 . C5 . A4 . . .",
    drums: "k.t.k.tts.t.k.t.k.t.k.tts.t.ktt." },
  snow: { bpm: 144, lead: "square", leadVol: 0.09, bassLen: 0.9, gtr: true,
    bass: "E2 . E2 E2 E2 . E2 . C2 . C2 C2 C2 . C2 . A1 . A1 A1 A1 . A1 . B1 . B1 B1 B1 . D2 .",
    mel: "E5 . G5 . B5 . G5 . A5 . . . G5 . F#5 . E5 . . . D5 . E5 . B4 . . . . . . .",
    drums: "k.h.s.h.k.h.s.h.k.h.s.h.k.k.s.hh" },
  city: { bpm: 156, lead: "sawtooth", leadVol: 0.06, bassLen: 0.8, gtr: true,
    bass: "C2 C3 C2 C3 C2 C3 C2 C3 G#1 G#2 G#1 G#2 G#1 G#2 G#1 G#2 A#1 A#2 A#1 A#2 A#1 A#2 A#1 A#2 G1 G2 G1 G2 G1 G2 G1 G2",
    mel: "C5 . D#5 . G5 . . . F5 D#5 D5 . C5 . . . G#4 . C5 . D#5 . D5 . . . B4 . D5 . G5 . . .",
    drums: "k.h.s.h.k.h.s.h.k.h.s.h.k.k.s.hh" },
  harbor: { bpm: 150, lead: "square", leadVol: 0.09, bassLen: 0.9, gtr: true,
    bass: "G2 . D3 . G2 . D3 . F2 . C3 . F2 . C3 . G2 . D3 . G2 . B2 . C3 . A2 . D3 . F#2 .",
    mel: "D5 . B4 . G4 . B4 D5 . G5 . F5 . D5 . C5 . A4 . F4 . A4 C5 . D5 . . . F#5 . G5 .",
    drums: "k..sk..sk..sk.sskk.sk..sk..skkss" },
  fortress: { bpm: 166, lead: "sawtooth", leadVol: 0.07, bassLen: 0.8, gtr: true,
    bass: "A#1 A#1 . A#1 A#2 . A#1 . C#2 C#2 . C#2 C#3 . C#2 . F#1 F#1 . F#1 F#2 . F#1 . F1 F1 . F1 F2 . G#1 .",
    mel: "A#4 . . F5 . . E5 . . C#5 . . A#4 . C5 . C#5 . . A#4 . . F4 . . G#4 . A4 . A#4 .",
    drums: "k.k.s.k.k.k.s.kkk.k.s.k.k.ksss.s" },
  boss: { bpm: 176, lead: "square", leadVol: 0.1, bassLen: 0.9, gtr: true,
    bass: "A2 . A2 A2 C3 . A2 . G2 . G2 G2 E2 . G2 . F2 . F2 F2 A2 . F2 . E2 . E2 G#2 E2 . E2 .",
    mel: "E5 E5 . E5 F5 . E5 . D5 D5 . D5 E5 . C5 . A4 A4 . C5 D5 . E5 . G#4 . B4 . E5 . E5 .",
    drums: "k.hsk.hsk.hsk.hskkhsk.hsk.hskkss" },
  survival: { bpm: 180, lead: "sawtooth", leadVol: 0.06, bassLen: 0.8, gtr: true,
    bass: "E2 E3 E2 E3 G2 G3 G2 G3 A2 A3 A2 A3 C3 B2 A2 G2 E2 E3 E2 E3 G2 G3 G2 G3 A2 A3 B2 B3 B2 A2 G2 F#2",
    mel: "E5 . B4 . E5 G5 . E5 A5 . G5 . E5 . D5 . E5 . B4 . E5 G5 . A5 B5 . A5 . G5 . F#5 .",
    drums: "k.hsk.hsk.hsk.hskkhsk.hsk.hskkss" },
};
for (const t of Object.values(TRACKS)) { t.B = t.bass.split(" "); t.M = t.mel.split(" "); }
const noteFreq = n => {
  const m = n.match(/^([A-G])(#?)(\d)$/);
  const s = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (s + 12 * (+m[3] + 1) - 69) / 12);
};
let music = null, nextNote = 0, mStep = 0, musicPaused = false;
function playMusic(name) {
  if (music === TRACKS[name]) return;
  music = TRACKS[name] || null; mStep = 0;
  if (ac) nextNote = ac.currentTime + 0.08;
}
function stopMusic() { music = null; }
function musicTick() {
  if (!ac || !music || musicPaused || save.settings.music <= 0) return;
  const step = 60 / music.bpm / 2;
  if (nextNote < ac.currentTime) nextNote = ac.currentTime + 0.05;
  while (nextNote < ac.currentTime + 0.15) {
    const t = nextNote - ac.currentTime, i = mStep % 32, tr = music, loop = Math.floor(mStep / 32);
    const b = tr.B[i], m = tr.M[i];
    // every 4th loop ends on a snare fill; every other loop opens with a crash
    const d = loop % 4 === 3 && i >= 28 ? "s" : tr.drums[i];
    if (b && b !== ".") {
      const f = noteFreq(b);
      tone("triangle", f, f, step * tr.bassLen, 0.5, t, musicGain);
      if (tr.gtr) powerChord(f * 2, step * 0.85, t);   // palm-muted power chord, an octave above the bass
    }
    if (m && m !== ".") {
      const f = noteFreq(m);
      tone(tr.lead, f, f, step * 0.8, tr.leadVol, t, musicGain);
      if (loop % 2 === 1) tone("triangle", f / 2, f / 2, step * 0.8, tr.leadVol * 1.2, t, musicGain);   // thicker second pass
    }
    if (i === 0 && loop % 2 === 0) noise(1.1, 6500, 0.6, 0.16, "highpass", t, musicGain);
    if (d === "k") { tone("sine", 150, 42, 0.16, 0.85, t, musicGain); noise(0.015, 3000, 1, 0.25, "bandpass", t, musicGain); }
    else if (d === "s") { noise(0.11, 1900, 0.7, 0.42, "bandpass", t, musicGain); tone("triangle", 200, 150, 0.07, 0.22, t, musicGain); }
    else if (d === "h") noise(0.03, 7500, 1, 0.12, "highpass", t, musicGain);
    else if (d === "t") tone("sine", 220, 90, 0.15, 0.45, t, musicGain);
    nextNote += step; mStep++;
  }
}
function powerChord(f, dur, t0) {
  if (!gtrBus) return;
  const t = ac.currentTime + Math.max(0, t0);
  for (const r of [1, 1.5, 2]) {
    const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = f * r;
    const gn = ac.createGain(); gn.gain.setValueAtTime(0.22, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gn); gn.connect(gtrBus.input); o.start(t); o.stop(t + dur + 0.02);
  }
}
function jingle(kind) {
  if (!ac) return;
  const n = f => noteFreq(f);
  if (kind === "win") { arp([n("C5"), n("E5"), n("G5"), n("C6")], 0.12, "square", 0.1, 0.18); [n("G5"), n("C6"), n("E6")].forEach(f => tone("triangle", f, f, 0.9, 0.07, 0.5)); }
  if (kind === "fail") arp([n("G4"), n("F#4"), n("F4"), n("E4")], 0.28, "square", 0.08, 0.3);
}
