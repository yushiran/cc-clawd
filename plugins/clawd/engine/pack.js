// pack.js: pet packs. A pack is a pet: its size, its pixel mode and how it looks in each state.
//   code pack  { ..., render(C, t, state, info) }       ships inside the plugin (pets/), can do anything
//   data pack  { ..., palette, sprites, states }         plain JSON: a file in ~/.config/clawd/pets/, or another
//                                                        plugin's $.clawd.pack(); compiled here, never run as code
// Both compile to one shape (Pack below), which a stage draws, one frame per call. docs/PACKS.md is the format.

import { createCanvas, color, sprite as toSprite } from './pixel.js'
import { FX, EMOTE_FX, EMOTE_MS, emoteOffset } from './fx.js'
import BUILTIN from '../pets/index.js'

export const FORMAT = 'cc-clawd/pack@1'
export const STATES = ['idle', 'calm', 'happy', 'ecstatic', 'cheer', 'worried', 'sad', 'sleep', 'alert', 'needs', 'think', 'dizzy']
/** Where a state a pack lacks falls back to, step by step, ending at idle. */
export const FALLBACK = { calm: 'idle', happy: 'calm', ecstatic: 'happy', cheer: 'happy', worried: 'calm', sad: 'worried', sleep: 'idle', alert: 'idle', needs: 'alert', think: 'idle', dizzy: 'worried' }
const FX_NAMES = new Set([...Object.keys(FX), 'desk'])        // desk = monitor when there are bars, coffee otherwise
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const pair = (v, d) => (Array.isArray(v) && isNum(v[0]) && isNum(v[1]) ? [Math.round(v[0]), Math.round(v[1])] : d)

/** The state a pack draws for `state`: itself if the pack has it, else down the fallback chain, else idle. */
export function resolveState(pack, state) {
  let s = state
  for (let i = 0; i < 12 && s && !pack.has(s); i++) s = (pack.fallback && pack.fallback[s]) || FALLBACK[s]
  return s && pack.has(s) ? s : 'idle'
}

function common(def, errors) {
  if (!def || typeof def !== 'object') { errors.push('a pack is an object'); return null }
  if (def.format !== FORMAT) errors.push('format must be "' + FORMAT + '"')
  if (typeof def.id !== 'string' || !ID.test(def.id)) errors.push('id: 1–32 of a–z, 0–9, "-", starting with a letter or digit')
  const cols = def.cols, rows = def.rows
  if (!Number.isInteger(cols) || cols < 4 || cols > 40) errors.push('cols: a whole number from 4 to 40')
  if (!Number.isInteger(rows) || rows < 1 || rows > 4) errors.push('rows: a whole number from 1 to 4')
  const mode = def.mode || 'quad'
  if (mode !== 'quad' && mode !== 'half') errors.push('mode: "quad" or "half"')
  const fallback = {}
  if (def.fallback != null) {
    if (typeof def.fallback !== 'object') errors.push('fallback: an object of state → state')
    else for (const [k, v] of Object.entries(def.fallback)) {
      if (!STATES.includes(k) || !STATES.includes(v)) errors.push('fallback: ' + k + ' → ' + v + ' names a state that does not exist')
      else fallback[k] = v
    }
  }
  return {
    id: String(def.id), name: typeof def.name === 'string' ? def.name.slice(0, 40) : String(def.id),
    author: typeof def.author === 'string' ? def.author.slice(0, 80) : '',
    description: typeof def.description === 'string' ? def.description.slice(0, 200) : '',
    cols, rows, mode, fallback, anchor: pair(def.anchor, [Math.max(0, (cols * (mode === 'half' ? 1 : 2)) >> 1), 0]),
    look: pair(def.look, null),                       // where the eyes are (pixels): the client turns them to the pointer
  }
}

