import { test, expect, mock } from 'claude-code/testing'

// The host end to end: mount the band, move the clock, read what was drawn and sent.
const now = Date.UTC(2026, 9, 5, 12, 0, 0)
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120 } as any

function find(node: any, type: string): any {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) { for (const k of node) { const r = find(k, type); if (r) return r } return undefined }
  if (node.type === type) return node
  const kids = node.props?.children ?? node.children ?? []
  return find(Array.isArray(kids) ? kids : [kids], type)
}
function textOf(node: any): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  const props = node.props ?? node
  return textOf(props.children ?? node.children ?? []) + (typeof props.label === 'string' ? props.label : '')
}

type Opts = { refuse?: boolean; files?: Record<string, string>; env?: Record<string, string>; denyImage?: boolean }
function engine(on: any, o: Opts = {}) {
  const clock = mock.clock(on, { now })
  mock.env(on, { HOME: '/home/t', TERM_PROGRAM: 'test', ...(o.env || {}) })
  mock.store(on)
  const files = o.files || {}
  const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
  on('fs.list', async ($: any, e: any) => {
    const names = Object.keys(files).filter((f) => dirOf(f) === e.path)
    if (!names.length) throw new Error('no such directory')
    return { value: names.map((f) => ({ name: f.slice(f.lastIndexOf('/') + 1), kind: 'file', size: files[f].length, mtimeMs: now, isLink: false })) }
  })
  on('fs.read', async ($: any, e: any) => { if (!(e.path in files)) throw new Error('missing'); return { value: files[e.path] } })
  on('fs.exists', async () => ({ value: true }))
  on('fs.write', async () => ({ value: undefined }))
  on('command.register', async ($: any, e: any) => { if (o.refuse) throw new Error('a skill owns that name'); return { value: { command: e.name } } })
  on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
  on('ui.render', async ($: any, e: any) => { const { Box } = $.ui.resolve(e); return Box({ children: [] }) })
  const sent = { cells: 0, images: 0 }
  on('ui.blit', async ($: any, e: any) => {
    if (e.source) { if (o.denyImage) return { value: { deny: 'the Image draws its alt there' } }; sent.images += 1; return { value: {} } }
    sent.cells += 1
    return { value: {} }
  })
  return { clock, sent }
}
async function tick(clock: any, ms: number) { for (let t = 0; t < ms; t += 16) { await clock.advance(16); await clock.settle() } }
async function clawd($: any, args = ''): Promise<string> { const r = await $.command.run({ command: 'clawd', args }); return String(r?.text ?? '') }

const guest = {
  name: 'guest',
  register: ((on: any) => {
    on('session.start', async ($: any, e: any, next: any) => {
      const r = await next(e)
      try {
        const L = await $.clawd.layout()
        await $.clawd.slot({ source: 'guest', rows: [[['guest row', { color: 'green' }], [' w=' + L.columns + ' api=' + L.api, { dim: true }]], [['second row', {}]]], action: { label: 'more', command: 'guest' } })
        await $.clawd.signal({ source: 'guest-ambient', scene: 'monitor', mood: 1.5, bars: [1.2, 0.4, -0.3], priority: 30, ttlMs: 600000 })
        await $.clawd.signal({ source: 'guest-event', scene: 'bell', say: 'order filled', priority: 70, ttlMs: 3000 })
        const good = await $.clawd.pack({ format: 'cc-clawd/pack@1', id: 'blob', cols: 6, rows: 2, palette: { o: '#ffaa00' }, sprites: { a: ['.oo.', 'oooo'] }, states: { idle: { frames: [['a', 500]] } } })
        const bad = await $.clawd.pack({ format: 'cc-clawd/pack@1', id: 'clawd', cols: 6, rows: 2, palette: {}, sprites: {}, states: {} })
        await $.clawd.slot({ source: 'guest-packs', rows: [[['packs ' + good.ok + ' ' + bad.ok + ' ' + bad.errors.length, {}]]], order: 1 })
      } catch (err) {
        // no pet: draw our own band
      }
      return r
    })
  }) as any,
}

test('terminal: a Raster the size of the pet, 60 frames computed a second, every change sent', async ($, on) => {
  const { clock, sent } = engine(on)
  await ($ as any).session.start({ cwd: '/tmp' })
  const ui = await $.ui.mount({ plugin: 'clawd', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, isWorking: true } })
  const raster = find(await ui.drawn(), 'Raster')
  expect([raster?.props?.columns, raster?.props?.rows]).toEqual([17, 3])
  const before = sent.cells
  await tick(clock, 5200)
  const said = await clawd($)
  console.log('sent in 5.2 s while working:', sent.cells - before, '|', said.split('\n')[1])
  expect(sent.cells - before).toBeGreaterThan(5 * 25)
  expect(Number((said.match(/frames: ([\d.]+) computed/) || [])[1])).toBeGreaterThan(55)
})

