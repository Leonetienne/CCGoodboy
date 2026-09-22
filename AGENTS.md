# CC Good Boy — behavior spec, architecture, and how to work on this bot

This file is the specification, the architecture map, and the extension
guide for the Tampermonkey userscript built from `src/`. It replaces the
giant header comment that used to live at the top of the single-file
original (still kept, frozen, at `legacy/cc-bot.original.js`, section 6
"ARCHITECTURE" of which is superseded by this document).

Whenever behavior changes: update the matching requirement ID below, bump
`VERSION` in `src/core/constants.ts` **and** `version` in `package.json`
(keep them identical — see NFR-1), and add a changelog entry.

The refactor from the single 11k-line monolith to this module tree was
done to be **behavior-identical**: every requirement below held for the
original file and holds for this one. If you find a divergence, it's a bug
in the refactor, not an intentional behavior change.

---

## 1. Purpose and scope

A userscript for Cookie Clicker (`https://orteil.dashnet.org/cookieclicker/`)
that plays the "golden cookie game" like a very polite, slightly playful
human: it catches good golden cookies, hammers the big cookie during Click
Frenzy, keeps a Grimoire "Force the Hand of Fate" (FTHOF) combo going, and
shows all of that through a little paw cursor, a HUD, charts and logs. It
also ships "debug tools" (cheats) to test the hunter on a test save.

Out of scope: wrinklers, seasons, garden, stock market, pantheon, ascending.
Buying is only done by the optional, OFF-by-default "Auto play" mode
(AUTO-\*) and even then only through the game's own buy functions. The bot
NEVER clicks anything except: good golden cookies, the big cookie, the
FTHOF spell button, and the lump-refill button (the paw only "visits"
store items, AUTO-9).

## 2. Terms

