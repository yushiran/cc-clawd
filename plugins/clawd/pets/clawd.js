// clawd.js: Clawd, the Claude Code crab, as a code pack. Fan art: Clawd is Anthropic's mascot; this project is not
// affiliated with Anthropic.
// 17 cells × 3 rows in quad mode = 34 × 6 pixels: the crab on the left (pixels 0–17, the official block art redrawn
// pixel by pixel, its eyes holes in the body) and its props on the right (pixels 18–33, effects from fx.js).

import { mix } from '../engine/pixel.js'
import { FX, PAL } from '../engine/fx.js'

const PROPS = 18                                             // where the props' region starts (pixels)

// Eyes (holes in the body), arms (rest / up / down) and legs (stand / step / tuck)
const EYES = {
  front: [[1, 5], [1, 12]], right: [[1, 6], [1, 13]], left: [[1, 4], [1, 11]], up: [[0, 5], [0, 12]],
  wide: [[0, 5], [1, 5], [0, 12], [1, 12]], shut: [],
}
const LOOKING = new Set(['idle', 'calm', 'happy', 'worried', 'think', 'needs', 'sad'])

function crab(C, x0, y0, o) {
  const holes = new Set((o.eyes || EYES.front).map(([r, c]) => r * 100 + c))
  const at = (r, c) => { if (!holes.has(r * 100 + c)) C.px(x0 + c, y0 + r, o.color, 5) }
  for (let c = 3; c <= 14; c++) { at(0, c); at(1, c); at(2, c); at(3, c) }
  const arm = (side, pose) => {
    const cs = side === 'L' ? [1, 2] : [15, 16]
    if (pose === 'up') { cs.forEach((c) => at(1, c)); at(0, side === 'L' ? 1 : 16) }
    else if (pose === 'down') cs.forEach((c) => at(3, c))
    else cs.forEach((c) => at(2, c))
  }
  arm('L', o.armL); arm('R', o.armR)
  for (const c of o.legs === 'step' ? [5, 7, 10, 12] : o.legs === 'tuck' ? [] : [4, 6, 11, 13]) at(4, c)
}

