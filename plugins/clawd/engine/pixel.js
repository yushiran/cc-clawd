// pixel.js: a small pixel engine for terminal cells.
// Pure, dependency-free and `$`-free: the same file runs in a Claude Code hooks module, in a Client
// surface module and in Node (tools/preview.mjs).
//
// A canvas is a grid of character cells. Each cell holds 2×2 pixels in "quad" mode (quadrant blocks ▖▗▘▝▚▞▙▛▜▟)
// or 1×2 pixels in "half" mode (half blocks ▀▄). Pixels carry a colour and a layer (z); glyphs (text, bar levels)
// can be put in whole cells over the pixels. A frame is then encoded for whichever backend draws it:
//   cells()  a Raster's `cells`: base64 of little-endian u32 [codePoint, fg, bg] triplets   terminal
//   spans()  per-row runs of [text, fg, bg]                                                Text, Client
//   rgba()   RGBA bytes, cw×ch image pixels per cell                                       Image (kitty, Ghostty)
//
// Measured on Claude Code 2.1.289 (docs/ENGINE.md): a Raster cell must be one printable, width-1 BMP character;
// the terminal paints colours at 4 bits per channel and keeps 1024 (fg, bg) pairs at once, so cells() quantizes;
// a cell has one foreground and one background, so when a cell's pixels disagree the highest layer wins there.
// rgba() has no such limits: every pixel keeps its own colour.

import { glyphBits } from './font.js'

export const PIXEL_VERSION = '2.0.0'
export const DEF = 0x01000000                         // "the terminal's own colour"

const QUAD = [' ', '▗', '▖', '▄', '▝', '▐', '▞', '▟', '▘', '▚', '▌', '▙', '▀', '▜', '▛', '█'].map((c) => c.codePointAt(0))
const UPPER = 0x2580, LOWER = 0x2584, FULL = 0x2588, SPACE = 0x20
/** Eighth-height bars ▁…█, for level meters. */
export const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'].map((c) => c.codePointAt(0))

/** 0xRRGGBB → 4 bits per channel, what the terminal actually paints. DEF passes through. */
export function q4(c) {
  if (c === DEF) return DEF
  const r = Math.round(((c >> 16) & 255) / 17) * 17
  const g = Math.round(((c >> 8) & 255) / 17) * 17
  const b = Math.round((c & 255) / 17) * 17
  return (r << 16) | (g << 8) | b
}

/** Linear blend of two 0xRRGGBB colours, k in [0, 1]. */
export function mix(a, b, k) {
  k = k < 0 ? 0 : k > 1 ? 1 : k
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k
  const bl = (a & 255) + ((b & 255) - (a & 255)) * k
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)
}

/** 0xRRGGBB → '#rrggbb'. */
export const hex = (c) => '#' + (c & 0xffffff).toString(16).padStart(6, '0')

/** '#rgb', '#rrggbb' or a number → 0xRRGGBB; throws on anything else. */
export function color(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return v
  if (typeof v === 'string') {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
    if (m) {
      const s = m[1].length === 3 ? m[1].split('').map((ch) => ch + ch).join('') : m[1]
      return parseInt(s, 16)
    }
  }
  throw new Error('not a colour: ' + JSON.stringify(v))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
/** Standard padded base64 (the engine's toBase64 when it has one). */
export function base64(u8) {
  if (typeof u8.toBase64 === 'function') return u8.toBase64()
  let s = ''
  for (let i = 0; i < u8.length; i += 3) {
    const n = (u8[i] << 16) | ((u8[i + 1] || 0) << 8) | (u8[i + 2] || 0)
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=')
  }
  return s
}

/**
 * Character-art sprite: one string per row; '.' or ' ' is transparent, any other character is looked up in
 * `palette` (a 0xRRGGBB number or '#rrggbb'). Returns [dx, dy, colour] triplets for canvas.stamp().
 */
export function sprite(lines, palette) {
  const out = []
  lines.forEach((line, dy) => {
    for (let dx = 0; dx < line.length; dx++) {
      const ch = line[dx]
      if (ch === '.' || ch === ' ') continue
      if (palette[ch] === undefined) throw new Error('sprite: the palette has no "' + ch + '"')
      out.push([dx, dy, color(palette[ch])])
    }
  })
  return out
}

/** How many terminal cells a string takes (CJK and full-width are 2). */
export function cells(s) {
  let n = 0
  for (const ch of String(s)) {
    const c = ch.codePointAt(0)
    n += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) ? 2 : 1
  }
  return n
}