test('a guest mod hands rows, an action, signals and a pack; the highest priority wins, then expires', { plugins: [guest] }, async ($, on) => {
  const { clock } = engine(on)
  await ($ as any).session.start({ cwd: '/tmp' })
  const ui = await $.ui.mount({ plugin: 'clawd', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await tick(clock, 100)
  const text = textOf(await ui.drawn())
  expect(text.includes('guest row w=100 api=1')).toBe(true)
  expect(text.includes('order filled')).toBe(true)                   // the line of speech replaces the bottom row's text…
  expect(text.includes('second row')).toBe(false)
  expect(text.includes('more')).toBe(true)                           // …and keeps its button
  expect(text.includes('packs true false 1')).toBe(true)             // a good pack registers; one taking a built-in id does not
  expect((await clawd($)).split('\n')[0]).toContain('is alert (guest-event)')
  await tick(clock, 4200)
  expect((await clawd($)).split('\n')[0]).toContain('is ecstatic (guest-ambient)')
  expect(textOf(await ui.drawn()).includes('order filled')).toBe(false)
  expect(textOf(await ui.drawn()).includes('second row')).toBe(true)
  expect(await clawd($, 'pets')).toContain('blob · blob (plugin, 6×2 quad)')
  await clawd($, 'pet blob')
  const blob = find(await ui.drawn(), 'Raster')
  expect([blob?.props?.columns, blob?.props?.rows]).toEqual([6, 2])
})

test('a program drops a signal file; a user drops a pack file', async ($, on) => {
  const { clock } = engine(on, { files: {
    '/home/t/.local/share/clawd/signals/train.json': JSON.stringify({ scene: 'confetti', say: 'training finished', priority: 85 }),
    '/home/t/.config/clawd/pets/dot.json': JSON.stringify({ format: 'cc-clawd/pack@1', id: 'dot', cols: 4, rows: 1, palette: { o: '#00ff00' }, sprites: { a: ['o'] }, states: { idle: { frames: [['a', 900]] } } }),
    '/home/t/.config/clawd/pets/broken.json': '{ not json',
  } })
  await ($ as any).session.start({ cwd: '/tmp' })
  const ui = await $.ui.mount({ plugin: 'clawd', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await tick(clock, 1200)
  expect((await clawd($)).split('\n')[0]).toContain('is cheer (file:train)')
  expect(textOf(await ui.drawn()).includes('training finished')).toBe(true)
  const pets = await clawd($, 'pets')
  expect(pets).toContain('dot · dot (file')
  expect(pets).toContain('broken.json: not JSON')
})

test('a refused /clawd name does not stop the animation', async ($, on) => {
  const { clock, sent } = engine(on, { refuse: true })
  await ($ as any).session.start({ cwd: '/tmp' })
  await $.ui.mount({ plugin: 'clawd', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, isWorking: true } })
  const before = sent.cells
  await tick(clock, 1000)
  expect(sent.cells - before).toBeGreaterThan(20)
})

test('kitty-like terminals try real pixels; a terminal that refuses them falls back to the Raster and remembers', async ($, on) => {
  const { clock, sent } = engine(on, { env: { TERM: 'xterm-kitty', TERM_PROGRAM: '' }, denyImage: true })
  await ($ as any).session.start({ cwd: '/tmp' })
  const ui = await $.ui.mount({ plugin: 'clawd', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(find(await ui.drawn(), 'Image')?.props?.columns).toBe(17)
  await tick(clock, 200)
  expect(find(await ui.drawn(), 'Raster')?.props?.columns).toBe(17)
  expect(await clawd($)).toContain('images: no')
  const before = sent.cells
  await tick(clock, 500)
  expect(sent.cells - before).toBeGreaterThan(5)
})

test('kitty-like terminals that draw images get real pixels', async ($, on) => {
  const { clock, sent } = engine(on, { env: { TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' } })
  await ($ as any).session.start({ cwd: '/tmp' })
  const ui = await $.ui.mount({ plugin: 'clawd', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, isWorking: true } })
  await tick(clock, 1000)
  expect(find(await ui.drawn(), 'Image')?.props?.rows).toBe(3)
  expect(sent.images).toBeGreaterThan(20)
  expect(await clawd($)).toContain('images: yes')
})

test('desktop: the client animates on its own clock, follows the pointer and turns a click into an emote', async ($, on) => {
  engine(on)
  await ($ as any).session.start({ cwd: '/tmp' })
  const ui = await $.ui.mount({ plugin: 'clawd', surface: 'desktop', component: 'AbovePrompt', props: PROPS } as any)
  expect(find(await ui.drawn(), 'Client')?.props?.module).toContain('client')
  const frames = new Set<string>()
  for (let i = 0; i < 60; i++) { await ui.advance(16); frames.add(JSON.stringify(await ui.drawn({ in: 'pet' }))) }
  expect(frames.size).toBeGreaterThan(5)
  expect(textOf(await ui.drawn({ in: 'pet' })).length).toBeGreaterThan(30)
  await ui.pointer({ type: 'move', x: 1, y: 1 })
  await ui.pointer({ type: 'down', x: 4, y: 1, button: 'left' })
  let pink = false
  for (let i = 0; i < 40 && !pink; i++) { await ui.advance(16); pink = JSON.stringify(await ui.drawn({ in: 'pet' })).includes('#ee88bb') }
  expect(pink).toBe(true)                                            // the heart (the host answered the poke with an emote)
  expect(await clawd($)).toContain('pokes 1')
})

test('VS Code: still frames as coloured text, nothing sent per frame', async ($, on) => {
  const { clock, sent } = engine(on)
  await ($ as any).session.start({ cwd: '/tmp' })
  const ui = await $.ui.mount({ plugin: 'clawd', surface: 'vscode', component: 'AbovePrompt', props: PROPS } as any)
  const tree = await ui.drawn()
  expect(find(tree, 'Raster')).toBe(undefined)
  expect(find(tree, 'Client')).toBe(undefined)
  expect(textOf(tree).length).toBeGreaterThan(30)
  await tick(clock, 300)
  expect(sent.cells + sent.images).toBe(0)
})
