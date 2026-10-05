// brain.js: what the pet does now. Pure state, no `$`, no clock: every call takes the time.
// Inputs: what Claude is doing (activity), signals from mods and programs, emotes, slots (other mods' band rows).
// Output: pick(now) → { state, info, say, by, emote }.
// Priority: a permission prompt waiting on you (100) > signals by their priority (0–99; ties: the newest) >
// Claude working (50) > nothing (idle, or asleep after a long quiet or late at night).

import { STATES } from './pack.js'
import { EMOTES, EMOTE_MS } from './fx.js'

export const SCENES = ['idle', 'monitor', 'notes', 'confetti', 'rain', 'night', 'bell', 'ticket', 'laptop', 'dizzy']
const SCENE_STATE = { idle: 'idle', notes: 'happy', confetti: 'cheer', rain: 'sad', night: 'sleep', bell: 'alert', ticket: 'needs', laptop: 'think', dizzy: 'dizzy' }

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** −2…2 → the monitor's mood. */
export function moodState(m) {
  if (m >= 1.2) return 'ecstatic'
  if (m >= 0.35) return 'happy'
  if (m <= -1.2) return 'sad'
  if (m <= -0.35) return 'worried'
  return 'calm'
}

function normSpan(sp) {
  if (!Array.isArray(sp) || typeof sp[0] !== 'string') return null
  const st = sp[1] && typeof sp[1] === 'object' ? sp[1] : {}
  return [sp[0].slice(0, 400), { color: typeof st.color === 'string' ? st.color : undefined, dim: st.dim === true, bold: st.bold === true }]
}

/**
 * options: { sleepAfterMs = 20 min, nightSleepAfterMs = 3 min, nightUntilHour = 7, hourOf = (ms) => local hour }
 */
