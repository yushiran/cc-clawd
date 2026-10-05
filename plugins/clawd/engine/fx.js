// fx.js: props and effects any pet can place, each a pure function of time.
// Every effect draws relative to an origin (x, y) in pixels, the top-left of its region, so a pet of any size puts
// it where it fits; glyph positions follow from the canvas's cellX/cellY, so quad and half canvases both work.
// Natural sizes (pixels, quad mode) are in FX_SIZES; data packs (pack.js) name effects from FX.
//   fx(C, t, x, y, o)   C a canvas (pixel.js), t milliseconds, o the effect's options

import { mix, sprite, BARS } from './pixel.js'

export const PAL = {
  orange: 0xd97757, orangeHi: 0xeb8a69, orangeDim: 0x9c5a44, gray: 0x8b929c, grayDark: 0x4a4f57, screen: 0x1b2420, glow: 0x2f4a3c,
  green: 0x5cc27a, red: 0xe5605a, yellow: 0xf2c14e, cyan: 0x5cc8e8, blue: 0x6f9cf5, pink: 0xf28bb3, purple: 0xb48ee0,
  white: 0xeeeeee, moon: 0xf3e3a1, paper: 0xf1ead8, ink: 0x3a3a3a, cloud: 0x9aa3ad, mug: 0xd9d4cc, coffee: 0x6b4a2f,
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// A screen's sweeping glow: five cells from x+4, pixel rows y+2..y+3.
function glow(C, t, x, y, period) {
  const s = ((t / period) % 1) * 7 - 1
  const c0 = C.cellX(x + 4)
  for (let k = 0; k < 5; k++) {
    const p = (c0 + k) * C.sx
    C.bg(p, y + 2, p + C.sx - 1, y + 3, mix(PAL.screen, PAL.glow, Math.max(0, 1 - Math.abs(k - s) / 1.2) * 0.9))
  }
}

/** A monitor whose three bars show o.bars (percent; ±2 fills a bar; green up, red down), eased over ~200 ms. */
function monitor(C, t, x, y, o) {
  const g = PAL.gray
  C.rect(x + 3, y + 1, x + 14, y + 1, g, 2); C.rect(x + 3, y + 4, x + 14, y + 4, g, 2)
  for (const r of [2, 3]) { C.px(x + 3, y + r, g, 2); C.px(x + 14, y + r, g, 2) }
  C.px(x + 8, y + 5, g, 2); C.px(x + 9, y + 5, g, 2)
  glow(C, t, x, y, 2600)
  const m = C.mem.monitor || (C.mem.monitor = { shown: [0, 0, 0], t: -1 })
  const dt = m.t < 0 ? 16.7 : clamp(t - m.t, 0, 500)
  m.t = t
  const k = 1 - Math.exp(-dt / 200)
  const bars = (o && o.bars) || []
  ;[x + 4, x + 8, x + 12].forEach((bx, i) => {
    const v = bars[i] || 0
    m.shown[i] += (v - m.shown[i]) * k
    const s = m.shown[i]
    const wiggle = Math.sin(t / 230 + i * 1.9) > 0.92 ? 1 : 0
    const lvl = clamp(Math.round((Math.abs(s) / 2) * 7) + wiggle, 0, 7)
    C.glyph(C.cellX(bx), C.cellY(y + 2), BARS[lvl], Math.abs(s) < 0.03 ? PAL.grayDark : s > 0 ? PAL.green : PAL.red)
  })
  C.glyph(C.cellX(x + 10), C.cellY(y + 2), '.', mix(PAL.screen, PAL.cyan, (Math.sin(t / 160) + 1) / 2))
}

const MUG = sprite(['mmmmm.', 'mcccmh', 'mmmmmh', '.mmm..'], { m: PAL.mug, c: PAL.coffee, h: PAL.mug })
/** A steaming mug. */
function coffee(C, t, x, y) {
  C.stamp(MUG, x + 6, y + 2, 2)
  for (let i = 0; i < 2; i++) {
    const k = ((t / 1500) + i / 2) % 1
    C.px(x + 7 + i * 2 + Math.round(Math.sin(t / 300 + i * 2) * 0.6), y + 1 - k * 2.2, mix(PAL.gray, PAL.grayDark, k), 2)
  }
}

/** Falling confetti over a w×h region (default 16×6), o.n pieces. */
function confetti(C, t, x, y, o) {
  const n = (o && o.n) || 12, w = (o && o.w) || 16, h = (o && o.h) || 6
  const colors = [PAL.yellow, PAL.pink, PAL.cyan, PAL.green, PAL.purple, PAL.white]
  for (let i = 0; i < n; i++) {
    const speed = 2.6 + (i % 5) * 0.8
    C.px(x + ((i * 7) % w) + Math.sin(t / 280 + i) * 0.7, y + (((t / 1000) * speed + i * 0.83) % (h + 1)) - 1, colors[i % colors.length], 3)
  }
}

/** A cloud with rain. */
function rain(C, t, x, y) {
  C.rect(x + 4, y + 1, x + 13, y + 1, PAL.cloud, 2)
  for (const dx of [5, 6, 7, 9, 10, 11, 12]) C.px(x + dx, y, PAL.cloud, 2)
  for (let i = 0; i < 7; i++) C.px(x + 4 + ((i * 3) % 10), y + 2 + (((t / 1000) * 7 + i * 0.57) % 4), PAL.blue, 3)
}

/** Moon, twinkling stars, and z's drifting up from cell (o.zx, o.zy), default the region's first cell, row +2. */
function night(C, t, x, y, o) {
  for (const [dy, dx] of [[0, 12], [0, 13], [1, 11], [2, 11], [3, 12], [3, 13]]) C.px(x + dx, y + dy, PAL.moon, 2)
  for (const [dx, dy, k] of [[5, 0, 0], [8, 3, 1.7], [15, 1, 3.1], [3, 4, 4.4]]) C.px(x + dx, y + dy, mix(PAL.grayDark, PAL.white, (Math.sin(t / 520 + k) + 1) / 2), 2)
  zzz(C, t, x, y, o)
}

/** z's drifting up and to the right, fading. */
function zzz(C, t, x, y, o) {
  const zx = o && o.zx != null ? o.zx : C.cellX(x), zy = o && o.zy != null ? o.zy : C.cellY(y) + 2
  for (let i = 0; i < 3; i++) {
    const k = ((t / 2600) + i / 3) % 1
    C.glyph(zx + Math.floor(k * 3.2), zy - Math.floor(k * 3), k < 0.5 ? 'z' : 'Z', mix(PAL.gray, PAL.grayDark, k))
  }
}

const BELL = sprite(['..yy..', '.yyyy.', '.yyyy.', 'yyyyyy'], { y: PAL.yellow })
/** A ringing bell; '!' blinks at cell (o.bx, o.by), default the region's first cell. */
function bell(C, t, x, y, o) {
  const s = Math.round(Math.sin((t / 1000) * Math.PI * 2 * 2.2) * 1.2)
  C.stamp(BELL, x + 6 + s, y, 3)
  if (Math.floor(t / 90) % 2) for (const [dx, dy] of [[2, 1], [3, 1], [2, 2]]) C.px(x + 6 + s + dx, y + dy, 0xfff1b8, 4)
  C.px(x + 9 - s, y + 4, PAL.orangeDim, 3)
  if (s !== 0) { C.px(x + (s > 0 ? 13 : 4), y + 1, PAL.gray, 2); C.px(x + (s > 0 ? 14 : 3), y + 2, PAL.gray, 2) }
  if (Math.floor(t / 250) % 2 === 0) C.glyph(o && o.bx != null ? o.bx : C.cellX(x), o && o.by != null ? o.by : C.cellY(y), '!', PAL.yellow)
}

/** A ticket with a blinking '?': waiting for the person. */
function ticket(C, t, x, y) {
  for (let r = 0; r <= 5; r++) {
    for (let px = x + 4; px <= x + 13; px++) {
      if ((r === 0 || r === 5) && (px === x + 4 || px === x + 13)) continue
      C.px(px, y + r, mix(PAL.paper, 0xfffaf0, (Math.sin(t / 300 + px * 0.4) + 1) / 4), 2)
    }
  }
  C.glyph(C.cellX(x + 8), C.cellY(y + 2), '?', mix(PAL.paper, PAL.red, (Math.sin(t / 180) + 1) / 2))
  C.bg(x + 8, y + 2, x + 9, y + 3, PAL.paper)
}

export const SCREEN = { Read: '[==]', Grep: '?...', Glob: '?...', Edit: '+-~ ', Write: '+-~ ', NotebookEdit: '+-~ ', Bash: '>ls_', WebSearch: '@...', WebFetch: '@...', Agent: '&...', Task: '&...' }
/** A laptop whose screen types what o.tool is doing. */
function laptop(C, t, x, y, o) {
  const g = PAL.gray
  C.rect(x + 4, y + 1, x + 13, y + 1, g, 2); C.px(x + 3, y + 1, g, 2); C.px(x + 14, y + 1, g, 2)
  for (const r of [2, 3]) { C.px(x + 3, y + r, g, 2); C.px(x + 14, y + r, g, 2) }
  C.rect(x + 1, y + 4, x + 15, y + 4, g, 2)
  glow(C, t, x, y, 1800)
  const text = SCREEN[o && o.tool] || '... '
  const n = 1 + (Math.floor(t / 170) % 5)
  for (let i = 0; i < 4; i++) {
    let ch = i < n ? text[i] : ' '
    if (i === n && Math.floor(t / 350) % 2 === 0) ch = '_'
    if (ch !== ' ') C.glyph(C.cellX(x + 4) + i, C.cellY(y + 2), ch, i === 0 ? PAL.cyan : PAL.green)
  }
}

/** Stars circling, with an 'x' in the middle: dizzy. */
function orbit(C, t, x, y) {
  for (let i = 0; i < 3; i++) {
    const a = (t / 1100) * Math.PI * 2 + (i * Math.PI * 2) / 3
    C.px(x + 8.5 + Math.cos(a) * 5, y + 2.5 + Math.sin(a) * 2.4, PAL.yellow, 3)
  }
  C.glyph(C.cellX(x + 8), C.cellY(y + 2), 'x', PAL.red)
}

/** A falling drop of sweat. */
function sweat(C, t, x, y) {
  const k = (t % 1400) / 1400
  if (k < 0.85) C.px(x, y + 1 + k * 4.5, PAL.cyan, 3)
}

/** Two notes floating up. */
function notes(C, t, x, y) {
  for (let i = 0; i < 2; i++) {
    const k = ((t / 1800) + i / 2) % 1
    const px = x + i * 3 + Math.round(Math.sin(k * 6) * 0.6), py = y + 5 - k * 6
    C.px(px, py, PAL.green, 3); C.px(px + 1, py - 1, PAL.green, 3); C.px(px + 1, py - 2, PAL.green, 3)
  }
}

// ---------- emote overlays: t is the time since the emote began ----------
const HEART = sprite(['.r.r.', 'rrrrr', '.rrr.', '..r..'], { r: PAL.pink })
/** A heart rising from (x, y), fading out after a second. */
function heart(C, t, x, y) {
  if (t > 1300) return
  C.stamp(HEART, x - 2, y - Math.round((t / 1300) * 3), 6)
}
/** Three twinkles around (x, y). */
function sparkle(C, t, x, y) {
  for (const [dx, dy, k] of [[-3, 0, 0], [2, -1, 1.3], [4, 2, 2.6]]) if (Math.sin(t / 90 + k) > 0) C.px(x + dx, y + dy, PAL.yellow, 6)
}
/** A blinking '!' in the cell over (x, y). */
function bang(C, t, x, y) {
  if (Math.floor(t / 160) % 2 === 0) C.glyph(C.cellX(x), C.cellY(y), '!', PAL.yellow)
}
/** A '?' in the cell over (x, y). */
function question(C, t, x, y) {
  C.glyph(C.cellX(x), C.cellY(y), '?', PAL.cyan)
}

export const FX = { monitor, coffee, confetti, rain, night, zzz, bell, ticket, laptop, orbit, sweat, notes, heart, sparkle, bang, question }

/** Each effect's natural size in pixels (quad mode), for placing it. */
export const FX_SIZES = {
  monitor: [16, 6], coffee: [16, 6], confetti: [16, 6], rain: [16, 6], night: [16, 6], zzz: [8, 6], bell: [16, 6], ticket: [16, 6],
  laptop: [16, 6], orbit: [16, 6], sweat: [1, 6], notes: [5, 6], heart: [5, 4], sparkle: [8, 4], bang: [2, 2], question: [2, 2],
}

/** Body motion of the emotes that move the pet: an offset {dx, dy} at time t since the emote began. */
export function emoteOffset(kind, t) {
  switch (kind) {
    case 'jump': return { dx: 0, dy: t < 700 && (t % 350) < 160 ? -1 : 0 }
    case 'nod': return { dx: 0, dy: (t % 450) > 120 && (t % 450) < 260 && t < 900 ? 1 : 0 }
    case 'shake': return { dx: t < 600 ? (Math.floor(t / 60) % 2 ? 1 : -1) : 0, dy: 0 }
    default: return { dx: 0, dy: 0 }
  }
}

/** The overlay an emote draws over the pet, at the pack's anchor. */
export const EMOTE_FX = { heart: 'heart', sparkle: 'sparkle', surprise: 'bang', question: 'question', jump: null, nod: null, shake: null }
export const EMOTES = Object.keys(EMOTE_FX)
export const EMOTE_MS = 1300
