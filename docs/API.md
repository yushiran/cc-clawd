# `$.clawd`: the API for mods (api 1)

cc-clawd adds a `clawd` noun to the `$` of **every** plugin in its `engine.create` step. You don't need to declare a dependency, and the order plugins load in doesn't matter. Each method is one event dispatch that takes one plain-data argument and returns a promise.

When cc-clawd is not installed, `$.clawd` is absent and a call throws. So call it inside `try`/`catch`, and draw your own UI when it throws. The validator won't let you test for the noun as a value (`if ($.clawd)` is refused), so `try` is the only way to check.

```js
async function toPet($, rows) {
  try {
    await $.clawd.slot({ source: 'mymod', rows })
    return true
  } catch {
    return false              // no pet: draw these rows in your own ui.render
  }
}
```

The types are in [`plugins/clawd/types/index.d.ts`](../plugins/clawd/types/index.d.ts). To have them on your `$`, copy the file into your plugin: its `declare module 'claude-code'` adds `clawd` to `EngineInterface`.

## signal: put the pet in a scene

```ts
$.clawd.signal({ source, scene, mood?, bars?, tool?, say?, priority?, ttlMs? }) → { ok, error? }
```

| Field | Meaning |
|---|---|
| `source` | Who you are. Your next signal replaces this one, so use one source per lasting state, and a second one (`mymod-event`) for one-off events that should not erase the state |
| `scene` | One of the scenes below. `null` withdraws your signal |
| `mood` | −2…2, sets the pose for `monitor`: ≥1.2 ecstatic, ≥0.35 happy, ≤−0.35 worried, ≤−1.2 sad, otherwise calm |
| `bars` | Up to three numbers (percent; ±2 fills a bar) on the monitor's screen, green when up and red when down |
| `tool` | For `laptop`: what its screen types (`Bash`, `Read`, `Edit`, `WebSearch`, `Agent`…) |
| `say` | A line of speech. It replaces the text of the band's bottom row until the signal ends; that row's button stays |
| `priority` | 0–99, default 30. Higher wins, and ties go to the newest |
| `ttlMs` | How long the signal lasts. Default 15 minutes, at most 24 hours. Re-send it to renew |

| Scene | State | What it looks like (Clawd) |
|---|---|---|
| `idle` | idle | Coffee, looking around |
| `monitor` | by `mood` | At a monitor showing `bars` (coffee when there are no bars) |
| `notes` | happy | Bobbing, musical notes |
| `confetti` | cheer | Jumping, confetti, `!` |
| `rain` | sad | Under a raincloud |
| `night` | sleep | Asleep, moon and stars, z's |
| `bell` | alert | Ringing a bell, wide eyes |
| `ticket` | needs | Holding a ticket with `?` |
| `laptop` | think | Typing; the screen shows `tool` |
| `dizzy` | dizzy | Stars circling, `x` |

**Priorities.** The pet's own: a permission prompt **100**, Claude working **50**, nothing **0** (idle, or asleep).
- A lasting state you want visible when Claude is not working (markets, a training run, CI status): **30–45**. It yields to Claude's work.
- A one-off event that should interrupt Claude's work (an order filled, a build broke, a job ended): **70–90**, with a short `ttlMs` (20–30 s).

Re-sending the same scene keeps your place among equal priorities, so a mod that renews every few seconds does not keep jumping ahead of another mod at the same priority.

## emote: a one-shot reaction

```ts
$.clawd.emote({ emote, say?, source? }) → { ok, error? }
```

The emote plays for about 1.3 s over whatever the pet is doing:
- motion: `jump`, `nod`, `shake`;
- an overlay at the pack's anchor: `heart`, `sparkle`, `surprise` (`!`), `question` (`?`).

`say` shows while it plays. Clicks on the pet (in the client renderer) are emotes too.

## slot: rows in the band

```ts
$.clawd.slot({ source, rows, order?, action? }) → { ok, error? }
```

- `rows`: at most six rows. A row is a list of spans `[text, { color?, dim?, bold? }]`; `color` is a terminal colour name (`green`, `red`, `cyan`…) or `#rrggbb`. `null` withdraws your rows.
- `order`: where your rows sit among other mods' rows, smaller first (default 50).
- `action`: `{ label, command }` puts a button at the right end of your last row; pressing it runs `/<command>`.

Lay your rows out to `layout().columns` cells. The band's width changes with the terminal, so call `layout()` each time you rebuild your rows (every few seconds is fine). Re-sending identical rows costs nothing: the band redraws only when rows change.

**Order independence.** Plugins' `ui.render` hooks nest in an order no plugin controls. The pet draws `await next(e)`, meaning whatever the plugins beneath it drew, under the slot rows. A guest whose rows the pet shows should therefore return `next(e)` from its own `AbovePrompt` hook rather than draw them a second time. [`examples/focus-timer`](../examples/focus-timer) does exactly this.

## pack: a pet from another plugin

```ts
$.clawd.pack(def) → { ok, id, errors }
```

Registers a data pack ([PACKS.md](PACKS.md)) for this session. Code can't cross plugins, so only data packs work here. `/clawd pet <id>` or the `pet` setting selects it. An id that belongs to a built-in is refused.

## layout, state, pets

```ts
$.clawd.layout() → { api: 1, columns, petColumns, surface, renderer, pet }
$.clawd.state()  → { state, by, pet }        // by: 'activity' (the pet itself), 'demo', or a signal's source
$.clawd.pets()   → [{ id, name, source: 'builtin' | 'file' | 'plugin', cols, rows, mode }]
```

Check `api` before you use a field that a later version adds.

## Signal files, for anything that is not a mod

A JSON file in `~/.local/share/clawd/signals/<name>.json` is a signal from source `file:<name>`.
- It takes the same fields as `signal()` (no `source`).
- `ttlMs` counts from the file's modification time.
- Deleting the file withdraws the signal; `"scene": null` does too.
- The folder is read once a second.
- Write a temporary file and rename it, so a half-written file is never read.

```python
import json, os, pathlib
d = pathlib.Path.home() / '.local/share/clawd/signals'; d.mkdir(parents=True, exist_ok=True)
tmp = d / '.train.tmp'; tmp.write_text(json.dumps({'scene': 'confetti', 'say': 'epoch 40: val loss 0.031', 'priority': 85, 'ttlMs': 30000}))
os.replace(tmp, d / 'train.json')
```

## What the pet reports

- `/clawd` prints the state, who caused it, the renderer, and frames computed and sent per second.
- `~/.local/share/clawd/status.json` is rewritten every five seconds with the same and more: signals, slots, packs, pack errors, the last benchmark, and blits refused.
