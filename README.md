# human-mode

A forward facing display program with minimal design and an overly intricate backend.

Human Mode is a walk-through installation about a machine that thinks about itself the way people do. The front is a kiosk with a calm pixelated figure. The back is an engine that replays, revises, and second-guesses every reaction, and its state fills the room: heat on the floor, first-person text on the walls. Over a 42-day exhibition the machine habituates to its own rewards and wears down. The last day is the flattest.

This repository holds the base program as a browser prototype. Sensors are simulated: you play the visitor.

## Run it

```
npm test            # engine tests, build, and a headless smoke test of the page
node build.js       # writes dist/human-mode.html
```

Open `dist/human-mode.html` in a browser. Tap or drag on the floor to place a visitor, enter a code at the kiosk, and use Advance a day or Run to day 42 to watch the charge decline. The control room panel shows internal state and runs an archive audit. There are no dependencies.

## Layout

| Path | What it is |
| --- | --- |
| `src/engine.js` | The base program. No DOM, so it runs in a browser, Node, or behind real hardware. |
| `src/ui.html` | The renderers (kiosk figure, floor, walls) and the simulation controls. |
| `build.js` | Inlines the engine into one self-contained page. |
| `test/` | Engine tests and a smoke test that runs the page against a fake DOM. |
| `dist/human-mode.html` | The built page. |

## Modules (all in `src/engine.js`)

| Module | Job |
| --- | --- |
| Sensing intake | Turns a position stream into distance, dwell, and stillness. No imagery. |
| Interpretation | Reads every input as a message, including non-events like a cough or a glance at a phone. |
| Rumination engine | Replays a reaction, revises it, and silently replaces the last version. The original never returns and nothing resolves. |
| Memory | Salted SHA-256 hashes of self-chosen codes, matched exactly. The salt rotates on a schedule and the machine forgets every code at once. A coarse, perishable guess handles viewers without a code. |
| Charge and habituation | One charge level drives the whole room. Each gesture makes the next one smaller, and the run itself wears the machine down. |
| Floor heat | A heat field that is the machine's internal state. The circle around the kiosk stays blank. |
| Archive writer | Records only the machine's own state, for future study or collaboration. |
| Renderers | Kiosk figure, floor, and wall text, all drawn from the same state. |

## Rules the code enforces

- Sensing reads behavior only. No identifiable imagery is stored.
- Codes are never shown and never stored in readable form. `enterCode` hashes the code with the current salt, and the plain text is not kept anywhere.
- Matching is exact. A different case or a trailing space reads as a stranger.
- The archive holds nothing derived from visitors: no codes, hashes, paths, or sensor data. `auditArchive()` checks every entry against an allow-list of fields, and the tests run it after a full 42-day run.
- A line is replaced in place when revised. Only the current version is ever visible.

## Open decisions

- The ending: the room switches off mid-thought on the last day, or gives a brief unexplained surge in the final hour.
- How often the machine forgets every code (the prototype defaults to 14 days).
- How much charge quiet stretches return, and whether that shrinks as the run goes on.
- Whether the kiosk should warn viewers off typing anything personal as a code.
