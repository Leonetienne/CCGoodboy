# CC Good Boy — behavior spec, architecture, and how to work on this bot

This file is the specification, the architecture map, and the extension
guide for the Tampermonkey userscript built from `src/`. It replaces the
giant header comment that used to live at the top of the single-file
original (still kept, frozen, at `legacy/cc-bot.original.js`, section 6
"ARCHITECTURE" of which is superseded by this document).

Whenever behavior changes: update the matching requirement ID below, bump
`VERSION` in `src/core/constants.ts` **and** `version` in `package.json`
(keep them identical — see NFR-1), and add a changelog entry. Pure
documentation changes do not bump the version (NFR-1).

Commit messages: a single lowercase `type: summary` subject line (`fix:`,
`feat:`, `tweak:`, `docs:`), like the existing history. NEVER add a
`Co-Authored-By:` trailer or any other AI/tool attribution line, whatever
an agent's defaults say.

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

Out of scope: seasons (switching them; auto play does buy the Easter egg
upgrades a season drops, EGG-\*), garden, stock market, pantheon, ascending,
and any Grandmapocalypse beyond stage 1 (WRINK-1).
Buying is only done by the optional, OFF-by-default "Auto play" mode
(AUTO-\*) and even then only through the game's own buy functions. The bot
NEVER clicks anything except: good golden cookies, the big cookie, the
FTHOF spell button, the lump-refill button, a ripe sugar lump, the
Options/Stats menu buttons and the "View Grimoire" button needed to get the
FTHOF spell on screen (FT-8), and — in auto play only — the Wizard tower's
"lvl" button (AUTO-13), mature wrinklers (WRINK-5) and Krumblor's tab,
popup and aura picker (KRUMB-3) (the paw only "visits" store items,
AUTO-9).

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
| ripe | a growing sugar lump whose age (since `Game.lumpT`) is between `Game.lumpRipeAge` and `Game.lumpOverripeAge`: clicking it now harvests it reliably. Below that it is still growing/"mature" (clicking gambles a 50% botched harvest); at/above `lumpOverripeAge` the game auto-harvests it on its own next tick. |
| LOCK_A | the bot's own lock that prevents a second lump refill until the CpS buff situation changes (see FT-6). |
| hurry mode | reduced delays/thresholds and faster paw during a cookie storm or cookie chain (HURRY-1). |
| hammer mode | button that clicks the big cookie non-stop (CF-4). |
| task | one unit of work run by the scheduler; only one at a time. |
| auto play | the optional shopping mode (AUTO-\*). |
| payback | cost / approximate CpS gain of a purchase, in seconds ("rentability"; lower is better). |
| impact | CpS gain / current CpS (how much it changes production, regardless of its cost). |
| in reach | affordable within a set time at the current income. |
| stage | `Game.elderWrath`, the Grandmapocalypse stage: 0 calm, 1 awoken (One mind), 2 displeased (Communal brainsweep), 3 angered (Elder Pact). Stage 1 turns 1 in 3 golden cookies into wrath cookies and lets wrinklers spawn. |
| wrinkler | a creature attached to the big cookie from stage 1 on (max 10, 12 with Elder spice). n attached wrinklers each digest n × 5% of CpS (n² × 5% together) while the bank only gets CpS × (1 − n × 5%); popping one returns what it digested × 1.1 (more with upgrades, × 3 for a shiny one). 10 wrinklers ≈ 6× the income, but only once popped. |
| respawn time | how long an emptied wrinkler slot takes to digest again: `1 / (spawn chance per frame × fps) + 10s` crawl (~56 min at stage 1: 0.00001 per frame). |
| Krumblor | the cookie dragon, unlocked by the upgrade "A crumbly egg" (in the store once the heavenly upgrade "How to bake your dragon" is owned and 1M cookies are baked). `Game.dragonLevel` 0-4 are egg levels paid in cookies (1M × 2^level), level 5 → 6 ("Train Dragon Cursor") sacrifices 100 cursors; aura `id` is known from level `id + 4`. |
| mature | a wrinkler that has digested for >= "maturity" × the respawn time (estimated as `sucked / (CpS × cpsSucked)`). |

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
- **GC-8** Every caught golden cookie also logs `"Caught a cookie!! I am
  such a gewd boy :3"` to the browser console, except Cookie Storm cookies
  (the storm itself and its drops), which would spam it (see CON-1).

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
  FTHOF cost, max mana >= FTHOF cost (a refill that could never reach the
  cost, because Wizard towers cap max mana below it, is skipped — it
  would just waste the lump), LOCK_A open, refill not on cooldown, >= 1
  lump. After a refill LOCK_A is set.
- **FT-4** Both abort at once if a golden cookie becomes ready or a Click
  Frenzy starts, and re-check their conditions right before clicking.
- **FT-5** Both respect the click delay (before moving) and pre-click
  pause.
- **FT-6** LOCK_A opens again when the CpS buff count returns to 0, or
  when it rises to >= 3 (and above its previous value).
- **FT-7** If the real Grimoire buttons are not visible on screen, the
  cast/refill click still fires directly on the real control (no dock
  chip and no visit is required); the paw's movement target in that case
  is simply wherever it already is. Since FT-8 this is only the FALLBACK
  for FTHOF (preparation blocked); the refill always works this way.
- **FT-8** Before casting FTHOF the paw first gets the spell in front of
  it, one step per scheduler tick at FTHOF priority, each re-checking the
  FT-1 conditions (FT-4): (1) if a menu covers the buildings
  (`Game.onMenu` not empty) it clicks Options once, then Stats twice;
  (2) if the Grimoire is closed, it scrolls `#centerArea` until the
  Wizard tower's "View Grimoire" button (`#productMinigameButton{id}`) is
  on screen and (3) clicks it — never when the Grimoire is already open,
  since that button toggles; (4) if the Grimoire is open but the FTHOF
  spell is scrolled away, it scrolls to the spell; then it casts. If a
  step is impossible (no Wizard tower row, a scroll that doesn't reach the
  element, the menu staying open) it logs `"fthof prep"` and casts
  directly per FT-7 for the next 10s instead. Debug: DBG-11 runs the same
  steps.
- **FT-9** Two settings switch lump/Grimoire actions off (both ON by
  default): "Grimoire: cast Force the Hand of Fate" (`grimoireFthof`) and
  "Spend sugar lumps" (`spendLumps`). With casting off, FT-1/FT-8 never
  run and no refill happens either (a refill only exists to pay for a
  cast). With lump spending off, the bot never spends a sugar lump on its
  own: no FT-3 refill and no AUTO-13 Grimoire unlock (Wizard tower level
  1). Nothing switched off is pending, blocks lower tiers or complains in
  the console (CON-2); the Grimoire HUD row says what is off. Harvesting
  ripe lumps (LUMP-\*) gains lumps and is unaffected, as is the explicit
  debug tool DBG-11.

### 3.5 Sugar lump harvesting

- **LUMP-1** The moment a growing sugar lump turns ripe (see "ripe" in
  §2), the paw clicks it (`#lumps`) to harvest it, instead of leaving it
  for the game's own slower overripe auto-harvest roughly an hour later.
- **LUMP-2** The bot never clicks a lump that is only "mature" (below
  `lumpRipeAge`): that gambles a 50% chance of a botched harvest in the
  live game, and GC/LUMP behavior is meant to be reliable, not lucky.
- **LUMP-3** Both abort at once if a golden cookie becomes ready or a
  Click Frenzy starts, and re-check ripeness right before clicking (same
  FT-4 pattern).
- **LUMP-4** Respects the click delay (before moving) and pre-click pause
  (FT-5 pattern).
- **LUMP-5** Priority: below FTHOF/refill, above auto play shopping (see
  SCHED-1). Not gated by Auto play — it runs whether or not Auto play is
  switched on, since it is not "buying" (§1).
- **LUMP-6** Each successful harvest is recorded (`stats.lumpHarvests`,
  shown in the HUD statistics row) and logged (`"harvest sugar lump"`).
  Debug: "Ripen growing sugar lump" / DBG-8.

### 3.6 Scheduling and priority

- **SCHED-1** Priority, highest first:
  1. good golden cookies (queue)
  2. real Click Frenzy clicking
  3. FTHOF cast (and its FT-8 preparation steps), then lump refill
  4. a ripe sugar lump (LUMP-\*)
  5. a buildings-view recipe already under way / the "Show grimoire"
     debug goal (DBG-9/11), then auto play: Grimoire unlock (AUTO-13),
     then a Krumblor step (KRUMB-\*), then popping a wrinkler for a
     purchase (WRINK-3), then shopping (only when a purchase is due,
     AUTO-8)
  6. hammer mode (manual button, or the auto hammer, AUTO-11)
  7. happy dance (only right after a catch, DANCE-1)
  8. idle behavior (IDLE-\*)
- **SCHED-2** One task at a time; the scheduler ticks every 25ms; long
  tasks poll "abort" predicates so higher priorities interrupt them within
  about one frame.
- **SCHED-3** After real work the paw ponders where it stopped (IDLE-3).
- **SCHED-4** A task that throws is logged (`"error"`) and never stops the
  bot.