export default {
  format: 'cc-clawd/pack@1',
  id: 'clawd',
  name: 'Clawd',
  author: 'cc-clawd (fan art of the Claude Code mascot)',
  description: 'The Claude Code crab at its desk: coffee when idle, a laptop while Claude works, a monitor of your numbers',
  cols: 17, rows: 3, mode: 'quad',
  anchor: [19, 0],
  look: [8, 1],
  states: ['idle', 'calm', 'happy', 'ecstatic', 'cheer', 'worried', 'sad', 'sleep', 'alert', 'needs', 'think', 'dizzy'],

  /** info: { bars?, tool?, dx?, dy? (emote motion), look?: 'left' | 'right' | 'up' | 'front' (the pointer) } */
  render(C, t, state, info) {
    const bars = Array.isArray(info.bars) && info.bars.length ? info.bars : null
    const pose = { eyes: EYES.right, armL: 'rest', armR: 'rest', legs: 'stand', color: 0 }
    let x0 = 0, y0 = 1
    const hop = (period, air) => ((t % period) / period < air ? 0 : 1)
    const desk = () => (bars ? FX.monitor(C, t, PROPS, 0, { bars }) : FX.coffee(C, t, PROPS, 0))
    switch (state) {
      case 'idle': {                                         // looks around, shuffles, stretches
        const c = t % 12000
        pose.eyes = c < 3000 ? EYES.front : c < 4200 ? EYES.left : c < 7000 ? EYES.front : c < 8200 ? EYES.right : EYES.front
        if (c > 9000 && c < 9800) pose.legs = Math.floor(t / 140) % 2 ? 'step' : 'stand'
        if (c > 10400 && c < 11200) pose.armR = 'up'
        FX.coffee(C, t, PROPS, 0)
        break
      }
      case 'calm': {
        const c = t % 9000
        pose.eyes = c > 6200 && c < 7300 ? EYES.front : EYES.right
        if (c > 3000 && c < 3700) pose.legs = Math.floor(t / 140) % 2 ? 'step' : 'stand'
        desk()
        break
      }
      case 'happy':
        pose.eyes = EYES.up; y0 = hop(700, 0.3)
        pose.armL = Math.floor(t / 350) % 2 ? 'up' : 'rest'; pose.armR = Math.floor(t / 350) % 2 ? 'rest' : 'up'
        desk(); FX.notes(C, t, PROPS, 0)
        break
      case 'ecstatic':
        pose.eyes = EYES.up; y0 = hop(420, 0.45); pose.armL = 'up'; pose.armR = 'up'
        pose.legs = y0 === 0 ? 'tuck' : 'stand'; FX.confetti(C, t, PROPS, 0, { n: 12 })
        break
      case 'cheer':
        pose.eyes = EYES.up; y0 = hop(380, 0.45)
        pose.armL = Math.floor(t / 190) % 2 ? 'up' : 'rest'; pose.armR = Math.floor(t / 190) % 2 ? 'rest' : 'up'
        pose.legs = y0 === 0 ? 'tuck' : 'stand'; FX.confetti(C, t, PROPS, 0, { n: 14 })
        if (Math.floor(t / 300) % 2 === 0) C.glyph(C.cellX(PROPS), 0, '!', PAL.yellow)
        break
      case 'worried':
        pose.eyes = EYES.front
        if (t % 2400 < 360) x0 = Math.floor(t / 60) % 2
        desk(); FX.sweat(C, t, PROPS, 0)
        break
      case 'sad':
        pose.eyes = EYES.front; pose.armL = 'down'; pose.armR = 'down'; FX.rain(C, t, PROPS, 0)
        break
      case 'sleep':
        pose.eyes = EYES.shut; pose.legs = 'tuck'; pose.color = PAL.orangeDim
        pose.armL = t % 4000 < 2000 ? 'rest' : 'down'; pose.armR = pose.armL
        FX.night(C, t, PROPS, 0)
        break
      case 'alert':
        pose.eyes = EYES.wide; y0 = hop(320, 0.4); pose.armL = 'up'; pose.armR = Math.floor(t / 160) % 2 ? 'up' : 'rest'
        FX.bell(C, t, PROPS, 0)
        break
      case 'needs':
        pose.eyes = Math.floor(t / 700) % 2 ? EYES.left : EYES.right; pose.armR = 'up'
        FX.ticket(C, t, PROPS, 0)
        break
      case 'think':
        pose.eyes = t % 3000 < 400 ? EYES.up : EYES.right
        pose.armL = Math.floor(t / 120) % 2 ? 'down' : 'rest'; pose.armR = Math.floor(t / 120) % 2 ? 'rest' : 'down'
        FX.laptop(C, t, PROPS, 0, { tool: info.tool })
        break
      case 'dizzy': {
        const k = Math.floor(t / 110) % 4
        pose.eyes = [[[0, 5], [1, 12]], [[1, 6], [0, 13]], [[1, 5], [0, 12]], [[0, 4], [1, 11]]][k]
        x0 = Math.floor(t / 260) % 2
        FX.orbit(C, t, PROPS, 0)
        break
      }
      default:
        FX.coffee(C, t, PROPS, 0)
    }
    const blink = t % 4200 < 130 && !['sleep', 'dizzy', 'cheer', 'alert', 'ecstatic'].includes(state)
    if (blink) pose.eyes = EYES.shut
    else if (info.look && EYES[info.look] && LOOKING.has(state)) pose.eyes = EYES[info.look]
    if (!pose.color) pose.color = mix(PAL.orange, PAL.orangeHi, ((Math.sin(t / 650) + 1) / 2) * 0.6)   // breathing
    crab(C, x0 + (info.dx || 0), y0 + (info.dy || 0), pose)
  },
}
