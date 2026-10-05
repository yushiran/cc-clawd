// register.js: the host. Wires Claude Code to the brain (engine/brain.js) and a stage (engine/pack.js), publishes
// $.clawd to every plugin, and draws the band above the prompt: the pet on the left, other mods' rows on the right.
//
// Renderers, picked per surface (userConfig `renderer`, default auto):
//   raster  terminal: character pixels in a Raster, a frame computed every 1000/fps ms and blitted when it changed
//   image   terminal that draws pictures (kitty, Ghostty): the same frames as real pixels in an Image
//   client  desktop app (and the terminal on request): client.js animates on the surface's own clock, follows the
//           pointer and reacts to clicks; no hook round trip per frame
//   text    VS Code, mobile: the current frame as coloured text, redrawn when the pet's state changes
//
// Validator rules this file keeps: `$` is never stored (only called, or passed to top-level functions); other
// plugins reach $.clawd only by calling it inside try/catch; engine.create spreads `built`.

import { createBrain } from '../engine/brain.js'
import { BUILTINS, compile, createStage, STATES } from '../engine/pack.js'
import { base64, cells, hex, DEF } from '../engine/pixel.js'
import { EMOTES } from '../engine/fx.js'

const API = 1
const GAP = 2
const POKES = ['heart', 'jump', 'sparkle', 'nod']
const SIGNAL_README = `cc-clawd signal files: put <name>.json here and the pet reads it within a second.
{
  "scene": "confetti",          // idle monitor notes confetti rain night bell ticket laptop dizzy; null withdraws
  "say": "training finished",   // optional: replaces the text of the band's bottom row
  "mood": 1.5,                  // optional, -2..2: the pose for monitor
  "bars": [0.5, -1.2, 0.3],     // optional: the monitor's three bars (percent)
  "priority": 80,               // 0-99, higher wins; Claude working is 50, a permission prompt 100
  "ttlMs": 20000                // how long after the file's modification time it lasts; default 15 minutes
}
Delete the file to withdraw it. Write a temporary file and rename it, so a half-written file is never read.
`

let opts = {}
const brain = createBrain()
const packs = new Map(BUILTINS)            // id → compiled pack
const packErrors = {}                      // file or id → errors
let petOverride = ''                       // /clawd pet, when the setting could not be written
let rendererOverride = ''                  // /clawd bench
let stage = null
let surface = 'terminal'
let lastCols = 120
let lastRenderer = 'raster'
let home = ''
let termKey = ''
let imageLikely = false
let imageOK = 'unknown'                    // can this terminal draw an Image: yes | no | unknown
let clientFault = false
const band = { id: '', kind: '', live: false, denied: 0 }
let busy = false
let lastWords = null
let lastPickKey = ''
let polling = false
let bench = null                           // a /clawd bench in progress
let lastBench = null                       // its results
const fileMtime = new Map()
// The animation clock: the host's time at the last resync plus the larger of ticks × interval and wall time since.
// No $.clock.now() per frame; in production wall time leads (timers fire late, never early), under the test kit's
// clock the ticks do.
const clk = { host: Date.now(), wall: Date.now(), ticks: 0, dt: 16 }
const stat = { startedAt: '', registered: [], errors: [], frames: 0, blits: 0, skipped: 0, denies: 0, lastDeny: '', fps: 0, framesPerSec: 0, pokes: 0, client: null, theirs: '' }
let fpsMark = { t: 0, frames: 0, blits: 0 }

const now = () => clk.host + Math.max(clk.ticks * clk.dt, Date.now() - clk.wall)
const msg = (err) => String(err && err.message ? err.message : err).slice(0, 240)
const pickKey = (v) => v.state + '|' + v.by + '|' + (v.say || '') + '|' + (v.emote ? v.emote.kind + v.emote.t0 : '')

function activePack() {
  return packs.get(petOverride) || packs.get(String(opts.pet || '')) || packs.get('clawd')
}
function ensureStage() {
  const want = activePack()
  if (!stage || stage.pack !== want) { stage = createStage(want); lastWords = null }
  return stage
}

