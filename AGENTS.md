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

Never launch the local test server (the Cookie Clicker copy served over
HTTP for in-game checks) or drive the game in a browser unless the user
asks for it. After a change: `make typecheck`, `make test`, `make build`,
then stop.

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
shows all of that through a little paw cursor, a HUD, charts and logs. With
the ON-by-default setting "Play the stock market" it also trades on the
Bank's stock market (STOCK-\*), and with "Tend the garden" (also on by
default) it keeps the Farm's garden planted (GARDEN-\*). It also ships "debug tools" (cheats) to
test the hunter on a test save.

Out of scope: seasons (switching them; auto play does buy the Easter egg
upgrades a season drops, EGG-\*, and the Christmas upgrades, evolving Santa,
XMAS-\*), breeding garden seeds on purpose (GARDEN-9), pantheon, the stock market's offices and loans (STOCK-8), challenge modes and permanent
upgrade slots when ascending (auto play ascends by itself unless "Auto:
ascend" is switched off, ASC-10; without auto play the ascension plan is
only shown), and any
Grandmapocalypse beyond stage 1 (WRINK-1).
Buying is only done by the optional, OFF-by-default "Auto play" mode
(AUTO-\*) and even then only through the game's own buy functions, and by
the stock market trader (STOCK-\*, on by default), which only uses the
market's own buttons. The bot
NEVER clicks anything except: good golden cookies, reindeer (XMAS-6), the big cookie, the
FTHOF spell button, the lump-refill button, a ripe sugar lump, the
Options/Stats menu buttons and the "View Grimoire" button needed to get the
FTHOF spell on screen (FT-8), with "Play the stock market" the "View Stock
Market" button, the market's buy/sell buttons and its "Hire" (broker)
button (STOCK-\*), with "Tend the garden" the "View Garden" button, the
garden's plot tiles, seeds and soils (GARDEN-\*), and — in auto play only —
the Wizard tower's "lvl" button (AUTO-13), the Bank's "lvl" button
(AUTO-16), the Farm's "lvl" button (AUTO-17), mature wrinklers (WRINK-5), Krumblor's tab,
popup and aura picker (KRUMB-3) and Santa's tab, "Evolve" button and popup
"x" (XMAS-4), and with "Auto: ascend" the Legacy button, the "Ascend" /
"Reincarnate" prompts, heavenly upgrade crates and the Reincarnate button
(ASC-10) (the paw only "visits" store items, AUTO-9; auto play also sells
Wizard towers it bought for a butter biscuit back through the game's `sell()`,
BUTTER-\*).

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
| Krumblor | the cookie dragon, unlocked by the upgrade "A crumbly egg" (in the store once the heavenly upgrade "How to bake your dragon" is owned and 1M cookies are baked). `Game.dragonLevel` 0-4 are egg levels paid in cookies (1M × 2^level), training from each level 5-13 sacrifices 100 of one building (`Game.ObjectsById[level − 5]`: cursors for Dragon Cursor, grandmas, farms, mines, factories, banks, temples, wizard towers, shipments for Dragonflight); aura `id` is known from level `id + 4`. |
| Santa | the Christmas special, unlocked by the upgrade "A festive hat" (in the store during Christmas season once 25 cookies are baked). `Game.santaLevel` 0 (Festive test tube) to 14 (Final Claus); evolving from level `l` costs `(l+1)^(l+1)` cookies and unlocks one Santa gift (`Game.santaDrops`), which costs `2525 × 3^santaLevel`. |
| prestige level | `Game.prestige`; each level is +1% CpS (at full heavenly potential) and one heavenly chip. Ascending sets it to `floor(((cookiesReset + cookiesEarned) / 1e12)^(1/3))`, the game's `Game.HowMuchPrestige` (`Game.HCfactor` = 3). |
| pending level | the prestige level ascending right now would give; pending − current = the levels (and chips) gained. |
| lucky level | a prestige level containing enough 7s ANYWHERE in its digits for a lucky heavenly upgrade: >= 1 for Lucky digit (777 chips), >= 2 for Lucky number (77,777), >= 4 for Lucky payout (77,777,777). This is the game's `showIf` (`(Game.prestige+'').split('7').length-1`), checked on the ascension screen against the new level. |
| stagnating | a run whose marginal prestige rate (levels per hour at the current income) has fallen below its average rate since the run started: ascending now maximises levels per hour (ASC-3). |
| stock market | the Bank's minigame (unlocked by Bank level 1): goods tied to buildings, bought and sold at prices in "$" = seconds of `Game.cookiesPsRawHighest`; one market tick per minute. |
| resting value | the price a good drifts back to (1% of the gap per tick): `10 + 10 × id + Bank level − 1` (`M.getRestingVal`). The trader measures prices against R = resting value + 10. |
| overhead | buying a good costs its price × (1 + 20% × 0.95^brokers); selling has none. |
| mature | a wrinkler that has digested for >= "maturity" × the respawn time (estimated as `sucked / (CpS × cpsSucked)`). |

## 3. Functional requirements

Each requirement has an ID. "Acceptance" says how to check it; "Debug"
points at the Debug tools button that makes the check easy, and (since the
refactor) which `tests/visual/scenarios.mjs` scenario exercises it.

### 3.1 Golden cookies

- **GC-1** Only good golden cookies (and reindeer, XMAS-6) are clicked. Wrath cookies are never
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
- **GC-7** Golden cookies have ABSOLUTE priority (see SCHED-1), with one
  exception: a committed ascension (ASC-12) outranks them and they are not
  clicked while it runs.
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
- **CF-7** Buff combo: while at least two positive buffs run at once (a
  buff with `multCpS > 1` or `multClick > 1`: Frenzy + Building special,
  Frenzy + Dragonflight, ...; `buffComboActive()`, `BUFF_COMBO_MIN`) the
  big cookie is hammered like CF-1 (same rate, jitter and step), with or
  without auto play. Only the Grimoire (FTHOF, its FT-8 preparation, the
  refill) outranks it; it outranks a ripe sugar lump and all of tier 5
  (auto play, the stock market, the garden: a payout crop's harvest,
  GARDEN-5, waits until fewer buffs are left), and between two clicks
  nothing below it gets the paw (`JOB_PRIORITY.BUFF_COMBO`). A Click
  Frenzy in the combo is plain CF-1. The Chasing row reads "big cookie
  (buff combo)".
- **CF-8** Dragonflight (clicks ×1111, from the dragon's aura) is treated
  exactly like a Click Frenzy everywhere: hammered at CF-1's rate with the
  frenzy's priority, no FTHOF cast or refill while it runs (FT-1/FT-3/FT-4;
  the game lets a new Click Frenzy and Dragonflight supersede each other),
  and every "during Click Frenzy" gate (AUTO-7, WRINK-4, ...) holds for it
  too (`IGameAdapter.clickFrenzyActive()` is true for either buff). In the
  logs it still reads "click frenzy".
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
  own: no FT-3 refill, no AUTO-13 Grimoire unlock (Wizard tower level
  1), no AUTO-16/AUTO-17 unlock of the stock market or the garden. Nothing switched off is pending, blocks lower tiers or complains in
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
- **LUMP-5** Priority: below FTHOF/refill and a buff combo (CF-7), above auto play shopping (see
  SCHED-1). Not gated by Auto play — it runs whether or not Auto play is
  switched on, since it is not "buying" (§1).
- **LUMP-6** Each successful harvest is recorded (`stats.lumpHarvests`,
  shown in the HUD statistics row) and logged (`"harvest sugar lump"`).
  Debug: "Ripen growing sugar lump" / DBG-8.
- **LUMP-7** Not while ascending (the intro or the ascension screen): the
  lump isn't there to click, and a ripe lump must not hold back the
  ascension at the tier below (ASC-10).

### 3.6 Scheduling and priority

- **SCHED-1** Priority, highest first:
  0. a committed ascension (ASC-12: its preparation, the hold at Legacy,
     Legacy/"Ascend"); while it runs nothing else does, not even golden
     cookies
  1. good golden cookies (queue)
  2. real Click Frenzy clicking
  3. FTHOF cast (and its FT-8 preparation steps), then lump refill, then
     hammering through a buff combo (CF-7)
  4. a ripe sugar lump (LUMP-\*)
  5. a buildings-view recipe already under way / the "Show grimoire"
     debug goal (DBG-9/11), then the auto hammer's kick-off after the
     Heavenly key (AUTO-19), then auto play: an ascension under way on the
     ascension screen (ASC-10), then the Grimoire unlock (AUTO-13), then the
     stock market unlock (AUTO-16), then the garden unlock (AUTO-17),
     then a Krumblor step (KRUMB-\*), then a Santa step (XMAS-4), then a
     butter biscuit top-up (BUTTER-\*), then a stock market trade (STOCK-\*, its own setting, with or without auto
     play), then a garden step (GARDEN-\*, likewise), then popping a wrinkler for a purchase (WRINK-3), then shopping
     (only when a purchase is due, AUTO-8)
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
- **PAW-2** Three embedded, upright SVG sprites sharing one frame (the arm
  stays put when the pose changes): open paw; a closed fist that replaces
  it for the whole click pulse; and a peace sign shown while the paw does
  a happy dance (DANCE-\*, IDLE-7; `runtime.pawPeace`, the fist still wins
  during a click pulse). If a sprite cannot load, a small drawn paw (or,
  for the fist/peace sign, the open paw) is used. Click point = the open
  paw's middle claw tip.
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

### 3.8a The hunting show (osu! mode)

An over-the-top, purely cosmetic layer on the overlay canvas while golden
cookies or reindeer are around (`HuntFx`, `src/rendering/hunt-fx.ts`, driven
by `OverlayLoop`). It never touches the game and never changes what or when
the paw clicks.

- **FX-1** ON by default, opt-out via the setting "Over-the-top hunting
  show (osu! mode)" (`huntFx`); needs "Pretty overlays" (PAW-5) and follows
  the overlay opacity (UI-9). Active while a catchable shimmer is ready or
  fading in, during a cookie storm or chain, and ~2.5s after a catch; then
  it fades out and draws nothing. While active: sweeping, hue-cycling
  spotlights from the screen edges and a vignette pulsing on a 140 BPM beat
  (more beams, wider sweep in a storm/chain), a soft spotlight on every
  waiting cookie, a rainbow trail behind the paw, and osu! follow points
  (chevrons drifting along the planned route, GC-5).
- **FX-2** Every queued good shimmer gets an osu! hit circle (its route
  number inside, the same number as the GC-2 box) and an approach circle
  shrinking from 3.5× to 1× between the moment it became ready and the
  planned click (click delay + pre-click pause + ~250ms trip, × the hurry
  factor), then beating on the circle. Pending ones get a spinning dotted
  ring that fills with their fade. GC-2's boxes stay as they are.
- **FX-3** A catch (`GoldenCookieAction`, via `runtime.huntFxEvents`):
  a particle burst (snowflakes for a reindeer), stars, two shockwave rings,
  a "300" judgement with the effect shouted under it ("LUCKY!!", "CLICK
  FRENZY!!!", "HO HO HO!!" for a reindeer) and a short radial screen flash.
  A cookie storm drop only gets a small burst and ring.
- **FX-4** Multiplier: bottom left, where osu! shows its combo, the CpS
  multiplier of every active buff together (the product of their
  `multCpS`, `buffMultiplier()`): "7x" during a Frenzy, "70x" with a
  Frenzy and a 10x Building special, a red "0.5x" during a Clot. Gold,
  pops up for 8s after a catch or when it changes (bumping, fading out
  over the last second), hidden at 1x. A cookie or reindeer that got away shows a
  red "X" / "MISS" (the combo, which only picks the circles' colours,
  resets; 60s without a catch resets it too). A banner "COOKIE STORM!!!" /
  "COOKIE CHAIN xN!!" in rainbow at the top during a storm/chain.
- **FX-5** Switched off (or with "Pretty overlays" off) nothing is drawn
  and queued events are dropped.
- **FX-6** Photosensitivity: flashes are at most one per 350ms, low alpha
  (0.22) and 180ms long; nothing strobes. With `prefers-reduced-motion`
  there is no flash and no sweeping beam.
- **FX-7** Performance: at most 500 particles, at most 32 queued events,
  events older than 1s when drawn (a background tab coming back) are
  dropped without a show.

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
  wrath), Click Frenzy, Grimoire, Wrinklers (WRINK-7), Ascension (ASC-5),
  Stock market (STOCK-7), Garden (GARDEN-8), Auto play, then a "Details" fold (`<details>`,
  collapsed by default, session-only) with Buffies, LOCK_A, Click cooldown
  and Background, then the statistics.
- **UI-3** Buttons: Pause/Resume, Hammer cookie, Auto play, "Pause
  investments" and "Cash stock market wins" (STOCK-9, only when they
  apply), Settings, "More..."; "More..." toggles a second row (session-only, closed at start)
  with Graphs, Logs and Debug tools. The Debug tools button only shows with
  the Advanced setting "Show debug tools (cheats)" (`showDebugTools`, OFF by
  default); switching it off also closes the debug frame.
- **UI-4** Settings are STAGED: editing only marks "unsaved"; "Save
  settings" (or Enter) validates, clamps, applies and stores them at once.
- **UI-11** Settings are split into "Basic" (what a nontechnical player
  would touch: the on/off switches for overlays, the hunting show, idle
  play, keep-alive, FTHOF, lumps, the stock market and the garden, the stock budget,
  the dance length and the two opacities) and an "Advanced" section
  (timings, speeds, click rates, history/log sizes, the ascension tuning),
  a `<details>` collapsed by default. The auto play settings are split the
  same way: basic are its on/off switches (manage hammering,
  grandmapocalypse, pop wrinklers, Krumblor, ascend); advanced are all its
  numbers, "spend the bank on achievements" and the dry run. "Show debug
  tools" (UI-3) sits in the general Advanced section. Session-only:
  every Advanced section starts collapsed after a reload.
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
- **DBG-17** Unlock all halloween upgrades: unlocks every Halloween cookie
  (`Game.halloweenDrops`: Skull, Ghost, Bat, Slime, Pumpkin, Eyeball and
  Spider cookies, normally random drops from popped wrinklers during
  Halloween season) that is neither unlocked nor bought, so all of them sit
  in the store. They are ordinary cookie upgrades (+2% CpS, fixed price),
  so auto play buys them as biscuits (AUTO-2). Fails in red when every one
  is already unlocked or bought.
- **DBG-18** Unlock all christmas upgrades: unlocks every Christmas upgrade
  that is neither unlocked nor bought: "A festive hat", the 14 Santa gifts
  (`Game.santaDrops`), the 7 reindeer biscuits (`Game.reindeerDrops`) and
  Santa's dominion, so all of them sit in the store (XMAS-\*). Buying the hat
  adds Santa's tab, so Santa's evolution can be tested outside Christmas
  season. Fails in red when every one is already unlocked or bought.
- **DBG-19** Spawn reindeer: one reindeer shimmer runs across the screen
  (`new Game.shimmer('reindeer')`, works in any season), and the paw
  catches it (XMAS-6). Fails in red if the game has no reindeer shimmer
  type.