/**
 * A canvas of `cols`×`rows` cells: (2·cols)×(2·rows) pixels in 'quad' mode, cols×(2·rows) in 'half' mode.
 * Buffers are allocated once and reused every frame.
 *   px(x, y, colour, z)      one pixel; a higher z draws over a lower one (default 1)
 *   rect(x0, y0, x1, y1, c, z)
 *   bg(x0, y0, x1, y1, c)    background colour behind a cell's pixels (per pixel; a cell takes its first)
 *   glyph(cx, cy, ch, c)     a character in a whole cell, over the pixels (text, BARS levels)
 *   stamp(sprite, x, y, z)
 *   cellX(x), cellY(y)       which cell a pixel coordinate falls in
 *   mem                      a scratch object effects may keep state in (one per canvas)
 */
export function createCanvas(cols, rows, mode = 'quad') {
  if (mode !== 'quad' && mode !== 'half') throw new Error('mode must be quad or half')
  const sx = mode === 'half' ? 1 : 2, sy = 2
  const w = cols * sx, h = rows * sy
  const fgC = new Uint32Array(w * h), fgZ = new Uint8Array(w * h)
  const bgC = new Uint32Array(w * h), bgOn = new Uint8Array(w * h)
  const gCode = new Uint32Array(cols * rows), gFg = new Uint32Array(cols * rows)
  const words = new Uint32Array(cols * rows * 3)
  const bytes = new Uint8Array(words.buffer)
  const ids = [0, 0, 0, 0]
  let fresh = false

  function encodeQuad() {
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const ci = cy * cols + cx, o = ci * 3
        ids[0] = (cy * 2) * w + cx * 2; ids[1] = ids[0] + 1; ids[2] = ids[0] + w; ids[3] = ids[2] + 1
        let bg = DEF
        for (let k = 0; k < 4; k++) if (bgOn[ids[k]]) { bg = q4(bgC[ids[k]]); break }
        if (gCode[ci]) { words[o] = gCode[ci]; words[o + 1] = q4(gFg[ci]); words[o + 2] = bg; continue }
        let top = 0, col = 0
        for (let k = 0; k < 4; k++) if (fgZ[ids[k]] > top) { top = fgZ[ids[k]]; col = fgC[ids[k]] }
        let bits = 0
        if (top) for (let k = 0; k < 4; k++) if (fgZ[ids[k]] && fgC[ids[k]] === col) bits |= 8 >> k
        words[o] = QUAD[bits]
        words[o + 1] = bits ? q4(col) : DEF
        words[o + 2] = bg
      }
    }
  }

  function encodeHalf() {
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const ci = cy * cols + cx, o = ci * 3
        const t = (cy * 2) * w + cx, b = t + w
        const bgT = bgOn[t] ? q4(bgC[t]) : DEF, bgB = bgOn[b] ? q4(bgC[b]) : DEF
        if (gCode[ci]) { words[o] = gCode[ci]; words[o + 1] = q4(gFg[ci]); words[o + 2] = bgT !== DEF ? bgT : bgB; continue }
        const tz = fgZ[t], bz = fgZ[b]
        if (!tz && !bz) { words[o] = SPACE; words[o + 1] = DEF; words[o + 2] = bgT !== DEF ? bgT : bgB }
        else if (tz && !bz) { words[o] = UPPER; words[o + 1] = q4(fgC[t]); words[o + 2] = bgB }
        else if (!tz && bz) { words[o] = LOWER; words[o + 1] = q4(fgC[b]); words[o + 2] = bgT }
        else {
          const a = q4(fgC[t]), d = q4(fgC[b])
          if (a === d) { words[o] = FULL; words[o + 1] = a; words[o + 2] = DEF }
          else { words[o] = UPPER; words[o + 1] = a; words[o + 2] = d }
        }
      }
    }
  }

  const c = {
    cols, rows, mode, w, h, sx, sy,
    mem: {},
    cellX: (x) => Math.floor(x / sx),
    cellY: (y) => Math.floor(y / sy),
    clear() { fgZ.fill(0); bgOn.fill(0); gCode.fill(0); fresh = false },
    px(x, y, col, z) {
      x = Math.round(x); y = Math.round(y)
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const i = y * w + x, zz = z || 1
      if (zz >= fgZ[i]) { fgC[i] = col; fgZ[i] = zz; fresh = false }
    },
    rect(x0, y0, x1, y1, col, z) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) c.px(x, y, col, z) },
    bg(x0, y0, x1, y1, col) {
      for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) { bgC[y * w + x] = col; bgOn[y * w + x] = 1 }
      }
      fresh = false
    },
    glyph(cx, cy, ch, col) {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return
      gCode[cy * cols + cx] = typeof ch === 'number' ? ch : ch.codePointAt(0)
      gFg[cy * cols + cx] = col
      fresh = false
    },
    stamp(spr, x, y, z) { for (let k = 0; k < spr.length; k++) c.px(x + spr[k][0], y + spr[k][1], spr[k][2], z) },

    /** The frame as [codePoint, fg, bg] words (quantized). Reused buffer: copy it to keep it. */
    words() {
      if (!fresh) { if (mode === 'half') encodeHalf(); else encodeQuad(); fresh = true }
      return words
    },
    /** A Raster's `cells`. */
    cells() { return base64(new Uint8Array(c.words().buffer)) },
    /** Per-row runs [text, fg, bg] of equal colours; a blank cell's foreground counts as DEF. */
    spans() {
      const wd = c.words(), out = []
      for (let cy = 0; cy < rows; cy++) {
        const row = []
        let text = '', fg = -1, bg = -1
        for (let cx = 0; cx < cols; cx++) {
          const o = (cy * cols + cx) * 3
          const cp = wd[o], f = cp === SPACE ? DEF : wd[o + 1], b = wd[o + 2]
          if (f !== fg || b !== bg) { if (text) row.push([text, fg, bg]); text = ''; fg = f; bg = b }
          text += String.fromCodePoint(cp)
        }
        if (text) row.push([text, fg, bg])
        out.push(row)
      }
      return out
    },
    /** Each row's characters (tests, debugging). */
    text() {
      const wd = c.words(), out = []
      for (let cy = 0; cy < rows; cy++) {
        let s = ''
        for (let cx = 0; cx < cols; cx++) s += String.fromCodePoint(wd[(cy * cols + cx) * 3])
        out.push(s)
      }
      return out
    },
    /**
     * The frame as RGBA bytes, cw×ch image pixels per cell (default 8×16, a typical cell), unquantized: every
     * pixel its own colour, glyphs drawn from a small pixel font, transparency where nothing is drawn.
     */
    rgba(cw = 8, ch = 16) {
      const W = cols * cw, H = rows * ch
      const out = new Uint8Array(W * H * 4)
      const put = (x, y, col) => { const i = (y * W + x) * 4; out[i] = (col >> 16) & 255; out[i + 1] = (col >> 8) & 255; out[i + 2] = col & 255; out[i + 3] = 255 }
      const box = (x0, y0, bw, bh, col) => { for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) put(x, y, col) }
      const pw = cw / sx, ph = ch / sy
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const ci = cy * cols + cx
          const X = cx * cw, Y = cy * ch
          if (gCode[ci]) {
            const p0 = (cy * sy) * w + cx * sx
            if (bgOn[p0]) box(X, Y, cw, ch, bgC[p0])
            const code = gCode[ci], col = gFg[ci]
            if (code >= 0x2581 && code <= 0x2588) { const n = Math.round(((code - 0x2580) / 8) * ch); box(X, Y + ch - n, cw, n, col); continue }
            const bits = glyphBits(code)
            const s = Math.max(1, Math.floor(Math.min(cw / 4, ch / 7)))
            const gx = X + Math.floor((cw - 3 * s) / 2), gy = Y + Math.floor((ch - 5 * s) / 2)
            for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (bits[r] & (4 >> q)) box(gx + q * s, gy + r * s, s, s, col)
            continue
          }
          for (let py = 0; py < sy; py++) {
            for (let px = 0; px < sx; px++) {
              const i = (cy * sy + py) * w + cx * sx + px
              const col = fgZ[i] ? fgC[i] : bgOn[i] ? bgC[i] : -1
              if (col >= 0) box(Math.round(X + px * pw), Math.round(Y + py * ph), Math.round(pw), Math.round(ph), col)
            }
          }
        }
      }
      return { data: out, width: W, height: H }
    },
  }
  c.encode = c.cells                                         // v1 name
  return c
}