export function createBrain(options) {
  const o = { sleepAfterMs: 20 * 60e3, nightSleepAfterMs: 3 * 60e3, nightUntilHour: 7, hourOf: (ms) => new Date(ms).getHours(), ...(options || {}) }
  const signals = new Map()        // source → signal
  const slots = new Map()          // source → { rows, order, action, key }
  let emote = null                 // the latest: { kind, t0, until, say, source }
  let demoAt = 0
  let changed = false              // something the band draws changed (rows, a line of speech)
  const act = { working: false, doing: null, doingAt: 0, needs: 0, needsTool: '', lastActive: 0 }

  const brain = {
    act,
    signals,
    slots,
    /** True once after anything the band's text depends on changed. */
    takeChanged() { const c = changed; changed = false; return c },

    signal(a, at) {
      if (!a || typeof a.source !== 'string' || !a.source) return { ok: false, error: 'source: a non-empty string' }
      const source = a.source.slice(0, 64)
      if (a.scene === null) { if (signals.delete(source)) changed = true; return { ok: true } }
      if (!SCENES.includes(a.scene)) return { ok: false, error: 'scene: one of ' + SCENES.join(', ') + ', or null' }
      const rec = {
        source, scene: a.scene, mood: num(a.mood, 0),
        bars: Array.isArray(a.bars) ? a.bars.slice(0, 3).map(Number).filter(Number.isFinite) : null,
        tool: typeof a.tool === 'string' ? a.tool.slice(0, 32) : null,
        say: typeof a.say === 'string' && a.say ? a.say.slice(0, 200) : null,
        priority: clamp(Math.round(num(a.priority, 30)), 0, 99),
        until: at + clamp(num(a.ttlMs, 15 * 60e3), 1000, 24 * 3600e3),
        at,
      }
      // The same source repeating the same scene (a renewal, new bar heights) keeps its time, so two sources of one
      // priority do not take turns winning each time one of them re-sends.
      const old = signals.get(source)
      const same = old && old.until > at && old.scene === rec.scene && old.say === rec.say && old.priority === rec.priority
      if (same) rec.at = old.at
      signals.set(source, rec)
      if (!same) changed = true
      return { ok: true }
    },

    emote(a, at) {
      if (!a || !EMOTES.includes(a.emote)) return { ok: false, error: 'emote: one of ' + EMOTES.join(', ') }
      emote = { kind: a.emote, t0: at, until: at + EMOTE_MS, say: typeof a.say === 'string' && a.say ? a.say.slice(0, 200) : null, source: typeof a.source === 'string' ? a.source.slice(0, 64) : '' }
      changed = true
      return { ok: true }
    },

    slot(a) {
      if (!a || typeof a.source !== 'string' || !a.source) return { ok: false, error: 'source: a non-empty string' }
      const source = a.source.slice(0, 64)
      if (a.rows === null || a.rows === undefined) { if (slots.delete(source)) changed = true; return { ok: true } }
      if (!Array.isArray(a.rows)) return { ok: false, error: 'rows: an array of rows, or null' }
      const rows = a.rows.slice(0, 6).map((r) => (Array.isArray(r) ? r.map(normSpan).filter(Boolean) : []))
      const action = a.action && typeof a.action.label === 'string' && typeof a.action.command === 'string'
        ? { label: a.action.label.slice(0, 16), command: a.action.command.replace(/^\//, '').slice(0, 64) } : null
      const rec = { rows, order: clamp(num(a.order, 50), 0, 999), action }
      const key = JSON.stringify(rec)
      const old = slots.get(source)
      if (!old || old.key !== key) { slots.set(source, Object.assign(rec, { key })); changed = true }
      return { ok: true }
    },

    /** The slots in drawing order. */
    rows() { return [...slots.entries()].sort((a, b) => a[1].order - b[1].order || (a[0] < b[0] ? -1 : 1)) },

    /** Drops what expired. */
    sweep(now) {
      for (const [k, s] of signals) if (s.until <= now) { signals.delete(k); changed = true }
      if (emote && emote.until <= now) { if (emote.say) changed = true; emote = null }
    },

    demo(at) { demoAt = at; changed = true },

    activity: {
      tool(name, at) { act.doing = name; act.doingAt = at; act.lastActive = at },
      toolDone(name) { if (act.needs && act.needsTool === name) { act.needs = 0; changed = true } },
      permission(toolName, at) { act.needs = at || 1; act.needsTool = toolName || ''; act.lastActive = at; changed = true },
      turnStart(at) { act.working = true; act.lastActive = at },
      turnEnd(at) { act.working = false; act.doing = null; act.needs = 0; act.lastActive = at; changed = true },
      prompt(at) { act.lastActive = at },
      working(v, at) { if (v && !act.working) act.lastActive = at; act.working = !!v },
    },

    pick(now) {
      const em = emote && now < emote.until ? { kind: emote.kind, t0: emote.t0 } : null
      const emSay = emote && now < emote.until ? emote.say : null
      if (demoAt) {
        const k = Math.floor((now - demoAt) / 2500)
        if (k >= 0 && k < STATES.length) return { state: STATES[k], info: { bars: [1.1, -0.6, 0.4], tool: 'Bash' }, say: 'demo: ' + STATES[k], by: 'demo', emote: em }
        demoAt = 0
      }
      let best = null
      const consider = (c) => { if (!best || c.pr > best.pr || (c.pr === best.pr && c.at > best.at)) best = c }
      if (act.needs && now - act.needs < 10 * 60e3) consider({ state: 'needs', info: {}, pr: 100, at: act.needs, by: 'activity', say: null })
      if (act.working) consider({ state: 'think', info: { tool: act.doing && now - act.doingAt < 60e3 ? act.doing : null }, pr: 50, at: act.doingAt, by: 'activity', say: null })
      for (const s of signals.values()) {
        if (s.until <= now) continue
        const state = s.scene === 'monitor' ? moodState(s.mood) : SCENE_STATE[s.scene] || 'idle'
        consider({ state, info: { bars: s.bars, tool: s.tool }, pr: s.priority, at: s.at, by: s.source, say: s.say })
      }
      if (!best) {
        const quiet = now - act.lastActive
        const sleepy = quiet > o.sleepAfterMs || (o.hourOf(now) < o.nightUntilHour && quiet > o.nightSleepAfterMs)
        best = { state: sleepy ? 'sleep' : 'idle', info: {}, pr: 0, at: 0, by: 'activity', say: null }
      }
      return { state: best.state, info: best.info, say: emSay || best.say, by: best.by, emote: em }
    },
  }
  return brain
}
