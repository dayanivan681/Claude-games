"use strict";
// Bitmap font: glyphs derived from Press Start 2P (SIL Open Font License) as 8x8 bitmaps,
// so text renders pixel-perfect inside the low-res buffer at any scale. 8 bytes (16 hex chars) per glyph, ASCII 32-126.
const FONT_HEX = "000000000000000038383830300030006c6c6c00000000006cfe6c6c6cfe6c00107cd07c16fc100062a4c810264a8c0070d8d870dacc7e0030303000000000000c18303030180c006030181818306000006c38fe386c00000018187e1818000000000000003030600000007e0000000000000000003030000204081020408000384cc6c6c66438001838181818187e007cc60e3c78e0fe007e0c183c06c67c001c3c6cccfe0c0c00fcc0fc0606c67c003c60c0fcc6c67c00fec60c183030300078c4e4789e867c007cc6c67e060c7800003030003030000000303000303060000c18306030180c000000fe00fe0000006030180c183060007cfec60c380038007c82baaabe807c00386cc6c6fec6c600fcc6c6fcc6c6fc003c66c0c0c0663c00f8ccc6c6c6ccf800fec0c0fcc0c0fe00fec0c0fcc0c0c0003e60c0cec6663e00c6c6c6fec6c6c6007e18181818187e000606060606c67c00c6ccd8f0f8dcce006060606060607e00c6eefed6d6c6c600c6e6f6decec6c6007cc6c6c6c6c67c00fcc6c6c6fcc0c0007cc6c6c6decc7a00fcc6c6cef8dcce007cc6c07c06c67c007e18181818181800c6c6c6c6c6c67c00c6c6c6ee7c381000d6d6d6d6feee4400c6c66c386cc6c6006666663c18181800fe0e1c3870e0fe003c30303030303c0080402010080402007818181818187800386c00000000000000000000000000fe100800000000000000007c067ec67e00c0c0fcc6c6c67c0000007ec0c0c07e0006067ec6c6c67e0000007cc6fec07c000e187e181818180000007ec6c67e067cc0c0fcc6c6c6c6001800381818187e000c001c0c0c0c0c78c0c0c6ccf8ccc6003818181818187e000000fcb6b6b6b6000000fcc6c6c6c60000007cc6c6c67c000000fcc6c6fcc0c000007ec6c67e060600006e706060600000007cc07c06fc0018187e18181818000000c6c6c6c67e0000006666663c18000000d6d6d6d66c000000c66c386cc6000000c6c6c67e067c0000fe1c3870fe000c18183018180c0018181818181818006030301830306000000070ba1c000000";
// Extra glyphs drawn by hand (same 8x8 grid)
const FONT_EXTRA = {
  "♥": [".XX.XX..", "XXXXXXX.", "XXXXXXX.", "XXXXXXX.", ".XXXXX..", "..XXX...", "...X....", "........"],
  "♡": [".XX.XX..", "X..X..X.", "X.....X.", "X.....X.", ".X...X..", "..X.X...", "...X....", "........"],
  "★": ["...X....", "..XXX...", "XXXXXXX.", ".XXXXX..", "..XXX...", ".XX.XX..", ".X...X..", "........"],
  "☆": ["...X....", "..X.X...", "XX...XX.", ".X...X..", "..X.X...", ".X.X.X..", ".X...X..", "........"],
  "←": ["........", "..X.....", ".XX.....", "XXXXXXX.", ".XX.....", "..X.....", "........", "........"],
  "→": ["........", "....X...", "....XX..", "XXXXXXX.", "....XX..", "....X...", "........", "........"],
  "↑": ["...X....", "..XXX...", ".XXXXX..", "...X....", "...X....", "...X....", "...X....", "........"],
  "↓": ["...X....", "...X....", "...X....", "...X....", ".XXXXX..", "..XXX...", "...X....", "........"],
  "∞": ["........", "........", ".XX.XX..", "X..X..X.", "X..X..X.", ".XX.XX..", "........", "........"],
  "·": ["........", "........", "........", "..XX....", "..XX....", "........", "........", "........"],
  "×": ["........", "X....X..", ".X..X...", "..XX....", "..XX....", ".X..X...", "X....X..", "........"],
  "¤": ["..XXX...", ".XXXXX..", "XXX.XXX.", "XX.X.XX.", "XXX.XXX.", ".XXXXX..", "..XXX...", "........"],
  "▶": ["X.......", "XXX.....", "XXXXX...", "XXXXXXX.", "XXXXX...", "XXX.....", "X.......", "........"],
  "✓": ["........", "......X.", ".....XX.", "X...XX..", "XX.XX...", ".XXX....", "..X.....", "........"],
  "🔒": ["..XXX...", ".X...X..", ".X...X..", "XXXXXXX.", "XXX.XXX.", "XXX.XXX.", "XXXXXXX.", "........"],
};
const FONT_CHARS = [];
for (let c = 32; c < 127; c++) FONT_CHARS.push(String.fromCharCode(c));
for (const ch of Object.keys(FONT_EXTRA)) FONT_CHARS.push(ch);
const FONT_INDEX = new Map(FONT_CHARS.map((ch, i) => [ch, i]));
let fontAtlas = null;
const fontTints = new Map();