function registerPack(def, source) {
  const { pack, errors } = compile(def, source)
  const id = def && typeof def.id === 'string' ? def.id : '?'
  if (!pack) { packErrors[id] = errors; return { ok: false, id, errors } }
  if (BUILTINS.has(pack.id)) { packErrors[id] = ['the id "' + pack.id + '" belongs to a built-in pet']; return { ok: false, id, errors: packErrors[id] } }
  packs.set(pack.id, pack)
  delete packErrors[id]
  return { ok: true, id: pack.id, errors: [] }
}

// ---------- renderers ----------
function chooseRenderer(s, els) {
  const pref = rendererOverride || String(opts.renderer || 'auto')
  if (s === 'terminal') {
    if (pref === 'text') return 'text'
    if (pref === 'client' && !clientFault) return 'client'
    if (pref === 'image' && imageOK !== 'no') return 'image'
    if (pref === 'auto' && (imageOK === 'yes' || (imageOK === 'unknown' && imageLikely))) return 'image'
    return 'raster'
  }
  if (s === 'desktop' && 'Client' in els && !clientFault && pref !== 'text') return 'client'
  return 'text'
}

function textArt(els, C) {
  const { Box, Text } = els
  return Box({
    flexDirection: 'column', width: C.cols,
    children: C.spans().map((row) => Text({ children: row.map(([s, fg, bg]) => Text({ color: fg === DEF ? undefined : hex(fg), backgroundColor: bg === DEF ? undefined : hex(bg), children: [s] })) })),
  })
}

function clientProps(v, t) {
  const pack = ensureStage().pack
  return {
    v: API, pack: pack.source === 'builtin' ? pack.id : pack.def, fps: Number(opts.fps) || 60,
    state: v.state, info: v.info || {}, emote: v.emote ? { kind: v.emote.kind, age: Math.max(0, t - v.emote.t0) } : null,
  }
}

function setImage($, v) {
  imageOK = v
  if (termKey) $.store.set('image:' + termKey, v).catch(() => {})
  if (v === 'no') { band.live = false; $.ui.invalidate('ui.render') }
}

// Redraw the band only when what it says changes; the pixels move by blit.
function follow($, v) {
  const key = pickKey(v)
  if (key !== lastPickKey) { lastPickKey = key; $.ui.invalidate('ui.render') }
}

// ---------- the frame loop: one frame per tick, blitted only when it changed, one blit in flight ----------
function animate($) {
  clk.ticks += 1
  if (brain.takeChanged()) $.ui.invalidate('ui.render')
  if (!stage) return
  const t = now()
  const v = brain.pick(t)
  follow($, v)
  if (!band.live || busy) return
  const C = stage.draw(t, v)
  stat.frames += 1
  const wd = C.words()
  if (lastWords && lastWords.length === wd.length) {
    let same = true
    for (let i = 0; i < wd.length; i++) if (wd[i] !== lastWords[i]) { same = false; break }
    if (same) { stat.skipped += 1; return }
  }
  lastWords = Uint32Array.from(wd)
  let args
  if (band.kind === 'image') {
    const img = C.rgba()
    args = { requestId: band.id, key: 'pet', source: { rgba: base64(img.data), width: img.width, height: img.height } }
  } else {
    args = { requestId: band.id, key: 'pet', cells: C.cells() }
  }
  const kind = band.kind
  busy = true
  $.ui.blit(args).then((r) => {
    busy = false
    if (r && r.deny) {
      stat.denies += 1; stat.lastDeny = String(r.deny).slice(0, 160); lastWords = null
      if (kind === 'image' && imageOK !== 'yes') { setImage($, 'no'); return }
      if (++band.denied >= 5) band.live = false
    } else {
      band.denied = 0; stat.blits += 1
      if (kind === 'image' && imageOK !== 'yes') setImage($, 'yes')
    }
  }, (err) => { busy = false; band.live = false; lastWords = null; stat.lastDeny = msg(err) })
}