See [§7 State machine](#7-state-machine) for how this maps onto code.

### 3.7 Idle behavior and happy dance

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
- **IDLE-6** While pondering, the paw's social mood is derived from the
  wall-clock time by passing the timestamp through a sine function with a
  threshold (`pawMoodAt()`, period 120s, threshold 0):
  - **shy** — if the real cursor gets within 60px of the paw centre the
    paw stops pondering and moves away to a random spot far from the human
    cursor (one relocation, not a continuous repulsion), then keeps
    pondering.
  - **not shy** — the paw ignores the human cursor entirely.
- **IDLE-7** Click dance: while the paw is not shy, a trusted click within
  160px of the paw centre and 800ms makes it do a small happy dance in
  place (2200ms, 0.7 scale). After the dance it won't dance (or flee)
  again for 3s.
- **IDLE-8** Idle ponder/drift/visit motion keeps the WHOLE paw sprite
  inside the viewport (`clampPawPoint`, 68px margin around the click
  point), not just the click point itself.
- **DANCE-1** After catching a golden cookie the paw does a small happy
  dance (hops + sway + tilt, default 2200ms, 0 = off) ONLY IF that very
  moment is idle: no other golden/wrath cookie present, nothing for
  FTHOF/refill/Click Frenzy/hammer to do.
- **DANCE-2** It is decided at the moment of the catch and never queued for
  later.
- **DANCE-3** Never during a cookie chain; stops within a frame when a
  cookie appears or real work becomes pending.
- **DANCE-4** Ends exactly where it started, then the paw ponders (IDLE-3).

### 3.8 The paw (virtual cursor)

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

### 3.9 Real-mouse compatibility

- **MOUSE-1** Before the game handles the USER's mousedown/mouseup/click,
  the bot re-sends a mousemove at the real coordinates so the game's own
  `Game.mouseX/Y` (used for the floating "+N" numbers) are correct.
- **MOUSE-2** Cosmetic paw movement does not dispatch mousemove to the
  game. Bot clicks always put the number where the paw is, never under the
  real cursor: `humanClick` sends a mousemove at the click point right
  before pressing AND again right before mouseup/click, so a real mouse
  moving during the hold can't pull `Game.mouseX/Y` back to the human.

### 3.10 User interface

- **UI-1** Draggable, minimizable panel (drag by the title bar; position
  saved and kept on screen). Title shows the script version.
- **UI-2** Rows: Mood, Chasing, Shinies waiting (ready / fading in /
  wrath), Click Frenzy, Buffies, Grimoire, LOCK_A, Click cooldown,
  Background, Wrinklers (WRINK-7), Auto play, statistics.
- **UI-3** Buttons: Pause/Resume, Hammer cookie, Auto play, Graphs, Logs,
  Debug tools, Settings.
- **UI-4** Settings are STAGED: editing only marks "unsaved"; "Save
  settings" (or Enter) validates, clamps, applies and stores them at once.
- **UI-5** Graphs: hourly golden-cookie clicks by effect and Grimoire
  actions. Every golden cookie effect the bot can catch has its own fixed,
  clearly different line colour (`CHART_PALETTE`/`chartColor()` in
  `src/ui/stats-window/chart-engine.ts`). Hovering a line (or its legend
  entry) draws it bold over the faded rest; on a line, a label shows the
  hour and its count (every series whose line lies there, e.g. several at
  0).
- **UI-6** Logs: searchable table (newest first, up to 2000 rows shown)
  with Export JSON / Export CSV (respects the filter; not capped).
- **UI-7** Theme: pastel pink/lavender/baby-blue on dark plum, rounded
  font, ASCII emoticons only (no emoji), no external assets.
- **UI-8** Debug tools sub panel (DBG-\*).
- **UI-9** Frame opacity (the main panel, Graphs, Logs and Debug tools frames)
  and overlay opacity (the hitbox/buy-value/paw canvas overlay, PAW-\*/GC-2/
  BUY-\*) are each configurable via a settings slider (0.1-1, so neither can
  be dragged fully invisible). Staged like every other setting (UI-4): the
  live percentage readout next to the slider updates as it's dragged, but
  the opacity itself only changes on Save.
- **UI-10** A small, faded footer link at the very bottom of the main
  panel ("(c) Leon Etienne · GitHub") opens the project's GitHub page
  (https://github.com/Leonetienne/CCGoodboy) in a new tab; the whole line
  is the link. Hidden while the panel is minimized.

### 3.11 Debug tools (cheats, for testing; use a test save)

- **DBG-1** Spawn: random golden, wrath, Frenzy, Click Frenzy, Building
  Frenzy, Cookie Chain (a real chain: spawn lead + forced `chain cookie`),
  Cookie Storm, Lucky, Cookie Storm Drop, Sweet (lump), Elder Frenzy
  (wrath), via `Game.shimmer('golden', ...)` / `.force`.
- **DBG-2** Grant 1 quadrillion cookies (`Game.Earn`, so it counts as
  earned).
- **DBG-3** Fill Up Mana (mana = max).
- **DBG-4** Reset Filling Up Mana cooldown = reset the game's 15-minute
  lump-refill timer (falls back to overriding `Game.canRefillLump` until
  reload).
- **DBG-5** Clear LOCK_A (the bot's own refill lock).
- **DBG-6** Give 10 sugar lumps.
- **DBG-7** Each use shows a status line (errors in red) and is logged
  (`"debug tool"`).
- **DBG-8** Ripen growing sugar lump: rewinds `Game.lumpT` so the current
  lump is in its ripe window (LUMP-1), for testing the harvest module
  without waiting ~23 real hours.
- **DBG-9** Show buildings view: the paw runs the AUTO-13 recipe (click
  Options once, then Stats twice) from whatever view is open. Works
  without auto play.
- **DBG-10** Scroll to Wizard towers: the paw rests over `#centerArea` and
  wheel-scrolls it until the Wizard tower row is centred (AUTO-13 step 2).
  Fails in red if the row is not shown (no Wizard tower, or a menu covers
  the buildings — use DBG-9 first).
- **DBG-11** Show grimoire: (a) buildings view (DBG-9 recipe), (b) Wizard
  towers scrolled into view, (c) Grimoire unlocked — fails in red at once
  if no Wizard tower is bought, or it is still level 0 and there is no
  sugar lump; otherwise spends one lump on level 1 like AUTO-13 — (d)
  "View Grimoire" clicked if the Grimoire is closed, and the spells
  scrolled into view. Works without auto play; gives up after 30s. The
  outcome (`"Show grimoire: done"` / `"failed"`) is logged as `"debug
  tool"`.
- **DBG-12** Spawn fed wrinklers (sets stage 1): fills every empty
  wrinkler slot with an attached wrinkler that has already digested 6
  hours' worth (mature at stage 1 with the default maturity), and sets
  `Game.elderWrath` to 1 if it is 0 so they respawn. Fails in red without a
  grandma or without CpS. Changes the save: use a test save.
- **DBG-13** Spawn a wrinkler: one wrinkler crawls into the first free slot
  through the game's own `Game.SpawnWrinkler` (attached after ~10s, starts
  digesting from 0). Leaves the stage alone. Fails in red when every slot
  is taken.
- **DBG-14** Pop a wrinkler: forces ONE pop through the real runtime path
  (WRINK-3..6: `WrinklerPopper.plan()` → scheduler tier 5 → `job()` →
  `WrinklerPopAction` → the normal result handling, stats and log) for the
  fattest attached normal wrinkler. Skips only maturity, the "a purchase
  needs it" check and the auto play switches; the WRINK-4 safety gates
  (golden cookie, Click Frenzy, CpS buff, ...) still hold it back, for up to
  30s: a poke that didn't pop pauses 3s (WRINK-4) and then retries while
  the 30s last. Works without auto play; dry run only logs. Fails in red
  when no normal wrinkler is attached.
- **DBG-15** Unlock crumblor: grants the heavenly upgrade "How to bake
  your dragon" (`Upgrade.earn()`, as if bought in the ascension tree), so
  KRUMB-\* can be tested without an ascension. With >= 1M cookies baked
  the crumbly egg is unlocked into the store at once (the game's own rule;
  below that it appears once 1M are baked). Fails in red when the egg is
  already bought.
- **DBG-16** Unlock all easter upgrades: unlocks every Easter egg upgrade
  (`Game.easterEggs`, normally random drops from golden cookies and
  wrinklers during Easter season) that is neither unlocked nor bought, so
  all of them sit in the store (EGG-\*). Fails in red when every egg is
  already unlocked or bought.
### 3.12 Console voice

The bot talks in the browser console, in the same cute style as the UI
(NFR-5), via `src/core/console-voice.ts`. Separate from the persisted
action log (UI-6); nothing here is stored.

- **CON-1** Happy lines (`sayYay`, `console.log`): GC-8's catch message,
  one short, personal greeting when the bot starts (`Bootstrap.start()`),
  `"Popped a stinky wrinkler! Yuckies!"` after each successful pop
  (WRINK-6), and `"Krumblor wears Dragon Cursor now, clicky clicky ^w^"`
  once the aura is on (KRUMB-5).
- **CON-2** "Wanted to ..., but ..." lines (`console.log`) whenever the bot
  wants to do something and can't. Conditions re-checked every scheduler
  tick go through `sayCantWhile(wish, reasonCode, msg)`, which says each
  reason once and only again when the reason changes or the wish went
  away in between (no spam at 40 ticks/s):
  - FTHOF wanted (>= 1 CpS buff outlasting a Click Frenzy, no Click
    Frenzy): no Wizard towers, Grimoire still locked (Wizard tower level
    0; a level >= 1 tower whose Grimoire hasn't loaded yet is not
    complained about), spell not found, not enough mana (`FthofActions.reportBlockers()`, called by
    `Scheduler.tick()`).
  - Refill wanted (additionally >= 2 buffs and too little mana): full mana
    can't pay for FTHOF (FT-3), LOCK_A already used, refill on cooldown, no
    sugar lumps ("sugar popsies").
  - Grimoire unlock wanted (AUTO-13): sugar lumps not unlocked, no lumps.

  One-off events use `sayCant(msg)`: a golden cookie click that didn't pop
  it (not for storm drops), a FTHOF/refill/lump click that did nothing,
  FT-8 preparation falling back to a direct cast, the Grimoire unlock,
  wrinkler popping or Krumblor training pausing (with the reason), a purchase the shop refused,
  a failed debug tool or "Show grimoire".
- **CON-3** Errors (`sayOops`, `console.error` with the error object): a
  failing action (SCHED-4, `CursorManager`), a failing timer callback, the
  auto play planner or wrinkler planner throwing, localStorage load/save
  failures, paw sprite failures.

### 3.13 Persistence and API

- **DATA-1** State is stored in
  `localStorage["ccGoodBoy"]` as JSON
  `{version, config, stats, hourly, logs, ui}`; saved debounced (500ms), on "Save
  settings", and on page unload. `version` is the script version that last
  saved it: at load it is kept as `PersistedData.previousVersion` (null on a
  fresh install) and then replaced by the running `VERSION`, so a future
  update can tell how old the stored state is.
- **DATA-2** Pruning: hourly buckets older than "History retention days"
  and logs beyond "Log entries to keep" are dropped.
- **DATA-3** Stored config is merged over the defaults, so new settings
  appear with their defaults after an update.
- **LIFE-1** Start-up: the bot waits until `Game.ready`, the shimmers
  array and `#bigCookie` exist (polled every 500ms), then starts at once
  (panel, overlay, paw, API), but its scheduler — and with it every
  behavior — only starts `GAME_SETTLE_MS` (1000ms) later, since minigames
  such as the Grimoire load asynchronously after `Game.ready`
  (`waitForGame()`/`Bootstrap.start()`, `src/lifecycle/bootstrap.ts`).
- **API-1** `window.__CCSmartGoldenComboBot = { version, pause(),
  resume(), state (runtime), clickFrenzySec(), data, save(), destroy() }`.

### 3.14 Auto play mode ("full auto play": shopping)

- **AUTO-1** OFF by default. The "Auto play" button switches it on/off;
  the choice is stored with the settings (`config.autoPlay`). The button
  reads "Auto play ON ^w^" while on.
- **AUTO-2** Scope. It may buy ONLY: buildings; building upgrades that
  make a building "twice as efficient"; grandma "cofactor" upgrades
  (grandmas twice as efficient + 1% CpS of a building per N grandmas, also
  recognised by their description); KITTEN upgrades; ALL cookie (biscuit)
  upgrades; every other flat "Cookie production multiplier +N%." upgrade
  (Wrinkler ambergris, Dragon scale, the eggs, ...); golden cookie upgrades (Lucky day, Serendipity, Get lucky,
  Lasting fortune, Lucky digit, Lucky number, Lucky payout, Green yeast
  digestives) — but never more Wizard towers than the configured target
  (`autoWizardTowerTarget`, default 57 — the ideal mana count for FTHOF);
  cursor and CLICKING upgrades: the "mouse and
  cursors twice as efficient" upgrades, the Thousand/Million/Billion/...
  fingers series and the mouse upgrades ("Clicking gains +1% of your
  CpS"); the heavenly potential unlocks (Heavenly chip secret, Heavenly
  cookie stand, Heavenly bakery, Heavenly confectionery, Heavenly key),
  valued as the prestige CpS bonus each one unlocks; and, with "Auto: grandmapocalypse stage 1" on (the default), the
  grandma research chain up to stage 1 (WRINK-1). It NEVER buys Exotic nuts, Communal
  brainsweep, Elder Pact, Elder Pledge/Covenant or anything else that pushes
  the Grandmapocalypse past stage 1, and nothing it cannot classify.
- **AUTO-3** Value model per option: cost; approximate CpS gain `dCps`
  (buildings: per-building CpS × global multiplier; "twice as efficient":
  that building's CpS; biscuit: its power % of CpS; golden upgrades: an
  assumed share of CpS; CLICKING upgrades are valued in cookies/s at the
  hammer rate: click power × clicks per second, so the cursor doubling
  upgrades are worth their click gain even with 0 cursors); payback = cost
  / `dCps` ("rentability"); impact = `dCps` / CpS; wait = time to afford it
  at the income (CpS without buffs, minus the share withered by attached
  wrinklers, + smoothed clicking income) after the reserve.
- **AUTO-4** Strategy: there is no absolute payback ceiling. Every
  candidate reaching `autoDecide()` already passed AUTO-2/AUTO-3's
  classification (never the research center, always a positive `dCps`),
  so a slow payback still beats 0% return from letting cookies sit idle —
  payback only ever decides ORDER and what is worth deliberately saving
  for, never whether an affordable purchase gets refused outright.
  (A) insignificant cost (<= `autoInsignificantSec` x CpS, default 60s —
  "worthless junk") -> buy at once, always, exempt from postponement.
  (B) preferred candidates — golden cookie upgrades and Wizard towers
  below `autoWizardTowerTarget` — are bought while affordable regardless
  of payback, also exempt from postponement, and sort before ordinary
  ones (Wizard towers first). (C) every other affordable candidate is
  bought too, UNLESS an option that is not affordable yet, in reach and a
  good deal (payback incl. waiting <= 1.2× the best of ALL options, in
  reach or not — pp already charges the wait) or preferred
  either pays back faster even counting the wait (its pp < this one's
  payback), or has >= 3× the impact and this one costs more than 10% of
  it: then it is postponed in favor of saving up for the big one (else a stream of small
  purchases keeps the bank too low to ever afford it). Among everything
  bought this tick the best payback goes first within a preference tier;
  with one purchase per task (AUTO-7), later ticks work down the same
  ranking, so the store empties out highest score first whenever nothing
  is being saved for. Otherwise nothing is bought and the target is shown
  (preferred first, then lowest pp): only an option that is itself worth
  saving up for (in reach, good deal or preferred) is ever named, so a
  bad deal that merely happens to be in reach is never "saved for" while
  a far better one sits just past the window.
- **AUTO-5** "In reach" = affordable within 1800s (`autoReachSec`) at the
  income — purely a time-window check, not a profitability one: a
  candidate outside it is just too far off to reason about yet, not "too
  slow a payback" (AUTO-4, there is no such gate). See `autoDecide()` in
  `src/autoplay/strategy.ts`.
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
- **AUTO-13** Grimoire unlock: as soon as >= 1 Wizard tower is owned, its
  level is still 0, sugar lumps are unlocked and >= 1 lump is in stock,
  auto play spends one lump on Wizard tower level 1 (which unlocks the
  Grimoire minigame, FT-\*), unless "Spend sugar lumps" is off (FT-9). Same safety gates as AUTO-7 (not while a
  golden cookie is ready, Click Frenzy, storm/chain, FTHOF/refill pending,
  ascending, a prompt open, paused); dry run only logs "would unlock".
  It is done like a human, one step per scheduler tick, re-derived from
  the live page each time so a preempted step is simply picked up again:
  (1) if a menu covers the buildings (`Game.onMenu` not empty) the paw
  clicks `#prefsButton` once, then `#statsButton` twice (idempotent: ends
  on the buildings view from any menu); (2) if the level button
  `#productLevel{id}` is scrolled out of `#centerArea` the paw rests over
  the column and wheel-scrolls it (ticks of ~70-120px) until the row is
  centred; (3) the paw clicks the level button (the game's "ask before
  spending lumps" confirmation is suppressed for that click, like FT-3's
  refill). Every step is a real synthetic click / visible scroll with the
  paw there (NFR-8). Guards against spinning: the recipe is never re-run
  within 5s; a menu that stays open, a failed scroll or a missing row
  pauses the unlock 10s, a failed level-up 3s. Planned by the same `GrimoireView` as FT-8 (goal "level").
  Priority: tier 5, before shopping (a pending unlock also interrupts
  hammering/idle like a due purchase). Logged as `"auto grimoire
  unlock"`. Debug: DBG-9, DBG-10.

### 3.15 Background operation (browser tab not in front)

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

### 3.16 "How good is a buy" overlay (independent of auto play)

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

### 3.17 Grandmapocalypse stage 1 and wrinklers (auto play)

- **WRINK-1** Stage 1 only. With "Auto: grandmapocalypse stage 1 (wrinklers)"
  on (`config.autoGrandmapocalypse`, DEFAULT ON) auto play treats the
  research chain as candidates (AUTO-2): Bingo center/Research facility
  (grandmas ×4), Specialized chocolate chips (+1%), Designer cocoa beans
  (+2%), Ritual rolling pins (grandmas ×2), Underworld ovens (+3%), One mind
  (each grandma +0.02 base CpS per grandma; starts stage 1). Nobody buys
  the Bingo center for "grandmas ×4": up to One mind a step is valued as
  part of ONE project, finishing the chain, and competes on payback like
  anything else (not preferred): payback = (cost of every step still to
  buy) / (stage 1 gain + the steps' own gains) + the delay until the
  wrinklers pay out; the step gets `dCps = its cost / that payback`. Stage 1
  gain = CpS × ((1 − 0.05n) + popMult × 0.05n² × m/(m+1) − 1 − 0.2/3)
  (n wrinkler slots, m = maturity, WRINK-2; minus the 1 in 3 golden
  cookies that turn wrath, golden cookies assumed worth 20% of CpS like
  Lucky day's valuation): about +400% with 10 wrinklers. Delay = the
  research still ahead (30 min each, 3 min with Persistent memory) + one
  respawn time (a slot filling) + m respawn times (digesting to maturity):
  ~8h from the Bingo center with the defaults. After One mind, a step
  bought late counts only its own gain
  (`src/autoplay/grandmapocalypse-valuation.ts`,
  `autoResearchCandidateGain()`). One mind's "are you
  sure?" prompt is confirmed like its own "Yes" button (buy with bypass).
  Exotic nuts (it starts the research of stage 2), Communal brainsweep
  (stage 2), Elder Pact (stage 3), Elder Pledge, Elder Covenant and Revoke
  Elder Covenant are NEVER bought, whatever the
  settings: `autoCollect()` skips them and `autoBuy()` refuses them as a
  second guard. The game itself never escalates past what was bought (its
  random stage shifts are capped by the owned upgrades). Setting it off
  stops buying the chain; it does not undo a stage already reached (Elder
  Pledge only unlocks with Elder Pact, so there is no way back from stage 1
  short of stage 3 + Elder Covenant). Golden cookie rules are unchanged: the
  1 in 3 wrath cookies of stage 1 are ignored (GC-1).
- **WRINK-2** A wrinkler is only popped once it is mature (§2):
  "Auto: pop a wrinkler after (× its respawn time)"
  (`autoWrinklerMaturity`, default 5, so a slot spends >= ~83% of its time
  digesting). Never a shiny one. Never while nothing respawns (stage 0:
  a pop would lose the slot for good).
- **WRINK-3** Only when a purchase needs it: auto play is asked what it
  would buy with the mature wrinklers' cookies added to the bank
  (`AutoPlayEngine.decideWithExtraBank()`, the unchanged `autoDecide()`).
  If that purchase is not affordable from the bank alone, the fewest mature
  wrinklers that cover the gap are popped, fattest first, one per job. The
  normal shopping (AUTO-4) then spends the cookies.
- **WRINK-4** Safety: only with auto play and "Auto: pop wrinklers for
  purchases" (`autoPopWrinklers`, default on) on; same gates as AUTO-7
  (golden cookie ready, Click Frenzy, storm/chain, FTHOF/refill pending,
  ascending, prompt open, paused); never while a CpS buff runs (wrinklers
  digest the buffed CpS, so that is exactly when they must stay attached).
  Planned at most once a second. A wrinkler that did not pop pauses popping
  3s, an error 30s. Dry run only logs "would pop".
- **WRINK-5** Popping is a real poke (NFR-8): the paw moves onto the
  wrinkler's body (90 canvas px out from its anchor along its angle, the
  middle of the game's hit box — or, since the game hands a click to the
  FIRST wrinkler in `Game.wrinklers` under the mouse, the spot nearest
  that middle which no earlier attached wrinkler covers,
  `wrinklerPokeCanvasPoint()`; a body covered completely pauses popping
  3s), hovers 260ms (the game re-checks what is
  under its mouse only every 5th frame), then clicks `#backgroundLeftCanvas`
  until it bursts (3 pokes: 2.1 hp, −0.75 per click; at most 10).
  Priority: tier 5, after the Grimoire unlock, before shopping; a due pop
  interrupts hammering and idle play like a due purchase (AUTO-8).
- **WRINK-6** Each pop is counted (`stats.wrinklersPopped`, "Wrinklers
  popped" in the HUD statistics once > 0) and logged (`"pop wrinkler"`
  with the cookies gained and the purchase it was for).
- **WRINK-7** HUD row "Wrinklers" (only while the stage is > 0 or a
  wrinkler is around): attached/max, the cookies they would give now, how
  many are mature, and a shiny one if present.
  Debug: DBG-12.

### 3.18 Krumblor, the cookie dragon (auto play)

- **KRUMB-1** With auto play and "Auto: train Krumblor (Dragon Cursor)"
  (`config.autoKrumblor`, DEFAULT ON) on, the bot raises Krumblor up to
  the Dragon Cursor aura and no further: it buys "A crumbly egg" once it
  is in the store, pays the egg levels (1M, 2M, 4M, 8M, 16M cookies:
  "Chip it" ×3, "Hatch it", "Train Breath of Milk"), trains Dragon Cursor
  (level 5 → 6, sacrifices 100 cursors) and puts it on. Nothing without
  the egg (it needs the heavenly upgrade "How to bake your dragon").
- **KRUMB-2** Cookie costs (the egg, each egg level, cursors bought to
  reach 100) are only paid when they are insignificant (AUTO-4 A: <=
  `autoInsignificantSec` × CpS) and leave the reserve (AUTO-6) alone, so
  the dragon never competes with real purchases. Right before the
  sacrifice every cursor above 100 is sold (the 25% given back for the
  priciest ones pays for far more than rebuying the cheapest ones), and
  after it the sold ones are bought back (`runtime.krumblorRebuy`, as many
  as the bank pays; the rest is left to shopping). Fewer than 100 cursors:
  the missing ones are bought first. Buying never happens while the store
  is in sell mode (the game's `buy()` sells then).
- **KRUMB-3** Like a human, one step per scheduler tick, re-derived from
  the live game each time (`nextKrumblorStep()`,
  `src/autoplay/krumblor-strategy.ts`), so a preempted step is simply
  picked up again: the paw opens the popup by clicking the dragon's tab,
  which the game draws on `#backgroundLeftCanvas` and hit-tests itself
  (`Game.UpdateSpecial`: x 24, y canvas height − 24 − 48 × tab count + 48 ×
  tab index, ±24px), clicks the popup's train button, the aura slot, the
  Dragon Cursor crate and "Confirm" in the "Set your dragon's aura" prompt,
  and finally the popup's "x" — real synthetic clicks (NFR-8 a). The egg
  purchase and the cursor sale/rebuy go through the game's API with the paw
  visiting the store item and pulsing (NFR-8 b, like AUTO-9). The paw only
  closes a popup it opened and only answers an aura picker it opened
  (30s); it also closes its popup while waiting for cookies.
- **KRUMB-4** Safety: same gates as AUTO-7 (golden cookie ready, Click
  Frenzy, storm/chain, FTHOF/refill pending, ascending, paused; a prompt
  other than its own aura picker). A click that didn't do its job pauses
  training 3s, an element that doesn't show up for 5s pauses it 10s. Dry
  run only logs "would do". Priority: tier 5, after the Grimoire unlock,
  before wrinkler pops and shopping; a due step interrupts hammering and
  idle play like a due purchase (AUTO-8).
- **KRUMB-5** The aura goes into slot 0 only while slot 0 is "No aura":
  an aura the player picked is never replaced. Switching costs 1 of the
  highest building owned (the game's rule). Every step is logged
  (`"krumblor"`). Debug: DBG-15.

### 3.19 Easter eggs (auto play)

During Easter season golden cookies are drawn as bunnies (still
`type === 'golden'`, so GC-\* is unchanged) and they and popped wrinklers
drop egg upgrades into the store, where they stay. Each egg makes every
remaining egg pricier: common ones cost 999 × 2^owned, rare ones 999 ×
3^owned (`src/autoplay/easter-eggs.ts`).

- **EGG-1** Auto play always buys the egg upgrades, like any other
  candidate (AUTO-2..4); there is no separate switch.
- **EGG-2** Values (`easterEggGain()`): the 12 common eggs +1% CpS;
  Golden goose egg (golden cookies 5% more often) a golden upgrade worth
  20% × 5% of CpS; Faberge egg (1% cheaper) +1% CpS; Wrinklerspawn 5% of
  the wrinkler payout (WRINK-1's popMult × 0.05n² × m/(m+1)); Cookie egg
  10% of the clicking income at the hammer rate; Century egg its boost one
  day from now (the game's formula, up to +10% on day 100 of the
  ascension, `Game.startDate`); "egg" +9 base CpS. Any of these that is
  worth less than 0.1% of CpS right now (Omelette always, Wrinklerspawn at
  stage 0, a fresh Century egg) gets that nominal value, so it is still
  bought once its cost is insignificant.
- **EGG-3** Order: buying an egg triples every rare egg's price but only
  doubles a common one's, so the 7 rare eggs (all but the Chocolate egg)
  are preferred (AUTO-4 B) and a common egg is held back while one of them
  waits in the store in reach (affordable within `autoReachSec`). Bought
  first, the rare eggs cost ~1M together; after the commons, ~1.6 billion
  each.
- **EGG-4** Chocolate egg (bursts into 5% of the bank when bought): only
  once no other egg waits in the store (buying it first would triple their
  prices) and the burst is >= 2× its price; its dCps is the burst, so it
  goes out at once. It is never "saved for".
- **EGG-5** Every egg goes through the normal purchase path: AUTO-7 gates,
  store visit + pulse (AUTO-9), `"auto buy"` log with type `egg` (the
  Golden goose egg: `golden`). Debug: DBG-16.

## 4. Non-functional requirements

- **NFR-1** Versioning: MAJOR.MINOR.PATCH, shown in the panel. Bump with
  EVERY change to the script, its tests or its build: this
  includes a follow-up correction to work made earlier in the same
  session and even work that hasn't been committed yet — bump again
  rather than editing an already-written VERSION/changelog entry in
  place. Use PATCH for fixes AND for small, contained behavior tweaks;
  reserve MINOR for genuinely substantial features (2026-08: a shy/cuddly
  idle mood is a patch, not a minor). Keep `package.json`'s `version` and
  `src/core/constants.ts`'s
  `VERSION` identical, and add a changelog entry (§12) for every bump, not
  just the ones that ship. The one exception: pure documentation changes
  (AGENTS.md, README.md, anything under `docs/`) never bump the version and
  get no changelog entry.
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
| `frameOpacity` | Frame opacity (0.1-1) | 0.95 | 0.1-1 |
| `overlayOpacity` | Overlay opacity (0.1-1) | 1 | 0.1-1 |
| `keepAlive` | Background keep-alive (silent audio) [checkbox] | true | – |
| `grimoireFthof` | Grimoire: cast Force the Hand of Fate [checkbox] (FT-9) | true | – |
| `spendLumps` | Spend sugar lumps [checkbox] (FT-9: refills, AUTO-13 unlock) | true | – |
| `autoPlay` | (Auto play button, stored) | false | – |
| `autoDryRun` | Auto play dry run (log only) [checkbox] | false | – |
| `autoInsignificantSec` | Auto: insignificant cost (s of CpS) | 60 | 0-3600 |
| `autoGoodFactor` | Auto: good deal (× best payback) | 1.2 | 1-10 |
| `autoBiggerImpact` | Auto: much bigger impact (×) | 3 | 1-100 |
| `autoReachSec` | Auto: in reach within (s) | 1800 | 0-86400 |
| `autoReserveSec` | Auto: bank reserve (s of CpS) | 0 | 0-1000000 |
| `autoWizardTowerTarget` | Auto: wizard tower target | 57 | 0-500 |
| `autoHammer` | Auto: manage hammering [checkbox] | true | – |
| `autoHammerMinShare` | Auto: hammer when clicks add >= (× CpS) | 0.05 | 0-1000 |
| `autoProbeIntervalSec` | Auto: probe hammering every (s, 0=never) | 300 | 0-86400 |
| `autoProbeSec` | Auto: probe length (s) | 10 | 2-120 |
| `autoWrinklerMaturity` | Auto: pop a wrinkler after (x its respawn time) | 5 | 1-50 |
| `autoGrandmapocalypse` | Auto: grandmapocalypse stage 1 (wrinklers) [checkbox] | true | – |
| `autoPopWrinklers` | Auto: pop wrinklers for purchases [checkbox] | true | – |
| `autoKrumblor` | Auto: train Krumblor (Dragon Cursor) [checkbox] | true | – |

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
  `localStorage["ccGoodBoy"]`; `previousVersion` = the version that saved it.
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
| Core state | `src/core/` | `constants.ts` (VERSION, clamp helpers), `console-voice.ts` (CON-\*), `persisted-data.ts`, `runtime-state.ts`, `state-machine.ts` |
| Game facade | `src/game/` | `game-adapter.ts` (IGameAdapter + GameAdapter), `types.ts` (GameShimmer/RawBuff/CpsBuff/GrimoireMinigame/GameBuilding/GameUpgrade), `golden-cookie-model.ts` (fade curve, shimmer classification, GC-2/GC-3), `hurry-mode.ts` (HURRY-\*), `buffs-lock.ts` (LOCK_A, FT-6), `grimoire.ts` (FTHOF spell/cost lookup), `grimoire-dom.ts` (real Grimoire controls — FT-7), `lump-dom.ts` (`#lumps` control/centre — LUMP-\*), `wrinkler-dom.ts` (`#backgroundLeftCanvas`, a wrinkler's body point — WRINK-5), `dragon-dom.ts` (the dragon's canvas tab, `#specialPopup`, the aura picker — KRUMB-3), `buildings-view-dom.ts` (`#centerArea`, menu buttons, building rows/level buttons, the Options/Stats/Stats recipe, `centeredScrollTop` — AUTO-13), `dom-geometry.ts` (visibleRect/looseRect/clippedByAncestor — shared by every overlay box, GC-2/BUY-3) |
| Cursor (queue) | `src/cursor/` | `types.ts` (`JOB_PRIORITY`, `CursorAction`, `CursorJob`, `CursorJobContext`, `CursorMover`, `CursorClickTiming`, `JobRequest`), `cursor-manager.ts` (owns the priority queue + all cursor motion: click gap → travel → pre-click pause → `cursor_at_position`, dedup by key, preemption, single cursor writer) |
| Actions | `src/actions/` | `click-element.ts` (ClickElementAction/MoveAction/VisualPressAction), `golden-cookie.ts` (GoldenCookieAction, `effectPrettyName`), `hammer.ts` (HammerAction + big-cookie point helpers, CF-\*), `fthof.ts` (FthofAction/RefillAction), `lump-harvest.ts` (LumpHarvestAction, LUMP-\*), `buildings-view.ts` (MenuButtonAction, ScrollIntoViewAction, MinigameButtonAction — FT-8/AUTO-13/DBG-9..11), `grimoire-unlock.ts` (GrimoireUnlockAction, AUTO-13), `wrinkler-pop.ts` (WrinklerPopAction, WRINK-5), `krumblor.ts` (DragonClickAction/DragonStoreAction, KRUMB-3), `dance.ts` (DanceAction + `danceEligible`/`anyGoldenPresent`/`getDanceMs`), `ponder.ts` (PonderAction), `idle.ts` (IdleWanderAction + `IDLE_SPOTS`/`pickIdleSpot`) |
| Hunting (modules) | `src/hunting/` | `click-golden.ts` (golden hunter: `jobFor` → GoldenCookieAction), `click-big-cookie.ts` (hammer module: `job` → HammerAction), `golden-queue.ts` (route caching, wraps route-planner), `fthof.ts` (FthofActions: `fthofOrRefillPending` + `castJob`/`refillJob`), `lump-harvest.ts` (LumpHarvestActions: `pending` + `harvestJob`), `happy-dance.ts` (HappyDance: `job` → DanceAction), `buildings-view.ts` (BuildingsViewNavigator: Options/Stats/Stats recipe + scroll-into-view steps, `PrepStep`), `grimoire-view.ts` (GrimoireView: step planner to an unlocked/open, on-screen Grimoire — FT-8/AUTO-13 — plus the DBG-9..11 tools and their scheduler tier), `hitbox-overlay.ts` (GC-2) |
| Routing | `src/routing/route-planner.ts` | `exactRoute` (Held-Karp DP, <= 11 cookies), `heuristicRoute` (nearest-neighbor + 2-opt/Or-opt + restarts), `planRoute` (GC-5) |
| Idle | `src/idle/` | `idle-behavior.ts` (IdleBehavior module: `idleJob` → IdleWanderAction), `pending-work.ts` (conditions + queue state via `CursorManager.hasJobsAbove` — the shared "is anything more important pending?" predicate) |
| Input synthesis | `src/input/` | `dispatch.ts` (dispatchMouse/dispatchMove — MOUSE-\*), `human-click.ts` (ClickTiming: delays, waitUntil, humanClick), `cursor-controller.ts` (CursorController: low-level PAW-4 arc/spline/warp travel, moveCursorTo/glideCursor — the only file that writes `runtime.cursor.x/y`), `background-clock.ts` (BackgroundClock: BG-1/BG-2 worker timer), `keep-alive.ts` (BG-3) |
| Auto play | `src/autoplay/` | `valuation-tables.ts` (AUTO_BLOCKED_\*, AUTO_GOLDEN_UPGRADES, AUTO_KITTEN_POWER, AUTO_FINGER_STEPS, AUTO_BUILDING_CAPS — AUTO-2 data), `building-valuation.ts` + `upgrade-classifier.ts` (AUTO-3 gain math per candidate type), `collector.ts` (`autoCollect`: gathers candidates + ctx, AUTO-7 safety gates), `strategy.ts` (`autoDecide`: the pure insignificant/good/postpone/save decision, AUTO-4 — flagship unit-test target), `shopping.ts` (`AutoPlayEngine`: evaluate/shopJob/statusText, AUTO-1/8/9/10/12), `auto-hammer.ts` (AUTO-11), `grimoire-unlock.ts` (`GrimoireUnlocker`: AUTO-13 gating, steps from GrimoireView), `wrinkler-strategy.ts` (pure: respawn time, maturity, fewest-fattest pick — WRINK-2/3), `grandmapocalypse-valuation.ts` (pure: stage 1 gain, delay, chain-step dCps — WRINK-1), `wrinkler-popper.ts` (`WrinklerPopper`: WRINK-3/4 gating, plan, job, HUD text), `krumblor-strategy.ts` (pure: next Krumblor step — KRUMB-1/2/5), `krumblor.ts` (`KrumblorTrainer`: KRUMB-\* gating, state, jobs, the cursor sale/rebuy), `easter-eggs.ts` (pure-ish: egg values and order — EGG-\*), `income-tracker.ts` (smoothed clicking income for AUTO-3's `income`), `buy-value-overlay.ts` (BUY-\*) |
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
| `idle` | scheduler found no job this tick (SCHED-1's tier 8 fell through with `idleWander` off, or genuinely nothing to do) | `Scheduler.tick()` |
| `idle-play` | idle wandering/pondering/drifting/visiting (IDLE-\*) | `IdleWanderAction` / `PonderAction` |
| `bored-click` | idle "bored" clicks on the big cookie (part of IDLE-2) | `IdleWanderAction` |
| `hammer` | hammer mode clicking outside a real frenzy (CF-4) | `HammerAction` |
| `click-frenzy` | clicking during a real Click Frenzy (CF-1..5) | `HammerAction` |
| `golden-cookie` | chasing/clicking a good golden cookie (GC-4) | `GoldenCookieAction` |
| `fthof` | casting Force the Hand of Fate (FT-1) | `FthofAction` |
| `grimoire-refill` | spending a sugar lump on mana (FT-3) | `RefillAction` |
| `lump-harvest` | harvesting a ripe sugar lump (LUMP-1) | `LumpHarvestAction` |
| `buildings-view` | clicking Options/Stats back to the buildings, scrolling `#centerArea`, or clicking "View Grimoire" (FT-8, AUTO-13, DBG-9..11) | `MenuButtonAction` / `ScrollIntoViewAction` / `MinigameButtonAction` |
| `grimoire-unlock` | spending a sugar lump on Wizard tower level 1 (AUTO-13) | `GrimoireUnlockAction` |
| `wrinkler-pop` | poking a mature wrinkler until it bursts (WRINK-5) | `WrinklerPopAction` |
| `krumblor` | buying the crumbly egg, clicking Krumblor's tab/popup/aura picker, selling/buying cursors for the sacrifice (KRUMB-\*) | `DragonClickAction` / `DragonStoreAction` |
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

1. **Unit tests** (`tests/unit/`, Vitest + jsdom, `make test`). 330 tests
   across 36 files. Pure functions (route planner, `autoDecide`, the chart
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
  `Game.gainLumps`, `Game.lumpT`/`Game.lumpRipeAge`/`Game.lumpOverripeAge`/
  `Game.canLumps` (sugar lump ripeness, LUMP-\*), `Game.onMenu`, the
  `#centerArea`/`#prefsButton`/`#statsButton`/`#row{id}`/`#productLevel{id}`
  DOM and building `level` (Grimoire unlock, AUTO-13), `Game.elderWrath`,
  `Game.wrinklers` (`phase`/`sucked`/`type`/`x`/`y`/`r`), `Game.cpsSucked`,
  `Game.getWrinklersMax()`, the wrinkler spawn/pop formulas and hit box
  (WRINK-\*; read from the game's `main.js` 2.058, and one pop verified live:
  3 pokes, digested × 1.1 gained). If one is missing, the
  affected feature degrades quietly (see NFR-4) and the Debug tools report
  an error in red.
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
- Grandmapocalypse stage 1 is on by default (WRINK-1) and cannot be undone
  by the bot. Its cost: 1 in 3 golden cookies becomes a wrath cookie that
  the bot ignores (GC-1), and the visible CpS drops by n × 5% while n
  wrinklers are attached. Shiny wrinklers are never popped; pop them by
  hand if you want them.
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
CpS buffs set up; for FT-8 close the Grimoire, open Options and scroll the
building list to the top before spawning a Frenzy + "Fill Up Mana"), sugar lump harvesting (LUMP-\*, "Ripen growing sugar
lump" then watch the paw harvest it), wrinkler popping (WRINK-\*: auto
play on, "Spawn fed wrinklers", then make the next purchase need them —
e.g. spend the bank down; watch the paw poke one wrinkler 3 times and the
purchase follow; a Frenzy must hold it back), Krumblor (KRUMB-\*: on
a test save with > 100 cursors and some CpS, auto play on, "Unlock
crumblor"; watch the egg bought, the tab clicked, 5 trainings, the cursors sold
to 100, the sacrifice, the rebuy, the aura picked and confirmed, the popup
closed), Grimoire unlock (AUTO-13: on a test
save with a Wizard tower at level 0, give lumps, open Options, switch auto
play on, scroll the building list to the top; watch Options/Stats/Stats,
the wheel-scroll and the "lvl" click; DBG-9/10 exercise the first two
steps on their own), settings staging (UI-4), log
filter/export (UI-6), real-mouse compatibility (MOUSE-1/2 — move your own
mouse while the bot runs and confirm the "+N" number follows your cursor,
not the paw's).

## 12. Changelog

- **5.2.1** Removed the "Auto: buy Easter eggs" setting (`autoEasterEggs`)
  from 5.2.0: auto play always buys the Easter eggs (EGG-1).

- **5.2.0** New auto play module: Easter eggs (EGG-\*). Auto play now
  buys the 8 rare eggs, which matched no candidate type before (the 12
  common ones were already bought as flat multipliers), each valued by its
  own effect (`src/autoplay/easter-eggs.ts`, `easterEggGain()`). Every
  egg now goes through that module. Rare eggs are preferred and the
  common ones wait for them, since each egg triples the rare ones'
  prices. The Chocolate egg comes last, once its burst (5% of the bank)
  is >= 2× its price. New setting "Auto: buy Easter eggs"
  (`autoEasterEggs`, on) and debug tool "Unlock all easter upgrades"
  (DBG-16); `IGameAdapter` gains `getRunStartDate()` and
  `unlockEasterEggs()`. Checked in a local copy of the game (2.058): all
  20 eggs unlocked by DBG-16 and bought, rare ones first. Unit tests in
  `tests/unit/easter-eggs.test.ts`.

- **5.1.1** The Krumblor debug tool (DBG-15) is now "Unlock crumblor": it
  grants the heavenly upgrade "How to bake your dragon" instead of only
  unlocking the crumbly egg, and unlocks the egg right away when 1M
  cookies are baked. `IGameAdapter.unlockCrumblyEgg()` became
  `unlockKrumblor()`.

- **5.1.0** New auto play module: Krumblor (KRUMB-\*). With the crumbly egg
  in the store it buys the egg, trains the dragon through the egg levels
  (only with insignificant cookie costs), sells the cursors above 100,
  sacrifices 100 cursors for Dragon Cursor, buys the sold ones back, puts on
  the Dragon Cursor aura (never replacing a player-picked one) and closes
  the popup — every step a real click (the dragon's tab on the left canvas,
  the popup, the aura picker) or a store visit with a pulse. New setting
  "Auto: train Krumblor (Dragon Cursor)" (`autoKrumblor`, on), mood
  `krumblor`, debug tool "Unlock crumbly egg (Krumblor)" (DBG-15);
  `IGameAdapter` gains `getDragonLevel`/`getDragonAuras`/
  `getSelectingDragonAura`/`getSpecialTabs`/`getSpecialTab` and
  `unlockCrumblyEgg`. Checked end to end against a local copy of the game
  (2.058). Unit tests in `tests/unit/krumblor.test.ts` and
  `tests/unit/priority.test.ts`.

- **5.0.11** Auto play never buys Exotic nuts any more: it starts the
  research of Communal brainsweep (stage 2), which is out of scope. It
  moved from `AUTO_RESEARCH` to `AUTO_ESCALATION_NAMES`, so
  `autoCollect()` skips it and `autoBuy()` refuses it (WRINK-1). Unit
  tests in `tests/unit/wrinklers.test.ts`.

- **5.0.10** Fixed: auto play never bought Wrinkler ambergris, Dragon
  scale, the eggs and other flat "Cookie production multiplier +N%."
  upgrades. They are not in the game's cookie pool, so they matched no
  candidate type. They are now classified as `multiplier`, valued as CpS ×
  N% (AUTO-2/AUTO-3; ambergris's "1% cheaper" side effect is not counted).
  Unit tests in `tests/unit/upgrade-classifier.test.ts`.

- **5.0.9** Fixed: auto play said it was saving for One mind but kept
  spending the bank on worse deals (e.g. an 8 quadrillion upgrade next to
  the 16 quadrillion One mind), so it never got there. A save target only
  held a purchase back when it had >= 3× that purchase's impact, and a
  research chain step's impact is small by design (its gain is spread over
  hours of wrinkler delay, WRINK-1). `autoDecide()` now also postpones an
  ordinary purchase whose payback is worse than the target's payback
  including the wait (AUTO-4). Unit tests in `tests/unit/strategy.test.ts`.

- **5.0.8** The main panel gets a small, shy footer link
  ("(c) Leon Etienne · GitHub") to the project's GitHub page (UI-10).

- **5.0.7** Tests only: `tests/unit/heavenly-unlocks.test.ts` checks the
  5.0.6 fix end to end — `autoCollect()` offers a store heavenly unlock
  with prestige and `autoDecide()` buys it; none without prestige, and
  never an ascension-tree (`prestige` pool) upgrade.

- **5.0.6** Fixed: auto play never bought the heavenly potential unlocks
  (Heavenly chip secret ... Heavenly key) — they matched no candidate type.
  They are now classified (`AUTO_HEAVENLY_UNLOCKS`, type `heavenly`) and
  valued as CpS × prestige% × their share / (1 + prestige% × owned shares)
  (AUTO-2); `IGameAdapter` gains `getPrestige()`. Unit tests in
  `tests/unit/upgrade-classifier.test.ts`.

- **5.0.5** Documentation only: the README no longer claims the Grimoire
  combo has no off switch; it points at the FT-9 settings ("Grimoire: cast
  Force the Hand of Fate", "Spend sugar lumps") and notes that the AUTO-13
  Grimoire unlock skips with lump spending off.

- **5.0.4** The refill setting from 5.0.3 is now "Spend sugar lumps"
  (`spendLumps`, replaces `grimoireRefill`, still on by default): besides
  the mana refill it also stops auto play from spending a lump on the
  Wizard tower level that unlocks the Grimoire (AUTO-13,
  `GrimoireUnlocker.wanted()`). Unit test in
  `tests/unit/grimoire-unlock.test.ts`.

- **5.0.3** Two new settings, both on by default (FT-9): "Grimoire: cast
  Force the Hand of Fate" (`grimoireFthof`) and "Grimoire: refill mana
  with sugar lumps" (`grimoireRefill`). Switching one off stops that
  Grimoire action in `selectJobRequest()`, `fthofOrRefillPending()` and the
  CON-2 console complaints; casting off also stops refills. The Grimoire
  HUD row shows "(refill off)" / "(FTHOF + refill off)". Unit tests in
  `tests/unit/fthof.test.ts` and `tests/unit/priority.test.ts`.

- **5.0.2** Userscript `@description` reworded: CC Good Boy is a mod that
  helps with golden cookies (auto play being the optional extra), not a
  bot that plays the whole game for you.

- **5.0.1** Userscript header (`build/userscript-banner.txt`): the
  namespace is now the GitHub repo (was a leftover
  `openai-cookie-clicker-smart-bot`), and it gains `@author`,
  `@homepageURL`, `@supportURL` and a description listing every feature
  area, not just the golden cookie ones. Tampermonkey tells scripts apart
  by name + namespace, so an install from before this version shows up as
  a second script: remove the old one.

- **5.0.0** Major version bump; no behavior change since 4.10.14.

- **4.10.14** The start-up delay from 4.10.8 no longer delays the panel:
  the UI, overlay and paw appear as soon as the game is ready, and only
  the scheduler (all behavior) starts 1s later (LIFE-1,
  `runtime.settleTimer`).

- **4.10.13** Graphs (UI-5): most golden cookie lines came out the same
  yellow, because each colour was a hash of the effect name. Every effect
  the bot can catch now has its own fixed colour from a hand-picked
  palette (`CHART_PALETTE`), and hovering a line or legend entry
  highlights it and labels the hovered hour with its count
  (`chartHitTest()`, `drawChartBase(..., hover)`). Unit tests in
  `tests/unit/chart-engine.test.ts`.

- **4.10.12** Fixed: the "+N" number of a bot click (Click Frenzy,
  hammering, bored clicks) could pop up under the human's cursor instead of
  at the paw. The game places it at `Game.mouseX/Y` when the click fires,
  and any real mouse movement during the paw's 8-21ms hold overwrote that.
  `humanClick()` now re-sends the mousemove at the paw right before
  mouseup/click (MOUSE-2). Unit test in `tests/unit/human-click.test.ts`.

- **4.10.11** The persisted state moved from
  `localStorage["ccSmartGoldenComboBot.v2"]` to `localStorage["ccGoodBoy"]`
  (DATA-1; no built-in migration, never released under the old key) and now
  records the script version that saved it (`version`), exposed at load as
  `PersistedData.previousVersion` so a later update can tell how old the
  stored state is. Unit tests in `tests/unit/persisted-data.test.ts`.

- **4.10.10** Fixed: "Pop a wrinkler" (DBG-14) said "trying again in 3s"
  after a failed poke but never did — the failure cleared its 30s force
  window along with the attempt. The window now only ends on a successful
  pop, so a failed one retries after the 3s pause (the console says
  "giving up for now" once the window is over). Also fixed why pokes could
  miss with many wrinklers: the game gives a click to the first wrinkler in
  its list under the mouse, so an overlapping neighbour could take the
  pokes. The paw now pokes the nearest spot of the target's body that no
  earlier wrinkler covers (`wrinklerHit()`/`wrinklerPokeCanvasPoint()` in
  `src/game/wrinkler-dom.ts`, a port of the game's hit test), and pauses
  3s instead of looping when the body is fully covered. Unit tests in
  `tests/unit/wrinklers.test.ts`.

- **4.10.9** Each successful wrinkler pop says "Popped a stinky wrinkler!
  Yuckies!" in the browser console (CON-1).

- **4.10.8** Fixed: right after page load the console claimed "my
  Grimoire is still locked (Wizard tower level 0)" although the Wizard
  towers were levelled — the Grimoire minigame simply hadn't loaded yet.
  The bot now waits 1s after the game reports ready before starting
  (LIFE-1), and CON-2 only calls the Grimoire locked when the Wizard
  tower's level really is 0 (a loading Grimoire is not complained about).

- **4.10.7** The console greeting (CON-1) is now one short, personal
  sentence ("Hiii, missed you!! Ready to catch cookies for you :3")
  instead of "hooman" plus a second API-hint line.

- **4.10.6** The bot greets you in the browser console when it loads
  ("Hiii hooman!! CC Good Boy vX is here ...", CON-1), replacing the old
  "[CC Good Boy] Loaded uwu." line; the API hint is kept in the same style.

- **4.10.5** The bot now says in the browser console when it wants to do
  something but can't (CON-2: FTHOF without Wizard towers / a locked
  Grimoire / enough mana, a refill on cooldown / without sugar lumps /
  capped by max mana / after LOCK_A, a Grimoire unlock without lumps, a
  click that did nothing, a paused module, a refused purchase, a failed
  debug tool), once per reason instead of every tick, and logs errors with
  `console.error` in the same style (CON-3). New
  `src/core/console-voice.ts`, `FthofActions.reportBlockers()`; unit tests
  in `tests/unit/console-voice.test.ts`.

- **4.10.4** Every caught golden cookie logs "Caught a cookie!! I am such
  a gewd boy :3" to the browser console (GC-8), except Cookie Storm /
  Cookie Storm Drop catches, to avoid spam.

- **4.10.3** Two new debug tools: "Spawn a wrinkler" (DBG-13, one wrinkler
  crawls in via `Game.SpawnWrinkler`; `IGameAdapter.spawnWrinkler()`) and
  "Pop a wrinkler" (DBG-14), which does not pop anything itself: it sets
  `runtime.wrinklerForcePopUntil` so the real `WrinklerPopper` plans the
  fattest attached normal wrinkler and the scheduler runs the normal pop
  job — the same code the runtime pops with, minus only the
  maturity/purchase-need checks and the auto play switches (safety gates
  still apply). Unit tests in `tests/unit/wrinklers.test.ts`.

- **4.10.2** Fixed: auto play could "save for" a terrible deal (e.g.
  the 101st Shipment, worth ~0.003% CpS) while a far better purchase
  (+2% CpS, slightly more expensive) sat right next to it — whenever the
  better one was just outside the 30-minute "in reach" window, the bad
  one was the only unaffordable option left in reach, and the save
  target was chosen from those without any quality bar. `autoDecide()`
  (`src/autoplay/strategy.ts`) now measures "good deal" against the best
  pp of ALL options (pp includes the wait, so an out-of-reach option only
  raises the bar when it is genuinely better), and the save target must
  be a real target (good deal or preferred); otherwise the HUD reads
  "nothing worth saving for in reach". Once the better option comes into
  reach it becomes the target and the bad one is postponed as before.
  New unit tests in `tests/unit/strategy.test.ts`.

- **4.10.1** The research chain is no longer "preferred" with its own
  effects as its value (the Bingo center scored as "grandmas ×4", which is
  not why anyone buys it). Up to One mind every step is now valued by the
  payback of finishing the chain: everything still to buy against what
  stage 1 is worth (wrinklers, ~+400% CpS with 10 slots, minus the 1 in 3
  golden cookies that turn wrath) plus the steps' own gains, delayed until
  the wrinklers pay out (research left + a slot filling + maturity). It now
  competes on payback like any purchase, and the "how good is a buy"
  overlay scores it by that. New `src/autoplay/grandmapocalypse-valuation.ts`,
  `autoResearchCandidateGain()`/`autoResearchSec()`, `AUTO_STAGE1_CHAIN`;
  `AUTO_PREF_RESEARCH` removed; `getWrinklerSpawnChance()` takes an
  optional stage. Unit tests in `tests/unit/wrinklers.test.ts`.

- **4.10.0** Grandmapocalypse stage 1 and wrinkler popping (WRINK-\*).
  Auto play now buys the grandma research chain up to One mind (stage 1:
  wrinklers, 1 in 3 golden cookies turns wrath), on by default via the new
  setting "Auto: grandmapocalypse stage 1 (wrinklers)"; Communal brainsweep,
  Elder Pact and the pledge/covenant switches stay blocked in
  `autoCollect()` AND `autoBuy()` (`AUTO_ESCALATION_NAMES`, replacing
  `AUTO_BLOCKED_NAMES`; new `AUTO_RESEARCH`, `autoResearchGain()`; One mind
  bought with the prompt bypass). New module `WrinklerPopper`
  (`src/autoplay/wrinkler-popper.ts`, pure logic in `wrinkler-strategy.ts`)
  pops mature wrinklers (digested >= 5× their ~56 min respawn time, setting
  "Auto: pop a wrinkler after") only when auto play's next purchase needs
  their cookies — asked through the unchanged `autoDecide()` with the
  mature stash added to the bank — fewest and fattest first, never a shiny
  one, never during a CpS buff; new setting "Auto: pop wrinklers for
  purchases". `WrinklerPopAction` pokes the wrinkler on
  `#backgroundLeftCanvas` like a human (tier 5, before shopping). Auto
  play's saving-up income now subtracts the CpS withered by wrinklers. New
  HUD row "Wrinklers", stat "Wrinklers popped", mood `wrinkler-pop`, debug
  tool "Spawn fed wrinklers (sets stage 1)" (DBG-12). `IGameAdapter` gains
  `getElderWrath`/`getWrinklers`/`getWrinklersMax`/`getCpsSucked`/
  `getWrinklerSpawnChance`/`getWrinklerPopMult` and `spawnFedWrinklers`.
  Unit tests in `tests/unit/wrinklers.test.ts` and
  `tests/unit/priority.test.ts`.

- **4.9.0** FTHOF now gets the spell in front of the paw before casting
  (FT-8): back to the buildings view (Options, Stats, Stats) if a menu is
  open, scroll to the Wizard towers, click "View Grimoire"
  (`#productMinigameButton7`) if the Grimoire is closed, scroll to the
  spell — one step per tick at FTHOF priority, falling back to the old
  direct cast (FT-7) for 10s when a step is impossible. The menu/scroll
  logic moved out of `GrimoireUnlocker` into a shared
  `BuildingsViewNavigator` (`src/hunting/buildings-view.ts`) and a
  `GrimoireView` step planner (`src/hunting/grimoire-view.ts`) used by
  FTHOF, the AUTO-13 unlock and the debug tools; new
  `MinigameButtonAction`; `fthofCastBlocked()` shared by `FthofAction`
  and the preparation steps. New debug tool "Show grimoire" (DBG-11);
  "Show buildings view" / "Scroll to Wizard towers" lost their
  "(paw: ...)" label suffixes. The unlock's "menu stays open" pause is now
  10s (was 30s).
- **4.8.0** Auto play unlocks the Grimoire (AUTO-13): as soon as a Wizard
  tower and a sugar lump are available and the tower is still level 0,
  the paw spends one lump on level 1 by clicking the tower's real "lvl"
  button — first clicking Options, Stats, Stats if a menu covers the
  buildings, and wheel-scrolling `#centerArea` if the row is scrolled
  away. New module `GrimoireUnlocker` (`src/autoplay/grimoire-unlock.ts`)
  hands the scheduler one step per tick at the auto-shop tier (before
  shopping); new actions `MenuButtonAction`/`ScrollIntoViewAction`
  (`src/actions/buildings-view.ts`) and `GrimoireUnlockAction`
  (`src/actions/grimoire-unlock.ts`); DOM helpers in
  `src/game/buildings-view-dom.ts`; `IGameAdapter` gains `lumpsUnlocked()`
  and `getOnMenu()`, `GameBuilding` gains `level`. Two new debug tools,
  "Show buildings view" (DBG-9) and "Scroll to Wizard towers" (DBG-10),
  run those steps on their own. New HUD moods `buildings-view` and
  `grimoire-unlock`. Unit tests in `tests/unit/grimoire-unlock.test.ts`
  and `tests/unit/priority.test.ts`.
- **4.7.0** Two new sliders, "Frame opacity" and "Overlay opacity" (0.1-1,
  UI-9), let the frames (main panel/Graphs/Logs/Debug) and the canvas
  overlay (hitboxes, "how good is a buy" boxes, the paw) be made more
  see-through. Frame opacity is a CSS variable (`--ccsb-frame-opacity`,
  `applyFrameOpacity()` in `src/ui/styles.ts`) read by the four frame
  elements' `opacity`; overlay opacity is applied as `ctx.globalAlpha` at
  the top of `OverlayLoop.tick()` (`src/scheduler/overlay-loop.ts`) before
  drawing hitboxes/buy-value/paw, none of which touch `globalAlpha`
  themselves. Both are staged settings like every other slider (UI-4):
  their live percentage readout (`updateRangeReadout()`,
  `src/ui/settings/settings-panel.ts`) updates as the slider is dragged,
  but the opacity itself only takes effect on Save. New unit tests in
  `tests/unit/normalize-setting.test.ts` cover the 0.1-1 clamp and
  defaults.
- **4.6.2** Fixed: the bot could spend a sugar lump refilling Grimoire
  mana even when Wizard towers cap max mana (`magicM`) below FTHOF's
  current cost — refilling only ever tops mana off to that cap, so the
  lump was spent for nothing since FTHOF still couldn't be cast
  afterward. Added `refillCanReachCost()` (`src/game/grimoire.ts`) and
  wired it into all three places that decide/guard a refill:
  `fthofOrRefillPending()` (`src/hunting/fthof.ts`), the refill branch of
  `selectJobRequest()` (`src/scheduler/priority.ts`), and
  `RefillAction.abortIf()` (`src/actions/fthof.ts`) — the same
  three-call-site pattern as 4.6.1's cooldown/lumps fix, since a refill
  that can never help is exactly as wasteful/blocking as one that's
  outright impossible. Spec FT-3 updated to say so explicitly. New unit
  tests in `tests/unit/fthof.test.ts`, `tests/unit/actions.test.ts` and
  `tests/unit/priority.test.ts` cover a Wizard-tower-limited max mana
  below cost.
- **4.6.1** Fixed: hammer mode (and everything below it — lump harvest,
  auto-shop, dance, idle) could go completely dead outside of a real
  Click Frenzy whenever the bot had >= 2 CpS buffs and low mana but a
  sugar lump refill wasn't actually possible (still on the game's
  15-minute cooldown, or 0 lumps in stock) — exactly the "buff combo
  without Click Frenzy" case reported. `fthofOrRefillPending()`
  (`src/hunting/fthof.ts`) and the matching refill branch in
  `selectJobRequest()` (`src/scheduler/priority.ts`) only checked buff
  count / mana / LOCK_A / refill-in-flight, unlike `RefillAction.abortIf()`
  (`src/actions/fthof.ts`) and FT-3's own spec, which both also require
  `canRefillLump()` and `getLumps() >= 1`. Every 25ms tick the scheduler
  kept re-selecting a refill job that immediately self-aborted, winning
  priority tier 3 over hammer mode (tier 6) each time without ever
  actually doing anything. Both call sites now check the same
  cooldown/lump preconditions as the action itself, so an impossible
  refill correctly falls through to hammer mode/lump harvest/auto-shop/
  idle instead of starving them forever. New unit tests in
  `tests/unit/fthof.test.ts` and `tests/unit/priority.test.ts` cover the
  cooldown and no-lumps cases.
- **4.6.0** Reworked the auto play purchase strategy: 4.5.7 and 4.5.8
  each patched the payback-cap relief further to cover cases where auto
  play sat on an enormous, flush bank and still refused its own
  best-ranked, affordable purchase — and it kept recurring one tier up
  (a golden upgrade, then a grandma upgrade, then a plain biscuit
  upgrade) because the underlying model was wrong, not just mistuned.
  `autoDecide()` (`src/autoplay/strategy.ts`) no longer has an absolute
  payback ceiling at all: `autoMaxPaybackSec` is removed as a concept and
  as a setting (config key, UI row, defaults, clamp). Every candidate
  reaching the function already passed AUTO-2/AUTO-3's classification —
  never the research center, always a real, positive `dCps` — so a slow
  payback is simply not a reason to refuse an otherwise-affordable
  purchase; it only affects ordering (best payback first) and what counts
  as worth deliberately saving for. "In reach" (AUTO-5) is now purely a
  time-window check (`wait <= autoReachSec`), not a profitability one.
  The one thing kept from the old model is the postponement guard: a
  much-bigger, much-more-impactful not-yet-affordable option can still
  hold back an ordinary small purchase so the bank doesn't get chipped
  away from ever affording it — insignificant and preferred purchases
  remain exempt. `autoInsignificantSec`'s formula is also simplified: it
  used to be `max(insignificantSec x income, 0.1% of bank)`; it is now
  just `insignificantSec x CpS` (default raised from 1s to 60s of CpS —
  "worthless junk"), and `AUTO_BANK_FRACTION` is removed as unused.
  Net effect: whenever nothing is being saved for, auto play now buys
  every affordable, viable option highest-score-to-lowest each tick,
  same as the "how good is a buy" overlay already ranks them (BUY-2),
  instead of getting stuck reporting "nothing in reach" while sitting on
  an idle fortune. Unit tests in `tests/unit/strategy.test.ts` rewritten
  for the new model (15 tests, was 18 patched-model tests).
- **4.5.8** Fixed a gap in 4.5.7's fix: the fixed 20× ceiling on the
  payback-cap relief (`AUTO_PAYBACK_SURPLUS_CAP_MULT`) still undershot for
  an expensive late-game purchase — e.g. a grandma cofactor upgrade
  costing ~10% of a huge, flush bank — whose absolute payback is long
  purely because it costs a big slice of an even bigger bank, not because
  it's a bad deal (it was still the single best-ranked option on offer).
  `autoDecide()` (`src/autoplay/strategy.ts`) no longer bounds the relief
  to a fixed multiple of `autoMaxPaybackSec`; on a flush bank it instead
  stretches the cap to at least cover the single best payback currently on
  offer (x `autoGoodFactor`), computed fresh from that tick's candidates.
  This still refuses a clearly worse deal sitting next to a much better
  one (the cap tracks the best offer, not an arbitrary ceiling), and a
  bank that isn't flush is unaffected either way. Removed the now-unused
  `AUTO_PAYBACK_SURPLUS_CAP_MULT` constant. New unit tests in
  `tests/unit/strategy.test.ts` cover the expensive-but-best-available
  case and the still-refused clearly-worse-deal case.
- **4.5.7** Fixed: auto play could report "nothing in reach" forever once
  every remaining purchase's payback exceeded `autoMaxPaybackSec` (24h
  default), even while sitting on a bank far larger than any income-based
  savings plan would need — e.g. a bank fattened mostly by golden-cookie/
  FTHOF windfalls rather than steady CpS, which this bot is specifically
  good at producing. `autoDecide()` (`src/autoplay/strategy.ts`) now
  computes a `paybackCap` that stretches past `autoMaxPaybackSec`, up to
  `AUTO_PAYBACK_SURPLUS_CAP_MULT` (20×, `src/autoplay/valuation-tables.ts`)
  x that, when the available bank holds more idle cash than the current
  income could have produced within `autoMaxPaybackSec` itself — that
  surplus isn't savings for anything specific, so a payback a few days
  out still beats 0% return from hoarding. A bank only modestly ahead of
  income is unaffected (the cap only ever stretches, never shrinks below
  `autoMaxPaybackSec`), and the 20× ceiling still refuses truly bad deals
  regardless of bank size. New unit tests in `tests/unit/strategy.test.ts`
  cover both the relief and its ceiling.
- **4.5.6** Fixed the real bug behind 4.5.2-4.5.5: `autoDecide()` itself
  (`src/autoplay/strategy.ts`) only ever populated `save` when `buy` was
  `null` for that call, so the overlay's `decision.buy ||
  decision.save`/independent-row-check logic from 4.5.5 still flickered —
  the save-target box vanished every tick some unrelated affordable
  purchase (an insignificant buy, a preferred Wizard tower, ...) also
  went out, then reappeared once that purchase cleared. `save` is now
  computed once, unconditionally, from the same "not affordable yet, in
  reach" candidates regardless of whether `buyable.length` is also
  nonzero this tick, so the two boxes are now genuinely independent, as
  intended by 4.5.5's "draw for both if both are ever present". New unit
  test in `tests/unit/strategy.test.ts` covers an affordable preferred
  buy landing the same tick as an unrelated, bigger save target.
- **4.5.5** "How good is a buy" overlay: the highlight box is drawn for
  `decision.buy` and `decision.save` independently (both get it if both
  are ever present) instead of picking one via `||`, and made thicker
  (5px, was 3px).
- **4.5.4** Reworked the 4.5.2/4.5.3 highlight rule: it now marks the
  intended NEXT purchase, whether that is something being saved up for
  (`decision.save`) or something already affordable and about to be
  bought outright (`decision.buy`) — including an item that was never
  saved for because it was affordable right away. Replaces the sticky
  `runtime.buySaveTargetKey` tracking from 4.5.3, which only bridged the
  save→buy transition and still missed instant buys; comparing directly
  against `decision.buy || decision.save` covers both without extra
  state.
- **4.5.3** Fixed: the "how good is a buy" save-target highlight (4.5.2)
  disappeared the instant the saved-for item became affordable and the
  paw started moving to buy it, because `decision.save` goes back to
  `null` the moment `autoDecide()` returns a `buy` instead. The highlight
  is now sticky (`AutoPlayEngine.updateSaveTarget`/`isSaveTarget`,
  tracked by `runtime.buySaveTargetKey`): it stays on the same option
  through the purchase itself and only clears once that option is no
  longer a candidate at all (i.e. actually bought).
- **4.5.2** "How good is a buy" overlay: the item currently being saved for
  (`decision.save`) now gets a solid, thicker outline (3px, no dash)
  instead of the usual dashed one, so it stands out from the rest of the
  ranked boxes.
- **4.5.1** Removed the HUD "dock" chips (FTHOF / REFILL) that used to
  appear under the settings panel as a fallback movement target when the
  real Grimoire buttons weren't on screen. The cast/refill click still
  fires directly on the real control either way (FT-7); the paw just no
  longer has a dedicated fallback spot to visit first, and stays where it
  is instead.
- **4.5.0** New module: automatically harvests ripe sugar lumps. The paw
  clicks the growing sugar lump icon (`#lumps`) the moment it turns ripe
  (`Game.lumpT` age in `[lumpRipeAge, lumpOverripeAge)`), instead of
  leaving it to the game's own slower overripe auto-harvest roughly an
  hour later; it deliberately never clicks while only "mature" (that
  gambles a 50% botched harvest). Priority: below FTHOF/refill, above
  auto play shopping; not gated by Auto play. New debug tool "Ripen
  growing sugar lump" forces the current lump into its ripe window for
  testing. New HUD stat "Sugar lumps harvested".
- **4.4.6** Simplified the non-shy behavior: removed the cursor-jump,
  ring trigger, slack averaging, wiggle detection and excited-magnitude
  changes. Non-shy now ignores the human cursor entirely, and a trusted
  click on the paw (within 160px/800ms) triggers a small happy dance in
  place. Shy still flees when the cursor gets within 60px.
- **4.4.5** Petting made much easier to trigger: any 25px of mouse path
  within 1000ms and 180px of the paw centre counts as a wiggle (no
  back-and-forth requirement), click-petting window widened to 3000ms and
  180px, the cuddle dance lasts 2600ms, and excited hop/sway/tilt now
  reaches ~1.9x.
- **4.4.4** Petting is easier and has a click alternative: wiggle
  detection is now 35px of wiggle within 1000ms and 160px of the paw
  centre (was 60px/700ms/120px), and clicking the paw 3 times within
  2500ms and 160px also triggers the excited dance. Trusted clicks are
  recorded by the bootstrap and pruned after 5s.
- **4.4.3** Cuddle targeting fixes: the paw now lands with its sprite
  centre exactly on the (slack-averaged) human cursor instead of next to
  it; the cuddle trigger is a ring (60-120px from the paw centre) instead
  of a close circle, so an already-close cursor doesn't cause a pointless
  jump; the approach is a calmer 800px/s (max 1200ms) and only starts
  after the real mouse has been still for 500ms.
- **4.4.2** Pondering polish: the cuddle approach is now a quick hop
  (2000px/s, max 600ms) toward a slack-averaged cursor position (350ms
  window) instead of an idle-speed stroll toward the raw position, and a
  4.5s grace period after a cuddle keeps petting wiggles from immediately
  shooing the paw away. Idle ponder/drift/visit motion now keeps the whole
  paw sprite inside the viewport (`clampPawPoint`, 68px margin).
- **4.4.1** The paw now has a time-based social mood while pondering:
  `pawMoodAt()` passes the timestamp through a sine function with a
  threshold (120s period, threshold 0). When the real cursor gets close,
  a shy paw relocates somewhere far away (as before) while a cuddly paw
  comes over and does a small happy dance next to the cursor. Wiggling the
  mouse near the paw during that cuddle dance pets it and makes the dance
  faster and bigger (warped dance clock, up to ~1.5x hop/sway/tilt).
- **4.4.0** While pondering, the paw now relocates somewhere else entirely
  when the real human cursor gets within 60px of it (tracked from trusted
  mousemove events only) — one relocation rather than a continuous
  antigravity-style repulsion. It picks a random spot at least 320px from
  the human cursor and keeps pondering there, with a 2.5s cooldown after a
  relocation so a stationary user cursor doesn't make it flee repeatedly.
- **4.3.1** Renamed the Wizard tower limit setting to
  `autoWizardTowerTarget` and made Wizard towers below that target top
  purchase priority: they are bought whenever affordable, ignoring
  `autoMaxPaybackSec` (mana value), but only while in reach
  (`wait <= autoReachSec`) so the bot never saves up for them indefinitely.
- **4.3.0** Auto play now prefers Wizard towers until their cap and golden
  cookie upgrades over ordinary purchases; the Wizard tower cap is exposed
  as the setting `autoWizardTowerCap` (default 57, range 0-500).
- **4.2.1** Removed the debug tool "Auto play: explain store (log)" and
  its handler.
- **4.2.0** All UI frames (main HUD, Graphs, Logs, Debug tools) are now
  draggable by their title/header bar; each frame remembers its own
  position in the saved UI state.
- **4.1.3** Debug tool "Spawn Cookie Chain" now spawns a REAL cookie chain:
  the first cookie is marked as the spawn lead (`spawnLead = 1`) and forced
  to `chain cookie`, so the game restarts its golden-cookie spawn timer
  after the click and the chain continues. Previously it spawned a single
  forced cookie that ended the moment it was clicked.
- **4.1.2** Fixed: golden cookies were ignored because `CursorManager`
  called action `target` getters without their `this` binding, so
  `GoldenCookieAction.target()` threw (and was swallowed), cancelling the
  job right after the reaction delay. Getter targets are now invoked with
  the action as `this`; regression test added.
- **4.1.1** Removed the debug tool "Reset FTHOF cooldown" — it was just
  a weaker duplicate of "Fill Up Mana" (the game has no real FTHOF
  cooldown, only the mana cost).
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
