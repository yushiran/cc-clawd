import { test, expect } from 'claude-code/testing'
import { createCanvas, DEF } from '../engine/pixel.js'
import { BUILTINS, compile, createStage, resolveState, STATES } from '../engine/pack.js'
import { createBrain } from '../engine/brain.js'

// The engine, pure: encodings, packs, the brain. No engine events needed.

const RED = 0xff0000, BLUE = 0x0000ff

test('half mode: each cell is a top and a bottom pixel, every pixel its own colour', async () => {
  const C = createCanvas(4, 1, 'half')
  C.px(0, 0, RED); C.px(0, 1, BLUE)          // two colours → ▀ red on blue
  C.px(1, 0, RED); C.px(1, 1, RED)           // one colour → █
  C.px(2, 1, BLUE)                           // bottom only → ▄
  expect(C.text()[0]).toBe('▀█▄ ')
  const w = C.words()
  expect([w[1], w[2]]).toEqual([0xff0000, 0x0000ff])
  expect(w[11]).toBe(DEF)
})

test('quad mode: 2×2 pixels a cell, the highest layer wins a cell whose pixels disagree', async () => {
  const C = createCanvas(2, 1, 'quad')
  C.rect(0, 0, 1, 1, RED)                    // a full cell
  C.px(2, 0, RED, 1); C.px(3, 1, BLUE, 2)    // blue is higher: the red pixel goes blank
  expect(C.text()[0]).toBe('█▗')
  expect(C.words()[4]).toBe(0x0000ff)
})

test('spans merge runs of equal colours; rgba keeps transparency', async () => {
  const C = createCanvas(4, 1, 'quad')
  C.rect(0, 0, 3, 1, RED)
  const row = C.spans()[0]
  expect(row.length).toBe(2)
  expect(row[0][0]).toBe('██')
  const img = C.rgba(8, 16)
  expect([img.width, img.height]).toEqual([32, 16])
  expect(img.data[3]).toBe(255)                          // a drawn pixel is opaque
  expect(img.data[(16 * 32 + 0) * 4 - 1]).toBe(0)        // the last pixel of the last cell is not drawn
})

test('every built-in pet draws every state, and data packs are checked', async () => {
  for (const pack of BUILTINS.values()) {
    const st = createStage(pack)
    for (const s of STATES) for (const t of [0, 777, 5555]) expect(st.draw(1e12 + t, { state: s, info: { bars: [1, -1, 0.5], tool: 'Bash' } }).cells().length).toBeGreaterThan(0)
  }
  const bad = compile({ format: 'cc-clawd/pack@1', id: 'Bad Id', cols: 2, rows: 9, palette: { '.': '#fff' }, sprites: { a: ['zz'] }, states: { cheer: { frames: [['nope', 100]] } } })
  expect(bad.pack).toBe(null)
  expect(bad.errors.length).toBeGreaterThan(3)
  const tiny = compile({ format: 'cc-clawd/pack@1', id: 'tiny', cols: 4, rows: 1, palette: { o: '#ffaa00' }, sprites: { a: ['oo', 'oo'] }, states: { idle: { frames: [['a', 500]] } } })
  expect(tiny.errors).toEqual([])
  expect(resolveState(tiny.pack!, 'ecstatic')).toBe('idle')
  expect(resolveState(BUILTINS.get('slime')!, 'cheer')).toBe('cheer')
})

test('the brain: a permission prompt beats signals, signals beat working, ties go to the newest, signals expire', async () => {
  const b = createBrain({ hourOf: () => 12 })
  b.activity.turnStart(0)
  expect(b.pick(10).state).toBe('think')
  b.signal({ source: 'm', scene: 'monitor', mood: 1.5, priority: 30 }, 10)
  expect(b.pick(20).state).toBe('think')
  b.signal({ source: 'e', scene: 'confetti', priority: 70, ttlMs: 1000, say: 'filled' }, 30)
  expect(b.pick(40)).toMatchObject({ state: 'cheer', by: 'e', say: 'filled' })
  b.activity.permission('Bash', 50)
  expect(b.pick(60).state).toBe('needs')
  b.activity.toolDone('Bash')
  b.sweep(2000)
  expect(b.pick(2000).state).toBe('think')
  b.activity.turnEnd(2100)
  expect(b.pick(2200)).toMatchObject({ state: 'ecstatic', by: 'm' })
  expect(b.emote({ emote: 'heart' }, 2300).ok).toBe(true)
  expect(b.pick(2400).emote).toMatchObject({ kind: 'heart' })
  expect(b.pick(4000).emote).toBe(null)
  expect(b.signal({ source: 'x', scene: 'nope' as any }, 0).ok).toBe(false)
})

test('the pet sleeps after a long quiet, and sooner at night', async () => {
  const day = createBrain({ hourOf: () => 14 }), night = createBrain({ hourOf: () => 2 })
  day.activity.prompt(0); night.activity.prompt(0)
  expect(day.pick(5 * 60e3).state).toBe('idle')
  expect(night.pick(5 * 60e3).state).toBe('sleep')
  expect(day.pick(25 * 60e3).state).toBe('sleep')
})
