// client.js: the Client renderer, a surface module. It runs on the drawing surface itself (the terminal's render
// loop, or the desktop app), draws the pet from its props on the surface's own frame clock (no frame goes through
// the hooks module), and turns the pointer into reactions: the eyes follow it; a click posts a poke, which the host
// answers with an emote in the next props.
// Props (from register.js): { v, pack: built-in id or a data pack, fps, state, info, emote: { kind, age } | null }.

import { BUILTINS, compile, createStage } from '../engine/pack.js'
import { hex, DEF } from '../engine/pixel.js'

const runtime = new WeakMap()               // surface → this instance's clock, pointer and last frame
const stages = new Map()                    // pack key → stage, shared by instances

function stageFor(pack) {
  const key = typeof pack === 'string' ? pack : JSON.stringify(pack)
  let st = stages.get(key)
  if (!st) {
    const p = typeof pack === 'string' ? BUILTINS.get(pack) : compile(pack, 'plugin').pack
    st = createStage(p || BUILTINS.get('clawd'))
    stages.set(key, st)
  }
  return st
}

// The instance's time: wall time where the surface keeps it, its own ticks under a test's frame clock.
const localNow = (R) => R.start + Math.max(R.ticks * R.dt, Date.now() - R.wall)

/** Draws a frame into R; true when it differs from the last one. */
function draw(R) {
  const p = R.props || {}
  const st = stageFor(p.pack || 'clawd')
  const t = localNow(R)
  const key = p.emote ? p.emote.kind + ':' + p.emote.age : ''
  if (key !== R.emoteKey) { R.emoteKey = key; R.emote = p.emote ? { kind: p.emote.kind, t0: t - p.emote.age } : null }
  const C = st.draw(t, { state: p.state || 'idle', info: { ...(p.info || {}), look: R.look }, emote: R.emote })
  R.frames += 1
  const wd = C.words()
  if (R.last && R.last.length === wd.length) {
    let same = true
    for (let i = 0; i < wd.length; i++) if (wd[i] !== R.last[i]) { same = false; break }
    if (same) return false
  }
  R.last = Uint32Array.from(wd)
  R.rows = C.spans()
  R.changed += 1
  return true
}

function tick(surface, R) {
  R.ticks += 1
  if (draw(R)) { R.n += 1; surface.setState({ n: R.n }) }
  const t = localNow(R), el = t - R.markAt
  if (el >= 2000) {
    surface.post({ stats: { computed: Math.round((R.frames * 10000) / el) / 10, fps: Math.round((R.changed * 10000) / el) / 10 } })
    R.markAt = t; R.frames = 0; R.changed = 0
  }
}

function pointer(surface, R, ev) {
  if (ev.type === 'down') { surface.post({ poke: { x: ev.x, y: ev.y } }); return }
  if (ev.type === 'leave') { R.look = null; return }
  const pk = stageFor((R.props && R.props.pack) || 'clawd').pack
  const eye = pk.look ? pk.look[0] / (pk.mode === 'half' ? 1 : 2) : pk.cols / 4    // the eyes' column, in cells
  const x = ev.fine ? ev.fine.x : ev.x + 0.5, y = ev.fine ? ev.fine.y : ev.y + 0.5
  R.look = y < 0.6 ? 'up' : x < eye - 1.5 ? 'left' : x > eye + 1.5 ? 'right' : 'front'
}

export default function Pet(props, surface) {
  const { Box, Text } = surface.elements
  let R = runtime.get(surface)
  if (!R) {
    const dt = Math.max(8, Math.round(1000 / (Number(props && props.fps) || 60)))
    const wall = Date.now()
    R = { props, dt, ticks: 0, start: wall, wall, look: null, emote: null, emoteKey: '', last: null, rows: null, frames: 0, changed: 0, markAt: wall, n: 0 }
    runtime.set(surface, R)
    surface.every(dt, () => tick(surface, R))
    surface.onPointer((ev) => pointer(surface, R, ev))
  }
  R.props = props
  if (!R.rows) draw(R)
  return Box({
    flexDirection: 'column',
    children: R.rows.map((row) => Text({ children: row.map(([s, fg, bg]) => Text({ color: fg === DEF ? undefined : hex(fg), backgroundColor: bg === DEF ? undefined : hex(bg), children: [s] })) })),
  })
}