function compileData(def, errors) {
  const base = common(def, errors)
  if (!base) return null
  const w = base.cols * (base.mode === 'half' ? 1 : 2), h = base.rows * 2
  const palette = {}
  if (!def.palette || typeof def.palette !== 'object') errors.push('palette: an object of character → colour')
  else for (const [ch, v] of Object.entries(def.palette)) {
    if (ch.length !== 1 || ch === '.' || ch === ' ') { errors.push('palette: keys are single characters other than "." and " "'); continue }
    try { palette[ch] = color(v) } catch (err) { errors.push('palette "' + ch + '": ' + err.message) }
  }
  const sprites = {}
  if (!def.sprites || typeof def.sprites !== 'object') errors.push('sprites: an object of name → rows of characters')
  else for (const [name, lines] of Object.entries(def.sprites)) {
    if (!Array.isArray(lines) || !lines.every((l) => typeof l === 'string')) { errors.push('sprite ' + name + ': rows of characters'); continue }
    if (lines.length > h || lines.some((l) => l.length > w)) errors.push('sprite ' + name + ': larger than the canvas (' + w + '×' + h + ' pixels)')
    try { sprites[name] = toSprite(lines, palette) } catch (err) { errors.push('sprite ' + name + ': ' + err.message.replace('sprite: ', '')) }
  }
  const at = pair(def.at, [0, 0])
  const states = {}
  if (!def.states || typeof def.states !== 'object') errors.push('states: an object of state → { frames, fx? }')
  else for (const [state, spec] of Object.entries(def.states)) {
    if (!STATES.includes(state)) { errors.push('states: "' + state + '" is not one of ' + STATES.join(', ')); continue }
    const frames = []
    for (const f of (spec && spec.frames) || []) {
      if (!Array.isArray(f) || typeof f[0] !== 'string' || !isNum(f[1]) || f[1] <= 0 || f[1] > 60000) { errors.push(state + ': a frame is [sprite, ms (1–60000), dx?, dy?]'); continue }
      if (!sprites[f[0]]) { errors.push(state + ': no sprite "' + f[0] + '"'); continue }
      frames.push({ sprite: sprites[f[0]], ms: f[1], dx: isNum(f[2]) ? Math.round(f[2]) : 0, dy: isNum(f[3]) ? Math.round(f[3]) : 0 })
    }
    if (!frames.length) { errors.push(state + ': needs at least one frame'); continue }
    const fx = []
    for (const e of (spec && spec.fx) || []) {
      if (!Array.isArray(e) || !FX_NAMES.has(e[0]) || !isNum(e[1]) || !isNum(e[2])) { errors.push(state + ': an effect is [name, x, y, options?], name one of ' + [...FX_NAMES].join(', ')); continue }
      fx.push({ name: e[0], x: Math.round(e[1]), y: Math.round(e[2]), opts: e[3] && typeof e[3] === 'object' ? e[3] : {} })
    }
    states[state] = { frames, fx, total: frames.reduce((n, f) => n + f.ms, 0) }
  }
  if (!states.idle && !errors.length) errors.push('states: "idle" is required (every other state falls back to it)')
  return {
    ...base,
    has: (s) => !!states[s],
    render(C, t, state, info) {
      const st = states[state] || states.idle
      let k = t % st.total, f = st.frames[0]
      for (const fr of st.frames) { if (k < fr.ms) { f = fr; break } k -= fr.ms }
      for (const e of st.fx) {
        const name = e.name === 'desk' ? (info.bars && info.bars.length ? 'monitor' : 'coffee') : e.name
        FX[name](C, t, e.x, e.y, { ...e.opts, bars: info.bars, tool: info.tool })
      }
      C.stamp(f.sprite, at[0] + f.dx + (info.dx || 0), at[1] + f.dy + (info.dy || 0), 5)
    },
  }
}

function compileCode(def, errors) {
  const base = common(def, errors)
  if (!base) return null
  const has = new Set(Array.isArray(def.states) ? def.states.filter((s) => STATES.includes(s)) : ['idle'])
  if (!has.has('idle')) errors.push('states: "idle" is required')
  return { ...base, has: (s) => has.has(s), render: (C, t, state, info) => def.render(C, t, state, info) }
}

/**
 * A pack definition → { pack, errors }. A definition with a render function is a code pack (built-ins only:
 * functions do not cross plugins or files); anything else is a data pack. `pack` is null when there are errors.
 * The compiled pack keeps its definition as `def`, so a data pack can be handed to a Client as plain props.
 */
export function compile(def, source) {
  const errors = []
  let pack = null
  try {
    pack = def && typeof def.render === 'function' ? compileCode(def, errors) : compileData(def, errors)
  } catch (err) {
    errors.push(String(err && err.message ? err.message : err))
  }
  if (errors.length || !pack) return { pack: null, errors: errors.slice(0, 12) }
  return { pack: { ...pack, source: source || 'builtin', def: typeof def.render === 'function' ? null : def }, errors: [] }
}

/** The built-in packs, compiled once. */
export const BUILTINS = new Map()
for (const def of BUILTIN) {
  const { pack, errors } = compile(def, 'builtin')
  if (pack) BUILTINS.set(pack.id, pack)
  else throw new Error('built-in pack ' + def.id + ': ' + errors.join('; '))
}

/**
 * A stage draws one pack: draw(t, view) clears its canvas, has the pack draw `view.state` (resolved through the
 * fallbacks) with `view.info`, then lays an active emote over it. view: { state, info?, emote?: { kind, t0 } }.
 * Read the frame off `stage.canvas`: cells() for a Raster, spans() for text, rgba() for an Image.
 */
export function createStage(pack) {
  const C = createCanvas(pack.cols, pack.rows, pack.mode)
  return {
    pack,
    canvas: C,
    draw(t, view) {
      C.clear()
      const info = { ...(view.info || {}) }
      const em = view.emote && t - view.emote.t0 >= 0 && t - view.emote.t0 < EMOTE_MS ? view.emote : null
      if (em) { const o = emoteOffset(em.kind, t - em.t0); info.dx = o.dx; info.dy = o.dy }
      pack.render(C, t, resolveState(pack, view.state), info)
      if (em && EMOTE_FX[em.kind]) FX[EMOTE_FX[em.kind]](C, t - em.t0, pack.anchor[0], pack.anchor[1])
      return C
    },
  }
}
