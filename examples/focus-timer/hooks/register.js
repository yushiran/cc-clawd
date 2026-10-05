// focus-timer: the smallest useful guest of cc-clawd. It shows the three things a guest does:
//   $.clawd.signal  put the pet in a scene (laptop while you focus, confetti when you are done)
//   $.clawd.slot    hand the pet a row for the band (the countdown, with a button to stop)
//   a fallback      every call sits in try/catch; without the pet, the countdown goes to the status line
// No dependency on cc-clawd is declared: $.clawd is on every plugin's `$` once cc-clawd is installed.

let endsAt = 0          // when the block ends (ms), 0 when none runs
let minutes = 25

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }

async function show($) {
  const left = endsAt - (await $.clock.now())
  try {
    if (!endsAt) {
      await $.clawd.slot({ source: 'focus', rows: null })
      return
    }
    if (left <= 0) {
      endsAt = 0
      await $.clawd.slot({ source: 'focus', rows: null })
      await $.clawd.signal({ source: 'focus', scene: 'confetti', say: minutes + ' minutes of focus done', priority: 85, ttlMs: 20000 })
      return
    }
    await $.clawd.slot({ source: 'focus', order: 5, rows: [[['focus ', { dim: true }], [mmss(left), { bold: true }], [' left', { dim: true }]]], action: { label: 'stop', command: 'focus stop' } })
    await $.clawd.signal({ source: 'focus', scene: 'laptop', tool: 'Edit', priority: 40, ttlMs: 5000 })
  } catch (err) {
    // no pet installed: the status line instead
    await $.ui.status(endsAt && left > 0 ? 'focus ' + mmss(left) : undefined)
    if (endsAt && left <= 0) { endsAt = 0; $.ui.toast(minutes + ' minutes of focus done') }
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    $.clock.every(1000, () => { show($) })
    try { await $.command.register({ name: 'focus', description: 'Focus block: /focus [minutes] starts one (default 25), /focus stop ends it' }) } catch (err) { /* the name is taken */ }
    return next(e)
  })

  on('command.run', { command: 'focus' }, async ($, e) => {
    const arg = String(e.args || '').trim()
    if (arg === 'stop') { endsAt = 0; await show($); return { text: 'Focus block stopped.' } }
    minutes = Math.max(1, Math.min(180, Number(arg) || 25))
    endsAt = (await $.clock.now()) + minutes * 60e3
    await show($)
    return { text: 'Focus for ' + minutes + ' minutes.' }
  })
}