async function resync($) {
  try { const h = await $.clock.now(); clk.host = h; clk.wall = Date.now(); clk.ticks = 0 } catch (err) { /* keep extrapolating */ }
}

// ---------- every second: resync, the last second's rates, expiries, signal files, the benchmark ----------
async function second($) {
  await resync($)
  const t = now()
  const dt = (t - fpsMark.t) / 1000
  if (fpsMark.t && dt >= 0.5) {
    stat.fps = Math.round(((stat.blits - fpsMark.blits) / dt) * 10) / 10
    stat.framesPerSec = Math.round(((stat.frames - fpsMark.frames) / dt) * 10) / 10
  }
  if (!fpsMark.t || dt >= 0.5) fpsMark = { t, frames: stat.frames, blits: stat.blits }
  brain.sweep(t)
  if (bench) stepBench($, t)
  await pollFiles($)
}

async function pollFiles($) {
  if (!home || polling) return
  polling = true
  const dir = home + '/.local/share/clawd/signals'
  try {
    const list = await $.fs.list(dir)
    const seen = new Set()
    for (const ent of list) {
      if (ent.kind !== 'file' || !ent.name.endsWith('.json')) continue
      const source = 'file:' + ent.name.slice(0, -5)
      seen.add(source)
      if (fileMtime.get(source) === ent.mtimeMs) continue
      try {
        const j = JSON.parse(await $.fs.read(dir + '/' + ent.name))
        fileMtime.set(source, ent.mtimeMs)
        const r = brain.signal({ ...j, source }, ent.mtimeMs)
        if (!r.ok) stat.errors = stat.errors.slice(-4).concat([ent.name + ': ' + r.error])
      } catch (err) {
        fileMtime.delete(source)                   // half-written or not JSON: try again next second
      }
    }
    for (const source of [...fileMtime.keys()]) {
      if (!seen.has(source)) { fileMtime.delete(source); brain.signal({ source, scene: null }, now()) }
    }
  } catch (err) {
    // no signals directory: nobody sends file signals
  }
  polling = false
}

async function loadUserPacks($) {
  if (!home) return
  const dir = home + '/.config/clawd/pets'
  let list = []
  try { list = await $.fs.list(dir) } catch (err) { return }
  for (const ent of list) {
    if (ent.kind !== 'file' || !ent.name.endsWith('.json')) continue
    try {
      const r = registerPack(JSON.parse(await $.fs.read(dir + '/' + ent.name)), 'file')
      if (!r.ok) packErrors[ent.name] = r.errors
    } catch (err) {
      packErrors[ent.name] = ['not JSON: ' + msg(err)]
    }
  }
}

// ---------- /clawd bench: each terminal renderer for four seconds, then back ----------
function stepBench($, t) {
  if (t - bench.at < 4000) return
  const phase = bench.order[bench.i]
  const secs = (t - bench.at) / 1000
  const rate = (n) => Math.round((n / secs) * 10) / 10
  const r = phase === 'client'
    ? { framesPerSec: stat.client ? stat.client.computed : 0, sentPerSec: stat.client ? stat.client.fps : 0 }
    : { framesPerSec: rate(stat.frames - bench.frames), sentPerSec: rate(stat.blits - bench.blits) }
  if (phase === 'image' && imageOK === 'no') r.note = 'this terminal does not draw images'
  bench.results[phase] = r
  bench.i += 1
  if (bench.i < bench.order.length) {
    rendererOverride = bench.order[bench.i]
    bench.at = t; bench.frames = stat.frames; bench.blits = stat.blits
    if (rendererOverride === 'client') stat.client = null
  } else {
    lastBench = { results: bench.results, at: new Date(t).toISOString() }
    bench = null; rendererOverride = ''
    writeStatus($)
  }
  $.ui.invalidate('ui.render')
}

