"use strict";
// Shared constants, viewport metrics and small helpers. Every other script reads these globals.

// Viewport: internal pixel resolution (variable width/height so pixels stay square and crisp),
// integer upscale factor K, device pixel ratio, safe-area insets (internal px) and px-per-point.
let W = 450, H = 234, K = 5, DPR = 1, PT = 0.6;
const SAFE = { l: 0, r: 0, t: 0, b: 0 };
// On touch screens the world is drawn VPAD px higher, over a strip of ground, so the hero and the
// enemies fight above the thumbs instead of under them.
let VPAD = 0, VPAD_TOUCH = 0;   // VPAD drops to 0 while a game controller is in use
// Inside the iOS app (slugger-ios) the WKWebView exposes native bridges; on the web these are absent.
const NATIVE = !!window.webkit?.messageHandlers?.haptic;
function nativeHaptic(kind) { try { window.webkit.messageHandlers.haptic.postMessage(kind); } catch {} }

const GROUND = 34;          // world y of the ground surface (world y grows upward from the bottom edge)
const GRAV = -820;
const STEP = 1 / 60;        // fixed simulation step
const TAU = Math.PI * 2;

const rand = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.random() * a.length | 0];
const chance = p => Math.random() < p;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, t, d) => v < t ? Math.min(v + d, t) : Math.max(v - d, t);
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const distBox = (x, y, b) => Math.hypot(Math.max(b.x - x, 0, x - (b.x + b.w)), Math.max(b.y - y, 0, y - (b.y + b.h)));
const inBox = (b, x, y, r = 0) => x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r;
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const fmtTime = s => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const fmtNum = n => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeOutBack = t => { t = clamp(t, 0, 1); const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

// Seeded generator for level layouts (same mission = same layout every time, so it can be learned).
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function rgbHex(r, g, b) { return "#" + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join(""); }
// k < 0 darkens toward black, k > 0 lightens toward white
function shade(hex, k) {
  const [r, g, b] = hexRgb(hex);
  const f = c => k < 0 ? c * (1 + k) : c + (255 - c) * k;
  return rgbHex(f(r), f(g), f(b));
}
function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)); }

let clock = 0;              // seconds of game time (advances only while not paused)
let realClock = 0;          // seconds since boot (menus animate with this)
