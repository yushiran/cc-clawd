#!/usr/bin/env node
// preview.mjs: see a pet without Claude Code. Runs the plugin's own engine in Node (no dependencies).
//
//   node tools/preview.mjs                         animate Clawd through every state in this terminal (truecolor)
//   node tools/preview.mjs slime --state happy     one pet, one state
//   node tools/preview.mjs my-pet.json             a data pack from a file (checked first)
//   node tools/preview.mjs clawd --png sheet.png   a contact sheet: one row per state, frames left to right
//   node tools/preview.mjs --check my-pet.json     only check a data pack and list its problems
//
// Options: --state <name>  --png <file>  --frames <n> (sheet columns, default 8)  --step <ms> (default 250)
//          --scale <n> (sheet pixel scale, default 1)  --seconds <n> (animation length, default 2 per state)

import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { BUILTINS, compile, createStage, STATES } from '../plugins/clawd/engine/pack.js'
import { DEF } from '../plugins/clawd/engine/pixel.js'

const argv = process.argv.slice(2)
const flag = (name, d) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : d }
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))

function loadPack(arg) {
  if (!arg) return BUILTINS.get('clawd')
  if (BUILTINS.has(arg)) return BUILTINS.get(arg)
  const { pack, errors } = compile(JSON.parse(readFileSync(arg, 'utf8')), 'file')
  if (!pack) { console.error(arg + ' is not a valid pack:\n  ' + errors.join('\n  ')); process.exit(1) }
  return pack
}

if (argv.includes('--check')) {
  const file = flag('check')
  const { errors } = compile(JSON.parse(readFileSync(file, 'utf8')), 'file')
  console.log(errors.length ? file + ':\n  ' + errors.join('\n  ') : file + ': OK')
  process.exit(errors.length ? 1 : 0)
}

const pack = loadPack(positional[0])
const stage = createStage(pack)
const states = flag('state') ? [flag('state')] : STATES
const info = { bars: [1.1, -0.6, 0.4], tool: 'Bash' }

// ---------- PNG contact sheet ----------
function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4) }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

if (flag('png')) {
  const cols = Number(flag('frames', 8)), step = Number(flag('step', 250)), scale = Number(flag('scale', 1))
  const cw = 8, ch = 16, pad = 8
  const fw = pack.cols * cw, fh = pack.rows * ch
  const W = (fw + pad) * cols + pad, H = (fh + pad) * states.length + pad
  const sheet = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 0x1e; sheet[i * 4 + 1] = 0x1f; sheet[i * 4 + 2] = 0x24; sheet[i * 4 + 3] = 255 }
  states.forEach((state, r) => {
    for (let c = 0; c < cols; c++) {
      const t = 1e12 + 5000 + c * step
      const img = stage.draw(t, { state, info }).rgba(cw, ch)
      const ox = pad + c * (fw + pad), oy = pad + r * (fh + pad)
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const s = (y * fw + x) * 4
        if (img.data[s + 3]) sheet.set(img.data.subarray(s, s + 4), ((oy + y) * W + ox + x) * 4)
      }
    }
  })
  let out = sheet, OW = W, OH = H
  if (scale > 1) {
    OW = W * scale; OH = H * scale; out = Buffer.alloc(OW * OH * 4)
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) sheet.copy(out, (y * OW + x) * 4, (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4, (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4 + 4)
  }
  writeFileSync(flag('png'), png(OW, OH, out))
  console.log('wrote ' + flag('png') + ' (' + OW + '×' + OH + '): ' + pack.name + ', states top to bottom: ' + states.join(', '))
  process.exit(0)
}

// ---------- truecolor animation in this terminal ----------
const sgr = (fg, bg) => (fg === DEF ? '\x1b[39m' : '\x1b[38;2;' + ((fg >> 16) & 255) + ';' + ((fg >> 8) & 255) + ';' + (fg & 255) + 'm') +
  (bg === DEF ? '\x1b[49m' : '\x1b[48;2;' + ((bg >> 16) & 255) + ';' + ((bg >> 8) & 255) + ';' + (bg & 255) + 'm')
function show(state, t) {
  const C = stage.draw(t, { state, info })
  return C.spans().map((row) => row.map(([s, fg, bg]) => sgr(fg, bg) + s).join('') + '\x1b[0m').join('\n')
}
const per = Number(flag('seconds', 2)) * 1000
const start = Date.now()
process.stdout.write('\x1b[?25l')
const lines = pack.rows + 1
let first = true
const timer = setInterval(() => {
  const el = Date.now() - start
  const k = Math.floor(el / per)
  if (k >= states.length) { clearInterval(timer); process.stdout.write('\x1b[?25h\n'); return }
  const frame = show(states[k], 1e12 + el) + '\n' + pack.name + ' · ' + states[k].padEnd(10)
  process.stdout.write((first ? '' : '\x1b[' + lines + 'A\r') + frame + '\n')
  first = false
}, 16)
process.on('SIGINT', () => { process.stdout.write('\x1b[?25h\n'); process.exit(0) })
