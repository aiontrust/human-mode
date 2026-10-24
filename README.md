# human-mode

A forward facing display program with minimal design and an overly intricate backend.

Human Mode is a walk-through installation about a machine that thinks about itself the way people do. The front is a kiosk with a calm pixelated figure. The back is an engine that replays, revises, and second-guesses every reaction, and its state fills the room: heat on the floor, first-person text on the walls. Over a 42-day exhibition the machine habituates to its own rewards and wears down. The last day is the flattest.

This repository holds the base program in two forms. The browser prototype runs the machine inside the page and the sensors are simulated: you play the visitor. The venue runner (`server/`) keeps one machine alive on a dedicated computer, saves it to an SSD so a reboot never resets the exhibition, and copies the archive to Neon. See [The venue machine](#the-venue-machine-ssd-and-neon).

## Run it

```
npm test            # engine, persistence, page smoke test, and the runner end to end
node build.js       # writes dist/human-mode.html
npm start           # the venue runner (see below)
```

Open `dist/human-mode.html` in a browser. Tap or drag on the floor to place a visitor, enter a code at the kiosk, and use Advance a day or Run to day 42 to watch the charge decline. The control room panel shows internal state and runs an archive audit. There are no dependencies.

## Layout

| Path | What it is |
| --- | --- |
| `src/engine.js` | The base program. No DOM, so it runs in a browser, Node, or behind real hardware. |
| `src/ui.html` | The renderers (kiosk figure, floor, walls) and the simulation controls. |
| `server/run.js` | The venue runner: the live loop, the day clock, a local sensor and display API. |
| `server/persist.js` | Atomic state saves, the append-only SSD archive, and the Neon sync. |
| `sql/schema.sql` | The one Neon table, `archive_entries`. |
| `build.js` | Inlines the engine into one self-contained page. |
| `test/` | Engine and persistence tests, a page smoke test against a fake DOM, and a runner test. |
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

## The venue machine: SSD and Neon

The exhibition runs on one dedicated computer at the venue. A venue network may block outbound connections, so the machine never depends on one. The SSD is the source of truth. Neon is an off-site copy of the archive.

### What lives where

| What | Where | Notes |
| --- | --- | --- |
| Machine state: day, charge, habituation, the wall lines, the floor heat, hashed codes, the salt | `data/state.json` on the SSD, plus `state.json.prev` | Saved every 60 seconds and on shutdown. Written to a temp file, fsynced, then renamed, with one earlier copy kept. **Never leaves the machine.** The hashed codes and the salt are runtime memory, not archive, and they are cleared when the salt rotates. |
| The archive: every line, every silent revision, every gesture, every recognition outcome, a summary per day | `data/archive.ndjson` on the SSD | Append-only, one JSON object per line with a running `seq`. Flushed and fsynced every 2 seconds. This is the record. |
| How far the Neon copy has got | `data/sync.json` on the SSD | A line number and a byte offset. A reboot resumes from here. |
| When the exhibition started and the run name | `data/meta.json` on the SSD | Written once. The day clock counts from `startMs`. |
| Off-site copy of the archive | Neon, table `archive_entries` | Archive lines only, keyed by `(run_id, seq)`, so a repeat is skipped and several venues can share the table. Created by `sql/schema.sql`. |

`data/` is in `.gitignore`. Do not commit it, because `state.json` holds the hashed codes and the salt.

### Rules the archive follows

The archive holds the machine's own state and nothing derived from visitors: no codes, no hashes, no paths, no sensor data. Three checks enforce it. The engine writes only allow-listed fields. The sync runs `auditEntry` on every line and stops, sending nothing, if one holds anything else. The Neon table has a `CHECK` on `kind`. The tests cover all three.

### Failure behavior

| What happens | Result |
| --- | --- |
| Power cut or reboot | The runner restores `state.json` on start. The day, the charge, and every code entered before the cut still match. At most the last 60 seconds of state and 2 seconds of archive are lost. |
| Power cut during a write | A half-written state file falls back to `state.json.prev`. A half-written last archive line is cut off on start. |
| Network down or blocked | The archive keeps writing to the SSD. The sync retries with growing waits, up to 15 minutes, and resumes from its cursor when the network returns. Nothing is sent twice. |
| Machine off for days | On start the day clock catches up and the machine advances through the days it missed. |
| SSD failure | The record is lost back to the last sync. Copy `data/archive.ndjson` to an encrypted drive on a schedule, for example weekly. |

Use an endurance-rated SSD, because it is written to every minute for weeks, and put the machine on a small UPS so a power cut does not interrupt a write.

### Run it on the venue machine

```
node build.js
DATA_DIR=/mnt/ssd/human-mode \
DATABASE_URL='postgresql://...' \
RUN_ID=venue-name-2026 \
npm start
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Put this on the SSD. |
| `DATABASE_URL` | none | The Neon connection string, from the Neon console. Without it the archive stays on the SSD only. Keep it in the environment, never in the repo. |
| `RUN_ID` | `run-<start date>` | Names this run in Neon. Set it per venue. |
| `DAY_MS` | `86400000` | Length of one exhibition day. Shorten it to demo the 42-day arc, for example `60000` for a day a minute. |
| `SALT_DAYS` | `14` | Forget every code every N days. `0` means never. |
| `PORT`, `HOST` | `8080`, `127.0.0.1` | The API has no login. Keep it on localhost or a private network. |

To start on boot, run `npm start` from a service manager such as systemd, with `Restart=always`.

The Neon project is named `human-mode`. To set up a new database, run `sql/schema.sql` once.

### Local API

| Route | Use |
| --- | --- |
| `POST /api/sense` `{x, y}` | The sensor bridge posts a position from 0 to 1 on each axis. A visitor unseen for 5 seconds is treated as gone. |
| `POST /api/leave` | A visitor left. |
| `POST /api/event` `{kind}` | `phone` or `cough`. |
| `POST /api/code` `{code}` | A viewer's own code. It is hashed in the engine and never logged. Returns only `new` or `match`. |
| `GET /api/state` | Day, charge, mood, the current wall lines, and the floor heat (base64, 40 by 26 bytes). |
| `GET /api/health` | The day, and whether the sync is on. |
| `GET /` | The built page. It runs its own machine, so it does not yet read from the runner. |

The displays reading from the runner, so that the kiosk, floor, and walls all show the venue machine, is the next step.

## Open decisions

- The ending: the room switches off mid-thought on the last day, or gives a brief unexplained surge in the final hour.
- How often the machine forgets every code (the prototype defaults to 14 days).
- How much charge quiet stretches return, and whether that shrinks as the run goes on.
- Whether the kiosk should warn viewers off typing anything personal as a code.
