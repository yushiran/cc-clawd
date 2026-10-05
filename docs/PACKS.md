# Pet packs (format `cc-clawd/pack@1`)

A pack is a pet: its size, its pixel mode, and how it looks in each state. There are two kinds:
- **Data packs** are plain JSON and need no code. Anyone can write one, and they load from a file or from another plugin.
- **Code packs** are JavaScript modules shipped inside the plugin (`plugins/clawd/pets/`). They can draw anything. Clawd is one.

## Where packs come from

| From | How |
|---|---|
| Built in | `plugins/clawd/pets/*.js`, listed in `pets/index.js` |
| A file | `~/.config/clawd/pets/<anything>.json`, loaded when the session starts |
| Another plugin | `$.clawd.pack(def)` ([API.md](API.md#pack-a-pet-from-another-plugin)) |

Select one with `/clawd pet <id>` (saved to the `pet` setting) or in `/config` → clawd → pet. `/clawd pets` lists every pack, along with any that were refused and why.

## Canvas and pixel modes

A pack is `cols` × `rows` terminal cells (4–40 by 1–4; the band is usually 3 rows). Each cell holds pixels:

| `mode` | Pixels per cell | Canvas for 17×3 | Colours |
|---|---|---|---|
| `quad` (default) | 2 × 2 (quadrant blocks ▖▗▘▝▚▞▙▛▜▟) | 34 × 6 | **two per cell**, one foreground and one background |
| `half` | 1 × 2 (half blocks ▀▄) | 17 × 6 | every pixel its own colour |

Terminal cells are about twice as tall as they are wide, so `quad` pixels are tall rectangles and `half` pixels are square.

**The quad rule.** When one cell's pixels disagree in colour, the highest layer wins and the other pixels in that cell go blank. Art in one colour, with details cut out as holes (Clawd's eyes are holes), stays crisp. For many colours, use `half`. Real-pixel terminals (kitty, Ghostty) draw every pixel its own colour in either mode.

## The format

```jsonc
{
  "format": "cc-clawd/pack@1",       // required, exactly this
  "id": "blob",                      // 1–32 of a–z, 0–9, '-'; not a built-in's id
  "name": "Blob", "author": "you", "description": "…",
  "cols": 17, "rows": 3, "mode": "quad",
  "palette": { "#": "#7bd88f", "e": "#1e2a24" },      // one character → a colour ('#rgb' or '#rrggbb')
  "at": [1, 1],                      // where sprites are stamped (pixels); a frame can shift it
  "anchor": [17, 0],                 // where emotes appear (pixels): above or beside the head
  "look": [7, 2],                    // where the eyes are (pixels)
  "sprites": {                       // name → rows of characters; '.' or ' ' is transparent
    "rest":  ["....######....", "..##########..", ".###.####.###.", "##############", "##############"],
    "blink": ["....######....", "..##########..", ".############.", "##############", "##############"]
  },
  "states": {                        // state → a loop of frames, and effects
    "idle":  { "frames": [["rest", 2200], ["blink", 130]], "fx": [["coffee", 18, 0]] },
    "think": { "frames": [["rest", 240], ["blink", 110]], "fx": [["laptop", 18, 0]] }
  },
  "fallback": { "cheer": "think" }   // optional: override where a missing state goes
}
```

**Frames** are `[sprite, ms, dx?, dy?]`. The loop restarts after the last frame, and `dx`/`dy` shift that frame's sprite (a hop, a shiver).

**Effects** are `[name, x, y, options?]`, placed at pixel `(x, y)`, the top-left of the effect. They are drawn in a lower layer than sprites. Sizes are in quad pixels; in half mode the same effect is twice as wide in cells.

| Effect | Size | What it draws | Options |
|---|---|---|---|
| `desk` | 16×6 | `monitor` when the signal has bars, `coffee` otherwise | |
| `monitor` | 16×6 | Monitor with three bars (eased) and a scanline | (bars come from the signal) |
| `coffee` | 16×6 | Steaming mug | |
| `laptop` | 16×6 | Laptop typing what the tool does | (tool comes from activity or the signal) |
| `confetti` | 16×6 | Falling confetti | `n` pieces, `w`, `h` |
| `rain` | 16×6 | Cloud and rain | |
| `night` | 16×6 | Moon, stars, z's | `zx`, `zy`: cell the z's start from |
| `zzz` | 8×6 | Just the z's | `zx`, `zy` |
| `bell` | 16×6 | Ringing bell and a blinking `!` | `bx`, `by`: cell of the `!` |
| `ticket` | 16×6 | Ticket with a blinking `?` | |
| `orbit` | 16×6 | Stars circling an `x` | |
| `sweat` | 1×6 | Falling drop | |
| `notes` | 5×6 | Two notes floating up | |
| `heart`, `sparkle`, `bang`, `question` | small | The emote overlays, usable as props too | |

## States and fallbacks

There are twelve states: `idle`, `calm`, `happy`, `ecstatic`, `cheer`, `worried`, `sad`, `sleep`, `alert`, `needs`, `think`, `dizzy`. Only `idle` is required. A state the pack lacks falls back step by step until it reaches one the pack has:

```
ecstatic → happy → calm → idle      cheer → happy      worried → calm      sad → worried
needs → alert → idle                sleep → idle       think → idle        dizzy → worried
```

A minimal pack is one sprite and an `idle` state. A pet worth living with also has `think` (Claude working), `needs` (a permission prompt), `sleep`, and something for good and bad news (`cheer`, `sad`).

## What decides the state

The pet's brain ([`engine/brain.js`](../plugins/clawd/engine/brain.js)) picks the state; packs only draw it:
- a permission prompt → `needs`;
- Claude working → `think`;
- signals → their scene's state (`monitor` by mood, `confetti` → `cheer`, `rain` → `sad`…; see [API.md](API.md));
- nothing → `idle`, then `sleep` after 20 minutes of quiet, or 3 minutes after midnight.

## Preview and check

```sh
node tools/preview.mjs my-pet.json                    # every state, animated in this terminal (truecolor)
node tools/preview.mjs my-pet.json --state happy
node tools/preview.mjs my-pet.json --png sheet.png    # one row per state, eight frames 250 ms apart
node tools/preview.mjs --check my-pet.json            # the same checks the plugin runs, with every problem listed
```

[`examples/pets/my-slime.json`](../examples/pets/my-slime.json) is the built-in slime as a file: copy it, change the palette, redraw the sprites.

## Code packs (built-ins)

A code pack is a module in `plugins/clawd/pets/` that exports the same header fields plus `states` (the list it draws) and `render(C, t, state, info)`:

- `C` is a canvas from [`engine/pixel.js`](../plugins/clawd/engine/pixel.js): `px`, `rect`, `bg`, `glyph`, `stamp`, `cellX`/`cellY`, and `mem` for state that should survive between frames.
- `t` is milliseconds. **Draw as a pure function of `t`**: never count frames, so a dropped frame never makes the animation jump, and every renderer draws the same picture.
- `info` holds the signal's `bars` and `tool`, the current emote's motion `dx`/`dy` (apply it to the body), and `look` (`left`, `right`, `up`, `front`: where the pointer is; turn the eyes toward it).
- Effects from [`engine/fx.js`](../plugins/clawd/engine/fx.js) are plain functions: `FX.laptop(C, t, x, y, { tool })`.

Add it to `pets/index.js`. The engine tests (`claude plugin test plugins/clawd`) draw every built-in in every state.