function initFont() {
  fontAtlas = document.createElement("canvas");
  fontAtlas.width = FONT_CHARS.length * 8; fontAtlas.height = 8;
  const c = fontAtlas.getContext("2d");
  c.fillStyle = "#fff";
  FONT_CHARS.forEach((ch, i) => {
    for (let y = 0; y < 8; y++) {
      let bits;
      if (i < 95) bits = parseInt(FONT_HEX.substr(i * 16 + y * 2, 2), 16);
      else { const row = FONT_EXTRA[ch][y]; bits = 0; for (let x = 0; x < 8; x++) if (row[x] === "X") bits |= 128 >> x; }
      for (let x = 0; x < 8; x++) if (bits & (128 >> x)) c.fillRect(i * 8 + x, y, 1, 1);
    }
  });
}
function fontTint(color) {
  let t = fontTints.get(color);
  if (t) return t;
  t = document.createElement("canvas"); t.width = fontAtlas.width; t.height = 8;
  const c = t.getContext("2d");
  c.drawImage(fontAtlas, 0, 0); c.globalCompositeOperation = "source-in"; c.fillStyle = color; c.fillRect(0, 0, t.width, 8);
  fontTints.set(color, t);
  return t;
}
// Iterate characters (emoji-safe for the lock glyph)
const glyphsOf = s => Array.from(String(s));
const textW = (s, scale = 1) => { const n = glyphsOf(s).length; return n ? n * 8 * scale - scale : 0; };

function drawGlyphs(ctx, chars, x, y, color, scale) {
  const atlas = fontTint(color);
  for (let i = 0; i < chars.length; i++) {
    const idx = FONT_INDEX.get(chars[i]);
    if (idx === undefined || chars[i] === " ") continue;
    ctx.drawImage(atlas, idx * 8, 0, 8, 8, x + i * 8 * scale, y, 8 * scale, 8 * scale);
  }
}
// opts: align left|center|right, scale, shadow (default true), outline, alpha, ctx
function text(s, x, y, color = "#fff", o = {}) {
  const ctx = o.ctx || g, scale = o.scale || 1;
  const chars = glyphsOf(s);
  const w = chars.length * 8 * scale - scale;
  if (o.align === "center") x -= Math.floor(w / 2); else if (o.align === "right") x -= w;
  x = Math.round(x); y = Math.round(y);
  const a = ctx.globalAlpha;
  if (o.alpha !== undefined) ctx.globalAlpha = a * o.alpha;
  if (o.outline) {
    const oc = o.outlineColor || "#000";
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) drawGlyphs(ctx, chars, x + dx * scale, y + dy * scale, oc, scale);
  } else if (o.shadow !== false) drawGlyphs(ctx, chars, x + scale, y + scale, o.shadowColor || "#000", scale);
  drawGlyphs(ctx, chars, x, y, color, scale);
  ctx.globalAlpha = a;
  return w;
}
function wrapText(s, maxW, scale = 1) {
  const max = Math.max(1, Math.floor((maxW + scale) / (8 * scale)));
  const out = [];
  for (const para of String(s).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? line + " " + word : word;
      if (glyphsOf(next).length > max && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}