// ---------- self-check: ~/.local/share/clawd/status.json, every five seconds ----------
async function writeStatus($) {
  if (!home) return
  const t = now()
  const v = brain.pick(t)
  try {
    await $.fs.write(home + '/.local/share/clawd/status.json', JSON.stringify({
      at: new Date(t).toISOString(), api: API, pet: stage ? stage.pack.id : '', renderer: lastRenderer, surface, columns: lastCols, imageOK,
      state: v.state, by: v.by, band: { kind: band.kind, live: band.live, denied: band.denied },
      signals: [...brain.signals.values()].map((s) => ({ source: s.source, scene: s.scene, priority: s.priority, expiresInS: Math.round((s.until - t) / 1000) })),
      slots: brain.rows().map(([source, s]) => ({ source, rows: s.rows.length, action: s.action ? s.action.command : null })),
      packs: [...packs.values()].map((p) => p.id + ' (' + p.source + ')'), packErrors, bench: lastBench, ...stat,
    }, null, 1))
  } catch (err) {
    // cannot write: nothing to do
  }
}

// ---------- the band's right column: other mods' rows; a line of speech replaces the bottom row's text ----------
function runCommand($, command) {
  $.command.run({ command, args: '' }).catch(() => {})
}

function rightColumn($, els, width, say) {
  const { Box, Text, Button } = els
  const lines = []
  for (const [source, s] of brain.rows()) s.rows.forEach((spans, ri) => lines.push({ source, spans, action: ri === s.rows.length - 1 ? s.action : null }))
  if (say) {
    const spans = [[say, { color: 'cyan' }]]
    if (lines.length) lines[lines.length - 1] = { ...lines[lines.length - 1], spans }
    else lines.push({ source: '', spans, action: null })
  }
  return lines.map((l) => {
    const children = [Text({ wrap: 'truncate-end', children: l.spans.map((x) => Text({ color: x[1].color, dimColor: x[1].dim, bold: x[1].bold, children: [x[0]] })) })]
    if (l.action) {
      const used = l.spans.reduce((n, x) => n + cells(x[0]), 0)
      const command = l.action.command
      children.push(Text({ children: [' '.repeat(Math.max(1, width - used - cells(l.action.label)))] }))
      children.push(Button({ key: 'act-' + l.source, plain: true, dimColor: true, label: l.action.label, onPress: () => runCommand($, command) }))
    }
    return Box({ children })
  })
}

function statusText() {
  const t = now()
  const v = brain.pick(t)
  const pack = ensureStage().pack
  const lines = [
    pack.name + ' is ' + v.state + (v.by === 'activity' ? '' : ' (' + v.by + ')') + ' · renderer ' + lastRenderer + ' on ' + surface + (imageOK !== 'unknown' ? ' · images: ' + imageOK : '') + (stat.pokes ? ' · pokes ' + stat.pokes : ''),
    'frames: ' + stat.framesPerSec + ' computed/s, ' + stat.fps + ' sent/s (a frame is sent only when it changed)' + (stat.client ? ' · client: ' + stat.client.computed + ' computed/s, ' + stat.client.fps + ' changed/s' : ''),
    'signals: ' + ([...brain.signals.values()].map((s) => s.source + '=' + s.scene + '@' + s.priority).join(', ') || 'none'),
    'rows from: ' + (brain.rows().map(([s]) => s).join(', ') || 'nobody'),
    'pets: ' + [...packs.values()].map((p) => p.id).join(', ') + (Object.keys(packErrors).length ? ' · pack errors: ' + Object.keys(packErrors).join(', ') : ''),
  ]
  if (lastBench) lines.push('bench ' + lastBench.at.slice(11, 19) + ': ' + Object.entries(lastBench.results).map(([k, r]) => k + ' ' + r.framesPerSec + ' computed/s, ' + r.sentPerSec + ' sent/s' + (r.note ? ' (' + r.note + ')' : '')).join(' · '))
  return lines.join('\n')
}