| Term | Meaning |
|---|---|
| good cookie | a golden shimmer that is not wrath. |
| wrath cookie | a golden shimmer with `wrath > 0` (never clicked). |
| ready | a good cookie that passed the fade-in threshold (queueable). |
| pending | a good cookie that is still fading in (highlighted only). |
| fade curve | `1 - (2*life/(fps*dur) - 1)^4` : 0 at spawn, 1 at mid-life, 0 again at despawn (mirrors the game's own opacity formula). |
| paw | the virtual cursor drawn on an overlay canvas. |
| click point | where the paw clicks: the tip of its middle claw. |
| CpS buff | an active buff with `multCpS > 1` (Frenzy, Building special...). |
| FTHOF | the Grimoire spell "Force the Hand of Fate". |
| refill | spending a sugar lump to refill mana (15 min game cooldown). |
| LOCK_A | the bot's own lock that prevents a second lump refill until the CpS buff situation changes (see FT-6). |
| hurry mode | reduced delays/thresholds and faster paw during a cookie storm or cookie chain (HURRY-1). |
| hammer mode | button that clicks the big cookie non-stop (CF-4). |
| task | one unit of work run by the scheduler; only one at a time. |
| auto play | the optional shopping mode (AUTO-\*). |
| payback | cost / approximate CpS gain of a purchase, in seconds ("rentability"; lower is better). |
| impact | CpS gain / current CpS (how much it changes production, regardless of its cost). |
| in reach | affordable within a set time at the current income. |

## 3. Functional requirements

Each requirement has an ID. "Acceptance" says how to check it; "Debug"
points at the Debug tools button that makes the check easy, and (since the
refactor) which `tests/visual/scenarios.mjs` scenario exercises it.

### 3.1 Golden cookies

- **GC-1** Only good golden cookies are clicked. Wrath cookies are never
  clicked; each wrath cookie is logged once (`"ignore wrath cookie"`).
- **GC-2** EVERY golden cookie (good, fading in, wrath) gets a hitbox
  overlay the moment it exists: ready = pink numbered box, pending =
  dashed lavender box with the fade percentage, wrath = dashed red box.
  Pending and wrath boxes are at least 34px so a still-tiny cookie is
  visible.
- **GC-3** A good cookie is queued/clicked only when its fade curve is >=
  the threshold (setting "Wait till cookie is visible", default 0.55), or
  when it is past its peak (progress >= 0.5), so it never becomes
  un-clickable again while fading out.
- **GC-4** Timing of one catch: (a) wait until
  `max(previous click, moment the cookie became ready) + click delay`
  ("Patience before moving", default 200ms), (b) move the paw (arced,
  human-like, see PAW-4), (c) wait the pre-click pause ("Shy pause before
  click", 100ms), (d) re-acquire the cookie center (cookies pulse), settle,
  click. Acceptance: with delay 1500 the click comes >= ~1600ms after the
  cookie became ready. Debug: "Spawn random Golden Cookie" / visual
  scenario "Golden cookie: basic hunt".
- **GC-5** Order of collection = the route with the LEAST TOTAL TRAVEL
  through all ready cookies, starting at the paw (open path, no return).
  Exact for <= 11 cookies (`exactRoute`, Held-Karp DP), otherwise best of
  several 2-opt/Or-opt improved tours (`heuristicRoute`). Deterministic,
  cached, re-planned when the cookie set changes or the paw moved > 80px.
  Not deadline-aware (by decision).
- **GC-6** Every catch is recorded (stats per effect name + hourly
  buckets) and logged (`"click golden cookie"`).
- **GC-7** Golden cookies have ABSOLUTE priority (see SCHED-1).

### 3.2 Hurry mode

- **HURRY-1** While a cookie chain is running
  (`Game.shimmerTypes.golden.chain > 0`) or a cookie storm is active (buff
  name contains "cookie storm", or a storm drop exists) the "hurry factor"
  (default 0.2, range 0.01-1) is applied: click delay, pre-click pause and
  fade threshold ×factor; paw travel speed ÷factor.
- **HURRY-2** The Mood line shows `"[storm/chain: hurry xF]"` while active.
- **HURRY-3** The happy dance never plays during a chain (DANCE-3).
  Acceptance (Debug/visual scenario: "Spawn Cookie Chain" / "Spawn Cookie
  Storm"): catch time drops from ~delay+pause+travel to ~0.2× of that.

### 3.3 Click Frenzy and hammer mode

- **CF-1** During a real Click Frenzy the big cookie is clicked at "Click
  Frenzy clicks/sec" (default 8) with ±"Wiggle" ms jitter (default 30,
  capped at 60% of the interval). Acceptance: 8 clicks/s with gaps inside
  125ms ±30.
- **CF-2** These clicks are exempt from the click delay and pre-click
  pause.
- **CF-3** Rate must not depend on scheduler ticks: one loop runs on a
  fixed timeline (next click due one interval after the previous one was
  DUE, resynced only when > 60ms late; never closer than base-jitter).
- **CF-4** "Hammer cookie" button = the same clicking outside a real
  frenzy. Priority: below FTHOF/refill, above dance/idle. Session-only (off
  after reload). Only the toggle is logged, not each click.
- **CF-5** Each click lands a small random step (0..max "Click step max
  px", default 3) from the previous one, inside the cookie; 0 = stay put.
- **CF-6** `estimateClickFrenzySec()`: rough Click Frenzy length in seconds
  (13s × Get lucky ×2 × Lasting fortune ×1.1 × Epoch Manipulator). Exposed
  on the game adapter; used by FT-2.

### 3.4 FTHOF and lump refill

- **FT-1** Cast FTHOF when: >= 1 CpS buff, mana >= cost, at least one CpS
  buff would still run when a Click Frenzy started now would end (FT-2), no
  Click Frenzy active, no ready golden cookie.
- **FT-2** "Outlast" rule: some CpS buff has remaining time >=
  `estimateClickFrenzySec()`.
- **FT-3** Refill (sugar lump) when: >= 2 CpS buffs, FT-2 holds, mana <
  FTHOF cost, LOCK_A open, refill not on cooldown, >= 1 lump. After a
  refill LOCK_A is set.
- **FT-4** Both abort at once if a golden cookie becomes ready or a Click
  Frenzy starts, and re-check their conditions right before clicking.
- **FT-5** Both respect the click delay (before moving) and pre-click
  pause.
- **FT-6** LOCK_A opens again when the CpS buff count returns to 0, or
  when it rises to >= 3 (and above its previous value).
- **FT-7** If the real Grimoire buttons are not visible, the HUD "dock"
  chips (FTHOF / REFILL) serve as click targets for the paw's movement.

### 3.5 Scheduling and priority

- **SCHED-1** Priority, highest first:
  1. good golden cookies (queue)
  2. real Click Frenzy clicking
  3. FTHOF cast, then lump refill
  4. auto play shopping (only when a purchase is due, AUTO-8)
  5. hammer mode (manual button, or the auto hammer, AUTO-11)
  6. happy dance (only right after a catch, DANCE-1)
  7. idle behavior (IDLE-\*)
- **SCHED-2** One task at a time; the scheduler ticks every 25ms; long
  tasks poll "abort" predicates so higher priorities interrupt them within
  about one frame.
- **SCHED-3** After real work the paw ponders where it stopped (IDLE-3).
- **SCHED-4** A task that throws is logged (`"error"`) and never stops the
  bot.

See [§7 State machine](#7-state-machine) for how this maps onto code.

### 3.6 Idle behavior and happy dance

- **IDLE-1** When nothing needs doing the paw never sits still: it draws
  very slow figure-eights (11-24px, one eight per 9-16s) with hand jitter.
- **IDLE-2** Every 14-34s it picks a new spot: look-only visit of
  something on screen (big cookie, building, upgrade, news ticker, cookie
  counter), a random drift, or (about 22%) 1-3 "bored" clicks on the big
  cookie. It never clicks anything but the big cookie.
- **IDLE-3** Right after real work it first ponders in place for 5-12s.
- **IDLE-4** Idle motion is cosmetic: it does not send fake mouse-moves to
  the game (MOUSE-2). It yields to any real work within a frame.
- **IDLE-5** Setting "Idle playtime" switches all of this off; "Paw idle
  speed" (default 320px/s) sets the travel speed.
- **DANCE-1** After catching a golden cookie the paw does a small happy
  dance (hops + sway + tilt, default 2200ms, 0 = off) ONLY IF that very
  moment is idle: no other golden/wrath cookie present, nothing for
  FTHOF/refill/Click Frenzy/hammer to do.
- **DANCE-2** It is decided at the moment of the catch and never queued for
  later.
- **DANCE-3** Never during a cookie chain; stops within a frame when a
  cookie appears or real work becomes pending.
- **DANCE-4** Ends exactly where it started, then the paw ponders (IDLE-3).

### 3.7 The paw (virtual cursor)

- **PAW-1** Drawn on a full-screen overlay canvas above the game;
  pointer-events none, so the real mouse is never blocked.
- **PAW-2** Two embedded, mirrored (left-facing) SVG sprites: open paw, and
  a closed fist that replaces it for the whole click pulse. If a sprite
  cannot load, a small drawn paw is used. Click point = middle claw tip.
- **PAW-3** Look: pink halo + dark drop shadow for contrast on any
  background. Lean: tilts into horizontal movement (up to ~0.22rad,
  smoothed). Click pulse: scale to 0.92 and back within ~80ms (25 down, 55
  up), pivot at the click point.
- **PAW-4** Movement is never a straight line at constant speed: 2-6
  arcing segments (Catmull-Rom through bowed waypoints), bell-shaped speed
  with wobble and small slow-downs at bends, duration ×0.85-1.2 random,
  hand tremor (<= 1.3px) that fades out on arrival; final position is
  exact. Duration clamp 22..420ms (default).
- **PAW-5** Visual overlays can be switched off ("Pretty overlays").

### 3.8 Real-mouse compatibility

- **MOUSE-1** Before the game handles the USER's mousedown/mouseup/click,
  the bot re-sends a mousemove at the real coordinates so the game's own
  `Game.mouseX/Y` (used for the floating "+N" numbers) are correct.
- **MOUSE-2** Cosmetic paw movement does not dispatch mousemove to the
  game. Bot clicks still put the number where the paw is (`humanClick`
  sends a mousemove at the click point right before pressing).

### 3.9 User interface

- **UI-1** Draggable, minimizable panel (drag by the title bar; position
  saved and kept on screen). Title shows the script version.
- **UI-2** Rows: Mood, Chasing, Shinies waiting (ready / fading in /
  wrath), Click Frenzy, Buffies, Grimoire, LOCK_A, Click cooldown, Auto
  play, statistics.
- **UI-3** Buttons: Pause/Resume, Hammer cookie, Auto play, Graphs, Logs,
  Debug tools, Settings.
- **UI-4** Settings are STAGED: editing only marks "unsaved"; "Save
  settings" (or Enter) validates, clamps, applies and stores them at once.
- **UI-5** Graphs: hourly golden-cookie clicks by effect and Grimoire
  actions.
- **UI-6** Logs: searchable table (newest first, up to 2000 rows shown)
  with Export JSON / Export CSV (respects the filter; not capped).
- **UI-7** Theme: pastel pink/lavender/baby-blue on dark plum, rounded
  font, ASCII emoticons only (no emoji), no external assets.
- **UI-8** Debug tools sub panel (DBG-\*).

### 3.10 Debug tools (cheats, for testing; use a test save)

- **DBG-1** Spawn: random golden, wrath, Frenzy, Click Frenzy, Building
  Frenzy, Cookie Chain, Cookie Storm, Lucky, Cookie Storm Drop, Sweet
  (lump), Elder Frenzy (wrath), via `new Game.shimmer('golden', ...)` +
  `.force`.
- **DBG-2** Grant 1 quadrillion cookies (`Game.Earn`, so it counts as
  earned).
- **DBG-3** Fill Up Mana (mana = max).
- **DBG-4** Reset FTHOF cooldown = mana raised to exactly the FTHOF cost
  (the game has no real FTHOF cooldown, only the mana cost).
- **DBG-5** Reset Filling Up Mana cooldown = reset the game's 15-minute
  lump-refill timer (falls back to overriding `Game.canRefillLump` until
  reload).
- **DBG-6** Clear LOCK_A (the bot's own refill lock).
- **DBG-7** Give 10 sugar lumps.
- **DBG-8** Each use shows a status line (errors in red) and is logged
  (`"debug tool"`).
- **DBG-9** "Auto play: explain store (log)": lists every store upgrade
  with how the auto player classifies it (type, cost, CpS gain, payback)
  or why it is ignored, in the log (`"auto explain"`), the console and a
  summary line.
### 3.11 Persistence and API

- **DATA-1** State is stored in
  `localStorage["ccSmartGoldenComboBot.v2"]` as JSON
  `{config, stats, hourly, logs, ui}`; saved debounced (500ms), on "Save
  settings", and on page unload.
- **DATA-2** Pruning: hourly buckets older than "History retention days"
  and logs beyond "Log entries to keep" are dropped.
- **DATA-3** Stored config is merged over the defaults, so new settings
  appear with their defaults after an update.
- **API-1** `window.__CCSmartGoldenComboBot = { version, pause(),
  resume(), state (runtime), clickFrenzySec(), data, save(), destroy() }`.

### 3.12 Auto play mode ("full auto play": shopping)

- **AUTO-1** OFF by default. The "Auto play" button switches it on/off;
  the choice is stored with the settings (`config.autoPlay`). The button
  reads "Auto play ON ^w^" while on.
- **AUTO-2** Scope. It may buy ONLY: buildings; building upgrades that
  make a building "twice as efficient"; grandma "cofactor" upgrades
  (grandmas twice as efficient + 1% CpS of a building per N grandmas, also
  recognised by their description); KITTEN upgrades; ALL cookie (biscuit)
  upgrades; golden cookie upgrades (Lucky day, Serendipity, Get lucky,
  Lasting fortune, Lucky digit, Lucky number, Lucky payout, Green yeast
  digestives) — but never more than 57 Wizard towers
  (`AUTO_BUILDING_CAPS`); cursor and CLICKING upgrades: the "mouse and
  cursors twice as efficient" upgrades, the Thousand/Million/Billion/...
  fingers series and the mouse upgrades ("Clicking gains +1% of your
  CpS"). It NEVER buys the grandma research center ("Bingo
  center/Research facility") or anything that starts/feeds the
  Grandmapocalypse, and nothing it cannot classify.
- **AUTO-3** Value model per option: cost; approximate CpS gain `dCps`
  (buildings: per-building CpS × global multiplier; "twice as efficient":
  that building's CpS; biscuit: its power % of CpS; golden upgrades: an
  assumed share of CpS; CLICKING upgrades are valued in cookies/s at the
  hammer rate: click power × clicks per second, so the cursor doubling
  upgrades are worth their click gain even with 0 cursors); payback = cost
  / `dCps` ("rentability"); impact = `dCps` / CpS; wait = time to afford it
  at the income (CpS without buffs + smoothed clicking income) after the
  reserve.
- **AUTO-4** Strategy: (A) insignificant cost (<= 1s of income, or <=
  0.1% of the bank) -> buy at once. (B) good deal (payback incl. waiting
  <= 1.2× the best in reach) -> buy, UNLESS an option that is not
  affordable yet, in reach and good has >= 3× the impact and this one
  costs more than 10% of it: then save up. Otherwise nothing is bought and
  the target is shown.
- **AUTO-5** "In reach" = affordable within 1800s at the income and
  payback <= 24h (both are settings).
- **AUTO-6** Optional bank reserve: keep N seconds of CpS in the bank
  (default 0), e.g. for Lucky/chain payouts.
- **AUTO-7** Safety: never while ascending, a prompt is open, the store is
  in sell mode (buildings), during Click Frenzy, cookie storm/chain, while
  a golden cookie is ready or FTHOF/refill is pending, or when paused. One
  purchase per task, >= 400ms between purchases; a failed purchase / an
  error pauses it (3s / 30s). "Auto play dry run" only logs what it WOULD
  buy.
- **AUTO-8** Priority: below golden cookies, Click Frenzy and
  FTHOF/refill, above hammer mode, dance and idle; a due purchase
  interrupts hammering and idle play at once.
- **AUTO-9** Presentation: the paw visits the store item if it is visible
  and does the click pulse (visual only: NO click is sent to the store);
  the purchase itself uses the game's buy functions, so store modes (sell,
  bulk) can never cause a mistake. HUD row "Auto play" shows the plan
  ("saving for X (+N% CpS, ~3m 20s)").
- **AUTO-10** Every purchase is logged (`"auto buy"` with cost, `dCps`,
  payback, impact, reason) and counted (`stats.autoBuys`, shown in the
  HUD).
- **AUTO-11** Auto hammer: in auto play the big cookie is hammered (like
  CF-4) whenever clicking is much better than idling: clicks would add >=
  5% of the CpS (setting). At the start (no CpS) that is always true, so
  it begins clicking by itself. When not worth it, it still PROBES: every
  5 minutes (setting) it hammers for 10s, measures the real clicking
  income and re-calibrates the estimate. Can be switched off ("Auto:
  manage hammering").
- **AUTO-12** Opt-in UI: the auto play settings, the "Auto play" HUD row
  and the auto purchase counter are hidden until auto play is switched on.

### 3.13 Background operation (browser tab not in front)

- **BG-1** The bot's own timing (`sleep()`, the 25ms scheduler) runs on a
  Web Worker clock. Browsers throttle the timers of a background PAGE, not
  those of a worker. A self-test at start decides; without a working
  worker (no Worker support, blocked blob workers) it falls back to the
  normal timers.
- **BG-2** Paw animation (movement, pondering, dancing) races
  `requestAnimationFrame` against a ~34ms worker timer, so the paw keeps
  moving while the browser sends no animation frames (hidden tab).
- **BG-3** Optional keep-alive ("Background keep-alive", on by default): a
  practically silent AudioContext. Firefox does not throttle tabs that
  contain an AudioContext, which also keeps the GAME's own loop at full
  speed. Browsers start audio only after a real click on the page, so it
  waits for the first click. (A speaker icon may show on the tab.)
- **BG-4** HUD row "Background" shows the timer source and the keep-alive
  state.

### 3.14 "How good is a buy" overlay (independent of auto play)

- **BUY-1** ON by default ("Show \"how good is a buy\" overlay"). Draws a
  bounding box directly over every building and upgrade the auto player
  can classify (AUTO-2/AUTO-3), whether or not auto play itself is
  switched on; it never buys anything on its own.
- **BUY-2** A score from 0 (worst payback on offer) to 100 (best) is
  drawn CENTERED INSIDE each box, so it never overlaps a neighbor's number
  the way a label floating above the box could. Box + score color is
  RELATIVE to the other options on offer right now, ranked on a LOG scale
  of payback (cost / estimated CpS gain: paybacks span seconds to days, so
  a linear scale would let one very bad option make every other one look
  equally green): red on the worst payback currently on offer, green on
  the best, amber in between, so it re-ranks as the store changes. Uses
  the same scoring as `autoDecide()` (AUTO-3/AUTO-4), refreshed at most
  twice a second.
- **BUY-3** A box is only drawn for an element that is genuinely on
  screen: hidden (`display:none`/`visibility:hidden`/`opacity 0`) or
  clipped away by a collapsed ancestor (e.g. the upgrade store folded into
  a strip, which can leave stale on-screen coordinates behind) is rejected
  the same way as an off-screen element (shared with every other overlay
  box: golden cookies, the Grimoire buttons, ...).

## 4. Non-functional requirements

- **NFR-1** Versioning: MAJOR.MINOR.PATCH, shown in the panel. Bump with
  EVERY change (fix = patch, feature = minor), no exceptions: this
  includes a follow-up correction to work made earlier in the same
  session and even work that hasn't been committed yet — bump again
  rather than editing an already-written VERSION/changelog entry in
  place. Keep `package.json`'s `version` and `src/core/constants.ts`'s
  `VERSION` identical, and add a changelog entry (§12) for every bump, not
  just the ones that ship.
- **NFR-2** No dependencies at runtime, no network, no external assets.
  Runs in page context (`@grant none`) at `document-idle`; a second
  instance refuses to start.
- **NFR-3** Performance: route planning <= ~2ms for 40 cookies and
  cached; the overlay costs only a few canvas calls per frame; timers:
  scheduler 25ms, panel refresh 200ms, charts 2s.
- **NFR-4** Robustness: every game-internal access is guarded
  (typeof/try, or funneled through `GameAdapter`, which is the one place
  allowed to touch `window.Game` directly); a failing task is logged and
  the bot continues.
- **NFR-5** Text style: cute (uwu), ASCII emoticons only (":3", "^w^",
  "owo").
- **NFR-6** Determinism: route planning and restarts are deterministic so
  the plan does not flip-flop.
- **NFR-7** *(added in the refactor)* Testability: stateful subsystems are
  classes with constructor-injected dependencies so they can be
  unit-tested against a `FakeGameAdapter`; pure algorithms (route
  planning, `autoDecide`, the chart engine) are plain functions with no
  DOM/game dependency at all. See §6 and §8.
- **NFR-8** Visual honesty of every game interaction: any action that
  changes game state — a real click, or a call through `GameAdapter` into
  a game API (`buy()`, `Game.Earn`, `Game.gainLumps`, a minigame/panel
  toggle, etc.) — must be represented on screen as the paw (PAW-\*) moving
  to the relevant UI element and playing a CLICK_PULSE (PAW-3) the moment
  the action fires. This generalizes AUTO-9 (which already required the
  visit + pulse for auto-shop purchases) to every interaction, not just
  store buys. Concretely: either (a) dispatch a real synthetic mouse click
  on the element (as FT-\* already does), or (b) invoke the game API
  directly but still move the paw there first and fire the click-pulse
  animation so the action is never invisible. No new game-state-changing
  action may be added without one of these two.

## 5. Configuration reference

`data.config`; UI label -> key. All numeric settings are clamped when
saved (see `normalizeSetting()` in
`src/ui/settings/normalize-setting.ts`).

| key | UI label | default | range |
|---|---|---|---|
| `goldenMinIntervalMs` | Patience before moving (ms) | 200 | 0-5000 |
| `preClickDelayMs` | Shy pause before click (ms) | 100 | 0-2000 |
| `goldenMinFadeCurve` | Wait till cookie is visible (0-1) | 0.55 | 0-1 |
| `panicFactor` | Storm/chain hurry factor (0.01-1) | 0.2 | 0.01-1 |
| `cursorSpeedPxPerSec` | Paw zoomies px/s | 4200 | 500-20000 |
| `clickFrenzyCps` | Click Frenzy clicks/sec | 8 | 0.2-50 |
| `clickFrenzyJitterMs` | Wiggle ±ms | 30 | 0-250 |
| `hammerStepPx` | Click step max px (0 = stay put) | 3 | 0-60 |
| `idleWander` | Idle playtime (paw wanders) [checkbox] | true | – |
| `idleSpeedPxPerSec` | Paw idle speed px/s | 320 | 60-2000 |
| `happyDanceMs` | Happy dance length (ms, 0 = off) | 2200 | 0-10000 |
| `visuals` | Pretty overlays [checkbox] | true | – |
| `chartHours` | Chart hours | 48 | 6-720 |
| `retentionDays` | Remember history (days) | 30 | 1-365 |
| `logLimit` | Log entries to keep | 10000 | 100-50000 |
| `showBuyValue` | Show "how good is a buy" overlay [checkbox] | true | – |
| `keepAlive` | Background keep-alive (silent audio) [checkbox] | true | – |
| `autoPlay` | (Auto play button, stored) | false | – |
| `autoDryRun` | Auto play dry run (log only) [checkbox] | false | – |
| `autoInsignificantSec` | Auto: insignificant cost (s of income) | 1 | 0-3600 |
| `autoGoodFactor` | Auto: good deal (× best payback) | 1.2 | 1-10 |
| `autoBiggerImpact` | Auto: much bigger impact (×) | 3 | 1-100 |
| `autoReachSec` | Auto: in reach within (s) | 1800 | 0-86400 |
| `autoMaxPaybackSec` | Auto: max payback (s) | 86400 | 60-10000000 |
| `autoReserveSec` | Auto: bank reserve (s of CpS) | 0 | 0-1000000 |
| `autoHammer` | Auto: manage hammering [checkbox] | true | – |
| `autoHammerMinShare` | Auto: hammer when clicks add >= (× CpS) | 0.05 | 0-1000 |
| `autoProbeIntervalSec` | Auto: probe hammering every (s, 0=never) | 300 | 0-86400 |
| `autoProbeSec` | Auto: probe length (s) | 10 | 2-120 |

(all "Auto" settings are only shown while Auto play is on)

Notes: the key `goldenMinIntervalMs` keeps its old name so stored settings
survive; it now means the click delay for ALL non-frenzy clicks. Under
hurry mode: delay, pause, threshold are multiplied by `panicFactor` and
the paw speed (`cursorSpeedPxPerSec`) is divided by it.

## 6. Architecture (post-refactor)

The original was one IIFE, one file, no build step, with two ad-hoc state
objects (`data`, `runtime`) and one big `schedulerTick()` if/else cascade.
The refactor keeps every behavior above but splits it into TypeScript
modules by concern, composed in `src/main.ts`, and bundled by esbuild into
the same single-file userscript shape (`dist/cc-good-boy.user.js`).

### 6.1 Composition root

`src/main.ts` constructs the entire object graph in dependency order (data
→ runtime → game adapter → the various trackers/models → hunting tasks →
scheduler → bootstrap) and ends with `waitForGame(bootstrap)`. There is no
DI container — everything is explicit constructor injection, which is
also what makes unit testing possible (swap a real dependency for a fake
at the call site).

### 6.2 Two state objects, now classes

- **`PersistedData`** (`src/core/persisted-data.ts`) — was the plain
  `data` object. Owns `DEFAULTS`, `mergeDefaults()`, load/save/prune
  (DATA-1..3), `ensureBucket()`, `appendLog()`. Backed by
  `localStorage["ccSmartGoldenComboBot.v2"]`.
- **`RuntimeState`** (`src/core/runtime-state.ts`) — was the plain
  `runtime` object. In-memory only: scheduling flags, FTHOF/refill
  bookkeeping, click bookkeeping, idle/dance/hammer flags, auto-play
  bookkeeping, paw animation state, timer handles, the cursor position.

### 6.3 The one gateway to the live game

**`GameAdapter`** (`src/game/game-adapter.ts`), implementing
`IGameAdapter`, is the *only* module allowed to read `window.Game`
directly (NFR-4). Every other module depends on the `IGameAdapter`
interface, never on `window.Game`. This is what makes unit tests possible
without a real Cookie Clicker page: tests inject `FakeGameAdapter`
(`tests/unit/fakes/fake-game-adapter.ts`) instead.

`GameAdapter` also exposes debug-only raw operations used exclusively by
`DebugTools` (spawnGoldenShimmer, resetLumpRefillCooldown, earnCookies,
gainLumps) — still guarded, still the only path to those `Game.*` calls.

### 6.4 Module map

| Area | Path | Contents |
|---|---|---|
| Core state | `src/core/` | `constants.ts` (VERSION, clamp helpers), `persisted-data.ts`, `runtime-state.ts`, `state-machine.ts` |
| Game facade | `src/game/` | `game-adapter.ts` (IGameAdapter + GameAdapter), `types.ts` (GameShimmer/RawBuff/CpsBuff/GrimoireMinigame/GameBuilding/GameUpgrade), `golden-cookie-model.ts` (fade curve, shimmer classification, GC-2/GC-3), `hurry-mode.ts` (HURRY-\*), `buffs-lock.ts` (LOCK_A, FT-6), `grimoire.ts` (FTHOF spell/cost lookup), `grimoire-dom.ts` (real/dock Grimoire controls — FT-7), `dom-geometry.ts` (visibleRect/looseRect/clippedByAncestor — shared by every overlay box, GC-2/BUY-3) |
| Cursor (queue) | `src/cursor/` | `types.ts` (`JOB_PRIORITY`, `CursorAction`, `CursorJob`, `CursorJobContext`, `CursorMover`, `CursorClickTiming`, `JobRequest`), `cursor-manager.ts` (owns the priority queue + all cursor motion: click gap → travel → pre-click pause → `cursor_at_position`, dedup by key, preemption, single cursor writer) |
| Actions | `src/actions/` | `click-element.ts` (ClickElementAction/MoveAction/VisualPressAction), `golden-cookie.ts` (GoldenCookieAction, `effectPrettyName`), `hammer.ts` (HammerAction + big-cookie point helpers, CF-\*), `fthof.ts` (FthofAction/RefillAction), `dance.ts` (DanceAction + `danceEligible`/`anyGoldenPresent`/`getDanceMs`), `ponder.ts` (PonderAction), `idle.ts` (IdleWanderAction + `IDLE_SPOTS`/`pickIdleSpot`) |
| Hunting (modules) | `src/hunting/` | `click-golden.ts` (golden hunter: `jobFor` → GoldenCookieAction), `click-big-cookie.ts` (hammer module: `job` → HammerAction), `golden-queue.ts` (route caching, wraps route-planner), `fthof.ts` (FthofActions: `fthofOrRefillPending` + `castJob`/`refillJob`), `happy-dance.ts` (HappyDance: `job` → DanceAction), `hitbox-overlay.ts` (GC-2) |
| Routing | `src/routing/route-planner.ts` | `exactRoute` (Held-Karp DP, <= 11 cookies), `heuristicRoute` (nearest-neighbor + 2-opt/Or-opt + restarts), `planRoute` (GC-5) |
| Idle | `src/idle/` | `idle-behavior.ts` (IdleBehavior module: `idleJob` → IdleWanderAction), `pending-work.ts` (conditions + queue state via `CursorManager.hasJobsAbove` — the shared "is anything more important pending?" predicate) |
| Input synthesis | `src/input/` | `dispatch.ts` (dispatchMouse/dispatchMove — MOUSE-\*), `human-click.ts` (ClickTiming: delays, waitUntil, humanClick), `cursor-controller.ts` (CursorController: low-level PAW-4 arc/spline/warp travel, moveCursorTo/glideCursor — the only file that writes `runtime.cursor.x/y`), `background-clock.ts` (BackgroundClock: BG-1/BG-2 worker timer), `keep-alive.ts` (BG-3) |
| Auto play | `src/autoplay/` | `valuation-tables.ts` (AUTO_BLOCKED_\*, AUTO_GOLDEN_UPGRADES, AUTO_KITTEN_POWER, AUTO_FINGER_STEPS, AUTO_BUILDING_CAPS — AUTO-2 data), `building-valuation.ts` + `upgrade-classifier.ts` (AUTO-3 gain math per candidate type), `collector.ts` (`autoCollect`: gathers candidates + ctx, AUTO-7 safety gates), `strategy.ts` (`autoDecide`: the pure insignificant/good/postpone/save decision, AUTO-4 — flagship unit-test target), `shopping.ts` (`AutoPlayEngine`: evaluate/shopJob/statusText, AUTO-1/8/9/10/12), `auto-hammer.ts` (AUTO-11), `income-tracker.ts` (smoothed clicking income for AUTO-3's `income`), `buy-value-overlay.ts` (BUY-\*) |
| Scheduler | `src/scheduler/` | `priority.ts` (`selectJobRequest`: the SCHED-1 cascade as pure data), `scheduler.ts` (`Scheduler.tick()`: wrath logging, queue build, enqueues ONE job via CursorManager), `overlay-loop.ts` (`OverlayLoop`: the requestAnimationFrame draw loop — hitboxes, buy-value overlay, paw) |
| Rendering | `src/rendering/` | `paw-cursor.ts` (`PawCursor`: PAW-1..3, sprite rasterizing, click pulse, fallback drawn paw), `overlay-canvas.ts` (resize/DPR handling) |
| Stats | `src/stats/` | `log.ts` (`LogStore`), `stats.ts` (`StatsRecorder`: GC-6/AUTO-10 counters + hourly buckets) |
| UI | `src/ui/` | `root.ts` (`UiRoot`: composes every panel, wires ~25 event listeners — was `createUi()`), `styles.ts` (UI-7 theme), `format.ts` (escapeHtml/formatNum/moodText/targetText), `gui-frames/` (panel DOM template, drag-to-move, the 200ms `PanelUpdater`), `settings/` (`normalize-setting.ts` clamps, `settings-panel.ts` UI-4 staged save), `stats-window/` (`chart-engine.ts` canvas chart drawing, `graphs-panel.ts` UI-5, `logs-panel.ts` UI-6 filter/export), `debug/debug-tools.ts` (DBG-\*) |
| Lifecycle | `src/lifecycle/bootstrap.ts` | `Bootstrap` (start/destroy, API-1, MOUSE-1 real-mouse sync, `waitForGame` polling) |
| Assets | `src/assets/*.svg` | The two paw sprites (PAW-2), imported as raw text via an esbuild `.svg` loader |

### 6.5 Job model (modules → actions → jobs → queue)

A **job** is `{ action, priority, key, dueAt }`; an **action** is an object
with a `cursor_at_position(ctx)` callback. `Scheduler.tick()`
(`src/scheduler/scheduler.ts`) refreshes the buff-lock tracker, classifies
live shimmers, logs wrath, builds the golden queue, calls
`selectJobRequest()` (SCHED-1), and enqueues the returned job into the
`CursorManager` (`src/cursor/cursor-manager.ts`). The manager owns the
priority queue and ALL cursor motion: it runs each job as click gap →
travel (config/hurry speed) → pre-click pause → `cursor_at_position`, with
dedup by key and preemption of lower-priority jobs.

Actions use the ctx primitives for anything they still need to do by hand:
`ctx.clickTiming.waitUntil()/waitForClickGap()/waitPreClick()/humanClick()`,
`ctx.cursor.moveCursorTo()/glideCursor()/setPosition()`,
`ctx.clock.nextFrame()`, and `ctx.abortRequested()` to yield to a
higher-priority job within a frame (SCHED-2). The low-level
`CursorController` (`src/input/cursor-controller.ts`) remains the only file
that writes `runtime.cursor.x/y`.

## 7. State machine

`BotStateMachine` (`src/core/state-machine.ts`) is a thin, explicit wrapper
around `runtime.currentAction`/`runtime.currentTarget` (the same two
fields the HUD's "Mood"/"Chasing" rows already read via
`moodText()`/`targetText()` in `src/ui/format.ts`). It didn't change what
state means — it gives the transition a name (`transitionTo(action,
target)`) instead of scattering direct field writes across every task.

`states` (the values `currentAction` can hold, i.e. `moodText()`'s keys):

| State | Meaning | Set by |
|---|---|---|
| `idle` | scheduler found no job this tick (SCHED-1's tier 7 fell through with `idleWander` off, or genuinely nothing to do) | `Scheduler.tick()` |
| `idle-play` | idle wandering/pondering/drifting/visiting (IDLE-\*) | `IdleWanderAction` / `PonderAction` |
| `bored-click` | idle "bored" clicks on the big cookie (part of IDLE-2) | `IdleWanderAction` |
| `hammer` | hammer mode clicking outside a real frenzy (CF-4) | `HammerAction` |
| `click-frenzy` | clicking during a real Click Frenzy (CF-1..5) | `HammerAction` |
| `golden-cookie` | chasing/clicking a good golden cookie (GC-4) | `GoldenCookieAction` |
| `fthof` | casting Force the Hand of Fate (FT-1) | `FthofAction` |
| `grimoire-refill` | spending a sugar lump on mana (FT-3) | `RefillAction` |
| `auto-shop` | visiting/buying a store item (AUTO-9) | auto-shop `CursorAction` from `AutoPlayEngine.shopJob()` |
| `happy-dance` | post-catch celebration (DANCE-\*) | `DanceAction` |

`currentTarget` is free-text shown in the "Chasing" row (`targetText()`
maps a few well-known values like `"none"`/`"good golden cookie"`/`"big
cookie"` to friendlier text; everything else — e.g. `"sniffing a
building"`, `"buying Cursor"` — is passed through as-is).

Transitions are driven entirely by `selectJobRequest()` (SCHED-1's
priority cascade, `src/scheduler/priority.ts`) choosing the next job each
tick; `Scheduler.tick()` sets `idle` when `selectJobRequest()` returns
nothing, and each action sets its own HUD state (its `hud` property, or by
hand during its loop) before doing anything else. There is no separate
transition table to keep in sync — the priority order in
`selectJobRequest()` *is* the state machine's transition policy; **this
table exists so you don't have to reconstruct it by reading every action
file.**

## 8. Testing

Three layers, each catching a different class of bug:

1. **Unit tests** (`tests/unit/`, Vitest + jsdom, `make test`). 175 tests
   across 26 files. Pure functions (route planner, `autoDecide`, the chart
   engine, `normalizeSetting`) are tested directly with plain data; the
   cursor queue/actions have their own fake mover/timing tests. Classes
   that depend on the game are tested against `FakeGameAdapter`
   (`tests/unit/fakes/fake-game-adapter.ts`), which implements
   `IGameAdapter` with test-controlled values — no real Cookie Clicker
   involved. `tests/unit/setup.ts` patches one jsdom quirk (computed
   `opacity` defaults to `''`, not `'1'`, which would make
   `elementHiddenByCss()` treat every element as hidden).
   These verify decision logic in isolation: "given this fake state, does
   the bot choose the right action?" They say nothing about whether it
   actually works against the live game's real DOM/timing.
2. **Visual test suite** (`tests/visual/`, `./run-vis-tests.sh`, plain
   Node + Playwright on the host — no AI, no CI). A human-judged suite:
   for each scenario in `tests/visual/scenarios.mjs` it opens a real,
   visible Chromium window, loads Cookie Clicker with a freshly-wiped save
   (`Game.HardReset(2)`), injects the freshly-built bot
   (`dist/cc-good-boy.user.js`, read straight off disk with
   `page.addScriptTag` — no Tampermonkey needed), shows a banner
   describing what to watch for, triggers the scenario through the bot's
   own real UI (its debug-tools panel, main panel buttons), and waits for
   **you** to click PASS/FAIL in the page. Nothing about the verdict is
   automated. Results are printed and saved to
   `tests/visual/results/*.json`. This is what actually exercises PAW-\*,
   MOUSE-\*, GC-2/BUY-3's visibility checks, and timing against the real
   game — everything the unit tests fake away.
3. **`make typecheck`** (`tsc --noEmit`) — catches interface drift between
   modules (e.g. a new `IGameAdapter` method not implemented by
   `FakeGameAdapter`) before it becomes a runtime `undefined is not a
   function`.

There is deliberately no automated E2E suite driving the live game and
asserting pass/fail — `playwright.config.ts`/`tests/e2e/` exist from an
earlier attempt but are unused: headless Playwright against the live
`orteil.dashnet.org` gets Cloudflare-challenged from some network
environments, and more importantly, verifying "does this look like a human
playing" is exactly the kind of judgment call that belongs to a human, not
an assertion — hence the visual suite instead.

## 9. Extension notes

- **Adding a new hunting/idle/auto-play action**: give the action its own
  file under `src/actions/` (or reuse a generic one), have the module
  produce a `JobRequest` (`action` + `priority` + `key`), wire it into
  `src/main.ts`'s composition root, and add it to `selectJobRequest()`
  (`src/scheduler/priority.ts`) at the right priority tier. Add its state
  name to the table in §7 and to `moodText()`/`targetText()`
  (`src/ui/format.ts`) if the HUD should describe it specially.
- **Adding a new `IGameAdapter` method**: add it to the interface in
  `src/game/game-adapter.ts`, implement it on `GameAdapter` (guarded, per
  NFR-4), and implement it on `FakeGameAdapter`
  (`tests/unit/fakes/fake-game-adapter.ts`) — `make typecheck` will catch
  a missing implementation.
- **Adding an auto-play candidate type**: extend
  `src/autoplay/valuation-tables.ts` with the new data and
  `src/autoplay/upgrade-classifier.ts` or `building-valuation.ts` with the
  gain formula; `autoCollect`/`autoDecide` need no changes since they
  operate on the generic `{kind, type, name, obj, cost, dCps}` candidate
  shape.
  Add a Debug tools spawn/grant button
  (`src/ui/debug/debug-tools.ts`) and a visual-suite scenario
  (`tests/visual/scenarios.mjs`) if the new behavior is worth watching by
  eye.
- **Changing a setting's default/range**: update the DEFAULTS object in
  `src/core/persisted-data.ts`, the clamp in
  `src/ui/settings/normalize-setting.ts`, the table in §5 above, and the
  input's `min`/`max`/`step` attributes in
  `src/ui/gui-frames/panel-dom.ts`.
- **Every behavior change**: bump `VERSION` (`src/core/constants.ts`) and
  `package.json`'s `version` together (NFR-1), add a changelog entry
  below, and if it's visually observable, run (or add to)
  `./run-vis-tests.sh` before calling it done.

## 10. Assumptions and known limits

- Verified against the live game via the visual test suite (§8.2), not
  via automated assertions against it. Assumed from the game's own
  source/community docs: the shimmer fade formula,
  `Game.shimmerTypes.golden.chain`, the buff name "Cookie storm", the
  `force` names used by the debug spawns, `Game.lumpRefill`,
  `Game.gainLumps`. If one is missing, the affected feature degrades
  quietly (see NFR-4) and the Debug tools report an error in red.
- In a hidden tab the bot itself keeps working (worker timers, BG-1/BG-2).
  The GAME's own loop is only unthrottled while the keep-alive audio runs
  (needs one real click on the page) or if the browser is configured that
  way.
- Auto play values are ESTIMATES from the fields above (not a full
  simulation of the game's CpS calculation) and the golden-upgrade values
  are assumed shares (`AUTO_GOLDEN_UPGRADES`). Use "Auto play dry run"
  first and compare its log with your own judgement.
- Auto play does not click the big cookie for you (combine with Hammer
  mode), does not buy kittens/mouse upgrades/dragon/seasonal switches, and
  has no ascension logic.
- FTHOF has no cooldown in the game; only mana limits it.
- Route planning is Euclidean and ignores click time (constant per
  cookie).

## 11. Manual/visual test plan

Run `./run-vis-tests.sh` for the structured, repeatable version of this
(see §8.2). The scenarios there cover:

| Scenario (`tests/visual/scenarios.mjs`) | Requirements exercised |
|---|---|
| Golden cookie: basic hunt | GC-2, GC-3, GC-4 |
| Wrath cookie: should be ignored | GC-1 |
| Click Frenzy: chase then hammer | CF-1..5 |
| Cookie Storm: hurry mode | HURRY-1, HURRY-2 |
| Cookie Chain: route through consecutive cookies | GC-5, HURRY-\*, DANCE-3 |
| Auto play: shops for buildings/upgrades | AUTO-\*, BUY-\* |
| Manual hammer: rapid big-cookie clicks | CF-4 |
| Happy dance after a golden click | DANCE-\* |

Not yet covered by a scripted scenario (do these by hand with Debug tools
if you touch the relevant code): FTHOF/refill logic (FT-\*, needs mana +
CpS buffs set up), settings staging (UI-4), log filter/export (UI-6),
real-mouse compatibility (MOUSE-1/2 — move your own mouse while the bot
runs and confirm the "+N" number follows your cursor, not the paw's).

## 12. Changelog

- **4.1.0** Cursor architecture refactor: modules now produce **actions**
  and enqueue them as **jobs** into a new `CursorManager`
  (`src/cursor/`) that owns the priority queue and ALL cursor motion
  (click gap → travel → pre-click pause → `cursor_at_position`, dedup by
  key, preemption by `JOB_PRIORITY`). Golden/FTHOF/refill/auto-shop/hammer/
  dance/idle choreography moved into action classes under `src/actions/`;
  the scheduler is now a producer (`selectJobRequest`) instead of running
  opaque task workflows, and `CursorController` is again the only writer of
  `runtime.cursor.x/y` (enforced by a unit test). Behavior unchanged —
  every requirement in this document still holds; 175 unit tests green.
- **4.0.0** Refactor: the single 11k-line monolith
  (`legacy/cc-bot.original.js`) split into ~50 TypeScript modules under
  `src/` (see §6), bundled by esbuild via a Docker-only build pipeline
  (`make build`, no Node required on the host), with a Vitest unit-test
  suite (147 tests) and a human-judged visual test suite
  (`./run-vis-tests.sh`). No behavior change intended — every requirement
  in this document held for 3.11.1 and holds here; see §8 for how that was
  verified. Major version bump because the distribution mechanism (source
  layout, build process) changed, not the bot's behavior.
- **3.11.1** Fixed: a collapsed upgrade store could leave stale on-screen
  coordinates behind, drawing its boxes over the building list; overlay
  elements are now checked for CSS visibility and ancestor clipping too.
  Also dropped the separate "BUY" tag and solid outline: every box is now
  the same dashed style, color + score only.
- **3.11.0** "How good is a buy" box now shows a 0-100 score centered
  inside it (not just color), so the relative quality is readable as a
  number too.
- **3.10.2** "How good is a buy" box color now ranks on a log scale of
  payback, so one very bad option (e.g. a multi-hour payback) no longer
  makes every other option look equally green.
- **3.10.1** "How good is a buy" overlay is now a color-graded bounding
  box (color relative to the other options on offer) instead of a text
  label.
- **3.10.0** "How good is a buy" overlay on every purchase option,
  color-coded, on by default, works without auto play.
- **3.9.0** Background operation: worker-clock timers, paw animation that
  does not depend on `requestAnimationFrame`, optional silent-audio
  keep-alive, HUD row "Background".
- **3.8.0** Auto play: kitten upgrades; grandma cofactor upgrades are now
  also recognised by their description (fixes them being ignored); debug
  tool "Auto play: explain store".
- **3.7.1** Auto play never buys more than 57 Wizard towers.
- **3.7.0** Auto play: buys cursor and clicking upgrades (cursor doubling,
  the Thousand/Million/... fingers, mouse upgrades) valued by click
  income; auto hammer with probing (starts clicking from 0 cookies); all
  auto settings/rows are hidden unless auto play is on.
- **3.6.0** Auto play mode (off by default): buys buildings, "twice as
  efficient" building upgrades, grandma cofactor upgrades, biscuits and
  golden cookie upgrades by payback/impact strategy; dry-run option; never
  the grandma research center.
- **3.5.1** Documentation only: the original spec header, section
  banners, JSDoc for every function/constant, commented defaults and
  state.
- **3.5.0** Closed-paw (fist) sprite shown during the click pulse.
- **3.4.0** Route planning: least total travel (exact <= 11 cookies,
  heuristic beyond) replaces nearest-first.
- **3.3.0** Hurry mode for cookie storms/chains (factor 0.2); no happy
  dance during chains.
- **3.2.0** Debug: reset FTHOF cooldown, reset refill cooldown, clear
  LOCK_A, grant 1 quadrillion cookies.
- **3.1.0** Debug tools sub panel (spawns, mana, lumps).
- **3.0.0** Baseline of the rewrite, version shown in the panel, real-mouse
  compatibility fix. Includes everything developed before: theme and
  rename to "CC Good Boy"; log export; fade-in threshold and immediate
  highlighting; reaction delay + pre-click pause; draggable panel; staged
  settings with Save; idle wandering, figure-eight pondering; human-like
  paths; paw sprite, click pulse, lean; happy dance; hammer mode; Click
  Frenzy rate/step rework; drop shadow.
- **2.0.0** Original "CC SmartBot v2".
