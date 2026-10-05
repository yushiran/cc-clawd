// The $.clawd contract, api 1. cc-clawd adds `clawd` to every plugin's `$` (engine.create): no dependency needed.
// Each method is one event dispatch with one plain-data argument. Without cc-clawd installed `$.clawd` is absent and a
// call throws, so call it inside try/catch and draw your own band when it fails:
//
//   try { await $.clawd.slot({ source: 'mymod', rows }) } catch { /* no pet: draw the rows yourself */ }
//
// docs/API.md has the long form, docs/PACKS.md the pack format.

/** What the pet can be doing. A pack draws each (or falls back toward idle: ecstatic → happy → calm → idle ...). */
export type ClawdStateName = 'idle' | 'calm' | 'happy' | 'ecstatic' | 'cheer' | 'worried' | 'sad' | 'sleep' | 'alert' | 'needs' | 'think' | 'dizzy'

/**
 * A scene: what a signal asks the pet to do, mapped to a state. monitor takes `mood` (≥1.2 ecstatic, ≥0.35 happy,
 * ≤−0.35 worried, ≤−1.2 sad, else calm) and draws `bars`; laptop types what `tool` does; the rest are fixed:
 * notes happy, confetti cheer, rain sad, night sleep, bell alert, ticket needs, dizzy dizzy, idle idle.
 */
export type ClawdScene = 'idle' | 'monitor' | 'notes' | 'confetti' | 'rain' | 'night' | 'bell' | 'ticket' | 'laptop' | 'dizzy'

/** A one-shot reaction over whatever the pet is doing, about 1.3 s. */
export type ClawdEmote = 'heart' | 'sparkle' | 'surprise' | 'question' | 'jump' | 'nod' | 'shake'

export type ClawdSignal = {
  /** Who sends it; a new signal from the same source replaces its last. */
  source: string
  /** null withdraws this source's signal. */
  scene: ClawdScene | null
  /** −2…2: the pose for `monitor`. */
  mood?: number
  /** Up to three values (percent; ±2 fills a bar) for the monitor. */
  bars?: number[]
  /** For `laptop`: the tool on the screen (Read, Edit, Bash, …). */
  tool?: string
  /** A line of speech: replaces the text of the band's bottom row until the signal ends (that row's button stays). */
  say?: string
  /** 0–99, higher wins; ties go to the newest. The pet itself: a permission prompt 100, Claude working 50, idle 0.
   *  Suggested: lasting states (markets, a training run) 30–45, one-off events 70–90. Default 30. */
  priority?: number
  /** How long it lasts, default 15 minutes, at most 24 hours. */
  ttlMs?: number
}

export type ClawdEmoteArgs = {
  source?: string
  emote: ClawdEmote
  /** Said while the emote plays. */
  say?: string
}

/** A run of text and its style: [text, { color?, dim?, bold? }]. color: a terminal colour name or #rrggbb. */
export type ClawdSpan = [string, { color?: string; dim?: boolean; bold?: boolean }]

export type ClawdSlot = {
  /** Whose rows; the same source again replaces them. */
  source: string
  /** Rows of spans, at most six; null withdraws them. Lay them out to `layout().columns`. */
  rows: ClawdSpan[][] | null
  /** Top to bottom among several mods' rows, smaller first; default 50. */
  order?: number
  /** A button at the right end of the last row: pressing it runs /<command>. */
  action?: { label: string; command: string }
}

export type ClawdLayout = {
  /** The contract's version; this file describes 1. */
  api: 1
  /** Cells a slot row may take: the band's width less the pet and its gap. */
  columns: number
  /** Cells the pet and its gap take. */
  petColumns: number
  /** Where the band was last drawn: terminal, desktop, vscode or mobile. */
  surface: string
  /** How the pet is drawn there: raster, image, client or text. */
  renderer: string
  /** The active pet's id. */
  pet: string
}

export type ClawdState = {
  state: ClawdStateName
  /** Who put it there: `activity` (the pet itself), `demo`, or a signal's source. */
  by: string
  pet: string
}

export type ClawdPetInfo = { id: string; name: string; source: 'builtin' | 'file' | 'plugin'; cols: number; rows: number; mode: 'quad' | 'half' }

/**
 * A data pack: a pet as plain JSON (docs/PACKS.md). Sprites are rows of characters ('.' or ' ' transparent, others
 * looked up in `palette`); each state loops its frames and places effects; states it lacks fall back toward idle.
 */
export type ClawdPackDef = {
  format: 'cc-clawd/pack@1'
  /** 1–32 of a–z, 0–9, '-'. */
  id: string
  name?: string
  author?: string
  description?: string
  /** Cells: 4–40 across, 1–4 down. */
  cols: number
  rows: number
  /** quad: 2×2 pixels a cell, two colours a cell (crisp single-colour art); half: 1×2, every pixel its own colour. */
  mode?: 'quad' | 'half'
  palette: Record<string, string>
  sprites: Record<string, string[]>
  /** Where sprites are stamped, pixels. */
  at?: [number, number]
  /** Where emotes appear, pixels. */
  anchor?: [number, number]
  /** Where the eyes are, pixels (the client turns code packs' eyes toward the pointer). */
  look?: [number, number]
  states: Partial<Record<ClawdStateName, {
    /** [sprite, ms, dx?, dy?], looped. */
    frames: [string, number, number?, number?][]
    /** [effect, x, y, options?]: monitor, coffee, desk (monitor with bars, else coffee), laptop, confetti, rain, night,
     *  zzz, bell, ticket, orbit, sweat, notes, heart, sparkle, bang, question. */
    fx?: [string, number, number, Record<string, unknown>?][]
  }>>
  fallback?: Partial<Record<ClawdStateName, ClawdStateName>>
}

export type ClawdResult = { ok: boolean; error?: string }

export type Clawd = {
  signal: (args: ClawdSignal) => Promise<ClawdResult>
  emote: (args: ClawdEmoteArgs) => Promise<ClawdResult>
  slot: (args: ClawdSlot) => Promise<ClawdResult>
  /** Registers a data pack for this session; `/clawd pet <id>` or the `pet` setting picks it. */
  pack: (def: ClawdPackDef) => Promise<{ ok: boolean; id: string; errors: string[] }>
  layout: () => Promise<ClawdLayout>
  state: () => Promise<ClawdState>
  pets: () => Promise<ClawdPetInfo[]>
}

declare module 'claude-code' {
  interface EngineInterface {
    clawd: Clawd
  }
}