export function register(on, options) {
  opts = options || {}
  clk.dt = Math.max(8, Math.round(1000 / (Number(opts.fps) || 60)))

  on('engine.create', async ($, e, next) => {
    const built = await next(e)
    return {
      ...built,
      clawd: {
        signal: async (a) => brain.signal(a, now()),
        emote: async (a) => brain.emote(a, now()),
        slot: async (a) => brain.slot(a),
        pack: async (def) => registerPack(def, 'plugin'),
        layout: async () => {
          const pack = ensureStage().pack
          return { api: API, columns: Math.max(10, lastCols - pack.cols - GAP - 1), petColumns: pack.cols + GAP, surface, renderer: lastRenderer, pet: pack.id }
        },
        state: async () => { const v = brain.pick(now()); return { state: v.state, by: v.by, pet: ensureStage().pack.id } },
        pets: async () => [...packs.values()].map((p) => ({ id: p.id, name: p.name, source: p.source, cols: p.cols, rows: p.rows, mode: p.mode })),
      },
    }
  })

  on('session.start', async ($, e, next) => {
    // Timers first: whatever fails below, the pet still moves.
    $.clock.every(clk.dt, () => animate($))
    $.clock.every(1000, () => { second($) })
    $.clock.every(5000, () => { writeStatus($); $.ui.invalidate('ui.render') })
    await resync($)
    brain.act.lastActive = now()
    stat.startedAt = new Date(now()).toISOString()
    try {
      home = (await $.env.get('HOME')) || ''
      const tp = (await $.env.get('TERM_PROGRAM')) || '', term = (await $.env.get('TERM')) || ''
      termKey = (tp || term).slice(0, 40)
      imageLikely = /kitty|ghostty/i.test(tp + ' ' + term) || !!(await $.env.get('KITTY_WINDOW_ID')) || !!(await $.env.get('GHOSTTY_RESOURCES_DIR'))
      const known = termKey ? await $.store.get('image:' + termKey) : undefined
      if (known === 'yes' || known === 'no') imageOK = known
    } catch (err) {
      stat.errors.push('environment: ' + msg(err))
    }
    try {
      await $.command.register({ name: 'clawd', description: 'The pet: status; demo, bench, pets, pet <id>, renderer <auto|raster|client|image|text>' })
      stat.registered.push('/clawd')
    } catch (err) {
      stat.errors.push('/clawd: ' + msg(err))
    }
    try {
      if (home && !(await $.fs.exists(home + '/.local/share/clawd/signals/README.txt'))) await $.fs.write(home + '/.local/share/clawd/signals/README.txt', SIGNAL_README)
    } catch (err) {
      // no signals directory: the band works without it
    }
    await loadUserPacks($)
    ensureStage()
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    brain.activity.tool(e.tool, now())
    try {
      return await next(e)
    } finally {
      brain.activity.toolDone(e.tool)          // a permission prompt names the tool, not the call
    }
  })
  on('classic.PermissionRequest', async ($, e, next) => {
    brain.activity.permission(e.tool_name, now())
    return next(e)
  })
  on('turn.start', async ($, e, next) => {
    brain.activity.turnStart(now())            // a subagent's run raises none
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) brain.activity.turnEnd(now())
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    brain.activity.prompt(now())
    return next(e)
  })

  // The client renderer's posts: a click on the pet, and its frame counts.
  on('ui.message', async ($, e, next) => {
    const d = e.data && typeof e.data === 'object' ? e.data : {}
    if (d.stats && typeof d.stats === 'object') stat.client = { computed: Number(d.stats.computed) || 0, fps: Number(d.stats.fps) || 0 }
    if (d.poke) {
      stat.pokes += 1
      const t = now()
      brain.emote({ source: 'pointer', emote: POKES[(stat.pokes - 1) % POKES.length] }, t)
      return { props: clientProps(brain.pick(t), t) }
    }
    return next(e)
  })
  on('ui.fault', async ($, e, next) => {
    clientFault = true
    stat.errors = stat.errors.slice(-4).concat(['client failed on ' + e.surface + ' (' + (e.phase || '') + ')'])
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'clawd' }, async ($, e) => {
    const [cmd, arg] = String(e.args || '').trim().split(/\s+/)
    if (cmd === 'demo') { brain.demo(now()); return { text: 'Each of the ' + STATES.length + ' states for 2.5 s: ' + STATES.join(' → ') } }
    if (cmd === 'pets') {
      return { text: [...packs.values()].map((p) => p.id + ' · ' + p.name + ' (' + p.source + ', ' + p.cols + '×' + p.rows + ' ' + p.mode + ')' + (p.description ? ': ' + p.description : '')).join('\n') + (Object.keys(packErrors).length ? '\nrefused: ' + Object.entries(packErrors).map(([k, v]) => k + ': ' + v.join('; ')).join(' · ') : '') }
    }
    if (cmd === 'pet') {
      if (!arg || !packs.has(arg)) return { text: 'Pets: ' + [...packs.keys()].join(', ') }
      try {
        const r = await $.config.set({ key: 'clawd.pet', value: arg })
        if (r && r.deny) throw new Error(r.deny)
        return { text: 'Pet: ' + arg + ' (saved in /config)' }
      } catch (err) {
        petOverride = arg; ensureStage(); $.ui.invalidate('ui.render')
        return { text: 'Pet: ' + arg + ' for this session (the setting could not be written: ' + msg(err) + ')' }
      }
    }
    if (cmd === 'renderer') {
      if (!['auto', 'raster', 'client', 'image', 'text'].includes(arg)) return { text: 'Renderers: auto, raster, client, image, text' }
      try {
        const r = await $.config.set({ key: 'clawd.renderer', value: arg })
        if (r && r.deny) throw new Error(r.deny)
        return { text: 'Renderer: ' + arg + ' (saved in /config)' }
      } catch (err) {
        rendererOverride = arg; $.ui.invalidate('ui.render')
        return { text: 'Renderer: ' + arg + ' for this session (' + msg(err) + ')' }
      }
    }
    if (cmd === 'bench') {
      if (surface !== 'terminal') return { text: 'The bench compares the terminal renderers; this band is on ' + surface + '.' }
      const order = ['raster', 'client'].concat(imageOK === 'no' ? [] : ['image'])
      bench = { order, i: 0, at: now(), frames: stat.frames, blits: stat.blits, results: {} }
      rendererOverride = order[0]; $.ui.invalidate('ui.render')
      return { text: 'Benchmarking ' + order.join(', ') + ', four seconds each; /clawd shows the result in ' + order.length * 4 + ' s.' }
    }
    return { text: statusText() }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) { band.live = false; return next(e) }
    const theirs = await next(e)
    stat.theirs = theirs && typeof theirs === 'object' ? String(theirs.type || 'tree') : String(theirs)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    surface = e.surface
    lastCols = e.props.bodyColumns || lastCols
    const t = now()
    brain.activity.working(!!e.props.isWorking, t)
    const pack = ensureStage().pack
    const v = brain.pick(t)
    lastPickKey = pickKey(v)
    const kind = chooseRenderer(e.surface, els)
    lastRenderer = kind
    band.live = false
    let art
    if (kind === 'raster' || kind === 'image') {
      band.id = e.requestId; band.kind = kind; band.live = true; band.denied = 0; lastWords = null
      const C = stage.draw(t, v)
      if (kind === 'image') {
        const img = C.rgba()
        art = els.Image({ key: 'pet', source: { rgba: base64(img.data), width: img.width, height: img.height }, columns: pack.cols, rows: pack.rows, alt: ' ' })
      } else {
        art = els.Raster({ key: 'pet', columns: pack.cols, rows: pack.rows, cells: C.cells() })
      }
    } else if (kind === 'client') {
      art = els.Client({ key: 'pet', module: './client.js', props: clientProps(v, t), width: pack.cols, height: pack.rows })
    } else {
      art = textArt(els, stage.draw(t, v))
    }
    const right = rightColumn($, els, Math.max(10, lastCols - pack.cols - GAP - 1), v.say)
    if (theirs !== null && theirs !== undefined) right.push(theirs)
    return Box({ flexDirection: 'row', children: [art, Text({ children: [' '.repeat(GAP)] }), Box({ flexDirection: 'column', children: right })] })
  })
}
