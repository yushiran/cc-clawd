# The engine, and what we measured

Measured on Claude Code 2.1.289: live in a macOS terminal (Warp), and in the test kit (`claude plugin test`), which the repo's tests run. The image renderer is verified through the test kit and offline rendering (`tools/preview.mjs --png`); a live run in kitty or Ghostty is still to be reported.

## Architecture

```
            ┌───────────── hooks module (register.js) ─────────────┐
 Claude ──▶ │ activity ─┐                                          │
 events     │ $.clawd ──┼─▶ brain ─▶ { state, info, say, emote } ──┼─▶ band: pet │ rows from slots
 signal     │ files ────┘                 │                        │
 files      │                             ▼                        │
            │       stage(pack).draw(t) ─▶ canvas ─▶ cells │ rgba ─┼─▶ $.ui.blit (Raster, Image)
            └──────────────────────────────────────────────────────┘
            client.js (surface module): the same stage + canvas ─▶ text spans, on the surface's clock
```

- **engine/** is pure (no `$`, no clock, no I/O), so the same files run in the hooks module, in the client module, and in Node for `tools/preview.mjs`.
- The **brain** only decides; **packs** only draw; the **host** only wires Claude Code to both.

## Renderers

| | Raster + blit | Image + blit | Client module | Text |
|---|---|---|---|---|
| Where | Every terminal | kitty, Ghostty (detected) | Terminal, desktop app | VS Code, mobile, fallback |
| Pixels | Characters: 2×2 or 1×2 per cell, 2 colours per cell | Real, any colour per pixel | Characters (Text spans) | Characters |
| Per frame | 1 timer tick + 1 blit (only if changed) | Same, with RGBA bytes | Nothing crosses to the hooks module | None; redrawn on state change |
| Interactive | No | No | Pointer, keys | No |

**Defaults:**
- terminal: `image` where the terminal draws images, otherwise `raster`;
- desktop app: `client`;
- everything else: `text`.

## Measurements

| What | Number |
|---|---|
| Computing one frame (any built-in, any state) | ~10 µs, 0.06% of a 60 Hz frame |
| Frames computed per second at fps 60 (16 ms timer) | 59–63 |
| Frames that actually change, by scene | idle 15/s, think 30–39/s, cheer 49/s, dizzy 53/s |
| `$.ui.blit` accepted | Up to ~120/s; the terminal shows ~60 |
| Raster frame size (17×3) | 612 bytes (816 base64) |
| Image frame size (17×3 at 8×16 px per cell) | 26 KB RGBA (35 KB base64) |
| Live session, Warp, Claude working (v0.1, same engine) | 59 computed/s, 28–40 sent/s, 0 refused |

Because computing takes almost no time, a faster compute engine would change nothing on screen. What matters is the path from frame to screen, which the rules below are about.

## Best practices (they apply to any mod that animates)

### Drawing

1. **One Raster per grid of coloured cells, never a Box per cell.** Draw it once in `ui.render`, then repaint it with `$.ui.blit({ requestId, key, cells, columns, rows })`. Re-rendering through `$.ui.invalidate` is capped at about 30/s for the band, too slow for animation.
2. **Raster is terminal-only. Gate it on `e.surface === 'terminal'`, not on `'Raster' in elements`.** The desktop app's element table also lists `Raster` and `Image`, but a Raster drawn there comes out as an empty Box.
3. **Raster cells must be printable, width-1 BMP characters.** Quadrant (U+2596–259F), half and full blocks (U+2580–2595), box drawing, braille and ASCII are fine. Sextants and octants are outside the BMP and are refused.
4. **Quantize colours yourself.** The terminal paints 4 bits per channel (steps of 17) and keeps 1024 (fg, bg) pairs at a time. Quantizing before encoding stops gradients from minting new pairs, and makes an unchanged frame byte-identical, so you can skip it.
5. **Images: detect, then remember.** An `Image` blit on a terminal that cannot draw images is refused with a reason saying it draws its `alt`. Probe once, store the answer per terminal (`$.store`), and fall back to the Raster.

### Timing

6. **Send only changed frames, one blit in flight.** Compare the encoded words with the last frame; if the blit after the last one is still pending, skip this tick. After 5 refusals in a row (the band is hidden or covered), stop until the next `ui.render`.
7. **Animate as a pure function of time.** Draw from absolute time `t`, never from a frame counter: a dropped frame is then just a skipped picture, never a jump, and every renderer agrees.
8. **Do not read the host clock every frame.** `$.clock.now()` is an event dispatch. Resync once a second and extrapolate: `host + max(ticks × interval, wall time since the resync)`. In production wall time wins, because timers fire late and never early; under the test kit's mock clock the ticks win, so tests can drive the animation.

### Startup and sharing the band

9. **Start timers first in `session.start`, and give every `command.register` / `tool.register` its own `try`/`catch`.** A command whose name matches one of the plugin's own skills is refused; an uncaught refusal ends the hook, and then no timer ever starts.
10. **One plugin hosts the band, and the others hand it rows.** Hook order between plugins is not yours to choose (`dependencies` orders you only against the plugins you list). So every band hook should:
    - draw `const theirs = await next(e)` under its own content, so nobody swallows anyone;
    - and, as a guest, return `next(e)` while a host is showing its rows.
11. **Nouns for other plugins:**
    - `engine.create` adds them as `{ ...built, noun: { … } }`;
    - methods take one plain-data argument;
    - callers can only `try { await $.noun.method() } catch {}`, because the validator refuses using a noun as a value and storing `$`.

### Client modules

12. **A client module draws on the surface's own clock.**
    - Start `surface.every` once per instance.
    - Call `setState` only when the frame changed.
    - Clicks go out with `surface.post`; a `ui.message` hook can answer `{ props }`, which reaches the instance without redrawing the band.
    - A client can't contain Raster or Image; it draws Text spans with `color` and `backgroundColor`.

### Testing

13. **Test with the kit.**
    - Drive time with `mock.clock` and `clock.advance(16)`, and client clocks with `ui.advance`.
    - Let inline plugins (`{ name, register }`) play guests. They can't see the test file's variables.
    - The test's `$` lacks nouns added in `engine.create`, so observe through a command (`$.command.run`) or a stand-in plugin.