- **DBG-20** Unlock all valentines upgrades: unlocks every Valentine's heart
  biscuit (`Game.heartDrops`: Pure, Ardent, Sour, Weeping, Golden, Eternal
  and Prism heart biscuits, normally unlocked one after another during
  Valentine's season, each once the previous one is bought) that is neither
  unlocked nor bought, so all of them sit in the store. They are ordinary
  cookie upgrades, so auto play buys them as biscuits (AUTO-2/AUTO-3). Fails
  in red when every one is already unlocked or bought.
- **DBG-21** Show update popup: shows the UPD-2 popup at once, as if
  GitHub's latest release were version "DUMMY" (no request is made; its
  button links to a release that doesn't exist).
- **DBG-22** Stock market: next tick now: runs the market's next tick at
  once (`M.tick()`, the timer restarts), so STOCK-\* can be tested without
  waiting a minute per tick. Fails in red while the market is locked.
- **DBG-23** Stock market: crash prices: drops every active good to $3-5,
  just turned up (the graph's previous point $0.50 lower, drift up), so the
  trader buys at once (STOCK-3). Changes the save: use a test save. Fails
  in red while the market is locked or no good is active yet.
- **DBG-24** Stock market: speed x50 (on/off): the market ticks 50× faster
  (`M.secondsPerTick` 60 → 1.2s, the game's own speed cheat), so the trader
  (STOCK-\*) can be watched through hours of market in minutes; clicking it
  again, or a reload (the game doesn't save the speed), sets it back to one
  tick a minute. The HUD's "next tick in" follows it. The paw may need more
  than one fast tick for a trip; every click is re-planned right before it
  fires (STOCK-3), so a stale trade is simply dropped. Fails in red while
  the market is locked.
### 3.12 Console voice

The bot talks in the browser console, in the same cute style as the UI
(NFR-5), via `src/core/console-voice.ts`. Separate from the persisted
action log (UI-6); nothing here is stored.

- **CON-1** Happy lines (`sayYay`, `console.log`): GC-8's catch message,
  one short, personal greeting when the bot starts (`Bootstrap.start()`),
  `"Popped a stinky wrinkler! Yuckies!"` after each successful pop
  (WRINK-6), `"Krumblor wears Dragonflight now, zoomy clicky ^w^"`
  once the aura is on (KRUMB-5), and `"Santa is Final Claus now, ho ho ho
  ^w^"` once Santa reaches his last level (XMAS-4); a caught reindeer
  says `"Caught a reindeer!! Ho ho ho, gewd boy :3"` (XMAS-6); an
  automatic ascension says `"Ascending!! See you on the other side, cookies
  ^w^"` and, after reincarnating, `"Back in the mortal world, time to bake
  again :3"` (ASC-10); a stock sold for a profit says `"Sold CRL for a
  profit, stonks ^w^"` (STOCK-6); a harvest that unlocks a seed says
  `"Found a new seed: Thumbcorn!! ^w^"` (GARDEN-8); a butter biscuit top-up
  that worked says `"Unlocked the Milk chocolate butter biscuit, +10% CpS
  ^w^"` (BUTTER-2).
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
  - Stock market unlock wanted (AUTO-16): sugar lumps not unlocked, no
    lumps. Trading wanted ("Play the stock market" on): no Bank, market
    still locked (Bank level 0).
  - Garden unlock wanted (AUTO-17): sugar lumps not unlocked, no lumps.
    Gardening wanted ("Tend the garden" on): no Farm, garden still locked
    (Farm level 0).

  One-off events use `sayCant(msg)`: a golden cookie click that didn't pop
  it (not for storm drops) or a reindeer that ran away, a FTHOF/refill/lump click that did nothing,
  FT-8 preparation falling back to a direct cast, the Grimoire unlock,
  wrinkler popping, a stock market click that did nothing or a view step
  that failed (STOCK-5), a garden click that did nothing or a view step that
  failed (GARDEN-7), Krumblor training, Santa's evolution or an ascension
  pausing (with the reason), a heavenly upgrade the ascension skips, a purchase the shop refused,
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
  (`autoWizardTowerTarget`, default 57 — the ideal mana count for FTHOF;
  the only exceptions are Krumblor's sacrifice, KRUMB-2, and a butter
  biscuit top-up, BUTTER-\*, which sells them back);
  cursor and CLICKING upgrades: the "mouse and
  cursors twice as efficient" upgrades, the Thousand/Million/Billion/...
  fingers series and the mouse upgrades ("Clicking gains +1% of your
  CpS"); the heavenly potential unlocks (Heavenly chip secret, Heavenly
  cookie stand, Heavenly bakery, Heavenly confectionery, Heavenly key),
  valued as the prestige CpS bonus each one unlocks; and every grandma research
  upgrade that doesn't push the Grandmapocalypse past stage 1 (up to Exotic nuts; One mind,
  which starts stage 1, only with "Auto: grandmapocalypse stage 1" on, the default; WRINK-1). It NEVER buys Communal
  brainsweep, Elder Pact, Elder Pledge/Covenant or anything else that pushes
  the Grandmapocalypse past stage 1, and nothing it cannot classify.
- **AUTO-3** Value model per option: cost; approximate CpS gain `dCps`
  (buildings: per-building CpS × global multiplier; "twice as efficient":
  that building's CpS; biscuit: its power % of CpS, evaluated when the game
  gives it as a function, like the heart biscuits' 2%/3% with Starlove; golden upgrades: an
  assumed share of CpS; CLICKING upgrades are valued in cookies/s at the
  hammer rate × the Click Frenzy factor: click power × clicks per second ×
  `clickFrenzyFactor()`, so the cursor doubling upgrades are worth their
  click gain even with 0 cursors. The factor is 1 + 776 × the share of time
  a Click Frenzy runs (a golden cookie turns into one ~4% of the time,
  `AUTO_CLICK_FRENZY_CHANCE`, every ~10 min, halved by Lucky day and by
  Serendipity, for `estimateClickFrenzySec()`), at least ×7
  (`AUTO_CLICK_VALUE_MIN`: the bot's FTHOF casts add more frenzies), since
  every Click Frenzy multiplies click power ×777 and the paw hammers each
  one. It covers the cursor doublers, the fingers series, the mouse
  upgrades, the Cookie egg and Santa's helpers; the kittens also get the
  clicks their extra CpS adds through the owned mouse upgrades (their gain ×
  (1 + mouse share × the weighted click rate)); payback = cost
  / `dCps` ("rentability"); impact = `dCps` / CpS; wait = time to afford it
  at the income (CpS without buffs, minus the share withered by attached
  wrinklers, + the clicking income: the smoothed measurement, or while the
  hammer is on the hammer rate × the click power if higher, so waits are
  right from the first second of a run) after the reserve.
- **AUTO-4** Strategy (`autoDecide()`, `src/autoplay/strategy.ts`). The
  goal: the highest CpS in the shortest time. Big buildings and upgrades
  get there, but only once the income they need is there, which the
  smaller ones build up first. Every option gets payback = cost / `dCps`,
  wait (AUTO-3) and pp = wait + payback, the seconds from now until it has
  paid for itself; going for the lowest pp is the greedy rule for growing
  CpS fastest. A big purchase's wait shrinks as quicker purchases raise the
  income, and anything that pays for itself before the target would even
  be affordable has the lower pp, so it is bought on the way (with the bank
  covering it the target is reached after (T − bank + cost)/(income +
  dCps) instead of (T − bank)/income, sooner exactly when payback < the
  target's wait). Each tick:
  Impact bias: an ordinary purchase (not preferred, not insignificant)
  adding less than 0.5% of the CpS (`AUTO_IMPACT_REF`) counts its payback
  × (0.5% / its impact) in everything below (`DecisionRow.score`; +0.05%
  CpS counts 10× slower), since every purchase costs a trip of the paw and
  a pause in hammering: the lower tiers' tiny gains no longer keep the paw
  from the big purchases. The "how good is a buy" overlay ranks by the same
  score (BUY-2).
  (A) insignificant cost (<= `autoInsignificantShare` × the spendable
  bank, default 0.1%) is only a label now (the "why" in the log, the junk
  spree AUTO-18, Krumblor's and Santa's cookie costs); it is decided like
  everything else.
  (B) preferred candidates — the Bingo center (WRINK-1), golden cookie
  upgrades, the click power upgrades — "mouse and cursors twice as
  efficient", the Thousand/Million/... fingers series and the Plastic/
  Iron/... mouse series —, the kitten upgrades (`AUTO_PREF_TYPES`) and
  Wizard towers below `autoWizardTowerTarget` — are bought the moment they
  are affordable, in tier order (golden, click power and kitten upgrades
  first, then the Bingo center, then Wizard towers). Wizard towers are only
  preferred once at least 93% of the target is owned
  (`AUTO_WIZARD_PREF_SHARE`, 53 of 57) or while the next one is
  insignificant (A); before that they compete on payback like any other
  building, so the target can't hold back the next building tier.
  (C) The target to save for: the not-yet-affordable option with the
  lowest pp, however far off. The click upgrades get there on their value,
  which counts the Click Frenzies (AUTO-3, ×7 and more) and grows with the
  CpS. An achievement top-off (AUTO-15) is never a target. An ordinary
  affordable purchase is bought when it pays for itself before the target
  would (its score < the target's pp): that covers everything that pays back
  before the target is even affordable (it gets the bank there sooner) and
  every deal that is simply better than the target. A cheap, slower one (the
  next cursor, affordable every few seconds) can't eat the bank while the
  better one a few seconds off (the next grandma) waits. With nothing to save
  for, everything affordable is bought. Everything else waits.
  Among everything bought this tick: preferred first, then the biggest CpS
  gain first. One purchase per task (AUTO-7), so later ticks work down the
  same ranking. The target is reported ("saving for X", which also lowers
  the stock trader's budget, STOCK-4) only while it is in reach; a far-off
  one still decides what is held back. Checked in a simulated run from 0
  cookies to 10M CpS (`tests/unit/strategy-sim.test.ts`, with the cursor
  and mouse upgrades valued ×7): every CpS goal is reached at least as fast
  as by buying the best payback at once or the cheapest thing (1M CpS in
  ~4.3h instead of ~20h). Every other greedy variant tried (payback order,
  buying only the lowest pp, preferred not first) lands within 0.3% of it;
  a one-step lookahead (the next purchase that doubles the CpS soonest) and
  a limit of "pays back before the target is affordable" were slower.
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
  purchase per task (for a building, a streak of up to 100 single
  purchases, AUTO-14; then the junk spree, AUTO-18), >= 400ms between purchases; a failed purchase / an
  error pauses it (3s / 30s). "Auto play dry run" only logs what it WOULD
  buy.
  `shoppingAllowed()` checks the prompt itself, so shopping never starts a
  trip while one is open (the ascension's "Ascend" prompt, ASC-10).
- **AUTO-8** Priority: below golden cookies, Click Frenzy and
  FTHOF/refill, above hammer mode, dance and idle; a due purchase
  interrupts hammering and idle play at once.
- **AUTO-9** Presentation: the paw visits the store item if it is visible
  and does the click pulse (visual only: NO click is sent to the store);
  the purchase itself uses the game's buy functions, so store modes (sell,
  bulk) can never cause a mistake. The upgrade store sections (Upgrades,
  Switches, Research, Vault: `.storeSection`) show only one 60px row and
  open only on a real `:hover`, which synthetic events never trigger, so
  every time the paw gets to an upgrade it opens that section itself
  (class `ccsb-store-open`, `height:auto` like the game's hover rule), moves
  onto the crate, and closes the section again when it leaves (also when
  interrupted). A crate folded away in a collapsed row is reached through
  the section's visible strip (`storeApproachPoint()`,
  `src/game/store-dom.ts`; `enterStoreElement()`,
  `src/actions/store-visit.ts`). The store column itself (`#sectionRight`)
  scrolls on its own: an item scrolled out of it (a building far down the
  list, the upgrades above a scrolled-down list) is first brought into view
  by a separate job: the paw rests over the column and wheel-scrolls it
  until the item (or its collapsed section) sits in the middle
  (`storeScrollTarget()`, `storeScrollJob()`, `ScrollIntoViewAction` with
  the store column as its container); the visit follows on a later tick. A
  scroll that doesn't bring the item into view isn't retried for 10s
  (`runtime.storeScrollGiveUp`). The same applies to Krumblor's egg and
  buildings (KRUMB-3) and the achievement purchases before an ascension
  (ASC-13). The purchase is decided again once the paw is there (things
  change on the way: hammering stops, the bank moves) and BEFORE the press:
  the paw buys what it stands on when it is still the tick's pick, or still
  one of this tick's purchases and buying it first leaves enough for the
  pick (`shopPickAt()`, `src/autoplay/strategy.ts`); otherwise it neither
  presses nor buys and logs `"changed its mind at X"`. The pulse and the
  purchase happen at the same moment. HUD row "Auto play" shows the plan
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
- **AUTO-14** Buying streak: when the purchase is a building, the paw
  does not walk away after it. It stays on the row and buys the same
  building again, one ordinary purchase at a time (`buy(1)`, each with its
  own click pulse, NFR-8), at ~10 buys per second (±30ms jitter) with the
  press point wandering a few px around the row's centre (±8/±5px, capped
  to a quarter of the row). While 10 copies together are still pocket money
  (their sum price <= 1% of the spendable bank, or `autoInsignificantShare`
  of it if higher) and leave enough for the tick's pick, one press buys a stack of 10
  (`buy(10)`, `AUTO_STACK`, `autoStackSize()`); never for Wizard towers. Each further buy is re-planned from the live
  game (`autoCollect()` + `autoDecide()`) and happens only while that
  building is still the very purchase this tick would make
  (`autoStreakContinues()`, `src/autoplay/buy-streak.ts`), so the streak
  buys exactly what one purchase per task would, minus the walking. Long
  streaks come from AUTO-4's buy order: a pocket-money building stays on
  top until it isn't pocket money any more.
  At most 100 per visit; the usual visit before and the 400ms gap after
  (AUTO-7) stay; golden cookies, Click Frenzy etc. interrupt it within one
  buy. Every buy counts in `stats.autoBuys`; the streak is logged once as
  `"auto buy"` (`"37x Cursor"`, with `count` and the total cost). When the
  streak ends the visit goes on with AUTO-18.

- **AUTO-18** Junk spree: after a shopping visit's purchase (and its
  streak), the paw doesn't walk away either while cheap junk is left. It
  hops straight to the next of this tick's purchases (AUTO-4's buy order,
  never one held back) that is insignificant (<= `autoInsignificantShare` ×
  the spendable bank, default 0.1%) and on screen in the store, opens its section (AUTO-9),
  pulses and buys it, at the streak's ~10 per second, re-planned from the
  live game before every buy (`autoSpreeNext()`,
  `src/autoplay/buy-streak.ts`; `AutoPlayEngine.buySpree()`). A junk item
  is skipped when buying it would leave too little for the tick's pick
  (AUTO-9's rule); a building junk item streaks like AUTO-14. At most 300
  purchases per visit (`AUTO_SPREE_MAX`); anything more important
  interrupts it within one buy. So the flood of cheap items after an
  ascension goes out in one spree instead of one trip each. The visit is
  logged as one `"auto buy"` entry per run of the same item.

- **AUTO-19** Kick-off hammering: the moment a shopping visit of auto play
  has bought "Heavenly key" (the last prestige potential unlock, so
  normally right after an ascension), the paw hammers the big cookie for
  10s (`AUTO_KICK_UPGRADE`, `AUTO_KICK_MS`; `AutoHammer.startKick()` /
  `kicking()`, `runtime.autoHammerState.kickUntil`), whatever AUTO-11's
  estimate says, so the handmade cookies unlock the clicking upgrades (the
  mouse series) early. Meanwhile it outranks the rest of tier 5 (every
  other auto play step, the stock market and the garden; only a
  buildings-view recipe under way comes first) and does not give way to a
  due purchase; golden cookies, Click Frenzy, FTHOF/refill and a ripe lump
  still interrupt it, and the 10s run on regardless. Only with auto play
  and "Auto: manage hammering" on. Logged as `"auto hammer"` ("kick-off").

- **AUTO-15** Achievement top-offs: every building has count
  achievements (own 1, 50, 100, 150, ... of it; the unwon ones come from
  `building.tieredAchievs` and `Game.Tiers[tier].achievUnlock`,
  `IGameAdapter.getUnwonBuildingAchievementCounts()`). Each achievement is
  +1/25 milk, which every owned kitten turns into CpS, so a building a few
  copies short of one is valued as a project, like WRINK-1's research
  chain: the n copies still missing pay back `their total price / (n ×
  one copy's gain + the achievement's gain)` × 1.5 (`AUTO_MILESTONE_MARGIN`:
  in the same ballpark as a real upgrade, the upgrade wins), and each copy
  gets `dCps = its cost / that payback` when that beats its own gain. It
  never locks in: `autoDecide()` judges such a copy by the whole top-off
  (`projectCost`: "insignificant", the buy order and the "costs > 10% of
  the target" postponement all use what the missing copies cost together,
  not one cheap copy), and a top-off is never a save target, so the bot
  never waits or holds anything back for an achievement. The
  achievement's gain = CpS × Σ over owned kittens of `f × 1/25 / (1 +
  milk × f)`, at least a nominal 0.1% of CpS without kittens
  (`src/autoplay/achievement-milestones.ts`). So 98 cursors are topped
  off to 100 even when the two cursors alone would rank low, while a far,
  costly milestone changes nothing; never past a building cap (Wizard
  tower target). The HUD plan reads "buying Cursor (to 100 for an
  achievement)" and the `"auto buy"` log carries `milestone`.

- **AUTO-16** Stock market unlock: with auto play AND "Play the stock
  market" (STOCK-1) on, as soon as >= 1 Bank is owned, its level is still
  0, sugar lumps are unlocked and >= 1 lump is in stock, the paw spends one
  lump on Bank level 1 (which unlocks the stock market), unless "Spend sugar
  lumps" is off (FT-9). Exactly AUTO-13's recipe and guards, run by the
  Bank's `MinigameView` (goal "level", `src/hunting/minigame-view.ts`, the
  same planner the Grimoire uses): Options/Stats/Stats if a menu covers the
  buildings, wheel-scroll to `#productLevel5`, click it
  (`MinigameUnlockAction`, the lump confirmation suppressed); the same
  AUTO-7 gates, pauses (10s / 3s) and dry run ("would unlock"). Without
  "Play the stock market" a market nobody plays isn't worth a lump, so the
  Bank stays level 0. Priority: tier 5, right after the Grimoire unlock.
  Logged as `"auto bank unlock"`. `BankUnlocker`,
  `src/autoplay/bank-unlock.ts`.

- **AUTO-17** Garden unlock: with auto play AND "Tend the garden"
  (GARDEN-1) on, as soon as >= 1 Farm is owned, its level is still 0, sugar
  lumps are unlocked and >= 1 lump is in stock, the paw spends one lump on
  Farm level 1 (which unlocks the garden), unless "Spend sugar lumps" is off
  (FT-9). Exactly AUTO-16's recipe, guards, pauses and dry run, run by the
  Farm's `MinigameView` (`#productLevel2`). This is the only lump the bot
  ever spends on the garden: the Farm is never levelled further (the plot
  stays 2x2 unless the player levels it) and the garden's own lump refill
  is never clicked. Priority: tier 5, right after the stock market unlock.
  Logged as `"auto farm unlock"`. `FarmUnlocker`,
  `src/autoplay/farm-unlock.ts`; `BankUnlocker` and `FarmUnlocker` share
  `MinigameUnlocker` (`src/autoplay/minigame-unlock.ts`).

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
  the best, amber in between, so it re-ranks as the store changes. It
  follows what the bot wants to buy: the tick's pick and every preferred
  option (AUTO-4 B: the Bingo center, golden, click power and kitten
  upgrades, Wizard towers while they are preferred) score 100 whatever their payback, and
  are left out of the others' scale, which ranks by the payback the
  decision goes by, impact bias included (AUTO-4, `DecisionRow.score`;
  `buyValueRanks()`,
  `src/autoplay/buy-value-overlay.ts`). Uses the same scoring as
  `autoDecide()` (AUTO-3/AUTO-4), refreshed at most twice a second.
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
  (each grandma +0.02 base CpS per grandma; starts stage 1), and after it
  Exotic nuts (+4%; it only starts the research of Communal brainsweep, which
  is never bought, so it can't lead to stage 2). Nobody buys
  the Bingo center for "grandmas ×4": up to One mind a step is valued as
  part of ONE project, finishing the chain, and competes on payback like
  anything else (not preferred), except the Bingo center itself: it starts
  the research, and every minute it waits pushes stage 1 back by a
  minute, so it is preferred (AUTO-4 B, `AUTO_PREF_BINGO`: below the
  golden, click power and kitten upgrades, above Wizard towers), "starts
  the research" in the log; nothing else is held back for it. Payback =
  (cost of every step still to buy) / (stage 1 gain + the steps' own gains) + the delay until the
  wrinklers pay out; the step gets `dCps = its cost / that payback`, or its
  own gain if that is higher (Designer cocoa beans' +2% pays on its own). Stage 1
  gain = CpS × ((1 − 0.05n) + popMult × 0.05n² × m/(m+1) − 1 − 0.2/3)
  (n wrinkler slots, m = maturity, WRINK-2; minus the 1 in 3 golden
  cookies that turn wrath, golden cookies assumed worth 20% of CpS like
  Lucky day's valuation): about +400% with 10 wrinklers. Delay = the
  research still ahead (30 min each, 3 min with Persistent memory) + one
  respawn time (a slot filling) + m respawn times (digesting to maturity):
  ~8h from the Bingo center with the defaults. After One mind (and with the
  setting off), a step counts only its own gain
  (`src/autoplay/grandmapocalypse-valuation.ts`,
  `autoResearchCandidateGain()`). One mind's "are you
  sure?" prompt is confirmed like its own "Yes" button (buy with bypass).
  Communal brainsweep (stage 2), Elder Pact (stage 3), Elder Pledge, Elder Covenant and Revoke
  Elder Covenant are NEVER bought, whatever the
  settings: `autoCollect()` skips them and `autoBuy()` refuses them as a
  second guard. The game itself never escalates past what was bought (its
  random stage shifts are capped by the owned upgrades). Setting it off
  only stops buying One mind (the Bingo center is then no longer preferred;
  the other research is bought for its own gain); it does not undo a stage already reached (Elder
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

- **KRUMB-1** With auto play and "Auto: train Krumblor (Dragonflight)"
  (`config.autoKrumblor`, DEFAULT ON) on, the bot raises Krumblor up to
  the Dragonflight aura and no further: it buys "A crumbly egg" once it
  is in the store, pays the egg levels (1M, 2M, 4M, 8M, 16M cookies:
  "Chip it" ×3, "Hatch it", "Train Breath of Milk"), trains levels 5 → 14
  (Dragon Cursor ... Dragonflight), each sacrificing 100 of one building
  in `Game.ObjectsById` order (cursors, grandmas, farms, mines,
  factories, banks, temples, wizard towers, shipments;
  `DRAGON_SACRIFICE_BUILDINGS`), and puts Dragonflight on. No aura is put
  on along the way. Nothing without
  the egg (it needs the heavenly upgrade "How to bake your dragon").
- **KRUMB-2** Cookie costs (the egg, each egg level, buildings bought to
  reach 100) are only paid when they are insignificant (AUTO-4 A: <=
  `autoInsignificantShare` × the spendable bank) and leave the reserve (AUTO-6) alone, so
  the dragon never competes with real purchases. Every building is
  treated alike: right before its sacrifice every copy above 100 is sold
  (the 25% given back for the priciest ones pays for far more than
  rebuying the cheapest ones), and after it the sold ones are bought back
  before the next level (`runtime.krumblorRebuy`/`krumblorRebuyId`, as
  many as the bank pays; the rest is left to shopping). Fewer than 100:
  the missing ones are bought first (Wizard towers too, past
  `autoWizardTowerTarget`; after the sacrifice shopping rebuys them up to
  the target). Buying never happens while the store
  is in sell mode (the game's `buy()` sells then).
- **KRUMB-3** Like a human, one step per scheduler tick, re-derived from
  the live game each time (`nextKrumblorStep()`,
  `src/autoplay/krumblor-strategy.ts`), so a preempted step is simply
  picked up again: the paw opens the popup by clicking the dragon's tab,
  which the game draws on `#backgroundLeftCanvas` and hit-tests itself
  (`Game.UpdateSpecial`: x 24, y canvas height − 24 − 48 × tab count + 48 ×
  tab index, ±24px), clicks the popup's train button, the aura slot, the
  Dragonflight crate and "Confirm" in the "Set your dragon's aura" prompt,
  and finally the popup's "x" — real synthetic clicks (NFR-8 a). The egg
  purchase and the building sale/rebuy go through the game's API with the paw
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
- **KRUMB-5** The aura goes into slot 0 only while slot 0 is "No aura"
  or Dragon Cursor (what versions before 5.8.16 put on): any other aura
  the player picked is never replaced. Switching costs 1 of the
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

### 3.20 Christmas (auto play)

During Christmas season "A festive hat" (25 cookies) unlocks once 25
cookies are baked; bought, it gives Santa's tab and one random Santa gift.
Every Santa evolution unlocks one more gift, and Final Claus (level 14)
unlocks Santa's dominion. Clicked reindeer drop the 7 reindeer biscuits
(the paw catches reindeer, XMAS-6). Pure logic in
`src/autoplay/christmas.ts` and `src/autoplay/santa-strategy.ts`.

- **XMAS-1** Auto play always buys every Christmas upgrade, like any other
  candidate (AUTO-2..4); there is no separate switch. The reindeer
  biscuits are ordinary cookie upgrades (+2% CpS) and bought as biscuits;
  the hat, the 14 gifts and Santa's dominion are valued by
  `christmasUpgradeGain()`.
- **XMAS-2** Values: Increased merriness / Improved jolliness +15% CpS; A
  lump of coal / An itchy sweater +1%; Season savings (buildings 1%
  cheaper) +1%; Naughty list the grandmas' CpS (twice as efficient);
  Santa's helpers 10% of the clicking income at the hammer rate; Santa's
  legacy +3% CpS × (Santa level + 1); Santa's dominion +21% (20% CpS plus
  the discounts). Everything else (the hat, the three reindeer upgrades,
  Santa's bottomless bag, Toy workshop, Santa's milk and cookies) gets the
  nominal 0.1% of CpS.
- **XMAS-3** Order: a gift costs 2525 × 3^santaLevel, so every evolution
  triples the price of the gifts still in the store. The hat and the gifts
  are preferred (AUTO-4 B, bought whenever affordable) and Santa does not
  evolve while a gift waits unbought in the store. Santa's dominion (2.5
  quadrillion) is not preferred; it competes on payback.
- **XMAS-4** With auto play on, Santa evolves up to Final Claus and no
  further (`SantaTrainer`, `src/autoplay/santa.ts`): an evolution is paid
  when the bank holds more than its cost after the reserve (AUTO-6) and
  the cost is insignificant (AUTO-4 A) or pays back within 1h
  (`SANTA_MAX_PAYBACK_SEC`; gain = Santa's legacy's +3% if owned, plus for
  Final Claus Santa's dominion's +20% against its price on top). Like
  KRUMB-3, one step per scheduler tick re-derived from the live game
  (`nextSantaStep()`): the paw clicks Santa's tab on `#backgroundLeftCanvas`
  (same hit test as the dragon's tab), the popup's "Evolve" button, and
  finally the popup's "x" — real synthetic clicks (NFR-8 a). It only closes
  a popup it opened; it also closes its popup while waiting. Every
  evolution is logged (`"santa"`).
- **XMAS-5** Safety: same gates as AUTO-7 (golden cookie ready, Click
  Frenzy, storm/chain, FTHOF/refill pending, ascending, a prompt open,
  paused). A click that didn't do its job pauses evolving 3s, an element
  that doesn't show up for 5s pauses it 10s. Dry run only logs "would do".
  Priority: tier 5, after a Krumblor step, before wrinkler pops and
  shopping; a due step interrupts hammering and idle play like a due
  purchase (AUTO-8). Debug: DBG-18.
- **XMAS-6** Reindeer are caught like good golden cookies (GC-2..7): they
  join the same queue and route, get the same hitbox, click delay and
  pre-click pause, at the same absolute priority (`CATCHABLE_SHIMMER_TYPES`,
  `src/game/golden-cookie-model.ts`). Their fade curve uses the game's
  power 12 instead of 4 (visible almost at once). A reindeer runs left to
  right (the whole `Game.bounds` width over its lifespan) and bounces, so
  the paw LEADS it: its path is predicted from the game's own drawing
  formula (`reindeerCenterAhead()`, `src/game/reindeer.ts`) and the paw
  travels to where the reindeer will be once the trip, the pre-click pause
  and the press are over (`reindeerIntercept()`, a fixed point over the
  paw's average trip time). The paw then waits in its path, re-aims after
  the pause at where the reindeer will be at that planned moment, and
  clicks as it runs into the paw. A reindeer that would leave the screen
  before the paw gets there is let go. A
  catch is recorded as the effect "Reindeer" (stats, graphs with its own
  colour), logged (`"click reindeer"`), says `"Caught a reindeer!! Ho ho ho,
  gewd boy :3"` (CON-1) and may be followed by the happy dance (DANCE-1; a
  reindeer on screen also counts as a cookie present). Hurry mode and the
  cookie storm/chain checks still only look at golden cookies. Debug:
  DBG-19.

### 3.21 Ascension: planning, tips and auto ascension

The bot works out when ascending would pay off, at which level and what to
buy in heaven (ASC-1..9), and shows it. With auto play on (and "Auto:
ascend", on by default) the bot also ascends by itself (ASC-10). Pure logic in `src/autoplay/ascension-strategy.ts`,
`heavenly-shopping.ts` and `ascension-steps.ts`, the live planner in
`ascension.ts`, the automation in `ascension-runner.ts`, the overlay in
`ascension-overlay.ts`.

- **ASC-1** Pending level = `floor(((Game.cookiesReset +
  Game.cookiesEarned + the wrinklers' payout) / 1e12)^(1/HCfactor))`, the
  same computation the game uses when ascending (so a total exactly on a
  level boundary floors like the game does). The wrinklers' payout
  (digested × pop multiplier, shiny ones too) counts because the bot pops
  them all before ascending (ASC-10); the game throws them away on reset.
  Levels gained = pending − `Game.prestige`; chips after ascending =
  `Game.heavenlyChips` + that gain.
- **ASC-2** Income = cookies per second over the last 30 minutes, measured
  from the all-time cookie count (sampled every 5s), so CpS, clicks, golden
  cookie payouts and popped wrinklers all count and one combo is only a bump
  in it; unbuffed CpS until 2 minutes of history exist (e.g. after a
  reload).
- **ASC-3** Stagnation: the marginal rate (income × 3600 / the cookie cost
  of the next level) is below the run's average (levels gained / hours
  since `Game.startDate`).
- **ASC-4** Verdict, checked in this order: no level to gain → "no gain";
  below the ASC-8 boost → "too small"; not stagnating (ASC-3) → "growing";
  the shopping list (ASC-9) needs a level above the pending one → "waiting
  for level L to afford <wish>"; otherwise "would ascend now". So an
  ascension needs BOTH a noticeable boost (ASC-8) AND a run that stagnates
  (ASC-3): a run still making prestige quickly keeps going however big the
  boost already is; and then it waits until its heavenly shopping list is
  paid for, rather than ascending a few chips short.
- **ASC-8** Noticeable impact: the prestige CpS bonus after ascending
  (+1% per level, assuming full heavenly potential) must be at least
  "Ascend: minimum CpS boost (x)" (`ascendMinBoost`, default 2) times the
  bonus now. With 2: a first ascension needs 100 levels, 1,000 prestige
  needs 2,100. Merely breaking even never counts (e.g. 0 + 10 levels is
  x1.10).
- **ASC-9** Heavenly shopping list (`src/autoplay/heavenly-shopping.ts`,
  `planHeavenlyShopping()`): a hardcoded priority list of 41 heavenly
  upgrades (`HEAVENLY_PRIORITY`, names checked against the game's
  `main.js` 2.058; left out: permanent upgrade slots, the golden switch and
  other switches, cosmetics and extras the bot can't use). Walked in order
  from the first level worth ascending at (the pending level or the ASC-8
  level, whichever is higher); each wish is taken with every parent not
  owned yet (read live from `Game.PrestigeUpgrades`, 1 chip per level), as
  long as the run reaches a level paying for everything taken so far
  within "Ascend: wait for heavenly upgrades up to (s)" (`ascendShopWaitSec`,
  default 21600) AND the extra levels stay a small share of what the
  ascension gains anyway: "Ascend: wait for heavenly upgrades at most (x
  levels gained)" (`ascendShopWaitShare`, default 0.1: at +47,826 levels at
  most ~4,800 more), so the bot waits when it is a few chips short, never
  for a wish that would take a big part of another run (a wish already
  paid for at the current level needs no wait). The first ordinary wish that is too far off ends the list: its
  chips are kept for it, nothing below it is bought. The lucky upgrades are
  wishes too, but they also need a level with enough 7s (§2) — the lucky
  level for everything taken so far — within "Ascend: wait for a lucky
  level up to (s)" (`ascendLuckyWaitSec`, default 86400; the share cap
  does not apply to them: a missed lucky level is hard to get back, and the run keeps earning levels while it
  waits); one out of reach is skipped without ending the list. Result: the
  level to ascend at, the upgrades to buy there in buying order (parents
  first), the wish the run waits for, and the wish it saves for next.
- **ASC-5** Plain wording, one fact per line (`planLines()`,
  `src/autoplay/ascension.ts`), used by the HUD row "Ascension" (joined
  with "; "; hidden until there is prestige or a level to gain) and the
  Legacy card (ASC-6):
  (1) a headline that says what to do: "ASCEND NOW", "WAIT: ascend at level
  L (~ETA)", "NOT YET: prestige still comes in fast", "NOT YET: too few
  levels to be worth it" or "NOT YET: no prestige level to gain";
  (2) why, in plain words (e.g. "then the chips also pay for X", "N
  levels/h now, M levels/h on average this run", "CpS bonus would grow
  x1.10, wanted x2.00 (level 100, ~ETA)");
  (3) "Prestige: current -> pending";
  (4) "CpS bonus after ascending: xN" and "Heavenly chips to spend: N"
  (unspent chips + the levels gained);
  (5) only for ASCEND NOW / WAIT: "Buy in heaven: N upgrades (X chips)" and,
  for the next wish this ascension does NOT wait for, "Later: X (cost
  chips)" plus "N chips left over after buying = P% of it";
  (6) the ASC-11 "Paw:" line.
- **ASC-6** Overlay (with "Pretty overlays" and the setting "Show
  ascension overlay" on, `showAscendOverlay`, default on): a box around the Legacy
  button (`#legacyButton`), gold and solid for ASCEND NOW, dashed otherwise
  (amber WAIT, baby blue NOT YET while prestige still comes in fast,
  lavender the other NOT YETs), with a card under it. Collapsed by default
  to one line, the level after ascending and the answer ("Lv 54,369 ·
  ASCEND NOW" / "· WAIT" / "· NOT YET", `compactLine()`); while the real
  mouse is over the card itself (the canvas takes no mouse events, so it
  uses the tracked real mouse position, `runtime.userMouse`; the open card
  covers the collapsed one's spot, so it stays open while hovered) it shows
  all the ASC-5 lines (the headline in the box's colour). While the mouse
  is over the Legacy button itself, the box and the card are not drawn at
  all, so the game's own Legacy tooltip stays readable. The card's right edge sits on the
  Legacy frame's right edge, so it grows to the left and never into the
  store.
- **ASC-7** On the ascension screen, only while auto play is on, every
  heavenly upgrade on screen (`#heavenlyUpgrade{id}`) gets a box (without
  auto play the tree is left bare; the Legacy card, ASC-6, is unaffected): on the shopping list for the chips
  owned right now (ASC-9 without waiting) thick pink with its place in the
  buying order above it; otherwise owned faint lavender, buyable and
  affordable green, buyable but too pricey amber dashed, not available yet
  (parent missing) red dashed, lucky upgrades gold (solid when buyable and
  affordable). Unowned ones carry their price under the crate (a
  not-yet-available lucky one: how many 7s it needs); the Reincarnate
  button (`#ascendButton`) gets a box, the chips to spend and the list.
  Its card (`heavenScreenLines()`) says "BUY THE PINK ONES, in order (1, 2,
  3...)", "N upgrades for X of your Y chips", "then click Reincarnate" (or
  "NOTHING TO BUY: click Reincarnate"), the "Later:" lines and the Paw line.
- **ASC-11** Paw line (`AscensionRunner.botLine()`), always the last line
  of the HUD row and the cards, so nothing has to be guessed from a missing
  line: "Paw: auto play is off, so it won't ascend by itself", "Paw: "Auto:
  ascend" is off, so it won't ascend by itself", "Paw: dry run, it only
  writes "would ascend" in the log", "Paw: will ascend by itself once it
  pays off" (NOT YET), "Paw: will get ready ~T before level L, then ascend
  there" (WAIT, T = the routine's lead time, ASC-12), "Paw: will ascend once
  <reason>" (the buffs are over, golden cookies and frenzies are done, the
  open prompt is closed, its pause after a hiccup is over, it is safe);
  while the routine runs (ASC-12) "Paw: getting ready for level L: popping
  the wrinklers" / "...: selling the stocks" / "...: spending the bank on
  achievements (X to N)", "Paw: ready at Legacy, waiting for level L (now
  R), no golden cookies meanwhile", then "Paw: ascending now"; on the
  ascension screen "Paw: buying the pink ones, then reincarnating" for its
  own ascension, else "Paw: you ascended yourself, so the buying is up to
  you".
- **ASC-10** Auto ascension: with auto play and "Auto: ascend"
  (`config.autoAscend`, DEFAULT ON; auto play itself is off by default), the bot
  acts on the "would ascend now" / "WAIT: ascend at level L" verdicts
  (ASC-4) through a committed routine (ASC-12), one step per scheduler
  tick re-derived from the live game (`nextAscensionStep()`), every step a
  real synthetic click or a visible drag (NFR-8):
  (1) pop every attached wrinkler, shiny ones too, fattest first
  (`WrinklerPopAction`; the game would throw their cookies away), then sell
  every stock and spend the bank on achievements (ASC-13), then hold still
  with the paw on Legacy until the target level is there (ASC-12);
  (2) click the Legacy button (`#legacyButton`) and the visible "Ascend" in
  its prompt (`#promptContentAscend #promptOption0`); the prompt counts as
  its own from the Legacy click on (`DragonClickParams.onClicked`), so no
  other module gets a tick in between; if the level leaves the target's
  window while that prompt is open it clicks "Cancel";
  (3) sit out the ~5s ascend animation (`WaitWhileAction`, nothing below
  its tier runs);
  (4) buy the shopping list for the chips on hand (ASC-9 without waiting)
  crate by crate (`#heavenlyUpgrade{id}`, looked up fresh since every
  purchase rebuilds the tree), first dragging the tree so the crate sits in
  the middle of the screen when it is not (`DragTreeAction`: the paw
  presses and slides, the tree pans through `Game.AscendOffXT/YT`); a
  crate missing from the tree or failing 3 times is skipped, and after 3
  minutes in heaven the rest of the list is;
  (5) click Reincarnate (`#ascendButton`) and "Yes" in its prompt;
  (6) reset the bot's per-run state (`RuntimeState.resetForNewRun()`: LOCK_A,
  plans, Krumblor/Santa/wrinkler bookkeeping, the auto hammer's
  calibration) and hold the scheduler 3s while the game rebuilds.
  Gates (for starting the routine, ASC-12): the AUTO-7 ones (no golden
  cookie ready, Click Frenzy, storm/chain, FTHOF/refill pending, paused, a
  prompt open) and no CpS buff at all (it would inflate the income the
  timing is based on); its own pause only (`ascendBlockUntil`), never
  shopping's (`autoBlockUntil`, which shopping sets whenever a re-plan is
  refused). Once committed none of these hold it back any more (a prompt
  it didn't open only makes it wait). It only ever finishes an ascension it
  started (a reload on the ascension screen leaves it to the player). A
  click that didn't do its job pauses it 3s, an element that doesn't show
  up for 5s pauses it 10s (nothing else runs meanwhile). Dry run never
  commits and only logs "would ascend". Priority: steps 1-2 above
  everything (SCHED-1 tier 0, `JOB_PRIORITY.ASCEND`, the steps never give
  way to a golden cookie); steps 3-6 tier 5, first. Logged as `"ascend"`
  (with the level, gain and shopping list), `"heavenly upgrade"` per
  purchase; counted in `stats.ascensions` ("Ascensions" in the HUD
  statistics once > 0).
- **ASC-12** A stable target, and a routine timed to reach it
  (`AscensionRunner`, `runtime.ascendTarget`). Late in a run levels pass
  quickly, and the routine before an ascension (pops, stock sales,
  achievements) takes minutes, so the bot never chases the level that is
  lucky right now:
  (a) Lead time (`AscensionRunner.leadSec()`, handed to the planner as
  `AscensionPlanner.leadSec`): 5s per attached wrinkler + 6s per stock to
  sell + 2s per building and 0.1s per copy the ASC-13 plan buys (for the
  bank plus the wrinklers' cookies; at most 90s), × 1.5, + 60s safety buffer
  (`LEAD_*` constants).
  (b) Routine income: while the routine runs no wrinkler digests, nothing
  is clicked and no buff runs, so the bank only gets the game's unbuffed CpS
  (`AscensionInput.routineIncome`, `Game.unbuffedCps`); the measured income
  (ASC-2) counts what attached wrinklers digest and can be 6-8× higher. The
  routine is timed with the routine income only.
  Target: the planner looks for the lucky level only from the level the
  run reaches after the lead time at the routine income
  (`AscensionInput.leadSec`, `HeavenlyShopInput.luckyFromLevel`), so the 7s
  are still ahead when the routine is done, and only where the window LEFT
  from the target on still lasts ASC_FINAL_SEC at the routine income (a
  level near the end of its block is skipped for the next block,
  `nextLuckyTarget()`, `luckyWindowLevels()`). `shop.level` is the level to
  ascend at, `AscensionPlan.luckyEnd` the last level that still has the 7s
  the list needs (`luckyWindowEnd()`: the rest of the ASC-15 block, then
  level by level; Infinity without lucky wishes: any level from the target
  on will do).
  (c) Commit: once the plan says ascend now or WAIT and the target is at
  most the lead time + 30s away at the routine income
  (`AscensionPlan.routineEtaSec`, `LOCK_SLACK_SEC`), with the ASC-10 gates
  clear, the target `{level, end}` is locked and never re-planned; the
  verdict may change afterwards, the routine goes on. Logged as `"ascend"`
  ("getting ready to ascend at level L").
  (d) The routine outranks everything from then on, golden cookies included
  (SCHED-1 tier 0; its jobs never give way to a golden cookie, and the
  stock sales and buildings-view steps ignore golden cookies and frenzies
  while it runs): pop every wrinkler, sell the stocks, spend the bank on
  achievements (ASC-13), once (`runtime.ascendPrepDone`; wrinklers that grow
  back and the bank that builds up during the wait are left alone), then
  hold still with the paw on Legacy (`WaitWhileAction`, mood `ascend`,
  logged "ready: waiting for level L"). Nothing is clicked meanwhile.
  (e) Ascend: as soon as the real prestige level (all-time cookies without
  the unpopped wrinklers, which the game throws away) is within [level,
  end], Legacy and "Ascend" are clicked; whatever preparation is left is
  dropped, the level comes first.
  (e2) Moved on, still committed (golden cookies stay ignored; logged
  "moved the target to level L: ..."): while the real level is below the
  target, a lucky window that lasts less than 20s at the current unbuffed
  CpS (`MIN_WINDOW_SEC`; the routine's buildings and milk raise it), or one
  that passed, is swapped for the next one that holds ASC_FINAL_SEC at that
  CpS (digit re-chosen, ASC-15; after the rest of the routine's time if the
  preparation isn't done). Once the level is inside the window the target
  never moves. The log also records the level at the Legacy click and the
  level the ascension landed on (`landed`).
  (f) Called off (logged, CON-2), and the next target planned: no lucky
  window ahead holds long enough, the level is more than 1h
  off at the unbuffed CpS (`MAX_HOLD_SEC`; as long as it is honestly on its
  way the routine keeps holding, however long that takes), or auto
  ascension was switched off (silently).

- **ASC-13** Spending the bank before ascending ("Auto: spend the bank on
  achievements before ascending", `ascendDumpBank`, DEFAULT ON; only as
  part of ASC-10). The ascension throws the bank, the stock market and the
  buildings away, but achievements stay won (`Game.Reset()` only clears
  them on a hard reset; each is +4% milk for the kittens in every later
  run), and spending never lowers the prestige gained (it comes from
  `cookiesEarned`; a stock sale doesn't raise it either, the game only
  keeps `cookiesEarned >= cookies`). So once the ascension is committed
  (ASC-12), before Legacy is clicked: (1) every held
  stock is sold with its "All" button (the trader's own view steps and sell
  click, `StockTrader.sellAllJob()`; only with "Play the stock market" on; a
  good bought this very market tick can't be sold and stays); (2) the whole
  bank goes into building count achievements, cheapest first
  (`planAchievementDump()`, `src/autoplay/achievement-dump.ts`: every step
  the cheapest next unwon count of any unlocked building the rest of the
  bank still pays for, priced with the game's 1.15× per copy; building caps
  like the Wizard tower target don't apply, the run ends anyway): the paw
  goes to the building's row and buys it one copy at a time, ~10 per
  second, a pulse per copy (`AchievementDumpAction`, NFR-8 b), re-planned
  from the live game every step. Only in the store's buy mode (in sell mode
  the game's `buy()` would sell). The whole phase gives up after 90s
  (`runtime.ascendDumpSince`), so a stuck market or store never holds the
  ascension back; it starts over for a new target. Logged as `"ascend"` ("bought 37x Farm for the 150 achievement").

- **ASC-14** While an ascension is committed (ASC-12) the stock trader
  buys no new stocks (`AscensionRunner.armed()`, `StockTrader.holdBuys`),
  since they would only be sold again. (Until 5.6.9 this was an early
  preparation as soon as the plan said WAIT, however far off; ASC-12's
  timed routine replaced it.)

- **ASC-15** The 7s go where they hold still: late in a run levels pass in
  fractions of a second, so a 7 in the last digit is gone before the paw
  can click, while the first digits are safest but take longest to reach.
  Digit position p (0 = the last) changes every 10^p levels; at the current
  income (`secPerLevel` = the cookie cost of the next level / income) the
  planner picks the lowest position whose value holds at least the last
  two clicks with slack for a CpS the routine's purchases raised, 60s at the
  routine income (`ASC_FINAL_SEC`; the preparation is done
  before the target, ASC-12, and the paw waits at Legacy) (`luckyMinDigit()`
  in `src/autoplay/ascension-strategy.ts`), and only counts 7s at that
  position and above (`countSevensFrom()`, `nextLevelWithSevens(from, n,
  minDigit)`): a target like 1,177,xxx, whose whole block of 10^p levels
  keeps the 7s (`AscensionPlan.luckyDigit`; `luckyEnd` is the block's end).

### 3.21a Butter biscuits (auto play)

The butter biscuits (+10% CpS each) unlock once EVERY building is owned at
least N times at once: 100 (Milk chocolate), 150 (Dark chocolate), 200,
250, ... 650 (Everybutter); the game checks every 5s (`minAmount` in
`main.js` 2.058) and the unlock stays when the count drops again. Auto play
holds Wizard towers at `autoWizardTowerTarget` (57), so they are the one
building short. Pure logic in `src/autoplay/butter-biscuit-strategy.ts`,
the module in `src/autoplay/butter-biscuit.ts` (`ButterBiscuitHunter`).

- **BUTTER-1** With auto play on (no separate switch), once every building
  other than Wizard towers is at a milestone whose biscuit is still locked,
  the tower target is below it and fewer towers are owned, the paw buys
  Wizard towers up to it in one go, but only when they cost less than 1% of
  the bank (`BUTTER_MAX_BANK_SHARE`) and leave the reserve (AUTO-6) alone.
  It takes the highest such milestone
  that passes both guards (one top-up to 200 also unlocks the 100 and 150
  biscuits); else it waits.
- **BUTTER-2** Then it waits for the game's unlock (up to 12s,
  `BUTTER_UNLOCK_WAIT_MS`) and sells the extra towers back down to the
  target (or to the count it had before, if higher) (`runtime.butterTopUp`,
  per run, not persisted). A top-up that didn't unlock its biscuit pauses
  the module 10 minutes, so it never loops buying and selling at a loss.
  A purchase that got fewer towers than asked is sold back at once. The
  biscuit itself is bought by the normal shopping (a +10% biscuit, AUTO-2).
- **BUTTER-3** Both are store actions through the game's `buy()`/`sell()`
  with the paw visiting the Wizard tower row (scrolled into view first) and
  pulsing (NFR-8 b, `DragonStoreAction`); never in the store's sell mode.
  Same gates as AUTO-7; dry run only logs "would buy/sell". Not while
  Krumblor needs the towers (dragon level 12 or its tower rebuy, KRUMB-2).
  Priority: tier 5 after a Santa step, before a stock trade. Logged as
  `"butter biscuit"`; an unlock says so in the console (CON-1).

### 3.22 Update check

- **UPD-1** Once per start-up (`Bootstrap.start()`), the bot asks GitHub
  for the latest release: `GET
  https://api.github.com/repos/Leonetienne/CCGoodboy/releases/latest`,
  `tag_name` (the same release `github.com/.../releases/latest`
  redirects to; that page sends no CORS headers, so a `@grant none`
  script can't follow the redirect itself). A tag that isn't a plain
  `MAJOR.MINOR.PATCH` (optionally `v`-prefixed) is ignored. A failed
  check only says so in the console (`sayCant`) and changes nothing.
- **UPD-2** Only when that tag is strictly higher than `VERSION`, a popup
  says "There's an update for your gewd boy :3" / "Wanna update now?"
  with both versions, a shiny animated rainbow button ("Yes pls, update
  me! ^w^": moving gradient, glow, a light sweep, a little wiggle; still
  under `prefers-reduced-motion`) and a quiet "Later :c". The button is a
  plain link to
  `https://github.com/Leonetienne/CCGoodboy/releases/download/{tag}/cc-good-boy.user.js`
  opened in a new tab, so Tampermonkey offers the update itself; both
  buttons close the popup. Not remembered: a still-newer release asks
  again at the next start.
- **UPD-3** Logged as `"update available"` (and `"update opened"` when
  the button is clicked); `destroy()` removes the popup and a check still
  in flight never shows one. `src/lifecycle/update-check.ts`
  (`UpdateChecker`, pure `parseVersion()`/`isNewerVersion()`), styles in
  `src/ui/styles.ts`. Unit tests in `tests/unit/update-check.test.ts`.

### 3.23 Stock market (the Bank's minigame)

The trader plays the Bank's stock market like a patient human: it buys a
good when it is cheap and has just turned up, rides the rise, and sells when
it starts to fall again. Every trade is a real click on the market's own
buttons (NFR-8 a), one `MarketClickAction` job per click. Pure logic in
`src/market/market-strategy.ts`, the module in `src/market/stock-trader.ts`,
the DOM in `src/game/market-dom.ts`; the game's `minigameMarket.js` (2.058)
was read for every rule below.

- **STOCK-1** Setting "Play the stock market" (`stockMarket`, a general
  setting, DEFAULT ON; switch it off to keep the cookies out of stocks).
  Not tied to auto play; auto
  play only adds the unlock (AUTO-16). Without a Bank, or with Bank level 0,
  the trader only says so (CON-2) and waits.
- **STOCK-2** Strategy, tuned on a faithful port of the game's `M.tick()`
  simulated over hundreds of thousands of ticks (Bank levels 1 and 10,
  overhead 20% and 3%). The simulation showed every good wandering far from
  its resting value (Cereals, resting at $10, spends a quarter of the time
  below $7 and a quarter above $50), a soft floor (below $5 the price is
  pulled back up) and trends that end at the top. Measured against R =
  resting value + 10: BUY at or below 0.3 R (`MARKET_BUY_SHARE`) once the
  price is higher than one tick ago (`MARKET_UPTICK`, it turned: never
  into a still-falling price); SELL, all of it, once the price has been at
  or above 0.7 R (`MARKET_SELL_SHARE`) since the buy and has fallen 5% from
  that peak (`MARKET_TRAILING_STOP`), and never at or below what a unit
  cost (the game's "last bought at" × today's overhead). In the simulation
  this earned the most per cookie tied up: ~1-1.6× the invested cookies back
  per hour held, ~2.6 round trips per good per day. The peak since the buy
  is watched every scheduler tick (`runtime.marketPeaks`, also while
  trading waits); a good first seen held (after a reload) takes it from the
  graph since the price was last at or below the purchase price
  (`marketPeakFromHistory()`).
- **STOCK-3** Order within a tick (`planMarketMove()`, re-planned from the
  live market for every click, so a preempted click is simply planned
  again): (1) sells first ("All" button); (2) a broker when it pays (STOCK-4)
  and something is to be bought; (3) buys, the best upside (0.7 R / price)
  first: "Max" when the budget fills the warehouse (the game's Max then
  buys exactly the free space), else the biggest of 100/10/1 that fits, one
  click per job, at least 10 units (or the whole free space) per click.
  The game's rule that a good can't be bought and sold in the same tick is
  respected (`me.last`). Only active goods (their building owned this
  ascension) are traded.
- **STOCK-4** Budget and brokers: stocks may hold at most "Stocks: invest at
  most (share of bank)" (`stockMaxShare`, default 0.5) of bank + stocks
  (valued at today's prices), and never more than the bank
  (`marketBudget()`). While auto play is saving up for a purchase (its plan
  has a save target, AUTO-4) the share is at most 10%
  (`MARKET_SAVING_SHARE`, `StockTrader.saving`), so stocks don't eat the
  savings; stocks above that are kept, not sold for it, and the HUD row says
  "budget 10% while shopping saves". A broker (20 minutes of the highest raw CpS, max
  `M.getMaxBrokers()`) is hired (the "Hire" button) when the overhead it
  saves on 3 refills of every active warehouse at the buy price pays for it
  (`marketBrokerWorth()`, `MARKET_BROKER_ROUNDS`) and the budget allows.
- **STOCK-5** Safety: the AUTO-7 gates (golden cookie ready, Click Frenzy,
  storm/chain, FTHOF/refill pending, paused; also a prompt open, ascending).
  Getting the market in front of the paw is the Bank's `MinigameView` (goal
  "open", like FT-8): Options/Stats/Stats if a menu covers the buildings,
  "View Stock Market" (`#productMinigameButton5`) if it is closed, wheel-
  scroll `#centerArea` to the button. A click that changed nothing pauses
  trading 3s, a failed view step 10s (`runtime.marketBlockUntil`).
  Priority: tier 5 after the Krumblor/Santa steps, before wrinkler pops and
  shopping; a due trade interrupts hammering and idle play (AUTO-8).
- **STOCK-6** Every trade is logged (`"stock buy"` with units, price and
  cost; `"stock sell"` with units, price, cookies and the profit in cookies;
  `"stock broker"`) and counted (`stats.stockTrades`, "Stock trades" in the
  HUD statistics once > 0). What the paw makes or loses is tracked in
  cookies with the game's own formulas (a buy costs price × overhead ×
  highest raw CpS, a sale pays price × highest raw CpS): each buy adds to
  that good's cost basis (`stats.stockBasis`: units and cookies paid,
  persisted), each sale books its proceeds against the average cost of the
  units sold into `stats.stockProfit` (a loss counts too), shown as "Stock
  market profit" in the HUD statistics (`StatsRecorder.recordStockBuy()` /
  `recordStockSell()`). Units the paw didn't buy (bought by hand) have no
  known cost and are left out of it; units that leave without the paw
  selling them (sold by hand, an ascension resetting the market) are
  dropped from the basis unbooked (`reconcileStockBasis()`). Brokers are
  not counted: they're paid once and lower every later cost. A sale with a
  profit says so in the console (CON-1).
- **STOCK-7** HUD row "Stock market" (only while STOCK-1 is on): what is
  held and its worth in cookies, what the paw made (STOCK-6) and, while it
  holds its own units, the unrealized gain or loss on them at today's price,
  the brokers, and
  the next trade or the time to the next market tick; "locked (Bank level
  0)" before the unlock.
- **STOCK-8** Not played: offices (they cost cursors, which Krumblor and the
  achievements want) and loans (a CpS gamble followed by a penalty). The
  ascension throws the market away (`M.reset()`: stocks, brokers, offices),
  like the bank itself; an automatic ascension sells everything first
  (ASC-13), the trader itself never sells for it; `runtime.marketPeaks`
  is reset with the run. Debug: DBG-22, DBG-23.
- **STOCK-9** Two main panel buttons, for a player who saves up by hand:
  (a) "Pause investments" (`stockInvest`, stored, investing by default;
  shown only while STOCK-1 is on, the market is unlocked and auto play is
  off, since auto play always invests): paused, the trader spends nothing
  on the market (no buys, no brokers) but still sells what it holds by
  STOCK-2's rules; the button then reads "Investments paused" (active
  style). (b) "Cash stock market wins" (shown while STOCK-1 is on and the
  market is unlocked, auto play or not): the paw sells, one "All" click
  per good, every good that is not at a loss (price above the game's "last
  bought at" × today's overhead, like every sale; a good bought this very
  tick can't be sold; `marketCashable()`), before any other trade, then
  stops; a second click stops it early, and it gives up after 2 minutes
  (`runtime.marketCashOutUntil`). Its tooltip names the goods and what they
  bring back right now (`marketCashOutValue()`, `cashOutPreview()`); it is
  greyed out when nothing qualifies. Same gates, clicks, logs and profit
  bookkeeping as any sale (STOCK-5/6); the start, end and pauses are logged
  (`"stock market"`).

### 3.24 Garden (the Farm's minigame)

The gardener keeps the Farm's garden planted for its passive effects,
every step a real click on the garden's own controls (NFR-8 a), one
`GardenClickAction` job per click. Pure logic in
`src/garden/garden-strategy.ts`, the module in `src/garden/gardener.ts`,
the DOM in `src/game/garden-dom.ts`; the game's `minigameGarden.js`
(2.058) was read for every rule below. How the garden works, for
reference: plants age once per garden tick (dirt 5 min, fertilizer 3,
clay 15; nothing grows while the game is closed), give 10/25/50/100% of
their effect as bud/sprout/bloom/mature and die at age 100; a tile click
harvests (mature: seed unlock, payout, drop upgrades, counts) or unearths
(not mature: nothing) whatever grows there, else plants the selected seed
(which the game then de-selects); a seed costs max(its minimum, the
BUFFED CpS × its minutes); new seeds only appear by mutation in empty
tiles next to mature plants.

- **GARDEN-1** Setting "Tend the garden" (`garden`, a general setting,
  DEFAULT ON). Not tied to auto play; auto play only adds the unlock
  (AUTO-17). With the setting off the bot never touches the garden. Without
  a Farm, or with Farm level 0, it only says so (CON-2) and waits. It never
  spends a sugar lump on the garden (AUTO-17 aside).
- **GARDEN-2** Order, re-planned from the live garden for every click
  (`planGardenMove()`), so a preempted click is simply planned again:
  (1) harvest a mature plant whose seed isn't known yet (unlocks it);
  (2) unearth a known pest at once (GARDEN-4; harvest it when mature);
  (3) harvest a mature plant about to wither (the game's own "dying" look:
  age + the most it can age in one tick >= 100): it keeps its full effect
  until then, and its seed chance, drops (Wheat slims, Bakeberry cookies,
  ...) and the harvest achievements only come from a harvest; (4) during a
  CpS buff, harvest a mature payout crop (GARDEN-5); (5) set the soil
  (GARDEN-6); (6) fill an empty tile with the crop (GARDEN-3): click its
  seed if it isn't selected, then the tile. A plant of a known, harmless
  kind that isn't the crop (e.g. an Elderwort the player planted) is left
  growing until it withers like the crop.
- **GARDEN-3** The crop is Baker's wheat (`GARDEN_CROP`): known from the
  start, one minute of CpS per seed, +1% CpS each while alive (+1.25% on
  clay, ~+34% for a full 6x6 plot averaged over its life). It is only
  planted with no CpS buff running (the seed price follows the buffed CpS:
  a Frenzy makes it 7× dearer) and when the seed is affordable from the
  bank minus auto play's reserve (AUTO-6, only while auto play is on).
- **GARDEN-4** Pests (`GARDEN_PESTS`): Meddleweed, Brown mold, Shriekbulb,
  Crumbspore, Doughshroom (negative effects, or they take over their
  neighbours). Unearthed at once when their seed is known; an unknown one
  grows to maturity first so its harvest unlocks the seed.
- **GARDEN-5** Payout crops (`GARDEN_PAYOUT`: Bakeberry, Chocoroot, White
  chocoroot, Queenbeet, Duketater) pay min(a share of the bank, some
  minutes of the BUFFED CpS) on a mature harvest, so one that is mature is
  harvested while a CpS buff runs rather than at its end. The bot doesn't
  plant them (without a buff and a big bank they cost more than they pay).
- **GARDEN-6** Soil: clay (effects ×1.25) once 100 farms allow it, else
  dirt (`gardenSoilTarget()`); changed with a click on the soil once its
  10-minute cooldown is over. A frozen garden (the player's freeze) is left
  alone completely: no harvest, no planting, no soil.
- **GARDEN-7** Safety: the AUTO-7 gates (golden cookie ready, Click Frenzy,
  storm/chain, FTHOF/refill pending, paused; also a prompt open,
  ascending). Getting the garden in front of the paw is the Farm's
  `MinigameView` (goal "open", like STOCK-5): Options/Stats/Stats if a menu
  covers the buildings, "View Garden" (`#productMinigameButton2`) if it is
  closed, wheel-scroll `#centerArea` to the control. Every click re-checks
  its move right before it fires (FT-4), since a tile click on the wrong
  plant would unearth it. A click that changed nothing pauses the garden
  3s, a failed view step 10s (`runtime.gardenBlockUntil`). Priority: tier 5
  right after a stock market trade, before wrinkler pops and shopping; a
  due step interrupts hammering and idle play (AUTO-8).
- **GARDEN-8** Every step is logged (`"garden plant"` with the cost,
  `"garden harvest"` with the cookies it paid and a seed it unlocked,
  `"garden unearth"`, `"garden soil"`) and counted (`stats.gardenPlants`,
  `stats.gardenHarvests`, "Garden: planted" / "Garden: harvested" in the
  HUD statistics once > 0, with "Garden profit", GARDEN-10); a new seed
  says so in the console (CON-1). HUD row "Garden" (only while GARDEN-1 is
  on): tiles planted, the garden's CpS bonus, what it made (GARDEN-10), soil,
  seeds known, the seed price while a tile is empty, the next step or the time
  to the next garden tick; "locked (Farm level 0)" before the unlock,
  "frozen" while frozen.
- **GARDEN-9** Not done (yet): breeding new seeds on purpose (layouts for
  mutations), other crops (Whiskerbloom's milk, clovers' golden cookie
  frequency), freezing mature payout crops for a combo, the garden's lump
  refill, levelling the Farm, sacrificing the garden. The plot is kept
  full, so mutations (and weeds) are rare.
- **GARDEN-10** Garden profit (`stats.gardenProfit`, persisted, in cookies):
  (a) the passive gain: once a second (`Gardener.track()`, called by every
  `Scheduler.tick()`, also while the paw is paused) the share of the real
  income that is the garden's CpS bonus, `Game.cookiesPs × (1 − 1/M.effs.cps)`
  × the seconds since the last sample (a gap over 5s, e.g. a throttled tab,
  counts as 5s); a garden bonus below 1 (Brown mold) counts as a loss;
  nothing while the setting is off, the garden is locked or frozen (its
  bonus is then 1); (b) + what a mature payout crop's harvest paid (the
  bank's rise over the click; any other harvest's rise is only the CpS
  during the click and isn't counted); (c) − every seed the paw planted,
  at its price at the click. Not counted: drop upgrades (Wheat slims, ...),
  the garden's effects other than CpS, seeds the player planted.
  `StatsRecorder.recordGardenProfit()`.

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
- **NFR-2** No dependencies at runtime, no external assets, and no network
  except the one update check per start-up (UPD-1).
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
| `huntFx` | Over-the-top hunting show (osu! mode) [checkbox] (FX-1) | true | – |
| `chartHours` | Chart hours | 48 | 6-720 |
| `retentionDays` | Remember history (days) | 30 | 1-365 |
| `logLimit` | Log entries to keep | 10000 | 100-50000 |
| `showBuyValue` | Show "how good is a buy" overlay [checkbox] | true | – |
| `frameOpacity` | Frame opacity (0.1-1) | 0.95 | 0.1-1 |
| `overlayOpacity` | Overlay opacity (0.1-1) | 1 | 0.1-1 |
| `keepAlive` | Background keep-alive (silent audio) [checkbox] | true | – |
| `ascendMinBoost` | Ascend: minimum CpS boost (x) (ASC-8) | 2 | 1-100 |
| `ascendShopWaitSec` | Ascend: wait for heavenly upgrades up to (s) (ASC-9) | 21600 | 0-2592000 |
| `ascendShopWaitShare` | Ascend: wait for heavenly upgrades at most (x levels gained) (ASC-9) | 0.1 | 0-1 |
| `ascendLuckyWaitSec` | Ascend: wait for a lucky level up to (s) (ASC-9) | 86400 | 0-2592000 |
| `showAscendOverlay` | Show ascension overlay [checkbox] (ASC-6) | true | – |
| `showDebugTools` | Show debug tools (cheats) [checkbox] (UI-3) | false | – |
| `grimoireFthof` | Grimoire: cast Force the Hand of Fate [checkbox] (FT-9) | true | – |
| `spendLumps` | Spend sugar lumps [checkbox] (FT-9: refills, AUTO-13/AUTO-16/AUTO-17 unlocks) | true | – |
| `stockMarket` | Play the stock market [checkbox] (STOCK-1) | true | – |
| `stockMaxShare` | Stocks: invest at most (share of bank) (STOCK-4) | 0.5 | 0-1 |
| `stockInvest` | ("Pause investments" button, stored; STOCK-9) | true | – |
| `garden` | Tend the garden [checkbox] (GARDEN-1) | true | – |
| `autoPlay` | (Auto play button, stored) | false | – |
| `autoDryRun` | Auto play dry run (log only) [checkbox] | false | – |
| `autoInsignificantShare` | Auto: insignificant cost (share of bank) | 0.001 | 0-1 |
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
| `autoKrumblor` | Auto: train Krumblor (Dragonflight) [checkbox] | true | – |
| `autoAscend` | Auto: ascend (and buy heavenly upgrades) [checkbox] (ASC-10) | true | – |
| `ascendDumpBank` | Auto: spend the bank on achievements before ascending [checkbox] (ASC-13) | true | – |

(all "Auto" settings are only shown while Auto play is on; the stock market
settings are general settings)

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
| Game facade | `src/game/` | `game-adapter.ts` (IGameAdapter + GameAdapter), `types.ts` (GameShimmer/RawBuff/CpsBuff/GrimoireMinigame/GameBuilding/GameUpgrade), `golden-cookie-model.ts` (fade curve, shimmer classification, GC-2/GC-3), `hurry-mode.ts` (HURRY-\*), `buffs-lock.ts` (LOCK_A, FT-6), `grimoire.ts` (FTHOF spell/cost lookup), `grimoire-dom.ts` (real Grimoire controls — FT-7), `market-dom.ts` (the stock market's trade and "Hire" buttons — STOCK-\*), `garden-dom.ts` (the garden's plot tiles, seeds and soils — GARDEN-\*), `lump-dom.ts` (`#lumps` control/centre — LUMP-\*), `wrinkler-dom.ts` (`#backgroundLeftCanvas`, a wrinkler's body point — WRINK-5), `dragon-dom.ts` (the special tabs on the left canvas, `#specialPopup`, the aura picker, Santa's "Evolve" button — KRUMB-3/XMAS-4), `buildings-view-dom.ts` (`#centerArea`, menu buttons, building rows/level buttons, the Options/Stats/Stats recipe, `centeredScrollTop` — AUTO-13), `reindeer.ts` (a reindeer's predicted path and the paw's meeting point — XMAS-6), `ascension-dom.ts` (the Legacy button, the Ascend/Reincarnate prompts, heavenly crates, the Reincarnate button, how far to drag the tree — ASC-10), `store-dom.ts` (the collapsible upgrade store sections, opened while the paw is there — AUTO-9), `dom-geometry.ts` (visibleRect/looseRect/clippedByAncestor — shared by every overlay box, GC-2/BUY-3) |
| Cursor (queue) | `src/cursor/` | `types.ts` (`JOB_PRIORITY`, `CursorAction`, `CursorJob`, `CursorJobContext`, `CursorMover`, `CursorClickTiming`, `JobRequest`), `cursor-manager.ts` (owns the priority queue + all cursor motion: click gap → travel → pre-click pause → `cursor_at_position`, dedup by key, preemption, single cursor writer) |
| Actions | `src/actions/` | `click-element.ts` (ClickElementAction/MoveAction/VisualPressAction), `golden-cookie.ts` (GoldenCookieAction, `effectPrettyName`), `hammer.ts` (HammerAction + big-cookie point helpers, CF-\*), `fthof.ts` (FthofAction/RefillAction), `lump-harvest.ts` (LumpHarvestAction, LUMP-\*), `buildings-view.ts` (MenuButtonAction, ScrollIntoViewAction, MinigameButtonAction — FT-8/AUTO-13/DBG-9..11), `minigame-unlock.ts` (MinigameUnlockAction: a building's "lvl" click that unlocks its minigame), `grimoire-unlock.ts` (GrimoireUnlockAction, AUTO-13), `market.ts` (MarketClickAction: one click on a stock market button, STOCK-\*), `garden.ts` (GardenClickAction: one click on a garden tile, seed or soil, GARDEN-\*), `wrinkler-pop.ts` (WrinklerPopAction, WRINK-5), `krumblor.ts` (DragonClickAction/DragonStoreAction, KRUMB-3; Santa's and the ascension's clicks reuse DragonClickAction, XMAS-4/ASC-10), `ascension.ts` (WaitWhileAction, DragTreeAction — ASC-10), `achievement-dump.ts` (AchievementDumpAction: buying a building copy by copy for its achievement — ASC-13), `store-visit.ts` (`enterStoreElement`: the paw opening an upgrade's store section and moving onto the crate, AUTO-9), `dance.ts` (DanceAction + `danceEligible`/`anyGoldenPresent`/`getDanceMs`), `ponder.ts` (PonderAction), `idle.ts` (IdleWanderAction + `IDLE_SPOTS`/`pickIdleSpot`) |
| Hunting (modules) | `src/hunting/` | `click-golden.ts` (golden hunter: `jobFor` → GoldenCookieAction), `click-big-cookie.ts` (hammer module: `job` → HammerAction), `golden-queue.ts` (route caching, wraps route-planner), `fthof.ts` (FthofActions: `fthofOrRefillPending` + `castJob`/`refillJob`), `lump-harvest.ts` (LumpHarvestActions: `pending` + `harvestJob`), `happy-dance.ts` (HappyDance: `job` → DanceAction), `buildings-view.ts` (BuildingsViewNavigator: Options/Stats/Stats recipe + scroll-into-view steps, `PrepStep`), `minigame-view.ts` (MinigameView: step planner to a building's unlocked/open, on-screen minigame — shared by the Grimoire and the stock market), `grimoire-view.ts` (GrimoireView: the Wizard tower's MinigameView for FT-8/AUTO-13, plus the DBG-9..11 tools and their scheduler tier), `hitbox-overlay.ts` (GC-2) |
| Routing | `src/routing/route-planner.ts` | `exactRoute` (Held-Karp DP, <= 11 cookies), `heuristicRoute` (nearest-neighbor + 2-opt/Or-opt + restarts), `planRoute` (GC-5) |
| Idle | `src/idle/` | `idle-behavior.ts` (IdleBehavior module: `idleJob` → IdleWanderAction), `pending-work.ts` (conditions + queue state via `CursorManager.hasJobsAbove` — the shared "is anything more important pending?" predicate) |
| Input synthesis | `src/input/` | `dispatch.ts` (dispatchMouse/dispatchMove — MOUSE-\*), `human-click.ts` (ClickTiming: delays, waitUntil, humanClick), `cursor-controller.ts` (CursorController: low-level PAW-4 arc/spline/warp travel, moveCursorTo/glideCursor — the only file that writes `runtime.cursor.x/y`), `background-clock.ts` (BackgroundClock: BG-1/BG-2 worker timer), `keep-alive.ts` (BG-3) |
| Auto play | `src/autoplay/` | `valuation-tables.ts` (AUTO_BLOCKED_\*, AUTO_GOLDEN_UPGRADES, AUTO_KITTEN_POWER, AUTO_FINGER_STEPS, AUTO_BUILDING_CAPS — AUTO-2 data), `building-valuation.ts` + `upgrade-classifier.ts` (AUTO-3 gain math per candidate type), `collector.ts` (`autoCollect`: gathers candidates + ctx, AUTO-7 safety gates), `strategy.ts` (`autoDecide`: the pure insignificant/good/postpone/save decision, AUTO-4 — flagship unit-test target), `buy-streak.ts` (pure: whether the paw buys one more of the same building in its streak, AUTO-14), `achievement-milestones.ts` (pure: a building's value on its way to a count achievement, AUTO-15), `shopping.ts` (`AutoPlayEngine`: evaluate/shopJob/statusText, AUTO-1/8/9/10/12), `auto-hammer.ts` (AUTO-11), `grimoire-unlock.ts` (`GrimoireUnlocker`: AUTO-13 gating, steps from GrimoireView), `minigame-unlock.ts` (`MinigameUnlocker`: a minigame's level 1 unlock, gating and steps from its MinigameView), `bank-unlock.ts` (`BankUnlocker`: AUTO-16), `farm-unlock.ts` (`FarmUnlocker`: AUTO-17), `wrinkler-strategy.ts` (pure: respawn time, maturity, fewest-fattest pick — WRINK-2/3), `grandmapocalypse-valuation.ts` (pure: stage 1 gain, delay, chain-step dCps — WRINK-1), `wrinkler-popper.ts` (`WrinklerPopper`: WRINK-3/4 gating, plan, job, HUD text), `krumblor-strategy.ts` (pure: next Krumblor step — KRUMB-1/2/5), `krumblor.ts` (`KrumblorTrainer`: KRUMB-\* gating, state, jobs, the cursor sale/rebuy), `easter-eggs.ts` (pure-ish: egg values and order — EGG-\*), `christmas.ts` (pure-ish: Christmas upgrade values — XMAS-1..3), `santa-strategy.ts` (pure: next Santa step — XMAS-4), `santa.ts` (`SantaTrainer`: XMAS-4/5 gating, jobs), `butter-biscuit-strategy.ts` (pure: the next Wizard tower top-up / sell-back — BUTTER-\*), `butter-biscuit.ts` (`ButterBiscuitHunter`: BUTTER-\* gating, jobs), `ascension-strategy.ts` (pure: pending level, stagnation, boost gate, verdict — ASC-1..4/8), `heavenly-shopping.ts` (pure: the heavenly priority list, lucky 7s, the shopping list and the level it needs — ASC-9), `ascension-steps.ts` (pure: the next step of an automatic ascension — ASC-10), `achievement-dump.ts` (pure: the cheapest-first achievement plan for the bank before an ascension — ASC-13), `ascension-runner.ts` (`AscensionRunner`: ASC-10 gating, steps, jobs, the per-run reset), `ascension.ts` (`AscensionPlanner`: measured income, cached plan, HUD text — ASC-2/5), `ascension-overlay.ts` (Legacy button and heavenly tree boxes — ASC-6/7), `income-tracker.ts` (smoothed clicking income for AUTO-3's `income`), `buy-value-overlay.ts` (BUY-\*) |
| Stock market | `src/market/` | `market-strategy.ts` (pure: thresholds, trailing stop, budget, brokers, the next trade — STOCK-2..4), `stock-trader.ts` (`StockTrader`: STOCK-\* gating, peaks, jobs, HUD text; the Bank's `MinigameView`) |
| Garden | `src/garden/` | `garden-strategy.ts` (pure: the crop, pests, payout crops, soil, the next step — GARDEN-2..6), `gardener.ts` (`Gardener`: GARDEN-\* gating, jobs, HUD text; the Farm's `MinigameView`) |
| Scheduler | `src/scheduler/` | `priority.ts` (`selectJobRequest`: the SCHED-1 cascade as pure data), `scheduler.ts` (`Scheduler.tick()`: wrath logging, queue build, enqueues ONE job via CursorManager), `overlay-loop.ts` (`OverlayLoop`: the requestAnimationFrame draw loop — hunting show, hitboxes, buy-value overlay, ascension overlay, paw) |
| Rendering | `src/rendering/` | `paw-cursor.ts` (`PawCursor`: PAW-1..3, sprite rasterizing, click pulse, fallback drawn paw), `hunt-fx.ts` (`HuntFx`: the osu!-style hunting show, FX-\*), `overlay-canvas.ts` (resize/DPR handling) |
| Stats | `src/stats/` | `log.ts` (`LogStore`), `stats.ts` (`StatsRecorder`: GC-6/AUTO-10 counters + hourly buckets) |
| UI | `src/ui/` | `root.ts` (`UiRoot`: composes every panel, wires ~25 event listeners — was `createUi()`), `styles.ts` (UI-7 theme), `format.ts` (escapeHtml/formatNum/moodText/targetText), `gui-frames/` (panel DOM template, drag-to-move, the 200ms `PanelUpdater`), `settings/` (`normalize-setting.ts` clamps, `settings-panel.ts` UI-4 staged save), `stats-window/` (`chart-engine.ts` canvas chart drawing, `graphs-panel.ts` UI-5, `logs-panel.ts` UI-6 filter/export), `debug/debug-tools.ts` (DBG-\*) |
| Lifecycle | `src/lifecycle/` | `bootstrap.ts` (`Bootstrap`: start/destroy, API-1, MOUSE-1 real-mouse sync, `waitForGame` polling), `update-check.ts` (`UpdateChecker`: UPD-\*) |
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
| `buildings-view` | clicking Options/Stats back to the buildings, scrolling `#centerArea`, or clicking "View Grimoire" / "View Stock Market" / "View Garden" (FT-8, AUTO-13, AUTO-16, AUTO-17, STOCK-5, GARDEN-7, DBG-9..11) | `MenuButtonAction` / `ScrollIntoViewAction` / `MinigameButtonAction` |
| `grimoire-unlock` | spending a sugar lump on Wizard tower level 1 (AUTO-13) | `GrimoireUnlockAction` |
| `bank-unlock` | spending a sugar lump on Bank level 1 (AUTO-16) | `MinigameUnlockAction` (from `BankUnlocker`) |
| `farm-unlock` | spending a sugar lump on Farm level 1 (AUTO-17) | `MinigameUnlockAction` (from `FarmUnlocker`) |
| `garden` | clicking a garden tile, seed or soil (GARDEN-\*) | `GardenClickAction` |
| `stock-market` | clicking a stock market buy/sell button or "Hire" (STOCK-\*) | `MarketClickAction` |
| `wrinkler-pop` | poking a mature wrinkler until it bursts (WRINK-5) | `WrinklerPopAction` |
| `krumblor` | buying the crumbly egg, clicking Krumblor's tab/popup/aura picker, selling/buying buildings for the sacrifices (KRUMB-\*) | `DragonClickAction` / `DragonStoreAction` |
| `santa` | clicking Santa's tab, "Evolve" button and popup "x" (XMAS-4) | `DragonClickAction` (from `SantaTrainer`) |
| `butter-biscuit` | buying Wizard towers up to a butter biscuit milestone and selling them back (BUTTER-\*) | `DragonStoreAction` (from `ButterBiscuitHunter`) |
| `ascend` | getting ready for a committed ascension (ASC-12: selling, buying for achievements, holding at Legacy), clicking Legacy/"Ascend", waiting out the animation, dragging the heavenly tree, buying heavenly upgrades, Reincarnate/"Yes" (ASC-10) | `DragonClickAction` / `WaitWhileAction` / `DragTreeAction` (from `AscensionRunner`; the pops show `wrinkler-pop`) |
| `auto-shop` | scrolling the store column to an item, visiting/buying it (AUTO-9) | auto-shop `CursorAction` from `AutoPlayEngine.shopJob()` |
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

1. **Unit tests** (`tests/unit/`, Vitest + jsdom, `make test`). 600 tests
   across 53 files. Pure functions (route planner, `autoDecide`, the chart
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
  `Game.getWrinklersMax()`, `building.tieredAchievs`/`Game.Tiers[tier].achievUnlock`
  (count achievements, AUTO-15), the wrinkler spawn/pop formulas and hit box
  (WRINK-\*; read from the game's `main.js` 2.058, and one pop verified live:
  3 pokes, digested × 1.1 gained), `Game.cookiesReset`/`cookiesEarned`/
  `heavenlyChips`/`HCfactor`/`PrestigeUpgrades` (`parents` turned into
  upgrade objects at load, `canBePurchased`)/`OnAscend`, the lucky upgrades'
  7-counting `showIf`, the `#legacyButton`/`#heavenlyUpgrade{id}`/
  `#ascendButton` DOM, the prompts' `#promptContent{id}`/`#promptOption{n}`
  ids, `Game.AscendTimer`/`AscendOffXT`/`AscendOffYT`/`AscendZoomT`, and that
  `Game.Reset()` drops wrinklers without paying them out (ASC-\*; read from
  `main.js` 2.058), the stock market's `M.goodsById` (`val`/`vals`/`stock`/
  `prev`/`last`/`active`), `M.getGoodMaxStock`/`getRestingVal`/
  `getMaxBrokers`/`getBrokerPrice`, `M.ticks`/`tickT`/`secondsPerTick`,
  `M.tick()` and the `#bankGood-{id}_{n}`/`#bankBrokersBuy` buttons
  (STOCK-\*; read from `minigameMarket.js` 2.058), the garden's `M.plot`/
  `plantsById`/`soilsById`/`getCost`/`isTileUnlocked`/`plotBoost`/
  `seedSelected`/`freeze`/`nextSoil`/`nextStep` and the
  `#gardenTile-{x}-{y}`/`#gardenSeed-{id}`/`#gardenSoil-{id}` controls
  (GARDEN-\*; read from `minigameGarden.js` 2.058). The trade strategy was
  tuned in simulation, not on the live game: expect real results to vary. If one is missing, the
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
  ascends by itself unless "Auto: ascend" is off (ASC-10). Auto
  ascension never picks a challenge mode or fills permanent upgrade slots,
  and a page reload on the ascension screen leaves that ascension to the
  player.
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
a test save with > 100 of each building up to shipments and some CpS,
auto play on, "Unlock crumblor"; watch the egg bought, the tab clicked, 5
trainings, then for each building from cursors to shipments the extras
sold to 100, the sacrifice and the rebuy, then Dragonflight picked and
confirmed, the popup closed), Christmas (XMAS-\*: on a test save with some CpS, auto play on,
"Unlock all christmas upgrades"; watch the hat and gifts bought, Santa's tab
clicked, "Evolve" clicked once per level with each new gift bought before
the next one, the popup closed), stock market (STOCK-\*/AUTO-16: on a
test save with a Bank at level 0, some CpS and a sugar lump, switch on
"Play the stock market" and auto play; watch the Bank's "lvl" click and
"View Stock Market", then "Stock market: crash prices": the paw clicks
Max on the goods; tick with "Stock market: next tick now" until prices
rise and fall again and watch it click "All", never below the purchase
price), garden (GARDEN-\*/AUTO-17: on a test save with a Farm at level 0,
100+ farms and a sugar lump, auto play on; watch the Farm's "lvl" click,
"View Garden", the soil switched to clay, then the wheat seed and an empty
tile clicked in turn until the plot is full; spawn a Frenzy with an empty
tile: nothing is planted until it ends), Grimoire unlock (AUTO-13: on a test
save with a Wizard tower at level 0, give lumps, open Options, switch auto
play on, scroll the building list to the top; watch Options/Stats/Stats,
the wheel-scroll and the "lvl" click; DBG-9/10 exercise the first two
steps on their own), ascension planning (ASC-\*: on a save with some prestige, check the Legacy
button's box and label against the game's own Legacy tooltip — "gained"
must match the levels it offers — then ascend by hand and check the
heavenly upgrade boxes and prices), auto ascension (ASC-10: on a TEST save
where the Ascension row says ASCEND NOW or WAIT, switch on auto
play and "Auto: ascend"; once the target is the lead time away watch the
log's "getting ready to ascend at level L", every wrinkler popped, the
stocks sold, the achievements bought, the paw holding still on Legacy
(spawn a golden cookie now: it must be ignored), Legacy and "Ascend"
clicked at level L, the tree dragged to each pink crate and each bought in
order, Reincarnate and "Yes", then the bot resuming after ~3s), settings staging (UI-4), log
filter/export (UI-6), real-mouse compatibility (MOUSE-1/2 — move your own
mouse while the bot runs and confirm the "+N" number follows your cursor,
not the paw's).

## 12. Changelog

- **5.8.28** Auto play leans towards purchases with a big CpS gain
  (AUTO-4): an ordinary purchase adding less than 0.5% of the CpS counts
  its payback × (0.5% / its impact) (`AUTO_IMPACT_REF`, `DecisionRow.score`),
  so the lower tiers' tiny gains (a Cursor for +0.03%) no longer take the
  paw's time from the higher tiers. Preferred and insignificant purchases
  are exempt. The "how good is a buy" overlay ranks by the same score
  (BUY-2). No slower CpS growth in the simulation. Unit tests in
  `tests/unit/strategy.test.ts` and `tests/unit/buy-value-overlay.test.ts`.

- **5.8.27** Fixed: auto play bought Wizard towers for billions each
  (24 of them at 7.7M CpS) and never got to the next building tier, since
  every tower below the target (57) was preferred whatever it cost. They
  are now only preferred once 93% of the target is owned
  (`AUTO_WIZARD_PREF_SHARE`) or while the next one is insignificant; below
  that they compete on payback (AUTO-4 B, `PurchaseCandidate.nearTarget`,
  `DecisionRow.pref`; the "how good is a buy" overlay follows, BUY-2). Unit
  tests in `tests/unit/strategy.test.ts`.

- **5.8.26** Fixed: auto play stopped buying for minutes while it saved for
  a preferred upgrade (e.g. ~14 min before Iron mouse, with a Factory paying
  back almost as fast), since it only let through what paid back before
  that upgrade arrived. The preferred saving rule is gone: the target is
  the lowest pp, preferred or not (the click upgrades' ×7 value makes them
  the target soon enough), and everything paying for itself before the
  target would is bought on the way, biggest CpS gain first (AUTO-4 C; the
  1%-of-the-bank buy order is gone). Checked in the simulation against the
  alternatives (AUTO-4). Unit tests in `tests/unit/strategy-sim.test.ts`,
  `tests/unit/strategy.test.ts`, `tests/unit/buy-streak.test.ts` and
  `tests/unit/achievement-milestones.test.ts`.

- **5.8.25** Auto play buys every research upgrade that can't lead to
  Grandmapocalypse stage 2 (WRINK-1): Exotic nuts (+4%) is no longer
  blocked (it only starts the research of Communal brainsweep, which stays
  blocked), every research step is worth at least its own gain (Designer
  cocoa beans' +2% no longer waits for the wrinklers' payoff), and with
  "Auto: grandmapocalypse stage 1" off only One mind is skipped, the rest
  of the research is bought for its own gain. `AUTO_STAGE1_NAME`; unit
  tests in `tests/unit/wrinklers.test.ts`.

- **5.8.24** Fixed: while saving for a preferred upgrade, auto play bought
  every purchase that paid back before the upgrade arrived, so cheap
  cursors (affordable every few seconds) kept eating the bank before the
  better grandma was ever affordable. An affordable purchase now also has to
  beat everything not affordable yet, counting its wait (AUTO-4 C). Unit
  test in `tests/unit/strategy-sim.test.ts`.

- **5.8.23** New purchase algorithm (AUTO-4), replacing the patched rule
  set: the lowest payback including the wait (pp) decides what is bought
  and what is saved for, so small purchases build the income up until the
  big ones are worth it; preferred upgrades are bought the moment they are
  affordable and saved for first, with everything that pays back before
  they arrive bought on the way. Clicking upgrades (cursor doublers,
  fingers, mouse upgrades) are valued with Click Frenzies counted, at least
  ×7, and kittens also by the clicks they add through the mouse upgrades
  (AUTO-3, `clickFrenzyFactor()`). While the hammer is on its clicks count
  as income from the first second, so early waits are right. The setting
  "Auto: good deal (x best payback)" (`autoGoodFactor`) is gone. Checked in
  a simulated run from 0 to 10M CpS against simple strategies and the old
  algorithm (1M CpS in ~4.5h, the old one ~7.5h). Unit tests in
  `tests/unit/strategy-sim.test.ts`, `tests/unit/strategy.test.ts` and
  `tests/unit/heavenly-unlocks.test.ts`.

- **5.8.22** Only the one target auto play saves for (preferred first:
  golden, cursor/click and kitten upgrades) decides what is held back
  (AUTO-4 C), so a closer building deal no longer blocks the powerful
  buildings that reach the preferred upgrade fastest. Unit tests in
  `tests/unit/strategy.test.ts`.

- **5.8.21** Fixed: while saving for an upgrade, auto play either spent
  the bank on purchases that only pushed the target away or refused the
  next building tier that would have got it there in a few minutes. A save
  target now holds back exactly the purchases whose payback is at least its
  wait (buying them first reaches the target later) and lets everything
  faster through (AUTO-4 C), insignificant purchases included. The setting
  "Auto: much bigger impact (x)" (`autoBiggerImpact`) is gone with the old
  impact rule. Unit tests in `tests/unit/strategy.test.ts`.

- **5.8.20** "Insignificant" (AUTO-4 A) now means at most 0.1% of the
  spendable bank instead of 60s of CpS: the setting "Auto: insignificant
  cost (s of CpS)" (`autoInsignificantSec`) is replaced by "Auto:
  insignificant cost (share of bank)" (`autoInsignificantShare`, 0.001,
  0-1). The same threshold applies to the junk spree (AUTO-18), the
  stacks of 10 (AUTO-14), Krumblor's cookie costs (KRUMB-2) and Santa's
  evolutions (XMAS-4). Unit tests in `tests/unit/strategy.test.ts`,
  `tests/unit/buy-streak.test.ts` and `tests/unit/krumblor.test.ts`.

- **5.8.19** Fixed: early in a run auto play spent its whole income on
  cheap buildings (each next copy ~55s of CpS, so "insignificant") and
  never reached the Bank or the upgrade it was saving for. An insignificant
  purchase is now held back when a save target pays back sooner even
  counting the wait (AUTO-4 A); it stays exempt from the impact rule. Unit
  tests in `tests/unit/strategy.test.ts`.

- **5.8.18** The butter biscuit top-up (BUTTER-1) is guarded by the bank
  instead of the CpS: the Wizard towers must cost less than 1% of the bank
  (`BUTTER_MAX_BANK_SHARE`, was at most 10 minutes of CpS). Unit tests in
  `tests/unit/butter-biscuit.test.ts`.

- **5.8.17** Butter biscuits (BUTTER-\*): once every other building reaches
  100 (150, 200, ...) of everything, auto play buys Wizard towers past
  their target up to that milestone, waits for the game to unlock the
  biscuit (+10% CpS) and sells them back down. Only when the towers cost at
  most 10 minutes of CpS and the bank pays for them. New
  `ButterBiscuitHunter`, `nextButterStep()`, mood `butter-biscuit`,
  `runtime.butterTopUp`; `GameUpgrade` gains `unlocked`. Unit tests in
  `tests/unit/butter-biscuit.test.ts` and `tests/unit/priority.test.ts`.

- **5.8.16** Krumblor trains up to Dragonflight instead of Dragon Cursor
  (KRUMB-\*): levels 5-13 each sacrifice 100 of one building (cursors to
  shipments), every one handled like the cursors were (the copies above
  100 sold first and bought back after, missing ones bought when cheap).
  Dragon Cursor put on by an earlier version is swapped for Dragonflight.
  Steps `sell-buildings`/`buy-buildings` replace `sell-cursors`/
  `buy-cursors`; new `runtime.krumblorRebuyId`, `DRAGONFLIGHT_AURA`,
  `DRAGON_SACRIFICE_BUILDINGS`. Unit tests in `tests/unit/krumblor.test.ts`.

- **5.8.15** New paw sprites (PAW-2): open paw, fist and a new peace
  sign, drawn upright (no longer mirrored) in one shared 684x1010 frame at
  68px tall; the click point moved to the new middle claw tip. The paw
  shows the peace sign while it does a happy dance (`runtime.pawPeace`,
  set by `DanceAction`). Unit tests in `tests/unit/dance.test.ts`.

- **5.8.14** Dragonflight is treated like Click Frenzy (CF-8):
  `clickFrenzyActive()` is true for either buff, so the paw hammers it at
  the frenzy's rate and priority, and FTHOF, refills, shopping etc. hold
  off like during a Click Frenzy. Unit test in `tests/unit/priority.test.ts`.

- **5.8.13** The paw hammers the big cookie through every combo of at least
  two positive buffs (CF-7: `multCpS > 1` or `multClick > 1`), not only
  during Click Frenzy; only FTHOF and the refill go first. New
  `buffComboActive()`, `JOB_PRIORITY.BUFF_COMBO`. Unit tests in
  `tests/unit/priority.test.ts`.

- **5.8.12** Kick-off hammering (AUTO-19): right after auto play buys
  "Heavenly key" (after an ascension) the paw hammers the big cookie for
  10s, ahead of shopping and the other auto play steps, so the clicking
  upgrades unlock early. `AutoHammer.startKick()`/`kicking()`,
  `AutoPlayEngine.onKickUpgrade`, `PriorityDeps.hammerKick`. Unit tests in
  `tests/unit/auto-hammer.test.ts` and `tests/unit/priority.test.ts`.

- **5.8.11** The ascension screen's overlay (the heavenly upgrade boxes,
  the Reincarnate box and its card, ASC-7) is only drawn while auto play is
  on; the Legacy card (ASC-6) stays as it is.

- **5.8.10** Two new main panel buttons for the stock market (STOCK-9):
  "Pause investments" (without auto play; `stockInvest`, stored) stops the
  paw from spending on stocks and brokers while it keeps selling, and "Cash
  stock market wins" sells every stock that isn't at a loss, with the
  goods and the cookies it brings back in its tooltip. New
  `marketCashable()`/`marketCashOutValue()`,
  `StockTrader.investAllowed()`/`toggleInvest()`/`cashOutPreview()`/
  `toggleCashOut()`, `runtime.marketCashOutUntil`. Unit tests in
  `tests/unit/stock-market.test.ts`.

- **5.8.9** While auto play saves up for a purchase, the stock trader puts
  at most 10% of bank + stocks into stocks (was the full 50%,
  `stockMaxShare`), so a dip in the market can't eat the savings (STOCK-4,
  `MARKET_SAVING_SHARE`, `StockTrader.saving`). Unit test in
  `tests/unit/stock-market.test.ts`.

- **5.8.8** Preference order (AUTO-4 B): golden, click power and kitten
  upgrades (and the Easter eggs and Santa's gifts that share their tier)
  first, then the Bingo center, then Wizard towers below their target (was
  Bingo center, Wizard towers, golden). Unit tests in
  `tests/unit/wrinklers.test.ts` and `tests/unit/strategy.test.ts`.

- **5.8.7** The fingers series, the mouse series ("Clicking gains +1% of
  your CpS") and the kitten upgrades are preferred too, like the cursor
  doublers and golden upgrades (AUTO-4 B, `AUTO_PREF_TYPES`), so they score
  100 on the overlay (BUY-2). Unit test in
  `tests/unit/heavenly-unlocks.test.ts`.

- **5.8.6** The "how good is a buy" score follows what the bot wants to buy
  (BUY-2): its next pick and every preferred option (the Bingo center,
  golden upgrades, the cursor doublers, Wizard towers below their target)
  score 100 instead of their payback rank, so the overlay no longer shows a
  Bingo center the bot is about to buy as a 70. New `buyValueRanks()`; unit
  tests in `tests/unit/buy-value-overlay.test.ts`.

- **5.8.5** The "mouse and cursors twice as efficient" upgrades are
  preferred like golden cookie upgrades (AUTO-4 B): cheap, and they double
  the click power every Click Frenzy multiplies ×777, which their
  hammer-rate valuation missed, so they waited behind better-rated items.
  Unit test in `tests/unit/heavenly-unlocks.test.ts`.

- **5.8.4** The building streak (AUTO-14) buys stacks of 10 per press while
  the 10 copies together are still pocket money (<= 60s of CpS or <= 1% of
  the bank) and leave enough for the tick's pick (`autoStackSize()`,
  `autoBuyBuilding()`), so streaks after an ascension go ~10× faster.
  Unit tests in `tests/unit/buy-streak.test.ts`.

- **5.8.3** Fixed: the Bingo center, costing next to nothing, waited in the
  store behind everything better rated (its payback counts the ~8h until
  the wrinklers pay out). It now has its own top preference tier
  (`AUTO_PREF_BINGO`, WRINK-1/AUTO-4 B): bought first once affordable, so
  the research starts as early as possible. The "how good is a buy"
  overlay still scores it by payback (BUY-2). Unit test in
  `tests/unit/wrinklers.test.ts`.

- **5.8.2** Junk spree (AUTO-18): after an ascension the store fills with
  a hundred cheap items and the paw fetched them one trip at a time. Now,
  after a purchase, it hops straight from item to item and buys every
  eligible one costing <= 60s of CpS (`autoInsignificantSec`) at ~10 per
  second, a pulse per buy. `AutoPlayEngine.buyStreak()` became
  `buySpree()`, `autoStreakContinues()`/`streakCandidate()` became
  `autoSpreeNext()`. Unit tests in `tests/unit/buy-streak.test.ts`.

- **5.8.1** Garden profit (GARDEN-10): the garden's CpS bonus over time,
  its harvest payouts and minus the seeds the paw planted, in cookies
  (`stats.gardenProfit`, `Gardener.track()`, sampled once a second by the
  scheduler); shown as "Garden profit" in the HUD statistics and "+5.0% CpS;
  made +1.2M cookies" in the Garden row. The garden snapshot gains
  `cpsMult`. A harvest's `cookies` log field now only counts payout crops.
  Unit tests in `tests/unit/garden.test.ts`.

- **5.8.0** New module: the garden (GARDEN-\*). With the new setting
  "Tend the garden" (`garden`, on) the paw keeps the Farm's garden full of
  Baker's wheat on clay (dirt below 100 farms), harvests plants before they
  wither (for their seed chance and drops), harvests new seeds as soon as
  they are mature, weeds out known pests, harvests payout crops during a
  CpS buff, and never plants during one; every step a real click on the
  garden's tiles, seeds and soils (`GardenClickAction`). With auto play it
  also unlocks the garden (Farm level 1, AUTO-17, `FarmUnlocker`); it never
  spends another lump on it. The Bank's unlock became the shared
  `MinigameUnlocker`. New HUD row "Garden", stats "Garden: planted" /
  "Garden: harvested", moods `garden` and `farm-unlock`; `IGameAdapter`
  gains `getGardenSnapshot()`. Unit tests in `tests/unit/garden.test.ts`.

- **5.7.5** De-cluttered the main panel: Graphs, Logs and Debug tools
  moved behind a "More..." button (UI-3), the Debug tools button is hidden
  unless the new Advanced setting "Show debug tools (cheats)"
  (`showDebugTools`, off) is on, and the Buffies, LOCK_A, Click cooldown
  and Background rows are folded under a collapsed "Details" (UI-2).

- **5.7.4** Settings split into "Basic" and a collapsed "Advanced"
  section, for the general and the auto play settings alike (UI-11), to
  de-clutter the main panel.

- **5.7.3** The multiplier counter (FX-4) is shown only for a moment again:
  8s after a catch or a change, fading out, instead of for the whole buff.

- **5.7.2** The hunting show's counter bottom left (FX-4) shows the buffs'
  total CpS multiplier ("7x" during a Frenzy, `buffMultiplier()`) instead
  of the catch combo, for the whole buff; a miss just says "MISS". Unit
  tests in `tests/unit/hunt-fx.test.ts`.

- **5.7.1** Fixed: the paw seemed to click into thin air over the store.
  The store column (`#sectionRight`) scrolls on its own, and a building far
  down the list (e.g. the Javascript console) was scrolled out of it:
  `storeApproachPoint()` found nothing to head for, so the paw stayed where
  it was and bought (a whole streak, ~10 pulses a second) out of sight. It
  now wheel-scrolls the store column to the item first, for shopping,
  Krumblor's egg and cursors and the achievement purchases before an
  ascension (AUTO-9; `storeScrollTarget()`, `storeScrollJob()`;
  `ScrollIntoViewAction` takes a `container`). Unit tests in
  `tests/unit/store-dom.test.ts`.

- **5.7.0** The hunting show (FX-\*): an over-the-top, osu!-style layer
  while golden cookies and reindeer are hunted, on by default, opt-out via
  the new setting "Over-the-top hunting show (osu! mode)" (`huntFx`).
  Hit circles with approach circles timed to the planned click, follow
  points along the route, a rainbow paw trail, sweeping spotlights and a
  beat-pulsing vignette, particle bursts, shockwaves, "300" judgements
  shouting the effect, a combo counter with combo breaks on a miss, and a
  rainbow storm/chain banner. Flashes are rate-limited and skipped with
  reduced motion. New `src/rendering/hunt-fx.ts`, `collectHunt()` shared by
  the hitboxes, `runtime.huntFxEvents` filled by `GoldenCookieAction`. Unit
  tests in `tests/unit/hunt-fx.test.ts`.

- **5.6.12** Fixed: the committed ascension (ASC-12) could still wait past
  its level. Only the whole block of levels holding the 7s had to last
  ASC_FINAL_SEC; the target itself could sit near the end of its block
  (e.g. 1,177,950 of 1,177,000-1,177,999), leaving a few seconds, and the
  routine's purchases (buildings, achievement milk for the kittens) raise
  the CpS on top. The target now needs its remaining window to last
  ASC_FINAL_SEC (`nextLuckyTarget()`, `luckyWindowEnd()`,
  `luckyWindowLevels()`, `HeavenlyShopInput.luckyMinLevels`), and while
  waiting the bot re-checks the window at the real unbuffed CpS: one
  shorter than 20s (`MIN_WINDOW_SEC`) or one that passed moves the target to
  the next window that holds, without leaving the routine (no golden cookies
  in between). The log now records the level at the Legacy click and the
  level the ascension landed on. Unit tests in
  `tests/unit/ascension-runner.test.ts` and `tests/unit/ascension.test.ts`.

- **5.6.11** Fixed: the committed ascension (ASC-12) still missed its level
  after a long wait. It was timed with the measured income, which counts
  what attached wrinklers digest (6-8× the CpS with a full set); once the
  paw popped them the level came far later than planned, the routine's
  deadline (2 × lead + 10 min) called it off shortly before the level, the
  bot went back to golden cookies and hammering, and rushed past. The
  routine is now timed with the unbuffed CpS it really gets
  (`AscensionInput.routineIncome`, `AscensionPlan.routineEtaSec`), and it
  keeps holding as long as the level is at most 1h off at that CpS
  (`MAX_HOLD_SEC`, replaces `AscendTarget.until`). The 7s' window must now
  hold 60s (`ASC_FINAL_SEC`, was 30s) for a CpS the routine's purchases
  raise. Unit tests in `tests/unit/ascension-runner.test.ts` and
  `tests/unit/ascension.test.ts`.

- **5.6.10** Reworked when an automatic ascension starts (ASC-12): it used
  to chase the level that was lucky right now, rush past it while popping,
  selling and buying, and start over at the next one. Now the planner picks
  a lucky level that is still ahead once the routine before ascending is
  done (`AscensionInput.leadSec`, `luckyFromLevel`), and the bot locks that
  level (`runtime.ascendTarget`) once it is the lead time away (the
  routine's estimate × 1.5 + 60s, `AscensionRunner.leadSec()`). From then on
  the routine outranks everything, golden cookies included (SCHED-1 tier 0,
  `JOB_PRIORITY.ASCEND`): pop the wrinklers, sell the stocks, spend the bank
  on achievements, hold still at Legacy until the level is there, ascend.
  A level that passed anyway or never comes is called off and a new one
  planned. The digit the 7s sit at only has to hold the last two clicks now
  (ASC-15, `ASC_FINAL_SEC`); the early preparation of ASC-14 is gone.
  `AscensionPlan.luckySafeSec` became `luckyEnd`; new step `hold`,
  `WaitWhileAction` takes a point. Unit tests in
  `tests/unit/ascension-runner.test.ts`, `tests/unit/ascension.test.ts` and
  `tests/unit/priority.test.ts`.

- **5.6.9** While waiting for the level (ASC-14) the paw pops the
  wrinklers first, then sells the stocks and spends the bank, so the
  wrinklers' cookies go into the achievements too instead of being popped
  only at the very end. Unit tests in `tests/unit/ascension-runner.test.ts`.

- **5.6.8** Lucky levels aim their 7s at digits that hold still (ASC-15):
  the planner picks the lowest digit position whose value lasts at least
  the last steps' time (30s + 5s per wrinkler) at the current income and
  counts only the 7s from there up, e.g. 1,177,xxx instead of 1,100,077,
  whose last digits flip before the paw can click. New `luckyMinDigit()`,
  `countSevensFrom()`, `AscensionPlan.luckyDigit`;
  `nextLevelWithSevens()` takes the lowest digit; the margin constants moved
  to `ascension-strategy.ts`. Unit tests in `tests/unit/ascension.test.ts`.

- **5.6.7** Waiting for a lucky level now comes last (ASC-14): as soon as the
  plan says "WAIT: ascend at level L", the paw sells the stocks and spends
  the bank on achievements once, right away, instead of doing it all inside
  the lucky window, where ASC-12's margin often made it let the window go.
  The trader buys no new stocks while the ascension is armed
  (`StockTrader.holdBuys`, `AscensionRunner.armed()`); the wrinklers keep
  digesting until the end. New step flag `AscendState.prep`,
  `runtime.ascendPrepDone`. Unit tests in `tests/unit/ascension-runner.test.ts`
  and `tests/unit/stock-market.test.ts`.

- **5.6.6** Before an automatic ascension the paw now sells every stock and
  spends the whole bank on building count achievements, cheapest first
  (ASC-13): the ascension throws the bank away, but achievements stay won
  (+4% milk each) and spending doesn't lower the prestige gained. New
  setting "Auto: spend the bank on achievements before ascending"
  (`ascendDumpBank`, on), new `src/autoplay/achievement-dump.ts`
  (`planAchievementDump()`), `AchievementDumpAction`,
  `StockTrader.dumpableGoods()`/`sellAllJob()`, steps `sell-stock`/`dump`;
  the lucky-level margin (ASC-12) counts the extra time. Unit tests in
  `tests/unit/achievement-dump.test.ts` and
  `tests/unit/ascension-runner.test.ts`.

- **5.6.5** New debug tool "Stock market: speed x50 (on/off)" (DBG-24): the
  market ticks every 1.2s instead of every minute, to test the trader
  (STOCK-\*) without waiting hours. `IGameAdapter` gains `getMarketSpeed()`
  and `setMarketSpeed()`. Unit tests in `tests/unit/game-adapter.test.ts`.

- **5.6.4** The ascension's status line says "Paw:" instead of "Bot:" (the
  HUD row, the Legacy card and the ascension screen card; ASC-11).

- **5.6.3** The paw's stock market result is tracked (STOCK-6): every buy
  adds to a persisted cost basis per good (`stats.stockBasis`), every sale
  books its proceeds against the average cost into `stats.stockProfit`
  (losses too), with the game's own price formulas. New HUD statistic
  "Stock market profit"; the "Stock market" row shows "paw made +X cookies"
  and the unrealized gain or loss of what it holds, instead of the game's own
  $ profit (which also counts trades by hand). `StatsRecorder` gains
  `recordStockBuy()`/`recordStockSell()`/`reconcileStockBasis()`. Unit tests
  in `tests/unit/stock-market.test.ts`.

- **5.6.2** Fixed: the paw sometimes pressed an upgrade or building in the
  store and nothing was bought. The shopping job pressed first and re-planned
  after; when the plan's first pick had changed on the way (hammering stops
  while the paw walks, so near-equal options swap places), it left
  silently, and the next job walked to the other item. It now decides
  before the press, still buys the item it stands on when that is one of
  this tick's purchases and leaves enough for the pick (`shopPickAt()`,
  `Decision.buyable`), presses only together with the purchase, and logs
  `"changed its mind at X"` otherwise (AUTO-9). Unit tests in
  `tests/unit/strategy.test.ts`.

- **5.6.1** "Play the stock market" (`stockMarket`) is on by default
  (STOCK-1): the paw trades without being asked (within the 50% budget,
  STOCK-4), and with auto play the Bank gets unlocked with a sugar lump
  (AUTO-16).

- **5.6.0** New module: the stock market (STOCK-\*). With the new setting
  "Play the stock market" (`stockMarket`, off) the paw trades on the Bank's
  minigame: it buys a good at or below 0.3 × (resting value + 10) once the
  price turned up, sells it once it has been at 0.7 × that and fell 5% from
  its peak (never at a loss), hires brokers when they pay, and keeps stocks
  within "Stocks: invest at most (share of bank)" (`stockMaxShare`, 0.5);
  thresholds tuned on a simulation of the game's own market tick. Every
  trade is a real click on the market's buttons (`MarketClickAction`). With
  auto play it also unlocks the market with a sugar lump (Bank level 1,
  AUTO-16, `BankUnlocker`). The Grimoire's step planner became the shared
  `MinigameView` (`src/hunting/minigame-view.ts`), its level click the
  shared `MinigameUnlockAction`. New HUD row "Stock market", stat "Stock
  trades", moods `stock-market` and `bank-unlock`, debug tools "Stock
  market: next tick now" (DBG-22) and "crash prices" (DBG-23);
  `IGameAdapter` gains `getMarketSnapshot()`, `marketTickNow()` and
  `crashMarket()`. Unit tests in `tests/unit/stock-market.test.ts`.

- **5.5.11** The ascension overlay switch moved from the HUD's button row
  into the settings, as the checkbox "Show ascension overlay"
  (`showAscendOverlay`, staged like every setting, UI-4; ASC-6).

- **5.5.10** New debug tool "Show update popup" (DBG-21): shows the
  update popup (UPD-2) with the version "DUMMY", without asking GitHub.

- **5.5.9** Update check (UPD-\*): at start-up the bot asks GitHub's API
  for the latest release and, if it is newer, pops up "There's an update
  for your gewd boy :3 Wanna update now?" with a shiny rainbow button that
  links straight to that release's `cc-good-boy.user.js`, so Tampermonkey
  offers the update. NFR-2 now allows this one request. New
  `src/lifecycle/update-check.ts`; unit tests in
  `tests/unit/update-check.test.ts`.

- **5.5.8** Undid 5.5.7's lift of the game's tooltips above the overlay
  (it wasn't enough). Instead the Legacy box and card are not drawn while
  the mouse is over the Legacy button, so its tooltip is readable (ASC-6).

- **5.5.7** The Legacy card opens when the mouse is over the card itself,
  not the Legacy button (ASC-6), and the game's own tooltips
  (`#tooltipAnchor`) now sit above the bot's overlay canvas, so the Legacy
  tooltip is readable again. The "Prestige" line no longer repeats the
  levels gained ("Prestige: 4,317 -> 54,369").

- **5.5.6** The Legacy card (ASC-6) is collapsed to one line, the level
  after ascending and the answer ("Lv 54,369 · ASCEND NOW"), and opens
  fully while the mouse is over the Legacy button or the card. The full
  card (and the HUD row) also shows "Heavenly chips to spend" (ASC-5). New
  `compactLine()`. Unit tests in `tests/unit/ascension.test.ts`.

- **5.5.5** The ascension texts were easy to misread ("worth ascending
  now" next to "saving for Unholy bait ... ~148h" read like a 148h wait,
  and a missing auto line had to be guessed from). Every card and the HUD
  row now answer in plain words, one fact per line (ASC-5): a headline
  ASCEND NOW / WAIT / NOT YET and why, "Prestige: a -> b (+n levels)", "CpS
  bonus after ascending", and only when ascending is on the table "Buy in
  heaven" and "Later: X (cost)" with the leftover chips' share of it. A
  "Bot:" line is always there, auto play on or off (ASC-11,
  `AscensionRunner.botLine()`, was `autoNote()`); the ascension screen says
  "BUY THE PINK ONES, in order" or "NOTHING TO BUY: click Reincarnate"
  (ASC-7). New `planLines()`, `verdictLines()`, `heavenLines()`,
  `heavenScreenLines()` replace `verdictText()`/`shopText()`/`shopLines()`.
  Unit tests in `tests/unit/ascension.test.ts` and
  `tests/unit/ascension-runner.test.ts`.

- **5.5.5** The next wish's line read like a wait ("saving for Unholy bait
  ... ~148h") although the bot was about to ascend without it. It now says
  "left over for next time: 25.8K of 44.4K chips for Unholy bait (58%)", with
  no ETA (ASC-5/ASC-6).

- **5.5.4** Fixed: the heavenly shopping list (ASC-9) waited for any wish
  the run could reach within 6h, however much it cost: at +47,826 levels
  (x12 CpS) it held the ascension back for 25K more chips for Unholy bait.
  An ordinary wish is now only waited for while the extra levels stay within
  "Ascend: wait for heavenly upgrades at most (x levels gained)"
  (`ascendShopWaitShare`, 10% of what the ascension gains); beyond that it is
  saved for next time. Lucky wishes keep their own time budget. Unit tests
  in `tests/unit/heavenly-shopping.test.ts` and `tests/unit/ascension.test.ts`.

- **5.5.3** Fixed: auto ascension looped: it opened the "Ascend" prompt,
  clicked "Cancel" at once, hammered, and opened it again. In the moment
  between the Legacy click and the bot claiming the prompt, shopping got a
  tick, had its re-plan refused (a prompt was open) and paused itself for
  1.5s, and the ascension's gate treated shopping's pause as a reason not to
  ascend. The gate now only minds its own pause, the prompt is claimed the
  instant Legacy is clicked (`DragonClickParams.onClicked`), and shopping
  never starts while any prompt is open (AUTO-7, `shoppingAllowed()`).
  Unit tests in `tests/unit/ascension-runner.test.ts` and the new
  `tests/unit/shopping-gates.test.ts`.

- **5.5.2** "Auto: ascend" is on by default (ASC-10): with auto play on,
  the bot ascends by itself. Popping wrinklers before ascending can no
  longer cost a lucky level's 7s (ASC-12): when the shopping list holds a
  lucky upgrade, the bot only starts if the level keeps its 7s long enough
  for the pops and clicks (30s + 5s per wrinkler), else it waits for the
  next lucky level; new `AscensionPlan.luckySafeSec`,
  `HeavenlyShopPlan.sevens`. Unit tests in `tests/unit/ascension.test.ts`
  and `tests/unit/ascension-runner.test.ts`.

- **5.5.1** The ascension texts are neutral now ("worth ascending now",
  "shopping list: ...") instead of tips that read wrong in auto play (ASC-5),
  with what auto play does about it on its own line (ASC-11: "auto:
  ascending now", "auto: ascends once the buffs are over", "Auto: ascend is
  off", ...). The wish saved for next shows its progress (chips left after
  the list / its cost, %, ETA; `savingProgress()`). The Legacy card is
  right-anchored to the Legacy frame so it no longer grows into the store.
  Unit tests in `tests/unit/ascension.test.ts` and
  `tests/unit/ascension-runner.test.ts`.

- **5.5.0** Auto ascension (ASC-10): with auto play and the new setting
  "Auto: ascend" (`autoAscend`, off by default), the bot acts on the
  planner's "ascend now": it pops every wrinkler (the game would throw
  their cookies away, so the planner now also counts them for prestige),
  clicks Legacy and "Ascend", waits out the animation, drags the heavenly
  tree to each crate on its shopping list and buys it, clicks Reincarnate
  and "Yes", and resets its per-run state; never during a buff or anything
  more important, and it cancels its own "Ascend" prompt if the moment
  passes. Without it, the HUD row and overlay are worded as tips ("tip:
  good time to ascend; then buy ...") instead of as if the bot would act.
  Lump harvesting now skips the ascension screen (LUMP-7). New mood
  `ascend`, stat "Ascensions"; `IGameAdapter` gains `isAscendIntro()` and
  `panAscendTree()`; new `src/autoplay/ascension-steps.ts`,
  `ascension-runner.ts`, `src/actions/ascension.ts`,
  `src/game/ascension-dom.ts`, `RuntimeState.resetForNewRun()`. Unit tests
  in `tests/unit/ascension-runner.test.ts` and `tests/unit/ascension.test.ts`.

- **5.4.2** The ascension planner now plans its heavenly shopping list
  before ascending (ASC-9): a priority list of 41 heavenly upgrades, taken
  with their missing parents, and the run goes on until the chips pay for
  it (new setting "Ascend: wait for heavenly upgrades up to (s)",
  `ascendShopWaitSec`, 6h), so it never ascends a few chips short. The
  lucky upgrades became wishes on that list (their 7s level within the
  lucky wait) instead of a separate target; the verdict "waiting for
  <lucky>" is now "waiting for level L to afford <wish>". The HUD and the
  Legacy card show the list; on the ascension screen the planned upgrades
  get a pink box with their buying order. New HUD button "Ascend overlay"
  (`showAscendOverlay`, on) switches the ascension overlay. New
  `src/autoplay/heavenly-shopping.ts` (the lucky/7s helpers moved there).
  Unit tests in `tests/unit/heavenly-shopping.test.ts` and
  `tests/unit/ascension.test.ts`.

- **5.4.1** Fixed: the ascension planner (ASC-\*) said "would ascend now"
  for a stagnating run worth only 10 levels from prestige 0 (+10% CpS),
  which throws a whole run away for almost nothing. An ascension now also
  needs a noticeable impact (ASC-8): the prestige CpS bonus must grow by the
  new setting "Ascend: minimum CpS boost (x)" (`ascendMinBoost`, default
  2), on top of the run stagnating. New verdict "too small" with the level
  needed and its ETA; lucky levels are searched from that level on; the
  Legacy label shows the boost. Unit tests in `tests/unit/ascension.test.ts`.

- **5.4.0** New read-only module: ascension planning (ASC-\*). The bot
  works out what ascending now would give (pending level, chips), whether
  the run stagnates (marginal prestige rate below the run's average, from
  income measured over 30 minutes) and which lucky level to aim for: the
  nearest level containing enough 7s for Lucky digit/number/payout that the
  chips then pay for (ancestors included) within the new setting "Ascend:
  wait for a lucky level up to (s)" (`ascendLuckyWaitSec`, 1 day). New HUD
  row "Ascension"; the overlay boxes the Legacy button with "Lv current +
  gained = pending" and the plan, and on the ascension screen every
  heavenly upgrade by state (owned, buyable, too pricey, not available,
  lucky) with its price, plus the Reincarnate button. It never ascends or
  buys anything. `IGameAdapter` gains `getHeavenlyChips()`,
  `getCookiesReset()`, `getCookiesEarned()`, `getHCFactor()`,
  `onAscendScreen()` and `getHeavenlyUpgrades()`; new `formatShort()`. Unit
  tests in `tests/unit/ascension.test.ts`.

- **5.3.11** Achievement top-offs (AUTO-15) no longer lock in. A cheap
  copy on its way to a far milestone counted as "insignificant" by its own
  price and so was never held back, even when the whole top-off cost as
  much as a better upgrade; `autoDecide()` now judges it by the whole
  top-off (`PurchaseCandidate.projectCost`) for "insignificant", the buy
  order and postponement. A top-off is never a save target any more, and
  it must beat alternatives by 1.5× (`AUTO_MILESTONE_MARGIN`), so an
  upgrade in the same ballpark wins. Unit tests in
  `tests/unit/achievement-milestones.test.ts`.

- **5.3.10** Auto play tops buildings off to their next count achievement
  (AUTO-15): 98 cursors become 100 even when two more cursors alone would
  rank low, because the achievement's milk makes every owned kitten worth
  more. The missing copies are valued as one project (their price against
  their own gain plus the achievement's), like the research chain. New
  `src/autoplay/achievement-milestones.ts`; `IGameAdapter` gains
  `getUnwonBuildingAchievementCounts()`; building candidates carry
  `milestone`, shown in the HUD plan and the `"auto buy"` log. Unit tests
  in `tests/unit/achievement-milestones.test.ts`.

- **5.3.9** The upgrade store opens every time the paw gets there
  (AUTO-9). The game's store sections are one row tall and only open on a
  real CSS `:hover`, so a crate in a later row was clipped away: the paw
  didn't visit it and the purchase happened out of sight. The paw now
  heads for the section's visible strip, opens the section (class
  `ccsb-store-open`, styled in `src/ui/styles.ts`), moves onto the crate,
  buys, and closes the section on leaving. New `src/game/store-dom.ts`
  and `src/actions/store-visit.ts`, used by the shop and Krumblor's egg
  purchase (`DragonStoreAction` gains `el`). Unit tests in
  `tests/unit/store-dom.test.ts`.

- **5.3.8** Auto play's buy order (AUTO-4): on a flush bank it bought 100
  of every cheap building first, because the higher tiers have the worse
  raw payback (cost ~10× for ~5-8× the CpS) — right per cookie, but with
  a huge bank the paw's time is the limit and the big buildings add far
  more CpS sooner. Among affordable purchases a cost at or below 1% of the
  spendable bank now counts as that 1% (`AUTO_TRIVIAL_BANK_SHARE`,
  `DecisionRow.order`), so pocket-money purchases go biggest CpS gain
  first; a tight bank still orders by payback. The buying streak
  (AUTO-14) now only continues while its building is the tick's pick
  (`autoStreakContinues(d, c)`), so it can no longer spend the bank on
  cheap buildings a better purchase needed; `Decision.buyable` from 5.3.7
  is gone again. Unit tests in `tests/unit/buy-streak.test.ts`.

- **5.3.7** Reworked 5.3.6's bulk buying (AUTO-14): it bought 10/100 only
  when the same building would win every pick that many times in a row,
  which almost never happens (the pick alternates between buildings as
  prices rise), so it still bought e.g. 17 cursors one trip at a time on
  a quadrillion bank. Now the paw stays on the building row and buys it
  again and again as single purchases, ~10 per second with time and
  position jitter, while it is still worth buying and the best pick stays
  affordable (up to 100 per visit). `autoBulkCount()`/`bulk-buy.ts` are
  replaced by `autoStreakContinues()` (`src/autoplay/buy-streak.ts`) and
  `AutoPlayEngine.buyStreak()`; `autoBuy()` is single-purchase again;
  `autoDecide()` also returns its `buyable` list. Unit tests in
  `tests/unit/buy-streak.test.ts`.

- **5.3.6** Auto play buys buildings 10 or 100 at a time when it would
  pick the same building that many times in a row anyway (AUTO-14), so
  e.g. 100 cursors after an ascension take one store visit instead of 100
  trips between the big cookie and the store. New `autoBulkCount()`
  (`src/autoplay/bulk-buy.ts`) replays `autoDecide()` with each next
  copy's price; `autoBuy()` takes a count and returns how many it bought;
  building candidates carry `maxCount` under a cap. Unit tests in
  `tests/unit/bulk-buy.test.ts`.

- **5.3.5** Fixed: auto play never bought the Valentine's heart biscuits.
  The game gives their power as a function (`heartPower`), which the
  biscuit valuation read as NaN and so left them unclassified. New
  `biscuitPower()` (`src/autoplay/upgrade-classifier.ts`) evaluates it
  (AUTO-3), also for the bought-biscuit base; the "how good is a buy"
  overlay scores them too. Unit tests in
  `tests/unit/upgrade-classifier.test.ts`.

- **5.3.4** New debug tool "Unlock all valentines upgrades" (DBG-20): puts
  the 7 heart biscuits in the store; `IGameAdapter` gains
  `unlockValentinesCookies()`.

- **5.3.3** Fixed: the paw chased a reindeer to where it had been and
  clicked long after it had run on. It now leads the reindeer (XMAS-6):
  new `src/game/reindeer.ts` predicts its centre from the game's own motion
  formula and plans the meeting point after the trip, pre-click pause and
  press; `GoldenCookieAction` aims there, waits in the reindeer's path and
  clicks where the paw is. `IGameAdapter` gains `getShimmerFieldWidth()`,
  `CursorClickTiming` exposes `getPreClickDelayMs()`, and
  `cursor-controller.ts` exports `pawTravelSpeed()`/`expectedTravelMs()`.
  Unit tests in `tests/unit/reindeer.test.ts`.

- **5.3.2** The paw now catches reindeer like golden cookies (XMAS-6):
  `GoldenCookieModel` counts `type === 'reindeer'` shimmers as good ones
  (`CATCHABLE_SHIMMER_TYPES`, the game's power-12 fade curve), and
  `GoldenCookieAction` records a catch as "Reindeer" (stats, its own graph
  colour), logs `"click reindeer"` and says so in the console. The happy
  dance waits while a reindeer is around. DBG-19 now says the paw goes
  after the reindeer. Unit tests in `tests/unit/reindeer.test.ts`.

- **5.3.1** New debug tool "Spawn reindeer" (DBG-19); `IGameAdapter`
  gains `spawnReindeer()`.

- **5.3.0** New auto play module: Christmas (XMAS-\*). Auto play buys "A
  festive hat", Santa's 14 gifts and Santa's dominion, each valued by its
  own effect (`src/autoplay/christmas.ts`, `christmasUpgradeGain()`; the
  reindeer biscuits were already bought as biscuits), and evolves Santa up
  to Final Claus through his tab and "Evolve" button (`SantaTrainer`,
  `src/autoplay/santa.ts`, pure logic in `santa-strategy.ts`), buying each
  new gift before the next evolution triples its price. New mood `santa`,
  debug tool "Unlock all christmas upgrades" (DBG-18); `IGameAdapter` gains
  `getSantaLevel()` and `unlockChristmasUpgrades()`; `DragonClickAction`
  takes an optional HUD mood. Unit tests in `tests/unit/christmas.test.ts`
  and `tests/unit/priority.test.ts`.

- **5.2.2** New debug tool "Unlock all halloween upgrades" (DBG-17): puts
  the 7 Halloween cookies in the store; `IGameAdapter` gains
  `unlockHalloweenCookies()`. Auto play already bought them as biscuits.

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
