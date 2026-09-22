// ==UserScript==
// @name         CC Good Boy
// @namespace    openai-cookie-clicker-smart-bot
// @version      3.11.1
// @description  CC Good Boy: a cute little golden-cookie hunter with Click Frenzy clicking, FTHOF combos, sugar-lump refills, debug HUD, logs and charts uwu
// @match        https://orteil.dashnet.org/cookieclicker/*
// @match        http://orteil.dashnet.org/cookieclicker/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
================================================================================
 CC GOOD BOY  -  Cookie Clicker golden-cookie hunter
 This single file is the SPECIFICATION, the DOCUMENTATION and the APPLICATION.
================================================================================

 HOW TO READ THIS FILE
   1. This header       requirements (with IDs), configuration reference,
                        architecture, behaviour rules, data formats, API,
                        assumptions, manual test plan, changelog.
   2. Section banners   "SECTION n" banners in the code follow the table of
                        contents below.
   3. JSDoc blocks      every function/constant is documented; "@req" tags
                        link code back to the requirement IDs used here.
 Whenever behaviour changes, update the matching requirement, the JSDoc and the
 changelog, and bump the version (see NFR-1).

--------------------------------------------------------------------------------
 TABLE OF CONTENTS (code)
   SECTION 1   Constants, defaults, runtime state
   SECTION 2   Persistence and small utilities
   SECTION 3   Statistics and logging
   SECTION 4   Game accessors, buffs, LOCK_A
   SECTION 5   Hurry mode (cookie storm / cookie chain)
   SECTION 6   Golden cookie model (fade curve, shimmers, geometry)
   SECTION 7   Route planning (least travel)
   SECTION 8   Input synthesis, waiting helpers, cursor motion
   SECTION 9   Actions (golden cookie, big cookie, FTHOF, refill)
   SECTION 10  Idle behaviour and happy dance
   SECTION 10A Auto play mode (shopping)
   SECTION 11  Scheduler (priorities)
   SECTION 12  User interface (styles, panel, settings, logs, debug tools)
   SECTION 13  Overlay and paw cursor rendering
   SECTION 14  Charts
   SECTION 15  Lifecycle (start / destroy / real-mouse sync)

--------------------------------------------------------------------------------
 1. PURPOSE AND SCOPE
   A userscript for Cookie Clicker (https://orteil.dashnet.org/cookieclicker/)
   that plays the "golden cookie game" like a very polite, slightly playful
   human: it catches good golden cookies, hammers the big cookie during Click
   Frenzy, keeps a Grimoire "Force the Hand of Fate" (FTHOF) combo going, and
   shows all of that through a little paw cursor, a HUD, charts and logs.
   It also ships "debug tools" (cheats) to test the hunter in a test save.

   Out of scope: wrinklers, seasons, garden, stock market, pantheon, ascending.
   Buying is only done by the optional, OFF-by-default "Auto play" mode (AUTO-*)
   and even then only through the game's own buy functions. The bot NEVER
   clicks anything except: good golden cookies, the big cookie, the FTHOF spell
   button and the lump-refill button (the paw only "visits" store items, AUTO-9).

--------------------------------------------------------------------------------
 2. TERMS
   good cookie    a golden shimmer that is not wrath.
   wrath cookie   a golden shimmer with wrath > 0 (never clicked).
   ready          a good cookie that passed the fade-in threshold (queueable).
   pending        a good cookie that is still fading in (highlighted only).
   fade curve     1 - (2*life/(fps*dur) - 1)^4 : 0 at spawn, 1 at mid-life,
                  0 again at despawn (mirrors the game's own opacity formula).
   paw            the virtual cursor drawn on an overlay canvas.
   click point    where the paw clicks: the tip of its middle claw.
   CpS buff       an active buff with multCpS > 1 (Frenzy, Building special...).
   FTHOF          the Grimoire spell "Force the Hand of Fate".
   refill         spending a sugar lump to refill mana (15 min game cooldown).
   LOCK_A         the bot's own lock that prevents a second lump refill until
                  the CpS buff situation changes (see FT-6).
   hurry mode     reduced delays/thresholds and faster paw during a cookie
                  storm or cookie chain (HURRY-1).
   hammer mode    button that clicks the big cookie non-stop (CF-4).
   task           one unit of work run by the scheduler; only one at a time.
   auto play      the optional shopping mode (AUTO-*).
   payback        cost / approximate CpS gain of a purchase, in seconds
                  ("rentability"; lower is better).
   impact         CpS gain / current CpS (how much it changes production,
                  regardless of its cost).
   in reach       affordable within a set time at the current income.

--------------------------------------------------------------------------------
 3. FUNCTIONAL REQUIREMENTS
 (Each requirement has an ID. "Acceptance" says how to check it, "Debug" points
  at the Debug tools button that makes the check easy.)

 3.1 Golden cookies
   GC-1  Only good golden cookies are clicked. Wrath cookies are never clicked;
         each wrath cookie is logged once ("ignore wrath cookie").
   GC-2  EVERY golden cookie (good, fading in, wrath) gets a hitbox overlay the
         moment it exists: ready = pink numbered box, pending = dashed lavender
         box with the fade percentage, wrath = dashed red box. Pending and
         wrath boxes are at least 34 px so a still-tiny cookie is visible.
   GC-3  A good cookie is queued/clicked only when its fade curve is >= the
         threshold (setting "Wait till cookie is visible", default 0.55), or
         when it is past its peak (progress >= 0.5), so it never becomes
         un-clickable again while fading out.
   GC-4  Timing of one catch:
           (a) wait until max(previous click, moment the cookie became ready)
               + click delay ("Patience before moving", default 200 ms),
           (b) move the paw (arced, human-like, see PAW-4),
           (c) wait the pre-click pause ("Shy pause before click", 100 ms),
           (d) re-acquire the cookie centre (cookies pulse), settle, click.
         Acceptance: with delay 1500 the click comes >= ~1600 ms after the
         cookie became ready. Debug: "Spawn random Golden Cookie".
   GC-5  Order of collection = the route with the LEAST TOTAL TRAVEL through
         all ready cookies, starting at the paw (open path, no return).
         Exact for <= 11 cookies, otherwise best of several 2-opt/Or-opt
         improved tours. Deterministic, cached, re-planned when the cookie set
         changes or the paw moved > 80 px. Not deadline-aware (by decision).
   GC-6  Every catch is recorded (stats per effect name + hourly buckets) and
         logged ("click golden cookie").
   GC-7  Golden cookies have ABSOLUTE priority (see SCHED-1).

 3.2 Hurry mode
   HURRY-1  While a cookie chain is running (Game.shimmerTypes.golden.chain > 0)
            or a cookie storm is active (buff name contains "cookie storm", or
            a storm drop exists) the "hurry factor" (default 0.2, range
            0.01-1) is applied:
              click delay, pre-click pause and fade threshold  x factor
              paw travel speed                                 / factor
   HURRY-2  The Mood line shows "[storm/chain: hurry xF]" while active.
   HURRY-3  The happy dance never plays during a chain (DANCE-3).
            Acceptance (Debug: "Spawn Cookie Chain" / "Spawn Cookie Storm"):
            catch time drops from ~delay+pause+travel to ~0.2x of that.

 3.3 Click Frenzy and hammer mode
   CF-1  During a real Click Frenzy the big cookie is clicked at
         "Click Frenzy clicks/sec" (default 8) with +-"Wiggle" ms jitter
         (default 30, capped at 60 % of the interval). Acceptance: 8 clicks/s
         with gaps inside 125 ms +-30.
   CF-2  These clicks are exempt from the click delay and pre-click pause.
   CF-3  Rate must not depend on scheduler ticks: one loop runs on a fixed
         timeline (next click due one interval after the previous one was DUE,
         resynced only when > 60 ms late; never closer than base-jitter).
   CF-4  "Hammer cookie" button = the same clicking outside a real frenzy.
         Priority: below FTHOF/refill, above dance/idle. Session-only (off after
         reload). Only the toggle is logged, not each click.
   CF-5  Each click lands a small random step (0..max "Click step max px",
         default 3) from the previous one, inside the cookie; 0 = stay put.
   CF-6  estimateClickFrenzySec(): rough Click Frenzy length in seconds
         (13 s x Get lucky x2 x Lasting fortune x1.1 x Epoch Manipulator).
         Exposed on the API; used by FT-2.

 3.4 FTHOF and lump refill
   FT-1  Cast FTHOF when: >= 1 CpS buff, mana >= cost, at least one CpS buff
         would still run when a Click Frenzy started now would end (FT-2), no
         Click Frenzy active, no ready golden cookie.
   FT-2  "Outlast" rule: some CpS buff has remaining time >= estimateClickFrenzySec().
   FT-3  Refill (sugar lump) when: >= 2 CpS buffs, FT-2 holds, mana < FTHOF
         cost, LOCK_A open, refill not on cooldown, >= 1 lump. After a refill
         LOCK_A is set.
   FT-4  Both abort at once if a golden cookie becomes ready or a Click Frenzy
         starts, and re-check their conditions right before clicking.
   FT-5  Both respect the click delay (before moving) and pre-click pause.
   FT-6  LOCK_A opens again when the CpS buff count returns to 0, or when it
         rises to >= 3 (and above its previous value).
   FT-7  If the real Grimoire buttons are not visible, the HUD "dock" chips
         (FTHOF / REFILL) serve as click targets for the paw's movement.

 3.5 Scheduling and priority
   SCHED-1  Priority, highest first:
              1 good golden cookies (queue)
              2 real Click Frenzy clicking
              3 FTHOF cast, then lump refill
              4 auto play shopping (only when a purchase is due, AUTO-8)
              5 hammer mode (manual button, or the auto hammer, AUTO-11)
              6 happy dance (only right after a catch, DANCE-1)
              7 idle behaviour (IDLE-*)
   SCHED-2  One task at a time; the scheduler ticks every 25 ms; long tasks
            poll "abort" predicates so higher priorities interrupt them within
            about one frame.
   SCHED-3  After real work the paw ponders where it stopped (IDLE-3).
   SCHED-4  A task that throws is logged ("error") and never stops the bot.

 3.6 Idle behaviour and happy dance
   IDLE-1  When nothing needs doing the paw never sits still: it draws very slow
           figure-eights (11-24 px, one eight per 9-16 s) with hand jitter.
   IDLE-2  Every 14-34 s it picks a new spot: look-only visit of something on
           screen (big cookie, building, upgrade, news ticker, cookie counter),
           a random drift, or (about 22 %) 1-3 "bored" clicks on the big cookie.
           It never clicks anything but the big cookie.
   IDLE-3  Right after real work it first ponders in place for 5-12 s.
   IDLE-4  Idle motion is cosmetic: it does not send fake mouse-moves to the
           game (MOUSE-2). It yields to any real work within a frame.
   IDLE-5  Setting "Idle playtime" switches all of this off; "Paw idle speed"
           (default 320 px/s) sets the travel speed.
   DANCE-1 After catching a golden cookie the paw does a small happy dance
           (hops + sway + tilt, default 2200 ms, 0 = off) ONLY IF that very
           moment is idle: no other golden/wrath cookie present, nothing for
           FTHOF/refill/Click Frenzy/hammer to do.
   DANCE-2 It is decided at the moment of the catch and never queued for later.
   DANCE-3 Never during a cookie chain; stops within a frame when a cookie
           appears or real work becomes pending.
   DANCE-4 Ends exactly where it started, then the paw ponders (IDLE-3).

 3.7 The paw (virtual cursor)
   PAW-1  Drawn on a full-screen overlay canvas above the game; pointer-events
          none, so the real mouse is never blocked.
   PAW-2  Two embedded, mirrored (left-facing) SVG sprites: open paw, and a
          closed fist that replaces it for the whole click pulse. If a sprite
          cannot load, a small drawn paw is used. Click point = middle claw tip.
   PAW-3  Look: pink halo + dark drop shadow for contrast on any background.
          Lean: tilts into horizontal movement (up to ~0.22 rad, smoothed).
          Click pulse: scale to 0.92 and back within ~80 ms (25 down, 55 up),
          pivot at the click point.
   PAW-4  Movement is never a straight line at constant speed: 2-6 arcing
          segments (Catmull-Rom through bowed waypoints), bell-shaped speed
          with wobble and small slow-downs at bends, duration x0.85-1.2 random,
          hand tremor (<= 1.3 px) that fades out on arrival; final position is
          exact. Duration clamp 22..420 ms (default).
   PAW-5  Visual overlays can be switched off ("Pretty overlays").

 3.8 Real-mouse compatibility
   MOUSE-1  Before the game handles the USER's mousedown/mouseup/click, the bot
            re-sends a mousemove at the real coordinates so the game's own
            Game.mouseX/Y (used for the floating "+N" numbers) are correct.
   MOUSE-2  Cosmetic paw movement does not dispatch mousemove to the game.
            Bot clicks still put the number where the paw is (humanClick sends
            a mousemove at the click point right before pressing).

 3.9 User interface
   UI-1  Draggable, minimizable panel (drag by the title bar; position saved and
         kept on screen). Title shows the script version.
   UI-2  Rows: Mood, Chasing, Shinies waiting (ready / fading in / wrath),
         Click Frenzy, Buffies, Grimoire, LOCK_A, Click cooldown, Auto play,
         statistics.
   UI-3  Buttons: Pause/Resume, Hammer cookie, Auto play, Graphs, Logs, Debug
         tools, Settings.
   UI-4  Settings are STAGED: editing only marks "unsaved"; "Save settings"
         (or Enter) validates, clamps, applies and stores them at once.
   UI-5  Graphs: hourly golden-cookie clicks by effect and Grimoire actions.
   UI-6  Logs: searchable table (newest first, up to 2000 rows shown) with
         Export JSON / Export CSV (respects the filter; not capped).
   UI-7  Theme: pastel pink/lavender/baby-blue on dark plum, rounded font,
         ASCII emoticons only (no emoji), no external assets.
   UI-8  Debug tools sub panel (DBG-*).

 3.10 Debug tools (cheats, for testing; use a test save)
   DBG-1  Spawn: random golden, wrath, Frenzy, Click Frenzy, Building Frenzy,
          Cookie Chain, Cookie Storm, Lucky, Cookie Storm Drop, Sweet (lump),
          Elder Frenzy (wrath), via new Game.shimmer('golden', ...) + .force.
   DBG-2  Grant 1 quadrillion cookies (Game.Earn, so it counts as earned).
   DBG-3  Fill Up Mana (mana = max).
   DBG-4  Reset FTHOF cooldown = mana raised to exactly the FTHOF cost (the game
          has no real FTHOF cooldown, only the mana cost).
   DBG-5  Reset Filling Up Mana cooldown = reset the game's 15 min lump-refill
          timer (falls back to overriding Game.canRefillLump until reload).
   DBG-6  Clear LOCK_A (the bot's own refill lock).
   DBG-7  Give 10 sugar lumps.
   DBG-8  Each use shows a status line (errors in red) and is logged
          ("debug tool").
   DBG-9  "Auto play: explain store (log)": lists every store upgrade with how the
          auto player classifies it (type, cost, CpS gain, payback) or why it is
          ignored, in the log ("auto explain"), the console and a summary line.

 3.11 Persistence and API
   DATA-1  State is stored in localStorage["ccSmartGoldenComboBot.v2"] as JSON
           {config, stats, hourly, logs, ui}; saved debounced (500 ms), on
           "Save settings", and on page unload.
   DATA-2  Pruning: hourly buckets older than "History retention days" and logs
           beyond "Log entries to keep" are dropped.
   DATA-3  Stored config is merged over the defaults, so new settings appear
           with their defaults after an update.
   API-1   window.__CCSmartGoldenComboBot = { version, pause(), resume(),
           state (runtime), clickFrenzySec(), data, save(), destroy() }.

 3.12 Auto play mode ("full auto play": shopping)
   AUTO-1  OFF by default. The "Auto play" button switches it on/off; the choice
           is stored with the settings (config.autoPlay). The button reads
           "Auto play ON ^w^" while on.
   AUTO-2  Scope. It may buy ONLY: buildings; building upgrades that make a
           building "twice as efficient"; grandma "cofactor" upgrades (grandmas
           twice as efficient + 1 % CpS of a building per N grandmas, also
           recognised by their description); KITTEN upgrades; ALL cookie
           (biscuit) upgrades; golden cookie upgrades (Lucky day, Serendipity,
           Get lucky, Lasting fortune, Lucky digit, Lucky number, Lucky payout,
           Green yeast digestives) - but never more than 57 Wizard towers
           (AUTO_BUILDING_CAPS); cursor and CLICKING upgrades: the "mouse and
           cursors twice as efficient" upgrades, the Thousand/Million/Billion/...
           fingers series and the mouse upgrades ("Clicking gains +1 % of your
           CpS"). It NEVER buys the grandma research center
           ("Bingo center/Research facility") or anything that starts/feeds the
           Grandmapocalypse, and nothing it cannot classify.
   AUTO-3  Value model per option: cost; approximate CpS gain dCps (buildings:
           per-building CpS x global multiplier; "twice as efficient": that
           building's CpS; biscuit: its power % of CpS; golden upgrades: an
           assumed share of CpS; CLICKING upgrades are valued in cookies/s at
           the hammer rate: click power x clicks per second, so the cursor
           doubling upgrades are worth their click gain even with 0 cursors);
           payback = cost / dCps ("rentability");
           impact = dCps / CpS; wait = time to afford it at the income (CpS
           without buffs + smoothed clicking income) after the reserve.
   AUTO-4  Strategy: (A) insignificant cost (<= 1 s of income, or <= 0.1 % of
           the bank) -> buy at once.
           (B) good deal (payback incl. waiting <= 1.2 x the best in reach) ->
           buy, UNLESS an option that is not affordable yet, in reach and good
           has >= 3 x the impact and this one costs more than 10 % of it: then
           save up. Otherwise nothing is bought and the target is shown.
   AUTO-5  "In reach" = affordable within 1800 s at the income and payback
           <= 24 h (both are settings).
   AUTO-6  Optional bank reserve: keep N seconds of CpS in the bank (default 0),
           e.g. for Lucky/chain payouts.
   AUTO-7  Safety: never while ascending, a prompt is open, the store is in sell
           mode (buildings), during Click Frenzy, cookie storm/chain, while a
           golden cookie is ready or FTHOF/refill is pending, or when paused.
           One purchase per task, >= 400 ms between purchases; a failed
           purchase / an error pauses it (3 s / 30 s). "Auto play dry run" only
           logs what it WOULD buy.
   AUTO-8  Priority: below golden cookies, Click Frenzy and FTHOF/refill, above
           hammer mode, dance and idle; a due purchase interrupts hammering and
           idle play at once.
   AUTO-9  Presentation: the paw visits the store item if it is visible and does
           the click pulse (visual only: NO click is sent to the store); the
           purchase itself uses the game's buy functions, so store modes (sell,
           bulk) can never cause a mistake. HUD row "Auto play" shows the plan
           ("saving for X (+N% CpS, ~3m 20s)").
   AUTO-10 Every purchase is logged ("auto buy" with cost, dCps, payback, impact,
           reason) and counted (stats.autoBuys, shown in the HUD).
   AUTO-11 Auto hammer: in auto play the big cookie is hammered (like CF-4)
           whenever clicking is much better than idling: clicks would add >=
           5 % of the CpS (setting). At the start (no CpS) that is always true,
           so it begins clicking by itself. When not worth it, it still PROBES:
           every 5 minutes (setting) it hammers for 10 s, measures the real
           clicking income and re-calibrates the estimate. Can be switched off
           ("Auto: manage hammering").
   AUTO-12 Opt-in UI: the auto play settings, the "Auto play" HUD row and the
           auto purchase counter are hidden until auto play is switched on.

 3.13 Background operation (browser tab not in front)
   BG-1  The bot's own timing (sleep(), the 25 ms scheduler) runs on a Web
         Worker clock. Browsers throttle the timers of a background PAGE, not
         those of a worker. A self-test at start decides; without a working
         worker (no Worker support, blocked blob workers) it falls back to the
         normal timers.
   BG-2  Paw animation (movement, pondering, dancing) races requestAnimationFrame
         against a ~34 ms worker timer, so the paw keeps moving while the
         browser sends no animation frames (hidden tab).
   BG-3  Optional keep-alive ("Background keep-alive", on by default): a
         practically silent AudioContext. Firefox does not throttle tabs that
         contain an AudioContext, which also keeps the GAME's own loop at full
         speed. Browsers start audio only after a real click on the page, so
         it waits for the first click. (A speaker icon may show on the tab.)
   BG-4  HUD row "Background" shows the timer source and the keep-alive state.

 3.14 "How good is a buy" overlay (independent of auto play)
   BUY-1  ON by default ("Show \"how good is a buy\" overlay"). Draws a
          bounding box directly over every building and upgrade the auto
          player can classify (AUTO-2/AUTO-3), whether or not auto play itself
          is switched on; it never buys anything on its own.
   BUY-2  A score from 0 (worst payback on offer) to 100 (best) is drawn CENTRED
          INSIDE each box, so it never overlaps a neighbour's number the way a
          label floating above the box could. Box + score colour is RELATIVE
          to the other options on offer right now, ranked on a LOG scale of
          payback (cost / estimated CpS gain: paybacks span
          seconds to days, so a linear scale would let one very bad option
          make every other one look equally green): red on the worst payback
          currently on offer, green on the best, amber in between, so it
          re-ranks as the store changes. Uses the same scoring as autoDecide()
          (AUTO-3/AUTO-4), refreshed at most twice a second.
   BUY-3  A box is only drawn for an element that is genuinely on screen: hidden
          (display:none/visibility:hidden/opacity 0) or clipped away by a
          collapsed ancestor (e.g. the upgrade store folded into a strip, which
          can leave stale on-screen coordinates behind) is rejected the same
          way as an off-screen element (shared with every other overlay box:
          golden cookies, the Grimoire buttons, ...).

--------------------------------------------------------------------------------
 4. NON-FUNCTIONAL REQUIREMENTS
   NFR-1  Versioning: MAJOR.MINOR.PATCH, shown in the panel. Bump with EVERY
          change (fix = patch, feature = minor); keep "@version" and the
          VERSION constant identical.
   NFR-2  No dependencies, no network, no external assets. Runs in page context
          (@grant none) at document-idle; a second instance refuses to start.
   NFR-3  Performance: route planning <= ~2 ms for 40 cookies and cached; the
          overlay costs only a few canvas calls per frame; timers: scheduler
          25 ms, panel refresh 200 ms, charts 2 s.
   NFR-4  Robustness: every game-internal access is guarded (typeof/try); a
          failing task is logged and the bot continues.
   NFR-5  Text style: cute (uwu), ASCII emoticons only (":3", "^w^", "owo").
   NFR-6  Determinism: route planning and restarts are deterministic so the
          plan does not flip-flop.

--------------------------------------------------------------------------------
 5. CONFIGURATION REFERENCE  (data.config; UI label -> key)
   All numeric settings are clamped when saved (see normalizeSetting()).

   key                    UI label                              default  range
   goldenMinIntervalMs    Patience before moving (ms)               200  0-5000
   preClickDelayMs        Shy pause before click (ms)               100  0-2000
   goldenMinFadeCurve     Wait till cookie is visible (0-1)        0.55  0-1
   panicFactor            Storm/chain hurry factor (0.01-1)         0.2  0.01-1
   cursorSpeedPxPerSec    Paw zoomies px/s                         4200  500-20000
   clickFrenzyCps         Click Frenzy clicks/sec                     8  0.2-50
   clickFrenzyJitterMs    Wiggle +-ms                                30  0-250
   hammerStepPx           Click step max px (0 = stay put)            3  0-60
   idleWander             Idle playtime (paw wanders) [checkbox]   true  -
   idleSpeedPxPerSec      Paw idle speed px/s                       320  60-2000
   happyDanceMs           Happy dance length (ms, 0 = off)         2200  0-10000
   visuals                Pretty overlays [checkbox]               true  -
   chartHours             Chart hours                                48  6-720
   retentionDays          Remember history (days)                    30  1-365
   logLimit               Log entries to keep                     10000  100-50000
   showBuyValue           Show "how good is a buy" overlay [checkbox]    true  -
   keepAlive              Background keep-alive (silent audio) [checkbox]  true  -
   autoPlay               (Auto play button, stored)               false  -
   autoDryRun             Auto play dry run (log only) [checkbox]  false  -
   autoInsignificantSec   Auto: insignificant cost (s of income)       1  0-3600
   autoGoodFactor         Auto: good deal (x best payback)           1.2  1-10
   autoBiggerImpact       Auto: much bigger impact (x)                 3  1-100
   autoReachSec           Auto: in reach within (s)                 1800  0-86400
   autoMaxPaybackSec      Auto: max payback (s)                    86400  60-10000000
   autoReserveSec         Auto: bank reserve (s of CpS)                0  0-1000000
   autoHammer             Auto: manage hammering [checkbox]         true  -
   autoHammerMinShare     Auto: hammer when clicks add >= (x CpS)   0.05  0-1000
   autoProbeIntervalSec   Auto: probe hammering every (s, 0=never)  300  0-86400
   autoProbeSec           Auto: probe length (s)                       10  2-120
   (all "Auto" settings are only shown while Auto play is on)

   Notes: the key "goldenMinIntervalMs" keeps its old name so stored settings
   survive; it now means the click delay for ALL non-frenzy clicks.
   Under hurry mode: delay, pause, threshold are multiplied by panicFactor and
   the paw speed (cursorSpeedPxPerSec) is divided by it.

--------------------------------------------------------------------------------
 6. ARCHITECTURE
   * One IIFE, one file, no build step. Two state objects:
       data     persisted (config, stats, hourly, logs, ui)
       runtime  in-memory only (flags, timers, cursor position, plans, caches)
   * Timers: scheduler (25 ms) -> picks and runs ONE task; panel refresh
     (200 ms); charts (2 s); overlay = requestAnimationFrame; debounced save.
   * Task model: schedulerTick() decides by SCHED-1, sets runtime.actionInProgress,
     runs the task as a promise, and clears it in .finally(). Tasks are async
     functions built from small awaitable steps: waitUntil(), moveCursorTo(),
     glideCursor(), humanClick(), ponder(), happyDance().
   * Abort predicates: waitUntil()/moveCursorTo()/loops accept "abort" callbacks
     (hasGoodGolden(), pendingPriorityWork(), stop() in clickBigCookie()), so
     lower priorities give way within a frame.
   * Synthetic input: dispatchMouse()/humanClick() create MouseEvents on the
     real DOM elements; dispatchMove() feeds document mousemove (silenced during
     cosmetic actions). The paw itself is only a drawing.
   * Rendering: overlay canvas (route, hitboxes, paw) + HUD panel + modal panels
     (graphs, logs, debug), all created by createUi() and removed by destroy().
   * Game coupling (all guarded): Game.ready, Game.fps, Game.shimmers,
     Game.shimmerTypes.golden.{last,chain}, Game.buffs, Game.hasBuff(),
     Game.Has(), Game.auraMult(), Game.Objects['Wizard tower'].minigame
     (magic, magicM, spells['hand of fate'], getSpellCost, spellsCastTotal),
     Game.canRefillLump(), Game.lumps, Game.lumpRefill (optional),
     Game.gainLumps() (optional), Game.Earn() (optional), Game.prefs.askLumps,
     Game.mouseX/Y (read by the game itself).
   * Auto play (all guarded): Game.ObjectsById[] {name,id,locked,price,amount,
     storedCps,storedTotalCps,buy(n)}, Game.UpgradesInStore[] {name,desc,pool,
     power,bought,buildingTie,buildingTie1/2,getPrice(),buy()}, Game.Upgrades,
     Game.UpgradesById, Game.GrandmaSynergies, Game.cookies, Game.cookiesPs,
     Game.unbuffedCps (optional), Game.handmadeCookies, Game.buyMode,
     Game.OnAscend, Game.AscendTimer, Game.promptOn, Game.computedMouseCps
     (click power), Game.Objects.Cursor, Game.milkProgress / AchievementsOwned,
     building.plural.

--------------------------------------------------------------------------------
 7. ASSUMPTIONS AND KNOWN LIMITS
   * Verified only against mock games in automated checks, NOT against the live
     game. Assumed from the game's own source/community docs: the shimmer fade
     formula, Game.shimmerTypes.golden.chain, the buff name "Cookie storm",
     the 'force' names used by the debug spawns, Game.lumpRefill, Game.gainLumps.
     If one is missing, the affected feature degrades quietly (see NFR-4) and
     the Debug tools report an error in red.
   * In a hidden tab the bot itself keeps working (worker timers, BG-1/BG-2). The
     GAME's own loop is only unthrottled while the keep-alive audio runs (needs
     one real click on the page) or if the browser is configured that way.
   * Auto play values are ESTIMATES from the fields above (not a full simulation
     of the game's CpS calculation) and the golden-upgrade values are assumed
     shares (AUTO_GOLDEN_UPGRADES). Use "Auto play dry run" first and compare
     its log with your own judgement. Defaults come from a simulation with
     buildings and tier upgrades only.
   * Auto play does not click the big cookie for you (combine with Hammer mode),
     does not buy kittens/mouse upgrades/dragon/seasonal switches, and has no
     ascension logic.
   * FTHOF has no cooldown in the game; only mana limits it.
   * Route planning is Euclidean and ignores click time (constant per cookie).

--------------------------------------------------------------------------------
 8. MANUAL TEST PLAN (use a test save + Debug tools)
   T-1  Spawn random Golden Cookie      -> box appears at once, paw catches it
        after the delays (GC-2, GC-3, GC-4).
   T-2  Spawn Wrath Cookie              -> red dashed box, never clicked, logged.
   T-3  Spawn 5 cookies quickly         -> numbers follow the shortest route (GC-5).
   T-4  Spawn Cookie Chain / Storm      -> Mood shows hurry, catches are fast,
        no dance during a chain (HURRY-*, DANCE-3).
   T-5  Spawn Click Frenzy Cookie       -> ~8 clicks/s inside the cookie, small
        steps (CF-1..CF-5). Toggle "Hammer cookie" for the same without frenzy.
   T-6  Grant cookies, buy Wizard towers, Fill Up Mana, Frenzy cookie, then
        watch FTHOF / refill logic; use the reset buttons to repeat (FT-*).
   T-7  Manually click the big cookie while the paw wanders -> the "+N" number
        appears under YOUR mouse (MOUSE-1/2).
   T-8  Change a setting -> "unsaved" until "Save settings" (UI-4).
   T-9  Logs: filter, Export JSON/CSV (UI-6).
   T-10 Auto play: tick "Auto play dry run", press "Auto play"; the HUD row shows
        the plan and the log gets "auto play (dry run)" entries. Untick the dry
        run: with Grant cookies it buys, "auto buy" entries appear, the paw
        visits the store item (AUTO-*). Turn it off again with the same button.

--------------------------------------------------------------------------------
 9. CHANGELOG
   3.11.1 Fixed: a collapsed upgrade store could leave stale on-screen
          coordinates behind, drawing its boxes over the building list; overlay
          elements are now checked for CSS visibility and ancestor clipping
          too. Also dropped the separate "BUY" tag and solid outline: every
          box is now the same dashed style, colour + score only.
   3.11.0 "How good is a buy" box now shows a 0-100 score centred inside it (not
          just colour), so the relative quality is readable as a number too.
   3.10.2 "How good is a buy" box colour now ranks on a log scale of payback, so
          one very bad option (e.g. a multi-hour payback) no longer makes every
          other option look equally green.
   3.10.1 "How good is a buy" overlay is now a colour-graded bounding box (colour
          relative to the other options on offer) instead of a text label.
   3.10.0 "How good is a buy" overlay on every purchase option, colour-coded,
          on by default, works without auto play.
   3.9.0  Background operation: worker-clock timers, paw animation that does not
          depend on requestAnimationFrame, optional silent-audio keep-alive,
          HUD row "Background".
   3.8.0  Auto play: kitten upgrades; grandma cofactor upgrades are now also
          recognised by their description (fixes them being ignored); debug tool
          "Auto play: explain store".
   3.7.1  Auto play never buys more than 57 Wizard towers.
   3.7.0  Auto play: buys cursor and clicking upgrades (cursor doubling, the
          Thousand/Million/... fingers, mouse upgrades) valued by click income;
          auto hammer with probing (starts clicking from 0 cookies); all auto
          settings/rows are hidden unless auto play is on.
   3.6.0  Auto play mode (off by default): buys buildings, "twice as efficient"
          building upgrades, grandma cofactor upgrades, biscuits and golden cookie
          upgrades by payback/impact strategy; dry-run option; never the grandma
          research center.
   3.5.1  Documentation only: this specification header, section banners,
          JSDoc for every function/constant, commented defaults and state.
   3.5.0  Closed-paw (fist) sprite shown during the click pulse.
   3.4.0  Route planning: least total travel (exact <= 11 cookies, heuristic
          beyond) replaces nearest-first.
   3.3.0  Hurry mode for cookie storms/chains (factor 0.2); no happy dance
          during chains.
   3.2.0  Debug: reset FTHOF cooldown, reset refill cooldown, clear LOCK_A,
          grant 1 quadrillion cookies.
   3.1.0  Debug tools sub panel (spawns, mana, lumps).
   3.0.0  Baseline of the rewrite, version shown in the panel, real-mouse
          compatibility fix. Includes everything developed before: theme and
          rename to "CC Good Boy"; log export; fade-in threshold and immediate
          highlighting; reaction delay + pre-click pause; draggable panel;
          staged settings with Save; idle wandering, figure-eight pondering;
          human-like paths; paw sprite, click pulse, lean; happy dance;
          hammer mode; Click Frenzy rate/step rework; drop shadow.
   2.0.0  Original "CC SmartBot v2".
================================================================================
*/

(function () {
    'use strict';

    // ============================================================================
    // SECTION 1 - Constants, defaults, runtime state
    // ============================================================================

    /**
     * localStorage key of the persisted state (see DATA-1). Kept at '.v2' on purpose so
     * settings, stats and logs survive script updates and the rename to CC Good Boy.
     * @req DATA-1
     */
    const STORAGE_KEY = 'ccSmartGoldenComboBot.v2';
    /**
     * Script version (MAJOR.MINOR.PATCH), shown in the panel header and exposed on the API.
     * Keep it identical to the @version line above and bump it with EVERY change.
     * @req NFR-1, UI-1, API-1
     */
    const VERSION = '3.11.1';

    /**
     * Default state. The persisted state is always merged over this (see mergeDefaults()),
     * so new settings appear with their defaults after an update. The full reference for
     * every setting (label, range, meaning) is in section 5 of the header comment.
     * @req DATA-3
     */
    const DEFAULTS = {
        // ---- config: user settings (labels, ranges and meaning: header section 5) ----
        config: {
            goldenMinIntervalMs: 200, // click delay in ms BEFORE the paw moves (x hurry factor)   GC-4
            goldenMinFadeCurve: 0.55, // fade-curve threshold 0..1 for "visible" (x hurry factor)  GC-3
            preClickDelayMs: 100, // pause in ms after arriving, before clicking (x hurry factor)   GC-4
            idleWander: true, // idle playtime on/off (ponder, visit, drift, bored clicks)          IDLE-5
            idleSpeedPxPerSec: 320, // paw travel speed while idling, px/s                          IDLE-5
            happyDanceMs: 2200, // happy dance length in ms after an idle catch; 0 = off            DANCE-1
            hammerStepPx: 3, // max step in px between two big-cookie clicks; 0 = stay put          CF-5
            panicFactor: 0.2, // hurry factor for cookie storm / chain, 0.01..1                     HURRY-1
            clickFrenzyCps: 8, // big-cookie clicks per second (Click Frenzy and hammer mode)       CF-1
            clickFrenzyJitterMs: 30, // +- ms random jitter per click interval                      CF-1
            cursorSpeedPxPerSec: 4200, // paw travel speed for real actions, px/s (/ hurry factor)  PAW-4
            visuals: true, // draw the overlay (hitboxes, route, paw)                              PAW-5
            chartHours: 48, // hours shown on the charts                                            UI-5
            retentionDays: 30, // days of hourly statistics kept                                    DATA-2
            logLimit: 10000, // log entries kept                                                     DATA-2
            showBuyValue: true, // "how good is a buy" overlay on every purchase, works without auto play  BUY-1
            keepAlive: true, // silent AudioContext so the browser does not throttle the tab              BG-3
            // ---- auto play (shopping): buys buildings/upgrades, OFF by default (AUTO-*) ----
            autoPlay: false, // auto play mode on/off (button in the panel)                        AUTO-1
            autoDryRun: false, // only log what it WOULD buy                                       AUTO-7
            autoInsignificantSec: 1, // cost <= this many seconds of income = insignificant, buy  AUTO-4
            autoGoodFactor: 1.2, // good deal = payback incl. waiting <= this x the best in reach AUTO-4
            autoBiggerImpact: 3, // "much bigger impact" = this many x the impact                 AUTO-4
            autoReachSec: 1800, // in reach = affordable within this many seconds                 AUTO-5
            autoMaxPaybackSec: 86400, // never buy (except insignificant) beyond this payback     AUTO-5
            autoReserveSec: 0, // keep this many seconds of CpS in the bank                        AUTO-6
            autoHammer: true, // auto play also hammers the big cookie when clicking beats idling      AUTO-11
            autoHammerMinShare: 0.05, // hammer when clicks add >= this x CpS (0.05 = 5 %)             AUTO-11
            autoProbeIntervalSec: 300, // probe hammering every N s when it is not worth it (0 = never) AUTO-11
            autoProbeSec: 10 // length of a probe in s                                                   AUTO-11
        },
        // ---- stats: lifetime counters shown in the HUD ----
        stats: {
            totalGolden: 0, // golden cookies caught
            byKind: {}, // { "<effect name>": count }
            fthofCasts: 0,
            grimoireRefills: 0,
            autoBuys: 0 // purchases made by auto play
        },
        hourly: {}, // { "<hour start, ms>": { golden: { "<effect>": n }, fthof: n, refill: n } }
        logs: [], // [{ action, meta, ts (unix s), extra? }], oldest first
        // ---- ui: remembered interface state ----
        ui: {
            minimized: false,
            panelPos: null, // { left, top } after the panel was dragged
            settingsOpen: false
        }
    };

    /**
     * In-memory state; NOT persisted. One object so every part of the bot (and the console
     * via window.__CCSmartGoldenComboBot.state) sees the same truth.
     * Field groups: scheduling flags, click bookkeeping, plans/caches, idle/dance/paw
     * animation state, timers, lifecycle.
     */
    const runtime = {
        // ---- scheduling ----
        running: true, // false while paused
        actionInProgress: false, // a task is running (only one at a time)
        currentAction: 'idle', // internal action name (shown via moodText)
        currentTarget: 'none', // what the paw is after (shown via targetText)
        // ---- FTHOF / refill bookkeeping ----
        lockA: false, // LOCK_A: no second refill until the buff situation changes  FT-6
        lastCpsBuffCount: 0,
        lastCpsSignature: '',
        lastClickFrenzy: false,
        refillInFlight: false,
        // ---- click bookkeeping ----
        lastGoldenClickAt: 0, // Date.now() of the last golden catch
        lastClickAt: 0, // Date.now() of the last click of ANY kind (click delay)
        nextBigClickAt: 0, // due time of the next big-cookie click (fixed timeline)   CF-3
        goldenReadyAt: new Map(), // shimmer id -> when it became ready (reaction delay) GC-4
        route: null, // cached route plan {key, from, ids}                            GC-5
        seenWrath: new Set(), // wrath cookies already logged
        // ---- idle / dance / hammer ----
        nextIdleAt: 0, // earliest time for the next idle step
        idleStay: false, // after real work: ponder in place first                    IDLE-3
        hammer: false, // hammer mode on (session only)                                CF-4
        danceQueued: false, // a happy dance was approved at the last catch            DANCE-2
        // ---- auto play (shopping) ----
        autoPlan: null, // last shopping plan {buy, save, note, why, at}
        autoNextEvalAt: 0, // next time the plan is recomputed (throttle: 1 s)
        autoBlockUntil: 0, // no shopping before this time (after an error / failed purchase)
        lastAutoBuyAt: 0, // Date.now() of the last purchase
        autoHand: null, // smoothed income from clicking {t, v, rate}
        autoWouldLog: new Map(), // dry run: item name -> last time it was logged
        buyValueCache: null, // "how good is a buy" overlay snapshot (BUY-1)
        buyValueAt: 0,
        autoHammerState: { // auto hammer bookkeeping (AUTO-11)
            on: false, // hammer right now (wanted, or probing)
            wanted: null, // last decision "worth it" (for the log)
            nextEvalAt: 0,
            nextProbeAt: 0,
            probeUntil: 0,
            probeT0: 0,
            probeH0: 0,
            cal: 1, // calibration of the click income estimate (from probes)
            share: 0 // estimated clicking income as a fraction of CpS
        },
        // ---- paw animation ----
        cursorTilt: 0, // extra tilt (radians) set by the happy dance
        lean: 0, // smoothed lean into horizontal movement (radians)
        leanState: null, // last sample for the lean calculation
        pulseAt: 0, // performance.now() of the last press (click pulse)
        cursor: { // the paw's click point in screen px
            x: Math.max(40, window.innerWidth * 0.55),
            y: Math.max(80, window.innerHeight * 0.45)
        },
        // ---- timers / lifecycle ----
        saveTimer: 0,
        panelTimer: 0,
        schedulerTimer: 0,
        keepAlive: { ctx: null, state: 'off', listening: false }, // keep-alive audio (BG-3)
        drawRaf: 0,
        graphTimer: 0,
        destroyed: false
    };

    /** Persisted state (config, stats, hourly, logs, ui); see DEFAULTS. */
    let data = loadData();
    // DOM handles, created by createUi() and removed by destroy():
    let overlayCanvas = null; // full-screen canvas: hitboxes, route, paw
    let overlayCtx = null;
    let panel = null; // the HUD panel
    let graphPanel = null; // charts window
    let logPanel = null; // log window
    let debugPanel = null; // debug tools window

    // ============================================================================
    // SECTION 2 - Persistence and small utilities
    // ============================================================================

    /**
     * Deep copy of a JSON-compatible value.
     * @param {*} obj
     * @returns {*}
     */
    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    /**
     * Merge a stored/incoming state over the defaults. Objects (config, stats, ui) are merged
     * key by key so newly added defaults survive; other keys (hourly, logs) are taken as stored.
     * @param {Object} base - DEFAULTS
     * @param {Object} incoming - parsed localStorage value or null
     * @returns {Object} a fresh, complete state object
     * @req DATA-3
     */
    function mergeDefaults(base, incoming) {
        const out = clone(base);
        if (!incoming || typeof incoming !== 'object') return out;

        for (const key of Object.keys(out)) {
            if (incoming[key] === undefined) continue;

            if (
                out[key] &&
                typeof out[key] === 'object' &&
                !Array.isArray(out[key])
            ) {
                out[key] = Object.assign({}, out[key], incoming[key]);
            } else {
                out[key] = incoming[key];
            }
        }

        return out;
    }

    /**
     * Read the persisted state from localStorage (fresh defaults on any error).
     * @returns {Object} state (config, stats, hourly, logs, ui)
     * @req DATA-1, DATA-3
     */
    function loadData() {
        try {
            const parsed = JSON.parse(
                localStorage.getItem(STORAGE_KEY) || 'null'
            );
            return mergeDefaults(DEFAULTS, parsed);
        } catch (e) {
            console.warn(
                '[CC Good Boy] Could not load stored state:',
                e
            );
            return clone(DEFAULTS);
        }
    }

    /**
     * Debounced save: writes the state 500 ms after the last change.
     * @req DATA-1
     */
    function scheduleSave() {
        if (runtime.saveTimer) return;
        runtime.saveTimer = window.setTimeout(saveNow, 500);
    }

    /**
     * Write the state to localStorage immediately (after pruning). Also used by the explicit
     * "Save settings" button and on page unload.
     * @req DATA-1, DATA-2, UI-4
     */
    function saveNow() {
        if (runtime.saveTimer) {
            clearTimeout(runtime.saveTimer);
            runtime.saveTimer = 0;
        }

        pruneStoredData();

        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(data)
            );
        } catch (e) {
            console.warn(
                '[CC Good Boy] Could not save state:',
                e
            );
        }
    }

    /**
     * Drop hourly buckets older than 'History retention days' and trim the log to
     * 'Log entries to keep' (oldest first).
     * @req DATA-2
     */
    function pruneStoredData() {
        const cutoff =
            Date.now() -
            Math.max(
                1,
                Number(data.config.retentionDays) || 30
            ) *
                86400000;

        for (const key of Object.keys(data.hourly)) {
            if (Number(key) < cutoff) {
                delete data.hourly[key];
            }
        }

        const limit = clampInt(
            data.config.logLimit,
            100,
            50000,
            10000
        );

        if (data.logs.length > limit) {
            data.logs = data.logs.slice(-limit);
        }
    }

    /**
     * Clamp a number into [min, max].
     * @param {number} n
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    /**
     * Round and clamp; falls back when the input is not a finite number.
     * @param {*} n
     * @param {number} min
     * @param {number} max
     * @param {number} fallback
     * @returns {number}
     */
    function clampInt(n, min, max, fallback) {
        n = Math.round(Number(n));
        if (!Number.isFinite(n)) n = fallback;
        return clamp(n, min, max);
    }

    /**
     * Current Unix time in whole seconds (log timestamps).
     * @returns {number}
     */
    function nowSec() {
        return Math.floor(Date.now() / 1000);
    }

    /**
     * Start of the hour (ms since epoch) containing tsMs; key of the hourly statistic buckets.
     * @param {number} tsMs
     * @returns {number}
     */
    function hourKey(tsMs) {
        return Math.floor(tsMs / 3600000) * 3600000;
    }

    /**
     * Get (creating if needed) the hourly statistics bucket for a timestamp.
     * Bucket shape: { golden: {<effect name>: count}, fthof: n, refill: n }.
     * @param {number} tsMs
     * @returns {Object} the bucket
     * @req GC-6, UI-5
     */
    function ensureBucket(tsMs) {
        const key = String(hourKey(tsMs));

        if (!data.hourly[key]) {
            data.hourly[key] = {
                golden: {},
                fthof: 0,
                refill: 0
            };
        }

        return data.hourly[key];
    }

    // ============================================================================
    // SECTION 3 - Statistics and logging
    // ============================================================================

    /**
     * Count one caught golden cookie (total, per effect, hourly bucket) and schedule a save.
     * @param {string} kind - display name of the effect, e.g. 'Frenzy'
     * @req GC-6
     */
    function recordGolden(kind) {
        kind = kind || 'Unknown';

        data.stats.totalGolden += 1;

        data.stats.byKind[kind] =
            (data.stats.byKind[kind] || 0) + 1;

        const bucket = ensureBucket(Date.now());

        bucket.golden[kind] =
            (bucket.golden[kind] || 0) + 1;

        scheduleSave();
    }

    /**
     * Count one successful FTHOF cast (total and hourly bucket).
     * @req FT-1, UI-5
     */
    function recordFthof() {
        data.stats.fthofCasts += 1;
        ensureBucket(Date.now()).fthof += 1;
        scheduleSave();
    }

    /**
     * Count one lump refill (total and hourly bucket).
     * @req FT-3, UI-5
     */
    function recordRefill() {
        data.stats.grimoireRefills += 1;
        ensureBucket(Date.now()).refill += 1;
        scheduleSave();
    }

    /**
     * Append an entry to the action log {action, meta, ts, extra?}, trim to the limit, schedule
     * a save and refresh the log table when it is open.
     * Actions used: 'bot started', 'bot paused/resumed', 'ignore wrath cookie',
     * 'click golden cookie', 'click cookie' (Click Frenzy), 'cast fthof', 'refill grimoire',
     * 'lock A', 'unlock A', 'cps buffs changed', 'click frenzy', 'hammer cookie',
     * 'debug tool', 'error'.
     * @param {string} action
     * @param {string} meta
     * @param {Object} [extra] - JSON-able details
     * @req UI-6
     */
    function logAction(action, meta, extra) {
        const entry = {
            action: String(action || ''),
            meta: String(meta || ''),
            ts: nowSec()
        };

        if (extra && typeof extra === 'object') {
            entry.extra = extra;
        }

        data.logs.push(entry);

        const limit = clampInt(
            data.config.logLimit,
            100,
            50000,
            10000
        );

        if (data.logs.length > limit) {
            data.logs.splice(
                0,
                data.logs.length - limit
            );
        }

        scheduleSave();

        if (
            logPanel &&
            logPanel.style.display !== 'none'
        ) {
            renderLogBrowser();
        }
    }

    // ============================================================================
    // SECTION 4 - Game accessors, buffs, LOCK_A
    // ============================================================================

    /**
     * The Grimoire minigame object (Wizard tower), or null when it is not available/unlocked.
     * Every access to the game is guarded, so a missing minigame just means "nothing to do".
     * @returns {Object|null}
     * @req FT-1, NFR-4
     */
    function getGrimoire() {
        try {
            return Game &&
                Game.Objects &&
                Game.Objects['Wizard tower'] &&
                Game.Objects['Wizard tower'].minigame
                ? Game.Objects['Wizard tower'].minigame
                : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * The 'hand of fate' spell definition of the Grimoire, or null.
     * @param {Object|null} M - Grimoire minigame
     * @returns {Object|null}
     * @req FT-1
     */
    function getFthofSpell(M) {
        return M && M.spells
            ? M.spells['hand of fate']
            : null;
    }

    /**
     * Current mana cost of FTHOF (game formula: 10 + 60 % of max mana).
     * @param {Object|null} M - Grimoire minigame
     * @returns {number} Infinity when the cost cannot be determined (so nothing is cast)
     * @req FT-1
     */
    function getFthofCost(M) {
        const spell = getFthofSpell(M);

        if (
            !M ||
            !spell ||
            typeof M.getSpellCost !== 'function'
        ) {
            return Infinity;
        }

        return M.getSpellCost(spell);
    }

    /**
     * Is a real Click Frenzy buff active right now?
     * @returns {boolean}
     * @req CF-1, SCHED-1
     */
    function clickFrenzyActive() {
        return !!(
            window.Game &&
            typeof Game.hasBuff === 'function' &&
            Game.hasBuff('Click frenzy')
        );
    }

    /**
     * Rough length (seconds) a Click Frenzy would have if it fired now:
     * 13 s x 2 (Get lucky) x 1.1 (Lasting fortune) x (1 + 0.05 x Epoch Manipulator aura).
     * The small +1 % upgrades and the Pantheon bonus are ignored on purpose (precision is not needed).
     * @returns {number} seconds (rounded up); 13 if the game cannot be queried
     * @req CF-6, FT-2
     */
    function estimateClickFrenzySec() {
        try {
            let mod = 1;

            if (Game.Has('Get lucky')) {
                mod *= 2;
            }

            if (Game.Has('Lasting fortune')) {
                mod *= 1.1;
            }

            if (
                typeof Game.auraMult ===
                'function'
            ) {
                mod *=
                    1 +
                    (Number(
                        Game.auraMult(
                            'Epoch Manipulator'
                        )
                    ) || 0) *
                        0.05;
            }

            return Math.ceil(13 * mod);
        } catch (_) {
            return 13;
        }
    }

    /**
     * All active buffs that multiply CpS (multCpS > 1), sorted by name.
     * @returns {{key:string,name:string,mult:number,time:number}[]} time is in game frames
     * @req FT-1, FT-3
     */
    function positiveCpsBuffs() {
        if (!window.Game || !Game.buffs) return [];

        const out = [];

        for (const key of Object.keys(Game.buffs)) {
            const buff = Game.buffs[key];
            if (!buff) continue;

            const mult = Number(buff.multCpS);

            if (
                Number.isFinite(mult) &&
                mult > 1
            ) {
                out.push({
                    key,
                    name:
                        buff.name ||
                        buff.dname ||
                        key,
                    mult,
                    time: Number(buff.time) || 0
                });
            }
        }

        out.sort((a, b) =>
            a.name.localeCompare(b.name)
        );

        return out;
    }

    /**
     * The 'outlast' rule: is there a CpS buff with at least estimateClickFrenzySec() seconds left?
     * A FTHOF that rolls Click Frenzy is only worth it when that frenzy fully overlaps a buff.
     * @param {Array} [buffs] - defaults to positiveCpsBuffs()
     * @returns {boolean}
     * @req FT-2
     */
    function cpsBuffOutlastsClickFrenzy(buffs) {
        const cfSec =
            estimateClickFrenzySec();

        const fps =
            Number(Game.fps) || 30;

        return (
            buffs || positiveCpsBuffs()
        ).some(
            b => b.time / fps >= cfSec
        );
    }

    /**
     * Called every scheduler tick. Logs CpS-buff and Click Frenzy changes, maintains LOCK_A
     * (opens it when the buff count returns to 0 or rises to >= 3) and restarts the big-cookie
     * timeline when a Click Frenzy starts.
     * @returns {Array} the current CpS buffs
     * @req FT-6, CF-1
     */
    function updateBuffAndLockState() {
        const buffs = positiveCpsBuffs();
        const count = buffs.length;

        const signature = buffs
            .map(
                b =>
                    `${b.name}@${b.mult}`
            )
            .join('|');

        const cf = clickFrenzyActive();

        if (
            count === 0 &&
            runtime.lockA
        ) {
            runtime.lockA = false;

            logAction(
                'unlock A',
                'cps buff count returned to 0'
            );
        } else if (
            count >= 3 &&
            count > runtime.lastCpsBuffCount &&
            runtime.lockA
        ) {
            runtime.lockA = false;

            logAction(
                'unlock A',
                `cps buff count increased ${runtime.lastCpsBuffCount}->${count}`
            );
        }

        if (
            signature !==
            runtime.lastCpsSignature
        ) {
            logAction(
                'cps buffs changed',
                signature || 'none',
                { count }
            );

            runtime.lastCpsSignature =
                signature;
        }

        if (
            cf !== runtime.lastClickFrenzy
        ) {
            logAction(
                'click frenzy',
                cf ? 'started' : 'ended'
            );

            runtime.lastClickFrenzy = cf;

            if (cf) {
                runtime.nextBigClickAt =
                    Date.now();
            }
        }

        runtime.lastCpsBuffCount = count;

        return buffs;
    }

    // ---------- Hurry mode (cookie storm / cookie chain) ----------
    // During a cookie storm or a cookie chain every cookie is short-lived,
    // so the bot has to act fast: the delays and the visibility threshold
    // are multiplied by the hurry factor (default 0.2) and the paw speed
    // is divided by it.

    // ============================================================================
    // SECTION 5 - Hurry mode (cookie storm / cookie chain)
    // ============================================================================

    /**
     * The configured hurry factor, clamped to 0.01..1 (default 0.2).
     * @returns {number}
     * @req HURRY-1
     */
    function getPanicFactor() {
        const v = Number(
            data.config.panicFactor
        );

        return Number.isFinite(v)
            ? clamp(v, 0.01, 1)
            : 0.2;
    }

    /**
     * Is a cookie chain running? (the game counts it in Game.shimmerTypes.golden.chain)
     * @returns {boolean}
     * @req HURRY-1, DANCE-3
     */
    function cookieChainActive() {
        return (
            !!window.Game &&
            !!Game.shimmerTypes &&
            !!Game.shimmerTypes.golden &&
            Number(
                Game.shimmerTypes.golden
                    .chain
            ) > 0
        );
    }

    /**
     * Is a cookie storm running? True when a buff whose name contains 'cookie storm' is active,
     * or a golden shimmer forced to 'cookie storm drop' exists.
     * @returns {boolean}
     * @req HURRY-1
     */
    function cookieStormActive() {
        if (!window.Game) return false;

        if (Game.buffs) {
            for (const k of Object.keys(
                Game.buffs
            )) {
                const b = Game.buffs[k];

                const name = String(
                    (b &&
                        (b.name ||
                            b.dname)) ||
                        k
                ).toLowerCase();

                if (
                    name.includes(
                        'cookie storm'
                    )
                ) {
                    return true;
                }
            }
        }

        return (
            Array.isArray(Game.shimmers) &&
            Game.shimmers.some(
                s =>
                    s &&
                    s.type === 'golden' &&
                    !s.popped &&
                    s.force ===
                        'cookie storm drop'
            )
        );
    }

    /**
     * Cache for urgencyFactor() (it is read very often); refreshed at most every 30 ms.
     */
    let urgencyCache = { t: -1e9, v: 1 };

    /**
     * The factor currently in effect: 1 normally, the hurry factor during a storm or chain.
     * Multiplies click delay / pre-click pause / fade threshold and divides the paw speed.
     * @returns {number}
     * @req HURRY-1
     */
    function urgencyFactor() {
        const now = performance.now();

        if (now - urgencyCache.t < 30) {
            return urgencyCache.v;
        }

        urgencyCache = {
            t: now,
            v:
                cookieChainActive() ||
                cookieStormActive()
                    ? getPanicFactor()
                    : 1
        };

        return urgencyCache.v;
    }

    // ============================================================================
    // SECTION 6 - Golden cookie model (fade curve, shimmers, geometry)
    // ============================================================================

    /**
     * Fade-curve threshold above which a cookie counts as visible/clickable (setting
     * 'Wait till cookie is visible', default 0.55) times the hurry factor.
     * @returns {number} 0..1
     * @req GC-3, HURRY-1
     */
    function getGoldenFadeThreshold() {
        const n = Number(
            data.config.goldenMinFadeCurve
        );

        return (
            (Number.isFinite(n)
                ? clamp(n, 0, 1)
                : 0.55) * urgencyFactor()
        );
    }

    /**
     * Fade state of a golden shimmer. Mirrors the game's own opacity/scale formula
     *   curve = 1 - (2 * life / (fps * dur) - 1)^4
     * 0 = just spawned, 1 = peak (mid-life), then back to 0. 'ready' means curve >= threshold,
     * or already past the peak (so it never turns un-clickable while fading out).
     * Unknown state never blocks a click.
     * @param {Object} shimmer
     * @returns {{curve:number,progress:number,ready:boolean}}
     * @req GC-3
     */
    function goldenVisibility(shimmer) {
        if (
            !shimmer ||
            !window.Game ||
            !Game.fps ||
            !Number.isFinite(shimmer.life) ||
            !Number.isFinite(shimmer.dur) ||
            shimmer.dur <= 0
        ) {
            // Unknown state: don't block the click.
            return {
                curve: 1,
                progress: 0.5,
                ready: true
            };
        }

        const lifeRatio = clamp(
            shimmer.life /
                (Game.fps * shimmer.dur),
            0,
            1
        );

        // 0 = just spawned, 0.5 = peak, 1 = gone
        const progress = 1 - lifeRatio;

        const curve =
            1 -
            Math.pow(lifeRatio * 2 - 1, 4);

        // Past the peak it stays eligible, otherwise
        // the fade-out would hide it from the bot again.
        const ready =
            progress >= 0.5 ||
            curve >= getGoldenFadeThreshold();

        return { curve, progress, ready };
    }

    /**
     * Classify all live golden shimmers.
     *   good    = clickable (passed the fade-in threshold) -> gets queued
     *   pending = good-type cookies still fading in -> highlighted only ({shimmer, curve})
     *   wrath   = never clicked
     * Also remembers when each good cookie first became ready (runtime.goldenReadyAt), which
     * starts the reaction delay of GC-4, and forgets cookies that are gone.
     * @returns {{good:Object[],wrath:Object[],pending:{shimmer:Object,curve:number}[]}}
     * @req GC-1, GC-2, GC-3, GC-4
     */
    function getGoldenShimmers() {
        if (
            !window.Game ||
            !Array.isArray(Game.shimmers)
        ) {
            return {
                good: [],
                wrath: [],
                pending: []
            };
        }

        const good = [];
        const wrath = [];
        const pending = [];
        const alive = new Set();

        for (const shimmer of Game.shimmers) {
            if (
                !shimmer ||
                shimmer.type !== 'golden' ||
                shimmer.popped ||
                !shimmer.l ||
                !shimmer.l.isConnected
            ) {
                continue;
            }

            alive.add(shimmer.id);

            if (Number(shimmer.wrath) > 0) {
                wrath.push(shimmer);
                continue;
            }

            const vis =
                goldenVisibility(shimmer);

            if (vis.ready) {
                good.push(shimmer);

                // Remember when it became clickable
                // (start of the reaction delay).
                if (
                    !runtime.goldenReadyAt.has(
                        shimmer.id
                    )
                ) {
                    runtime.goldenReadyAt.set(
                        shimmer.id,
                        Date.now()
                    );
                }
            } else {
                pending.push({
                    shimmer,
                    curve: vis.curve
                });
            }
        }

        for (const id of Array.from(
            runtime.goldenReadyAt.keys()
        )) {
            if (!alive.has(id)) {
                runtime.goldenReadyAt.delete(
                    id
                );
            }
        }

        return { good, wrath, pending };
    }

    /**
     * Bounding rect of an element if it is connected, non-empty and on screen; else null.
     * @param {Element} el
     * @returns {DOMRect|null}
     */
    function visibleRect(el) {
        if (!el || !el.isConnected) {
            return null;
        }

        const r =
            el.getBoundingClientRect();

        if (
            !r ||
            r.width <= 0 ||
            r.height <= 0
        ) {
            return null;
        }

        if (
            r.right < 0 ||
            r.bottom < 0 ||
            r.left > window.innerWidth ||
            r.top > window.innerHeight
        ) {
            return null;
        }

        if (elementHiddenByCss(el)) {
            return null;
        }

        if (clippedByAncestor(el, r)) {
            return null;
        }

        return r;
    }

    /**
     * True if the element itself or any ancestor is display:none / visibility:hidden / opacity:0.
     * getBoundingClientRect() can still report a plausible-looking rect for a collapsed accordion
     * panel (e.g. the upgrade store folded into a strip), so size alone is not enough to trust it.
     * @param {Element} el
     * @returns {boolean}
     * @req BUY-3
     */
    function elementHiddenByCss(el) {
        if (
            typeof el.checkVisibility ===
            'function'
        ) {
            try {
                return !el.checkVisibility({
                    checkOpacity: true,
                    checkVisibilityCSS: true
                });
            } catch (e) {
                /* fall through to the manual check below */
            }
        }

        for (
            let node = el;
            node && node.nodeType === 1;
            node = node.parentElement
        ) {
            const cs =
                window.getComputedStyle(
                    node
                );

            if (
                !cs ||
                cs.display === 'none' ||
                cs.visibility === 'hidden' ||
                Number(cs.opacity) === 0
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * True if an ancestor clips the element away: an overflow:hidden/auto/scroll ancestor (e.g. a
     * collapsed store panel with height:0) whose own visible box does not actually contain the
     * element's rect. Layout can keep the element's coordinates while the panel that holds it is
     * squeezed to nothing, which is exactly what a "collapsed" accordion looks like.
     * @param {Element} el
     * @param {DOMRect} r - el's own getBoundingClientRect()
     * @returns {boolean}
     * @req BUY-3
     */
    function clippedByAncestor(el, r) {
        for (
            let node = el.parentElement;
            node && node !== document.body;
            node = node.parentElement
        ) {
            const cs =
                window.getComputedStyle(
                    node
                );

            const clipRe = /(hidden|auto|scroll|clip)/;

            const clipsX =
                clipRe.test(cs.overflowX) ||
                clipRe.test(cs.overflow);

            const clipsY =
                clipRe.test(cs.overflowY) ||
                clipRe.test(cs.overflow);

            if (!clipsX && !clipsY) continue;

            const cr =
                node.getBoundingClientRect();

            if (
                cr.width <= 0 ||
                cr.height <= 0
            ) {
                return true;
            }

            const overlapW =
                Math.min(r.right, cr.right) -
                Math.max(r.left, cr.left);

            const overlapH =
                Math.min(
                    r.bottom,
                    cr.bottom
                ) - Math.max(r.top, cr.top);

            if (
                (clipsX &&
                    overlapW < r.width * 0.5) ||
                (clipsY &&
                    overlapH < r.height * 0.5)
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * Rect for something that may still be tiny or invisible (a cookie that is only just fading
     * in): centred on the element, at least minSize wide/high. Used for the immediate hitboxes.
     * @param {Element} el
     * @param {number} minSize
     * @returns {{left:number,top:number,width:number,height:number}|null}
     * @req GC-2
     */
    function looseRect(el, minSize) {
        if (!el || !el.isConnected) {
            return null;
        }

        const r =
            el.getBoundingClientRect();

        if (!r) return null;

        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;

        if (
            cx < 0 ||
            cy < 0 ||
            cx > window.innerWidth ||
            cy > window.innerHeight
        ) {
            return null;
        }

        const w = Math.max(
            r.width,
            minSize || 0
        );

        const h = Math.max(
            r.height,
            minSize || 0
        );

        return {
            left: cx - w / 2,
            top: cy - h / 2,
            width: w,
            height: h
        };
    }

    /**
     * Centre of a shimmer on screen.
     * @param {Object} shimmer
     * @returns {{x:number,y:number,rect:DOMRect}|null}
     */
    function shimmerCenter(shimmer) {
        const r = visibleRect(
            shimmer && shimmer.l
        );

        if (!r) return null;

        return {
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
            rect: r
        };
    }

    /**
     * Euclidean distance between two {x,y} points.
     * @returns {number}
     */
    function distance(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;

        return Math.sqrt(
            dx * dx + dy * dy
        );
    }

    // ---------- Route planning ----------
    // Shortest OPEN path (it starts at the paw and may end anywhere) that
    // visits every cookie, i.e. the least travel to collect all of them.
    // Up to 11 cookies it is solved exactly (Held-Karp dynamic programming),
    // beyond that the best of several 2-opt + Or-opt improved tours is used.
    // Everything is deterministic, so the plan does not flip-flop between
    // equally good routes.

    // ============================================================================
    // SECTION 7 - Route planning (least total travel)
    // ============================================================================

    /**
     * Exact shortest OPEN path (Held-Karp dynamic programming, O(2^n * n^2)): start at node 0,
     * visit all n cookies, end anywhere.
     * @param {Float64Array} D - (n+1)x(n+1) distance matrix, node 0 = start, 1..n = cookies
     * @param {number} n - number of cookies (used for n <= 11)
     * @returns {number[]} node path [0, first, ..., last]
     * @req GC-5
     */
    function exactRoute(D, n) {
        const N = n + 1;
        const size = 1 << n;
        const dp = new Float64Array(size * n).fill(Infinity);
        const par = new Int8Array(size * n).fill(-1);

        for (let j = 0; j < n; j++) {
            dp[(1 << j) * n + j] = D[j + 1];
        }

        for (let mask = 1; mask < size; mask++) {
            for (let j = 0; j < n; j++) {
                if (!(mask & (1 << j))) continue;

                const cur = dp[mask * n + j];

                if (cur === Infinity) continue;

                for (let k = 0; k < n; k++) {
                    if (mask & (1 << k)) continue;

                    const nm = mask | (1 << k);
                    const c = cur + D[(j + 1) * N + (k + 1)];

                    if (c < dp[nm * n + k]) {
                        dp[nm * n + k] = c;
                        par[nm * n + k] = j;
                    }
                }
            }
        }

        const full = size - 1;
        let best = 0;
        let bestCost = Infinity;

        for (let j = 0; j < n; j++) {
            if (dp[full * n + j] < bestCost) {
                bestCost = dp[full * n + j];
                best = j;
            }
        }

        const order = [];
        let mask = full;
        let j = best;

        while (j !== -1) {
            order.push(j + 1);

            const pj = par[mask * n + j];

            mask &= ~(1 << j);
            j = pj;
        }

        // path with the start in front: [0, first, ..., last]
        return [0].concat(order.reverse());
    }

    /**
     * Length of an open path.
     * @param {Float64Array} D
     * @param {number} N - matrix size
     * @param {number[]} path
     * @returns {number}
     * @req GC-5
     */
    function routeCost(D, N, path) {
        let c = 0;

        for (let k = 0; k + 1 < path.length; k++) {
            c += D[path[k] * N + path[k + 1]];
        }

        return c;
    }

    /**
     * Local search on an open path whose first node (the start) is fixed: 2-opt (reverse a
     * segment) and Or-opt (move a run of 1-3 nodes, optionally reversed) until no move helps.
     * Modifies and returns the given path.
     * @param {Float64Array} D
     * @param {number} N
     * @param {number[]} path
     * @returns {number[]}
     * @req GC-5
     */
    function improveRoute(D, N, path) {
        const n = path.length - 1;

        for (let guard = 0; guard < 400; guard++) {
            let changed = false;

            // 2-opt: reverse path[i..j]
            for (let i = 1; i <= n && !changed; i++) {
                for (let j = i + 1; j <= n; j++) {
                    const a = path[i - 1];
                    const b = path[i];
                    const c = path[j];
                    const d = j < n ? path[j + 1] : -1;

                    const delta =
                        D[a * N + c] +
                        (d >= 0 ? D[b * N + d] : 0) -
                        D[a * N + b] -
                        (d >= 0 ? D[c * N + d] : 0);

                    if (delta < -1e-9) {
                        const seg = path.slice(i, j + 1).reverse();

                        for (let t = 0; t < seg.length; t++) {
                            path[i + t] = seg[t];
                        }

                        changed = true;
                        break;
                    }
                }
            }

            if (changed) continue;

            // Or-opt: move a run of 1-3 cookies elsewhere (maybe reversed)
            for (let L = 1; L <= 3 && !changed; L++) {
                for (let i = 1; i + L - 1 <= n && !changed; i++) {
                    const j = i + L - 1;
                    const prev = path[i - 1];
                    const first = path[i];
                    const last = path[j];
                    const next = j < n ? path[j + 1] : -1;

                    const removeGain =
                        D[prev * N + first] +
                        (next >= 0 ? D[last * N + next] : 0) -
                        (next >= 0 ? D[prev * N + next] : 0);

                    let bestDelta = -1e-9;
                    let bestK = -1;
                    let bestRev = false;

                    for (let k = 0; k <= n; k++) {
                        if (k >= i - 1 && k <= j) continue;

                        const a = path[k];
                        const b = k < n ? path[k + 1] : -1;
                        const ab = b >= 0 ? D[a * N + b] : 0;

                        const fwd =
                            D[a * N + first] +
                            (b >= 0 ? D[last * N + b] : 0) -
                            ab -
                            removeGain;

                        const rev =
                            D[a * N + last] +
                            (b >= 0 ? D[first * N + b] : 0) -
                            ab -
                            removeGain;

                        if (fwd < bestDelta) {
                            bestDelta = fwd;
                            bestK = k;
                            bestRev = false;
                        }

                        if (rev < bestDelta) {
                            bestDelta = rev;
                            bestK = k;
                            bestRev = true;
                        }
                    }

                    if (bestK >= 0) {
                        const seg = path.slice(i, j + 1);

                        if (bestRev) seg.reverse();

                        const rest = path
                            .slice(0, i)
                            .concat(path.slice(j + 1));

                        const after = bestK < i ? bestK : bestK - L;
                        const out = rest
                            .slice(0, after + 1)
                            .concat(seg, rest.slice(after + 1));

                        for (let t = 0; t < out.length; t++) {
                            path[t] = out[t];
                        }

                        changed = true;
                    }
                }
            }

            if (!changed) break;
        }

        return path;
    }

    /**
     * Route for many cookies (n > 11): nearest-neighbour tour plus (n <= 60) 8 seeded random
     * restarts, each improved by improveRoute(); the cheapest wins. Deterministic (seeded from
     * the distances) so the plan is stable. Within ~0.4 % of exact in tests at n = 13..14.
     * @param {Float64Array} D
     * @param {number} n
     * @returns {number[]} path with the start in front
     * @req GC-5, NFR-6
     */
    function heuristicRoute(D, n) {
        const N = n + 1;

        // nearest-neighbour tour as the first candidate
        const nn = [0];
        const left = new Set();

        for (let i = 1; i <= n; i++) left.add(i);

        while (left.size) {
            const cur = nn[nn.length - 1];
            let best = -1;
            let bd = Infinity;

            for (const i of left) {
                if (D[cur * N + i] < bd) {
                    bd = D[cur * N + i];
                    best = i;
                }
            }

            nn.push(best);
            left.delete(best);
        }

        let bestPath = improveRoute(D, N, nn.slice());
        let bestCost = routeCost(D, N, bestPath);

        // a few seeded random restarts (deterministic)
        let seed = (n * 2654435761) >>> 0;

        for (let i = 0; i < N; i++) {
            seed = (seed + Math.round(D[i] * 7) * 40503) >>> 0;
        }

        const rnd = () => {
            seed = (seed + 0x6d2b79f5) >>> 0;

            let t = seed;

            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        const restarts = n > 60 ? 0 : 8;

        for (let r = 0; r < restarts; r++) {
            const perm = [];

            for (let i = 1; i <= n; i++) perm.push(i);

            for (let i = perm.length - 1; i > 0; i--) {
                const k = Math.floor(rnd() * (i + 1));
                const tmp = perm[i];

                perm[i] = perm[k];
                perm[k] = tmp;
            }

            const cand = improveRoute(D, N, [0].concat(perm));
            const cost = routeCost(D, N, cand);

            if (cost < bestCost - 1e-9) {
                bestCost = cost;
                bestPath = cand;
            }
        }

        return bestPath;
    }

    /**
     * Visiting order with the least total travel from a start point through all points.
     * Exact up to 11 points, heuristic beyond. Never worse than nearest-first.
     * @param {{x:number,y:number}} start - the paw
     * @param {{x:number,y:number}[]} pts - the cookies
     * @returns {number[]} indices into pts in visiting order
     * @req GC-5
     */
    function planRoute(start, pts) {
        const n = pts.length;

        if (n <= 1) return pts.map((_, i) => i);

        const P = [start].concat(pts);
        const N = n + 1;
        const D = new Float64Array(N * N);

        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                D[i * N + j] = Math.hypot(
                    P[i].x - P[j].x,
                    P[i].y - P[j].y
                );
            }
        }

        const path = n <= 11 ? exactRoute(D, n) : heuristicRoute(D, n);

        return path.slice(1).map(i => i - 1);
    }

    /**
     * The order in which the ready cookies get collected: [{shimmer, pos}, ...].
     * The plan is cached in runtime.route and only recomputed when the set (or position) of
     * cookies changes or the paw moved more than 80 px, because this is asked for many times
     * per frame (overlay, panel, scheduler).
     * @param {Object[]} goodShimmers - ready cookies
     * @returns {{shimmer:Object,pos:Object}[]}
     * @req GC-5, NFR-3
     */
    function buildGoldenQueue(goodShimmers) {
        const items = goodShimmers
            .map(shimmer => ({
                shimmer,
                pos: shimmerCenter(shimmer)
            }))
            .filter(item => item.pos);

        if (items.length <= 1) {
            return items;
        }

        const key = items
            .map(
                it =>
                    `${it.shimmer.id}@${Math.round(
                        it.pos.x / 4
                    )},${Math.round(it.pos.y / 4)}`
            )
            .sort()
            .join('|');

        const cur = {
            x: runtime.cursor.x,
            y: runtime.cursor.y
        };

        const r = runtime.route;

        if (
            !r ||
            r.key !== key ||
            Math.hypot(cur.x - r.from.x, cur.y - r.from.y) > 80
        ) {
            const order = planRoute(
                cur,
                items.map(it => it.pos)
            );

            runtime.route = {
                key,
                from: cur,
                ids: order.map(i => items[i].shimmer.id)
            };
        }

        const byId = new Map(
            items.map(it => [it.shimmer.id, it])
        );

        const out = runtime.route.ids
            .map(id => byId.get(id))
            .filter(Boolean);

        return out.length === items.length ? out : items;
    }


    // ============================================================================
    // SECTION 8 - Input synthesis, waiting helpers, cursor motion (plus the effect-name helper)
    // ============================================================================

    /**
     * Display name of a golden cookie's internal effect key (e.g. 'multiply cookies' -> 'Lucky').
     * @param {string} internal
     * @returns {string}
     * @req GC-6
     */
    function effectPrettyName(internal) {
        const map = {
            frenzy: 'Frenzy',
            'multiply cookies': 'Lucky',
            'ruin cookies': 'Ruin',
            'blood frenzy':
                'Elder Frenzy',
            clot: 'Clot',
            'click frenzy':
                'Click Frenzy',
            'cursed finger':
                'Cursed Finger',
            'chain cookie':
                'Cookie Chain',
            'cookie storm':
                'Cookie Storm',
            'cookie storm drop':
                'Cookie Storm Drop',
            'building special':
                'Building Special',
            'dragon harvest':
                'Dragon Harvest',
            dragonflight:
                'Dragonflight',
            'free sugar lump': 'Sweet',
            blab: 'Blab',
            'everything must go':
                'Everything Must Go'
        };

        return (
            map[internal] ||
            (internal
                ? internal.replace(
                      /\b\w/g,
                      c => c.toUpperCase()
                  )
                : 'Unknown')
        );
    }

    /**
     * Actions whose paw movement is purely cosmetic (pondering, dancing, idle wandering, bored
     * clicks). dispatchMove() stays silent during them: the game puts click numbers, popups and
     * tooltips at Game.mouseX/Y, so a wandering paw would hijack them from the real mouse.
     * @req MOUSE-2, IDLE-4
     */
    const SILENT_MOVE_ACTIONS = new Set([
        'idle',
        'idle-play',
        'happy-dance',
        'bored-click',
        'auto-shop'
    ]);

    /**
     * Send a synthetic mousemove to the document (keeps the game's mouse position in step with the
     * paw during real actions). Silent while a cosmetic action runs (SILENT_MOVE_ACTIONS).
     * @param {number} x
     * @param {number} y
     * @req MOUSE-2
     */
    function dispatchMove(x, y) {
        if (
            SILENT_MOVE_ACTIONS.has(
                runtime.currentAction
            )
        ) {
            return;
        }

        try {
            document.dispatchEvent(
                new MouseEvent(
                    'mousemove',
                    {
                        bubbles: true,
                        cancelable: false,
                        view: window,
                        clientX:
                            Math.round(x),
                        clientY:
                            Math.round(y),
                        screenX:
                            Math.round(x),
                        screenY:
                            Math.round(y),
                        detail: 0
                    }
                )
            );
        } catch (_) {}
    }

    /**
     * Dispatch a synthetic MouseEvent (bubbling) on an element.
     * @param {Element} el
     * @param {string} type - 'mousemove', 'mousedown', 'click', ...
     * @param {number} x
     * @param {number} y
     * @param {number} buttons
     * @returns {boolean} result of dispatchEvent
     */
    function dispatchMouse(
        el,
        type,
        x,
        y,
        buttons
    ) {
        if (!el) return false;

        const ev = new MouseEvent(
            type,
            {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX:
                    Math.round(x),
                clientY:
                    Math.round(y),
                screenX:
                    Math.round(x),
                screenY:
                    Math.round(y),
                button: 0,
                buttons:
                    buttons || 0,
                detail: 1
            }
        );

        return el.dispatchEvent(ev);
    }

    // ============================================================================
    // Background operation: timers that browsers do not throttle (BG-*)
    // ============================================================================

    /**
     * State of the worker clock. 'ok' becomes true after a self-test succeeded; until then (and if it
     * never does, e.g. no Worker support or a page policy that forbids blob workers) normal timers are used.
     * @req BG-1
     */
    const bgClock = {
        worker: null,
        ok: false,
        failed: false,
        seq: 0,
        cbs: new Map()
    };

    /**
     * Create the timer worker and run a self-test (a 20 ms timeout must come back within 2 s).
     * Browsers throttle timers of the PAGE in background tabs, but not those of a Web Worker.
     * @req BG-1
     */
    function bgInit() {
        if (bgClock.worker || bgClock.failed) return;

        try {
            const code =
                'self.onmessage=function(e){var d=e.data;' +
                'setTimeout(function(){self.postMessage(d.id)},d.ms)};';

            const url = URL.createObjectURL(
                new Blob([code], { type: 'text/javascript' })
            );

            const w = new Worker(url);

            try {
                URL.revokeObjectURL(url);
            } catch (e) {
                /* ignore */
            }

            w.onmessage = e => {
                const fn = bgClock.cbs.get(e.data);

                if (!fn) return;

                bgClock.cbs.delete(e.data);

                try {
                    fn();
                } catch (err) {
                    console.error('[CC Good Boy] timer error', err);
                }
            };

            w.onerror = () => {
                bgClock.ok = false;
                bgClock.failed = true;
            };

            bgClock.worker = w;

            // self-test: only trust the worker once it has answered
            const id = ++bgClock.seq;

            bgClock.cbs.set(id, () => {
                bgClock.ok = true;
            });

            w.postMessage({ id, ms: 20 });
        } catch (e) {
            bgClock.failed = true;
        }
    }

    /**
     * setTimeout that is not throttled in background tabs (worker clock), or the normal one while the
     * worker is not (yet) usable.
     * @param {Function} fn
     * @param {number} ms
     * @returns {number|Object} handle for bgClear()
     * @req BG-1
     */
    function bgSetTimeout(fn, ms) {
        if (bgClock.ok && bgClock.worker) {
            const id = ++bgClock.seq;

            bgClock.cbs.set(id, fn);
            bgClock.worker.postMessage({ id, ms });

            return id;
        }

        return { native: window.setTimeout(fn, ms) };
    }

    /**
     * Cancel a bgSetTimeout() handle.
     * @param {number|Object|null} h
     * @req BG-1
     */
    function bgClear(h) {
        if (h == null) return;

        if (typeof h === 'object') {
            window.clearTimeout(h.native);
        } else {
            bgClock.cbs.delete(h);
        }
    }

    /**
     * Interval built from chained bgSetTimeout()s (each run re-arms the next one).
     * @param {Function} fn
     * @param {number} ms
     * @returns {{stop:boolean,id:*}} handle for bgStop()
     * @req BG-1
     */
    function bgEvery(fn, ms) {
        const h = { stop: false, id: null };

        const tick = () => {
            if (h.stop) return;

            try {
                fn();
            } finally {
                if (!h.stop) h.id = bgSetTimeout(tick, ms);
            }
        };

        h.id = bgSetTimeout(tick, ms);

        return h;
    }

    /**
     * Stop a bgEvery() interval.
     * @param {{stop:boolean,id:*}} h
     * @req BG-1
     */
    function bgStop(h) {
        if (!h) return;

        h.stop = true;

        bgClear(h.id);
    }

    /**
     * Next animation step for the paw: requestAnimationFrame when the page is drawn, but never later than
     * ~34 ms - a hidden tab gets no animation frames, so a timer (unthrottled, see bgSetTimeout) steps in.
     * @param {Function} cb - called with a performance.now() time stamp
     * @req BG-2
     */
    function nextFrame(cb) {
        let done = false;
        let t = null;

        const fire = () => {
            if (done) return;

            done = true;

            bgClear(t);

            cb(performance.now());
        };

        requestAnimationFrame(fire);

        t = bgSetTimeout(fire, 34);
    }

    /**
     * Keep-alive: a (practically silent) AudioContext. Firefox does not throttle the timers of a tab that
     * contains one, which keeps the GAME's own loop running at full speed in the background. Browsers only
     * let audio start after a click on the page, so it waits for the first real click (shown in the HUD).
     * @req BG-3
     */
    function keepAliveInit() {
        const ka = runtime.keepAlive;

        if (data.config.keepAlive === false) {
            keepAliveStop();

            return;
        }

        if (ka.ctx) return;

        const AC = window.AudioContext || window.webkitAudioContext;

        if (!AC) {
            ka.state = 'not supported';

            return;
        }

        try {
            const ctx = new AC();
            const gain = ctx.createGain();
            const osc = ctx.createOscillator();

            gain.gain.value = 0.0002; // about -74 dBFS at 40 Hz: inaudible, but not digital silence
            osc.type = 'sine';
            osc.frequency.value = 40;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();

            ka.ctx = ctx;

            if (!ka.listening) {
                ka.listening = true;

                ['pointerdown', 'keydown', 'click', 'touchstart'].forEach(
                    type =>
                        window.addEventListener(type, keepAliveResume, true)
                );
            }

            keepAliveResume({ isTrusted: true });
        } catch (e) {
            ka.state = 'failed';
        }
    }

    /**
     * Resume the keep-alive audio (only real user input counts, not the bot's own synthetic events).
     * @param {Event} e
     * @req BG-3
     */
    function keepAliveResume(e) {
        const ka = runtime.keepAlive;

        if (!ka.ctx || !e || e.isTrusted === false) return;

        if (ka.ctx.state === 'suspended') {
            ka.ctx.resume().catch(() => {});
        }
    }

    /**
     * Stop the keep-alive audio.
     * @req BG-3
     */
    function keepAliveStop() {
        const ka = runtime.keepAlive;

        if (ka.ctx) {
            try {
                ka.ctx.close();
            } catch (e) {
                /* ignore */
            }
        }

        ka.ctx = null;
        ka.state = 'off';
    }

    /**
     * Text of the HUD row "Background": timer source and keep-alive state.
     * @returns {string}
     * @req BG-4
     */
    function backgroundStatusText() {
        const ka = runtime.keepAlive;

        let audio = 'off';

        if (data.config.keepAlive !== false) {
            audio = !ka.ctx
                ? ka.state
                : ka.ctx.state === 'running'
                  ? 'running'
                  : 'waiting for a click on the page';
        }

        return `timers: ${bgClock.ok ? 'worker' : bgClock.failed ? 'page (no worker)' : 'page (starting)'} | keep-alive: ${audio}`;
    }

    /**
     * Promise that resolves after ms milliseconds (worker clock, so it is not throttled in background tabs).
     * @param {number} ms
     * @returns {Promise<void>}
     * @req BG-1
     */
    function sleep(ms) {
        return new Promise(resolve =>
            bgSetTimeout(resolve, ms)
        );
    }

    /**
     * Click delay in ms: setting 'Patience before moving' (default 200) x hurry factor.
     * Applied BEFORE the paw starts moving, to every click except Click Frenzy/hammer clicks.
     * @returns {number}
     * @req GC-4, FT-5, HURRY-1
     */
    function getClickDelayMs() {
        return Math.round(
            clampInt(
                data.config
                    .goldenMinIntervalMs,
                0,
                5000,
                200
            ) * urgencyFactor()
        );
    }

    /**
     * Pre-click pause in ms: setting 'Shy pause before click' (default 100) x hurry factor.
     * Applied AFTER the paw arrived and before it clicks.
     * @returns {number}
     * @req GC-4, FT-5, HURRY-1
     */
    function getPreClickDelayMs() {
        return Math.round(
            clampInt(
                data.config.preClickDelayMs,
                0,
                2000,
                100
            ) * urgencyFactor()
        );
    }

    /**
     * Wait until click delay ms have passed since the previous click of ANY kind. Enforced
     * BEFORE the cursor starts moving.
     * @param {boolean} abortForGolden - stop waiting when a good cookie is ready
     * @param {Function} [abortIf] - extra abort predicate
     * @returns {Promise<boolean>} false if aborted
     * @req GC-4, FT-5
     */
    function waitForClickGap(
        abortForGolden,
        abortIf
    ) {
        return waitUntil(
            runtime.lastClickAt +
                getClickDelayMs(),
            abortForGolden,
            abortIf
        );
    }

    /**
     * Extra pause AFTER the cursor arrived, before clicking (pre-click delay).
     * @param {boolean} abortForGolden
     * @param {Function} [abortIf]
     * @returns {Promise<boolean>} false if aborted
     * @req GC-4
     */
    function waitPreClick(
        abortForGolden,
        abortIf
    ) {
        return waitUntil(
            Date.now() +
                getPreClickDelayMs(),
            abortForGolden,
            abortIf
        );
    }

    /**
     * Is at least one good, READY golden cookie on screen? (the standard abort predicate)
     * @returns {boolean}
     * @req SCHED-1, SCHED-2
     */
    function hasGoodGolden() {
        return (
            getGoldenShimmers().good
                .length > 0
        );
    }

    // ---- Human-like cursor travel ---------------------------------------
    // The trip is split into a few arcing segments (a spline through
    // bowed waypoints). Speed varies along the way (ease in/out, wobble,
    // small hesitations at the waypoints) and a light hand tremor is added
    // that fades out on arrival, so the paw never moves like a robot.

    /**
     * Human-like path between two points: 2-6 waypoints (one per ~170 px) bowed sideways so the
     * route is an arc with small irregularities, plus 'dips' (0..1 fractions) where the cursor
     * hesitates slightly.
     * @param {{x:number,y:number}} start
     * @param {{x:number,y:number}} end
     * @returns {{pts:Object[],dips:number[]}}
     * @req PAW-4
     */
    function buildCursorPath(start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 2) {
            return {
                pts: [start, end],
                dips: []
            };
        }

        const nx = -dy / dist;
        const ny = dx / dist;

        const segs =
            dist < 40
                ? 2
                : clamp(
                      Math.round(
                          dist / 170
                      ),
                      2,
                      6
                  );

        const bowSign =
            Math.random() < 0.5 ? -1 : 1;

        const bow =
            dist *
            (0.05 + Math.random() * 0.1) *
            bowSign;

        const pts = [start];
        const dips = [];

        for (let k = 1; k < segs; k++) {
            const f = clamp(
                k / segs +
                    (Math.random() - 0.5) *
                        (0.5 / segs),
                0.05,
                0.95
            );

            const lateral =
                bow * 4 * f * (1 - f) +
                (Math.random() - 0.5) *
                    dist *
                    0.04;

            pts.push({
                x:
                    start.x +
                    dx * f +
                    nx * lateral,
                y:
                    start.y +
                    dy * f +
                    ny * lateral
            });

            dips.push(f);
        }

        pts.push(end);

        return { pts, dips };
    }

    /**
     * Catmull-Rom spline through pts evaluated at u in [0,1].
     * @param {Object[]} pts
     * @param {number} u
     * @returns {{x:number,y:number}}
     * @req PAW-4
     */
    function splinePoint(pts, u) {
        const n = pts.length - 1;
        const f = clamp(u, 0, 1) * n;
        const i = Math.min(
            n - 1,
            Math.floor(f)
        );
        const t = f - i;

        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(n, i + 2)];

        const t2 = t * t;
        const t3 = t2 * t;

        const c = (a, b, c2, d) =>
            0.5 *
            (2 * b +
                (-a + c2) * t +
                (2 * a - 5 * b + 4 * c2 - d) *
                    t2 +
                (-a + 3 * b - 3 * c2 + d) *
                    t3);

        return {
            x: c(p0.x, p1.x, p2.x, p3.x),
            y: c(p0.y, p1.y, p2.y, p3.y)
        };
    }

    /**
     * Time -> path progress mapping. Bell-shaped speed (min-jerk like) with random wobble and slight
     * slow-downs where the path bends, so the cursor never moves at constant speed.
     * @param {number[]} dips - fractions of the path with hesitations
     * @returns {function(number):number} tau 0..1 -> u 0..1
     * @req PAW-4
     */
    function buildSpeedWarp(dips) {
        const N = 96;
        const TAU = Math.PI * 2;

        const p1 = Math.random() * TAU;
        const p2 = Math.random() * TAU;
        const k1 = 1.5 + Math.random() * 1.5;
        const k2 = 3.5 + Math.random() * 2.5;
        const a1 = 0.1 + Math.random() * 0.12;
        const a2 = 0.05 + Math.random() * 0.08;

        const cum = new Float64Array(N + 1);

        for (let i = 0; i < N; i++) {
            const tau = (i + 0.5) / N;

            let v =
                30 *
                tau *
                tau *
                (1 - tau) *
                (1 - tau);

            v = Math.max(v, 0.03);

            v *=
                1 +
                a1 *
                    Math.sin(
                        TAU * k1 * tau + p1
                    ) +
                a2 *
                    Math.sin(
                        TAU * k2 * tau + p2
                    );

            for (const f of dips) {
                v *=
                    1 -
                    0.3 *
                        Math.exp(
                            -Math.pow(
                                (tau - f) /
                                    0.04,
                                2
                            )
                        );
            }

            cum[i + 1] = cum[i] + v;
        }

        const total = cum[N];

        for (let i = 1; i <= N; i++) {
            cum[i] /= total;
        }

        return tau => {
            const x =
                clamp(tau, 0, 1) * N;

            const i = Math.min(
                N - 1,
                Math.floor(x)
            );

            return (
                cum[i] +
                (cum[i + 1] - cum[i]) *
                    (x - i)
            );
        };
    }

    /**
     * Animate the paw to (x, y) along an arced, speed-varying path with a fading hand tremor.
     * Speed = setting 'Paw zoomies' / hurry factor (or opts.speed); duration = distance/speed x
     * 0.85..1.2, clamped to 22 ms .. opts.maxMs (420). Ends exactly on the target.
     * @param {number} x
     * @param {number} y
     * @param {boolean} abortForGolden - stop as soon as a good cookie is ready
     * @param {{speed?:number,maxMs?:number,abortIf?:Function}} [opts]
     * @returns {Promise<boolean>} true on arrival, false if aborted/paused/destroyed
     * @req PAW-4, GC-4, HURRY-1
     */
    async function moveCursorTo(
        x,
        y,
        abortForGolden,
        opts
    ) {
        // opts (all optional): speed px/s, maxMs, abortIf() callback.
        opts = opts || {};

        x = clamp(
            x,
            2,
            window.innerWidth - 2
        );

        y = clamp(
            y,
            2,
            window.innerHeight - 2
        );

        const start = {
            x: runtime.cursor.x,
            y: runtime.cursor.y
        };

        const end = { x, y };

        const dist = distance(start, end);

        const speed = opts.speed
            ? clamp(opts.speed, 20, 20000)
            : clamp(
                  (Number(
                      data.config
                          .cursorSpeedPxPerSec
                  ) || 4200) /
                      urgencyFactor(),
                  500,
                  200000
              );

        // Every trip is a little faster or slower than the last.
        const duration = clamp(
            (dist / speed) *
                1000 *
                (0.85 +
                    Math.random() * 0.35),
            22,
            opts.maxMs || 420
        );

        const path = buildCursorPath(
            start,
            end
        );

        const warp = buildSpeedWarp(
            path.dips
        );

        // Hand tremor: small, fades out towards the target.
        const TAU = Math.PI * 2;
        const tremor = Math.min(
            1.3,
            dist * 0.03
        );

        const fq = [
            7 + Math.random() * 6,
            17 + Math.random() * 6,
            6 + Math.random() * 6,
            16 + Math.random() * 6
        ];

        const ph = [
            Math.random() * TAU,
            Math.random() * TAU,
            Math.random() * TAU,
            Math.random() * TAU
        ];

        const startTs =
            performance.now();

        return new Promise(resolve => {
            function frame(ts) {
                if (
                    runtime.destroyed ||
                    !runtime.running
                ) {
                    return resolve(false);
                }

                if (
                    abortForGolden &&
                    hasGoodGolden()
                ) {
                    return resolve(false);
                }

                if (
                    opts.abortIf &&
                    opts.abortIf()
                ) {
                    return resolve(false);
                }

                const t = clamp(
                    (ts - startTs) /
                        duration,
                    0,
                    1
                );

                if (t >= 1) {
                    runtime.cursor.x = x;
                    runtime.cursor.y = y;

                    dispatchMove(x, y);

                    return resolve(true);
                }

                const p = splinePoint(
                    path.pts,
                    warp(t)
                );

                const el =
                    (ts - startTs) / 1000;

                const env =
                    Math.sin(Math.PI * t) *
                    tremor;

                runtime.cursor.x =
                    p.x +
                    env *
                        (0.7 *
                            Math.sin(
                                TAU *
                                    fq[0] *
                                    el +
                                    ph[0]
                            ) +
                            0.3 *
                                Math.sin(
                                    TAU *
                                        fq[1] *
                                        el +
                                        ph[1]
                                ));

                runtime.cursor.y =
                    p.y +
                    env *
                        (0.7 *
                            Math.sin(
                                TAU *
                                    fq[2] *
                                    el +
                                    ph[2]
                            ) +
                            0.3 *
                                Math.sin(
                                    TAU *
                                        fq[3] *
                                        el +
                                        ph[3]
                                ));

                dispatchMove(
                    runtime.cursor.x,
                    runtime.cursor.y
                );

                nextFrame(frame);
            }

            nextFrame(frame);
        });
    }

    /**
     * Synthesize a click on an element like a person: mouseover, mousemove (which also puts the
     * game's mouse position, and therefore the floating '+N' number, at the paw), mousedown, a
     * short hold, mouseup, click. Also starts the click pulse (fist + squish) and records the time.
     * @param {Element} el
     * @param {number} x
     * @param {number} y
     * @param {number} [holdMs] - press-to-click delay (default random 8..21 ms)
     * @returns {Promise<boolean>}
     * @req PAW-3, MOUSE-2, CF-3
     */
    async function humanClick(
        el,
        x,
        y,
        holdMs
    ) {
        if (
            !el ||
            !el.isConnected
        ) {
            return false;
        }

        dispatchMouse(
            el,
            'mouseover',
            x,
            y,
            0
        );

        dispatchMouse(
            el,
            'mousemove',
            x,
            y,
            0
        );

        dispatchMouse(
            el,
            'mousedown',
            x,
            y,
            1
        );

        runtime.pulseAt =
            performance.now();

        await sleep(
            holdMs != null
                ? holdMs
                : 8 + Math.random() * 13
        );

        dispatchMouse(
            el,
            'mouseup',
            x,
            y,
            0
        );

        dispatchMouse(
            el,
            'click',
            x,
            y,
            0
        );

        runtime.lastClickAt =
            Date.now();

        return true;
    }

    // ============================================================================
    // SECTION 9 - Actions (golden cookie, big cookie, FTHOF, refill)
    // ============================================================================

    /**
     * Catch one good golden cookie (task). Sequence (GC-4):
     *   1 reaction delay: wait until max(previous click, cookie ready) + click delay
     *   2 move the paw to it (arced path)
     *   3 pre-click pause
     *   4 re-acquire the centre (cookies pulse) and settle
     *   5 humanClick, then record stats/log and decide about the happy dance (DANCE-2)
     * Aborts silently if the cookie disappears, turns wrath, or the bot is paused.
     * @param {Object} shimmer
     * @returns {Promise<void>}
     * @req GC-1, GC-4, GC-6, DANCE-2
     */
    async function clickGolden(
        shimmer
    ) {
        if (
            !shimmer ||
            shimmer.popped ||
            Number(shimmer.wrath) > 0 ||
            !shimmer.l ||
            !shimmer.l.isConnected
        ) {
            return;
        }

        runtime.currentAction =
            'golden-cookie';

        runtime.currentTarget =
            'good golden cookie';

        // 1) Reaction delay, BEFORE moving: wait the click delay after
        //    this cookie became clickable AND after the previous click.
        const readyAt =
            runtime.goldenReadyAt.get(
                shimmer.id
            ) || Date.now();

        if (
            !(await waitUntil(
                Math.max(
                    runtime.lastClickAt,
                    readyAt
                ) + getClickDelayMs(),
                false
            ))
        ) {
            return;
        }

        const gone = () =>
            shimmer.popped ||
            Number(shimmer.wrath) > 0 ||
            !shimmer.l ||
            !shimmer.l.isConnected;

        if (gone()) return;

        let pos =
            shimmerCenter(shimmer);

        if (!pos) return;

        // 2) Move.
        const moved =
            await moveCursorTo(
                pos.x,
                pos.y,
                false
            );

        if (!moved || gone()) {
            return;
        }

        // 3) Extra pause after arriving.
        if (
            !(await waitPreClick(
                false
            )) ||
            gone()
        ) {
            return;
        }

        // 4) Re-acquire after pulse animation.
        pos =
            shimmerCenter(shimmer) ||
            pos;

        const settled =
            await moveCursorTo(
                pos.x,
                pos.y,
                false
            );

        if (!settled || gone()) {
            return;
        }

        const preForce =
            shimmer.force ||
            (shimmer.forceObj &&
                shimmer.forceObj.type) ||
            '';

        const beforeLast =
            Game.shimmerTypes &&
            Game.shimmerTypes.golden
                ? Game.shimmerTypes
                      .golden.last
                : '';

        await humanClick(
            shimmer.l,
            pos.x,
            pos.y
        );

        if (shimmer.popped) {
            runtime.lastGoldenClickAt =
                Date.now();

            let internal =
                Game.shimmerTypes &&
                Game.shimmerTypes.golden
                    ? Game.shimmerTypes
                          .golden.last
                    : '';

            if (
                !internal ||
                internal === beforeLast
            ) {
                internal =
                    preForce ||
                    internal ||
                    'unknown';
            }

            const kind =
                effectPrettyName(
                    internal
                );

            recordGolden(kind);

            logAction(
                'click golden cookie',
                kind.toLowerCase(),
                {
                    effect: internal,
                    shimmerId:
                        shimmer.id
                }
            );

            // Happy dance only if this exact moment is otherwise idle.
            runtime.danceQueued =
                danceEligible();
        }
    }

    /**
     * A uniformly random point inside the clickable area (36 % radius) of the big cookie.
     * @returns {{el:Element,x:number,y:number,rect:DOMRect}|null}
     * @req CF-5, IDLE-2
     */
    function randomPointInBigCookie() {
        const el =
            document.getElementById(
                'bigCookie'
            );

        const rect =
            visibleRect(el);

        if (!rect) return null;

        const cx =
            rect.left +
            rect.width / 2;

        const cy =
            rect.top +
            rect.height / 2;

        const maxRadius =
            Math.min(
                rect.width,
                rect.height
            ) * 0.36;

        const angle =
            Math.random() *
            Math.PI *
            2;

        const radius =
            Math.sqrt(Math.random()) *
            maxRadius;

        return {
            el,
            x:
                cx +
                Math.cos(angle) *
                    radius,
            y:
                cy +
                Math.sin(angle) *
                    radius,
            rect
        };
    }

    /**
     * Wait (polling every <= 8 ms) until the timestamp ts.
     * @param {number} ts - Date.now() based deadline
     * @param {boolean} [abortForGolden] - stop when a good cookie is ready
     * @param {Function} [abortIf] - extra abort predicate
     * @returns {Promise<boolean>} true when the time was reached, false if aborted/paused/destroyed
     * @req SCHED-2
     */
    async function waitUntil(
        ts,
        abortForGolden,
        abortIf
    ) {
        while (Date.now() < ts) {
            if (
                runtime.destroyed ||
                !runtime.running
            ) {
                return false;
            }

            if (
                abortForGolden &&
                hasGoodGolden()
            ) {
                return false;
            }

            if (abortIf && abortIf()) {
                return false;
            }

            await sleep(
                Math.min(
                    8,
                    Math.max(
                        1,
                        ts - Date.now()
                    )
                )
            );
        }

        return true;
    }

    /**
     * The cursor starts heading for the next big-cookie click this long before it is due,
     * so travelling never eats into the click rhythm.
     * @req CF-3
     */
    const BIG_CLICK_LEAD_MS = 150;

    /**
     * True while the big cookie should be clicked fast: a real Click Frenzy, hammer mode, or the auto hammer.
     * @returns {boolean}
     * @req CF-1, CF-4, AUTO-11
     */
    function bigCookieWanted() {
        return (
            clickFrenzyActive() ||
            hammerActive()
        );
    }

    /**
     * A FTHOF cast or lump refill is waiting for its turn (the same conditions the scheduler uses).
     * @returns {boolean}
     * @req FT-1, FT-3, SCHED-1
     */
    function fthofOrRefillPending() {
        const M = getGrimoire();

        if (!M) return false;

        const buffs = positiveCpsBuffs();

        if (
            !cpsBuffOutlastsClickFrenzy(
                buffs
            )
        ) {
            return false;
        }

        const cost = getFthofCost(M);

        if (
            buffs.length >= 1 &&
            M.magic >= cost
        ) {
            return true;
        }

        return (
            buffs.length >= 2 &&
            M.magic < cost &&
            !runtime.lockA &&
            !runtime.refillInFlight
        );
    }

    /**
     * Setting 'Click step max px' (default 3, 0..60).
     * @returns {number}
     * @req CF-5
     */
    function getHammerStepPx() {
        const v = Number(
            data.config.hammerStepPx
        );

        return Number.isFinite(v)
            ? clamp(v, 0, 60)
            : 3;
    }

    /**
     * Next big-cookie click spot: a small random step (0.3..1 x max step) from the previous click, kept
     * inside the cookie, so there is almost no travel. near=false means 'no usable previous spot,
     * travel there first'.
     * @param {{x:number,y:number}|null} prev
     * @returns {{el:Element,x:number,y:number,near:boolean}|null}
     * @req CF-5
     */
    function nextBigCookiePoint(prev) {
        const el =
            document.getElementById(
                'bigCookie'
            );

        const rect = visibleRect(el);

        if (!rect) return null;

        const cx =
            rect.left + rect.width / 2;

        const cy =
            rect.top + rect.height / 2;

        const maxR =
            Math.min(
                rect.width,
                rect.height
            ) * 0.36;

        // (small tolerance: a spot clamped onto the rim must still count
        // as "on the cookie" on the next click)
        if (
            prev &&
            Math.hypot(
                prev.x - cx,
                prev.y - cy
            ) <=
                maxR + 8
        ) {
            const maxStep =
                getHammerStepPx();

            const ang =
                Math.random() *
                Math.PI *
                2;

            const step =
                maxStep *
                (0.3 +
                    Math.random() * 0.7);

            let x =
                prev.x +
                Math.cos(ang) * step;

            let y =
                prev.y +
                Math.sin(ang) * step;

            const d = Math.hypot(
                x - cx,
                y - cy
            );

            // never leave the cookie
            if (d > maxR * 0.98) {
                const k = (maxR * 0.98) / d;

                x = cx + (x - cx) * k;
                y = cy + (y - cy) * k;
            }

            return { el, x, y, near: true };
        }

        const start =
            randomPointInBigCookie();

        return start
            ? {
                  el: start.el,
                  x: start.x,
                  y: start.y,
                  near: false
              }
            : null;
    }

    /**
     * Short smooth hop (timer based, so it also works in a background tab). With no time to spare
     * (< 14 ms) or almost no distance it just snaps.
     * @param {number} x
     * @param {number} y
     * @param {number} ms
     * @param {Function} [abortIf]
     * @returns {Promise<boolean>}
     * @req CF-5
     */
    async function glideCursor(
        x,
        y,
        ms,
        abortIf
    ) {
        const sx = runtime.cursor.x;
        const sy = runtime.cursor.y;

        if (
            ms < 14 ||
            Math.hypot(x - sx, y - sy) <
                0.5
        ) {
            runtime.cursor.x = x;
            runtime.cursor.y = y;

            dispatchMove(x, y);

            return true;
        }

        const t0 = performance.now();

        for (;;) {
            if (
                runtime.destroyed ||
                !runtime.running ||
                (abortIf && abortIf())
            ) {
                return false;
            }

            const t = clamp(
                (performance.now() - t0) /
                    ms,
                0,
                1
            );

            const e = t * t * (3 - 2 * t);

            runtime.cursor.x =
                sx + (x - sx) * e;

            runtime.cursor.y =
                sy + (y - sy) * e;

            dispatchMove(
                runtime.cursor.x,
                runtime.cursor.y
            );

            if (t >= 1) return true;

            await sleep(6);
        }
    }

    /**
     * Hammer the big cookie for as long as it is wanted (real Click Frenzy or hammer mode) in ONE
     * loop, so the rate does not depend on scheduler ticks. Fixed timeline: the next click is due one
     * interval after the previous one was DUE (not after it happened); resynced from the real click
     * when > 60 ms late; never closer than base-jitter to the previous click. Each click lands a few px
     * from the previous one. Stops when: no longer wanted, a golden cookie is ready, or (hammer mode only)
     * FTHOF/refill becomes pending. Only real Click Frenzy clicks are logged.
     * @returns {Promise<void>}
     * @req CF-1, CF-2, CF-3, CF-4, CF-5
     */
    async function clickBigCookie() {
        const stop = () =>
            !bigCookieWanted() ||
            hasGoodGolden() ||
            (!clickFrenzyActive() &&
                (fthofOrRefillPending() ||
                    autoShopReady()));

        if (stop()) return;

        runtime.currentTarget =
            'big cookie';

        let prev = {
            x: runtime.cursor.x,
            y: runtime.cursor.y
        };

        for (;;) {
            if (
                runtime.destroyed ||
                !runtime.running ||
                stop()
            ) {
                return;
            }

            const frenzy =
                clickFrenzyActive();

            runtime.currentAction = frenzy
                ? 'click-frenzy'
                : 'hammer';

            const point =
                nextBigCookiePoint(prev);

            if (!point) return;

            // first click, or far from the last one: normal travel
            if (
                !point.near &&
                !(await moveCursorTo(
                    point.x,
                    point.y,
                    true,
                    { abortIf: stop }
                ))
            ) {
                return;
            }

            const due =
                runtime.nextBigClickAt ||
                Date.now();

            // The press-to-click delay is known up front, so press early
            // enough that the click event itself lands on the due time.
            const hold =
                8 + Math.random() * 13;

            const pressAt = due - hold;

            if (point.near) {
                const glideMs = clamp(
                    pressAt -
                        Date.now() -
                        3,
                    0,
                    40
                );

                if (
                    !(await glideCursor(
                        point.x,
                        point.y,
                        glideMs,
                        stop
                    ))
                ) {
                    return;
                }
            }

            if (
                !(await waitUntil(
                    pressAt,
                    true,
                    stop
                )) ||
                stop()
            ) {
                return;
            }

            await humanClick(
                point.el,
                point.x,
                point.y,
                hold
            );

            const clickedAt = Date.now();

            prev = {
                x: point.x,
                y: point.y
            };

            // Only real Click Frenzy clicks are logged; hammer mode would
            // otherwise flood the log with entries.
            if (frenzy) {
                logAction(
                    'click cookie',
                    'click frenzy'
                );
            }

            const cps = clamp(
                Number(
                    data.config
                        .clickFrenzyCps
                ) || 8,
                0.2,
                50
            );

            const base = 1000 / cps;

            // at high rates the jitter must not exceed the interval itself
            const jit = Math.min(
                clamp(
                    Number(
                        data.config
                            .clickFrenzyJitterMs
                    ) || 30,
                    0,
                    250
                ),
                base * 0.6
            );

            const interval = Math.max(
                20,
                base +
                    (Math.random() * 2 -
                        1) *
                        jit
            );

            // Fixed timeline: the next click is due one interval after
            // this one was DUE (not after it happened), so click overhead
            // never slows the rate down. If we ended up more than 60 ms
            // late (lag, first click of a burst), restart the timeline
            // from the actual click. Never closer than base - jitter to
            // the click just made.
            const ref =
                clickedAt - due > 60
                    ? clickedAt
                    : due;

            runtime.nextBigClickAt =
                Math.max(
                    ref + interval,
                    clickedAt +
                        Math.max(
                            20,
                            base - jit
                        )
                );
        }
    }

    /**
     * The real Grimoire DOM control for an action.
     * @param {'fthof'|'refill'} kind
     * @param {Object} M - Grimoire minigame
     * @returns {Element|null}
     * @req FT-4
     */
    function getGrimoireControl(
        kind,
        M
    ) {
        if (kind === 'fthof') {
            const spell =
                getFthofSpell(M);

            return spell
                ? document.getElementById(
                      `grimoireSpell${spell.id}`
                  )
                : null;
        }

        if (kind === 'refill') {
            return document.getElementById(
                'grimoireLumpRefill'
            );
        }

        return null;
    }

    /**
     * Element used as the paw's movement target: the real control when visible, otherwise the HUD
     * dock chip (FTHOF / REFILL).
     * @param {'fthof'|'refill'} kind
     * @param {Object} M
     * @returns {Element|null}
     * @req FT-7
     */
    function getActionVisualElement(
        kind,
        M
    ) {
        const real =
            getGrimoireControl(
                kind,
                M
            );

        if (visibleRect(real)) {
            return real;
        }

        if (kind === 'fthof') {
            return document.getElementById(
                'ccsb-dock-fthof'
            );
        }

        if (kind === 'refill') {
            return document.getElementById(
                'ccsb-dock-refill'
            );
        }

        return null;
    }

    /**
     * Centre of a visible element.
     * @param {Element} el
     * @returns {{x:number,y:number}|null}
     */
    function elementCenter(el) {
        const rect =
            visibleRect(el);

        if (!rect) return null;

        return {
            x:
                rect.left +
                rect.width / 2,
            y:
                rect.top +
                rect.height / 2,
            rect
        };
    }

    /**
     * Cast Force the Hand of Fate (task). Preconditions FT-1/FT-2; then: click delay, move to the
     * spell button, pre-click pause, re-check everything (golden ready? frenzy? buffs? mana?), click,
     * verify via M.spellsCastTotal, record stats/log.
     * @returns {Promise<void>}
     * @req FT-1, FT-2, FT-4, FT-5
     */
    async function castFthof() {
        const M = getGrimoire();
        const spell =
            getFthofSpell(M);

        if (
            !M ||
            !spell ||
            clickFrenzyActive() ||
            hasGoodGolden()
        ) {
            return;
        }

        const cost =
            getFthofCost(M);

        if (
            M.magic < cost ||
            !cpsBuffOutlastsClickFrenzy()
        ) {
            return;
        }

        runtime.currentAction =
            'fthof';

        runtime.currentTarget =
            'Force the Hand of Fate';

        // Global click delay, BEFORE moving.
        if (
            !(await waitForClickGap(
                true
            ))
        ) {
            return;
        }

        const control =
            getGrimoireControl(
                'fthof',
                M
            );

        const visual =
            getActionVisualElement(
                'fthof',
                M
            );

        const p =
            elementCenter(visual);

        if (
            !control ||
            !control.isConnected
        ) {
            return;
        }

        if (p) {
            const moved =
                await moveCursorTo(
                    p.x,
                    p.y,
                    true
                );

            if (!moved) return;
        }

        // Extra pause after arriving.
        if (
            !(await waitPreClick(
                true
            ))
        ) {
            return;
        }

        if (
            clickFrenzyActive() ||
            hasGoodGolden()
        ) {
            return;
        }

        if (
            !cpsBuffOutlastsClickFrenzy() ||
            M.magic <
                getFthofCost(M)
        ) {
            return;
        }

        const beforeTotal =
            Number(
                M.spellsCastTotal
            ) || 0;

        const point =
            p || {
                x: runtime.cursor.x,
                y: runtime.cursor.y
            };

        await humanClick(
            control,
            point.x,
            point.y
        );

        const casted =
            (Number(
                M.spellsCastTotal
            ) || 0) > beforeTotal;

        if (casted) {
            recordFthof();

            logAction(
                'cast fthof',
                'force the hand of fate',
                { cost }
            );
        }
    }

    /**
     * Refill mana with a sugar lump (task). Preconditions FT-3; temporarily disables the game's
     * 'ask before spending lumps' prompt, clicks the refill button, verifies (lumps down or mana up),
     * then sets LOCK_A and records stats/log.
     * @returns {Promise<void>}
     * @req FT-3, FT-4, FT-5, FT-6
     */
    async function refillGrimoire() {
        const M = getGrimoire();

        if (
            !M ||
            runtime.refillInFlight ||
            clickFrenzyActive() ||
            hasGoodGolden()
        ) {
            return;
        }

        const cost =
            getFthofCost(M);

        const buffs =
            positiveCpsBuffs();

        if (
            buffs.length < 2 ||
            !cpsBuffOutlastsClickFrenzy(
                buffs
            ) ||
            M.magic >= cost ||
            runtime.lockA
        ) {
            return;
        }

        if (
            !Game.canRefillLump ||
            !Game.canRefillLump() ||
            Number(Game.lumps) < 1
        ) {
            return;
        }

        runtime.currentAction =
            'grimoire-refill';

        runtime.currentTarget =
            'Grimoire refill';

        // Global click delay, BEFORE moving.
        if (
            !(await waitForClickGap(
                true
            ))
        ) {
            return;
        }

        const control =
            getGrimoireControl(
                'refill',
                M
            );

        const visual =
            getActionVisualElement(
                'refill',
                M
            );

        const p =
            elementCenter(visual);

        if (
            !control ||
            !control.isConnected
        ) {
            return;
        }

        if (p) {
            const moved =
                await moveCursorTo(
                    p.x,
                    p.y,
                    true
                );

            if (!moved) return;
        }

        // Extra pause after arriving.
        if (
            !(await waitPreClick(
                true
            ))
        ) {
            return;
        }

        if (
            clickFrenzyActive() ||
            hasGoodGolden()
        ) {
            return;
        }

        if (
            positiveCpsBuffs()
                .length < 2 ||
            !cpsBuffOutlastsClickFrenzy() ||
            M.magic >=
                getFthofCost(M) ||
            runtime.lockA
        ) {
            return;
        }

        if (
            !Game.canRefillLump() ||
            Number(Game.lumps) < 1
        ) {
            return;
        }

        runtime.refillInFlight = true;

        let didRefill = false;

        const beforeLumps =
            Number(Game.lumps);

        const beforeMagic =
            Number(M.magic);

        const oldAskLumps =
            Game.prefs
                ? Game.prefs.askLumps
                : 0;

        try {
            if (Game.prefs) {
                Game.prefs.askLumps = 0;
            }

            const point =
                p || {
                    x: runtime.cursor.x,
                    y: runtime.cursor.y
                };

            await humanClick(
                control,
                point.x,
                point.y
            );

            didRefill =
                Number(Game.lumps) <
                    beforeLumps ||
                Number(M.magic) >
                    beforeMagic + 1;
        } finally {
            if (Game.prefs) {
                Game.prefs.askLumps =
                    oldAskLumps;
            }

            runtime.refillInFlight =
                false;
        }

        if (didRefill) {
            runtime.lockA = true;

            recordRefill();

            logAction(
                'refill grimoire',
                'sugar lump',
                {
                    cpsBuffCount:
                        buffs.length
                }
            );

            logAction(
                'lock A',
                `refill used at ${buffs.length} cps buffs`
            );
        }
    }

    // ---------- Idle playtime ----------
    // While nothing else needs doing, the paw ponders around: it drifts,
    // visits things on screen, wiggles, and sometimes clicks the big cookie
    // out of boredom. It never clicks anything except the big cookie, and
    // anything important interrupts it right away.

    // ============================================================================
    // SECTION 10 - Idle behaviour and happy dance
    // ============================================================================

    /**
     * True when real work is waiting (hammer mode, a ready golden cookie, Click Frenzy, FTHOF, refill, a due auto purchase),
     * so idle play / the dance must stop at once. Mirrors the scheduler's priorities.
     * @returns {boolean}
     * @req SCHED-1, IDLE-4, DANCE-3
     */
    function pendingPriorityWork() {
        if (!window.Game || !Game.ready) {
            return false;
        }

        if (hammerActive()) {
            return true;
        }

        if (
            hasGoodGolden() ||
            clickFrenzyActive()
        ) {
            return true;
        }

        return fthofOrRefillPending() || autoShopReady();
    }

    /**
     * Setting 'Paw idle speed' (default 320 px/s, 60..2000).
     * @returns {number}
     * @req IDLE-5
     */
    function getIdleSpeed() {
        return clamp(
            Number(
                data.config
                    .idleSpeedPxPerSec
            ) || 320,
            60,
            2000
        );
    }

    /**
     * Options for moveCursorTo() during idle play: slow speed, up to 6 s per move, abort on real work.
     * @param {Object} [extra]
     * @returns {Object}
     * @req IDLE-2, IDLE-4
     */
    function idleMoveOpts(extra) {
        return Object.assign(
            {
                speed: getIdleSpeed(),
                maxMs: 6000,
                abortIf:
                    pendingPriorityWork
            },
            extra || {}
        );
    }

    /**
     * Things the paw likes to look at while idle (CSS selector, label, weight). Look only, never clicked.
     * @req IDLE-2
     */
    const IDLE_SPOTS = [
        {
            sel: '#bigCookie',
            label: 'the big cookie',
            w: 3
        },
        {
            sel: '#products .product',
            label: 'a building',
            w: 4
        },
        {
            sel: '#upgrades .upgrade',
            label: 'an upgrade',
            w: 3
        },
        {
            sel: '#comments',
            label: 'the news ticker',
            w: 1
        },
        {
            sel: '#cookies',
            label: 'the cookie counter',
            w: 1
        }
    ];

    /**
     * A random spot on some visible thing on the page (weighted), or null.
     * @returns {{label:string,x:number,y:number}|null}
     * @req IDLE-2
     */
    function pickIdleSpot() {
        const groups = [];

        for (const spot of IDLE_SPOTS) {
            const els = Array.from(
                document.querySelectorAll(
                    spot.sel
                )
            ).filter(el =>
                visibleRect(el)
            );

            if (els.length) {
                groups.push({
                    spot,
                    els
                });
            }
        }

        if (!groups.length) {
            return null;
        }

        let roll =
            Math.random() *
            groups.reduce(
                (a, g) => a + g.spot.w,
                0
            );

        let group =
            groups[groups.length - 1];

        for (const g of groups) {
            roll -= g.spot.w;

            if (roll <= 0) {
                group = g;
                break;
            }
        }

        const el =
            group.els[
                Math.floor(
                    Math.random() *
                        group.els.length
                )
            ];

        const r = visibleRect(el);

        if (!r) return null;

        return {
            label: group.spot.label,
            x:
                r.left +
                r.width *
                    (0.25 +
                        Math.random() *
                            0.5),
            y:
                r.top +
                r.height *
                    (0.25 +
                        Math.random() *
                            0.5)
        };
    }

    /**
     * Short interruptible pause between idle clicks.
     * @param {number} minMs
     * @param {number} maxMs
     * @returns {Promise<boolean>}
     * @req IDLE-2
     */
    function idleDwell(minMs, maxMs) {
        return waitUntil(
            Date.now() +
                minMs +
                Math.random() *
                    (maxMs - minMs),
            true,
            pendingPriorityWork
        );
    }

    /**
     * How long the paw stays around one spot (pondering) before it picks somewhere else [min, max] ms.
     * @req IDLE-2
     */
    const IDLE_HOLD_MS = [14000, 34000];

    /**
     * Uniform random number in [a, b).
     * @returns {number}
     */
    function randBetween(a, b) {
        return a + Math.random() * (b - a);
    }

    /**
     * Very slow figure-eights (lemniscate) around the current position with a bit of hand jitter and a
     * slow drift of the centre, so the paw never sits perfectly still. Eases in so it starts exactly where
     * it is. Runs for holdMs or until real work is pending.
     * @param {number} holdMs
     * @returns {Promise<boolean>} true if it ran to the end
     * @req IDLE-1
     */
    function ponder(holdMs) {
        const TAU = Math.PI * 2;
        const cx0 = runtime.cursor.x;
        const cy0 = runtime.cursor.y;

        const amp = randBetween(11, 24);
        const rot = Math.random() * Math.PI;
        const period = randBetween(9000, 16000); // ms per eight

        const ph = [0, 1, 2, 3, 4, 5].map(
            () => Math.random() * TAU
        );

        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        const startTs = performance.now();
        const endAt = startTs + holdMs;

        return new Promise(resolve => {
            function frame(ts) {
                if (
                    runtime.destroyed ||
                    !runtime.running ||
                    pendingPriorityWork()
                ) {
                    return resolve(false);
                }

                if (ts >= endAt) {
                    return resolve(true);
                }

                const t = ts - startTs;

                // ease everything in so it starts exactly where it is
                const k = Math.min(1, t / 1500);

                // slightly uneven pace, so the eights look hand-drawn
                const theta =
                    (TAU * t) / period +
                    0.35 *
                        (Math.sin(
                            (TAU * t) /
                                (period * 1.7) +
                                ph[0]
                        ) -
                            Math.sin(ph[0]));

                const a =
                    amp *
                    (1 +
                        0.18 *
                            Math.sin(
                                (TAU * t) /
                                    (period *
                                        2.3) +
                                    ph[1]
                            ));

                // figure eight (lemniscate of Gerono)
                const ex = a * Math.sin(theta);

                const ey =
                    a *
                    0.9 *
                    Math.sin(theta) *
                    Math.cos(theta);

                const rx = ex * cosR - ey * sinR;
                const ry = ex * sinR + ey * cosR;

                // slow drift of the centre + fine jitter
                const drx =
                    3 *
                    (Math.sin(
                        (TAU * t) /
                            (period * 3.1) +
                            ph[2]
                    ) -
                        Math.sin(ph[2]));

                const dry =
                    3 *
                    (Math.sin(
                        (TAU * t) /
                            (period * 2.7) +
                            ph[3]
                    ) -
                        Math.sin(ph[3]));

                const jx =
                    0.6 *
                        Math.sin(
                            t / 173 + ph[4]
                        ) +
                    0.4 *
                        Math.sin(
                            t / 61 + ph[5]
                        );

                const jy =
                    0.6 *
                        Math.sin(
                            t / 149 + ph[5]
                        ) +
                    0.4 *
                        Math.sin(
                            t / 53 + ph[4]
                        );

                runtime.cursor.x = clamp(
                    cx0 +
                        k *
                            (rx + drx + jx),
                    2,
                    window.innerWidth - 2
                );

                runtime.cursor.y = clamp(
                    cy0 +
                        k *
                            (ry + dry + jy),
                    2,
                    window.innerHeight - 2
                );

                dispatchMove(
                    runtime.cursor.x,
                    runtime.cursor.y
                );

                nextFrame(frame);
            }

            nextFrame(frame);
        });
    }

    /**
     * Ponder for a random time in [minMs, maxMs] and show it in the HUD ('drawing eights').
     * @param {number} minMs
     * @param {number} maxMs
     * @returns {Promise<boolean>}
     * @req IDLE-1
     */
    function idleHold(minMs, maxMs) {
        runtime.currentAction = 'idle-play';
        runtime.currentTarget =
            'drawing eights';

        return ponder(
            randBetween(minMs, maxMs)
        );
    }

    /**
     * Arc over to something on screen (look only), then ponder there.
     * @returns {Promise<void>}
     * @req IDLE-2
     */
    async function idleVisit() {
        const spot = pickIdleSpot();

        if (!spot) return;

        runtime.currentAction =
            'idle-play';

        runtime.currentTarget = `sniffing ${spot.label}`;

        if (
            !(await moveCursorTo(
                spot.x,
                spot.y,
                true,
                idleMoveOpts()
            ))
        ) {
            return;
        }

        await idleHold(
            IDLE_HOLD_MS[0],
            IDLE_HOLD_MS[1]
        );
    }

    /**
     * Drift to a random spot on screen, then ponder there.
     * @returns {Promise<void>}
     * @req IDLE-2
     */
    async function idleDrift() {
        runtime.currentAction =
            'idle-play';

        runtime.currentTarget =
            'drifting about';

        const x =
            window.innerWidth *
            (0.1 + Math.random() * 0.8);

        const y =
            window.innerHeight *
            (0.12 + Math.random() * 0.76);

        if (
            !(await moveCursorTo(
                x,
                y,
                true,
                idleMoveOpts()
            ))
        ) {
            return;
        }

        await idleHold(
            IDLE_HOLD_MS[0],
            IDLE_HOLD_MS[1]
        );
    }

    /**
     * Sometimes the paw gets bored and pokes the big cookie 1-3 times (then ponders). Uses the same
     * click delay and pre-click pause as every other click; interruptible.
     * @returns {Promise<void>}
     * @req IDLE-2
     */
    async function idleBoredClick() {
        const clicks =
            1 +
            Math.floor(
                Math.random() * 3
            );

        for (let i = 0; i < clicks; i++) {
            if (pendingPriorityWork()) {
                return;
            }

            runtime.currentAction =
                'bored-click';

            runtime.currentTarget =
                'the big cookie';

            if (
                !(await waitForClickGap(
                    true,
                    pendingPriorityWork
                ))
            ) {
                return;
            }

            const point =
                randomPointInBigCookie();

            if (!point) return;

            if (
                !(await moveCursorTo(
                    point.x,
                    point.y,
                    true,
                    idleMoveOpts()
                ))
            ) {
                return;
            }

            if (
                !(await waitPreClick(
                    true,
                    pendingPriorityWork
                ))
            ) {
                return;
            }

            if (
                pendingPriorityWork() ||
                !point.el.isConnected
            ) {
                return;
            }

            await humanClick(
                point.el,
                point.x,
                point.y
            );

            if (
                i < clicks - 1 &&
                !(await idleDwell(
                    350,
                    1100
                ))
            ) {
                return;
            }
        }

        await idleHold(5000, 12000);
    }

    /**
     * Idle task: one activity per call (22 % bored clicks, 53 % visit, 25 % drift), or - right after real
     * work - ponder in place first. Always ends with a short gap before the next call.
     * @returns {Promise<void>}
     * @req IDLE-1, IDLE-2, IDLE-3
     */
    async function idleWander() {
        runtime.currentAction =
            'idle-play';

        runtime.currentTarget =
            'nothing yet';

        try {
            if (runtime.idleStay) {
                // Right after real work: stay put and ponder first.
                runtime.idleStay = false;

                await idleHold(5000, 12000);

                return;
            }

            const roll = Math.random();

            if (roll < 0.22) {
                await idleBoredClick();
            } else if (roll < 0.75) {
                await idleVisit();
            } else {
                await idleDrift();
            }
        } finally {
            runtime.nextIdleAt =
                Date.now() + 150;
        }
    }

    // ---------- Happy dance ----------
    // After catching a golden cookie the paw does a little dance, but only
    // if the moment is otherwise idle (decided right at the catch): no other
    // cookie around, nothing for FTHOF / refill / Click Frenzy / hammer to do.

    /**
     * Any golden/wrath cookie still around (fading in, waiting or wrath)?
     * @returns {boolean}
     * @req DANCE-1
     */
    function anyGoldenPresent() {
        return (
            !!window.Game &&
            Array.isArray(Game.shimmers) &&
            Game.shimmers.some(
                s =>
                    s &&
                    s.type === 'golden' &&
                    !s.popped &&
                    s.l &&
                    s.l.isConnected
            )
        );
    }

    /**
     * Setting 'Happy dance length' (default 2200 ms, 0 = off).
     * @returns {number}
     * @req DANCE-1
     */
    function getDanceMs() {
        return clampInt(
            data.config.happyDanceMs,
            0,
            10000,
            2200
        );
    }

    /**
     * Decided right at the catch: dance length > 0, no cookie chain, no other cookie present and no
     * real work pending.
     * @returns {boolean}
     * @req DANCE-1, DANCE-2, DANCE-3, HURRY-3
     */
    function danceEligible() {
        return (
            getDanceMs() > 0 &&
            !cookieChainActive() &&
            !anyGoldenPresent() &&
            !pendingPriorityWork()
        );
    }

    /**
     * Task: short hops with a sway and a little tilt of the paw, around where the cursor is. Eases in and
     * out (ends exactly where it started) and stops at once if a cookie appears, a chain starts or real work
     * becomes pending.
     * @returns {Promise<boolean>}
     * @req DANCE-1, DANCE-3, DANCE-4, HURRY-3
     */
    function happyDance() {
        runtime.danceQueued = false;

        const ms = getDanceMs();

        if (
            ms <= 0 ||
            cookieChainActive() ||
            anyGoldenPresent() ||
            pendingPriorityWork()
        ) {
            return Promise.resolve(false);
        }

        runtime.currentAction =
            'happy-dance';

        runtime.currentTarget =
            'a happy dance';

        const TAU = Math.PI * 2;
        const cx0 = runtime.cursor.x;
        const cy0 = runtime.cursor.y;
        const swayP = randBetween(600, 740); // ms per sway
        const hopP = swayP / 2; // two hops per sway
        const sway = randBetween(9, 13); // px
        const hop = randBetween(12, 18); // px
        const startTs = performance.now();

        return new Promise(resolve => {
            function finish(ok) {
                runtime.cursorTilt = 0;

                resolve(ok);
            }

            function frame(ts) {
                if (
                    runtime.destroyed ||
                    !runtime.running ||
                    cookieChainActive() ||
                    anyGoldenPresent() ||
                    pendingPriorityWork()
                ) {
                    return finish(false);
                }

                const t = ts - startTs;

                if (t >= ms) {
                    runtime.cursor.x = cx0;
                    runtime.cursor.y = cy0;

                    dispatchMove(cx0, cy0);

                    return finish(true);
                }

                // 0 at both ends, so it starts and ends exactly in place
                const env = Math.pow(
                    Math.sin(
                        (Math.PI * t) / ms
                    ),
                    0.6
                );

                runtime.cursor.x = clamp(
                    cx0 +
                        env *
                            sway *
                            Math.sin(
                                (TAU * t) / swayP
                            ),
                    2,
                    window.innerWidth - 2
                );

                runtime.cursor.y = clamp(
                    cy0 -
                        env *
                            hop *
                            Math.abs(
                                Math.sin(
                                    (Math.PI * t) /
                                        hopP
                                )
                            ),
                    2,
                    window.innerHeight - 2
                );

                runtime.cursorTilt =
                    env *
                    0.32 *
                    Math.sin(
                        (TAU * t) / swayP
                    );

                dispatchMove(
                    runtime.cursor.x,
                    runtime.cursor.y
                );

                nextFrame(frame);
            }

            nextFrame(frame);
        });
    }

    // ============================================================================
    // SECTION 10A - Auto play mode (shopping)
    // ============================================================================

    /**
     * Names the auto player must NEVER buy: the grandma research center
     * ("Bingo center/Research facility") and everything that starts or feeds the
     * Grandmapocalypse. (The auto player only ever considers upgrades it can
     * classify, see autoUpgradeGain(); this list is an extra hard stop.)
     * @req AUTO-2
     */
    const AUTO_BLOCKED_NAMES = new Set([
        'Bingo center/Research facility',
        'One mind',
        'Communal brainsweep',
        'Elder Pact',
        'Elder Pledge',
        'Elder Covenant',
        'Revoke Elder Covenant'
    ]);

    /**
     * Name pattern that is blocked as well (covers spelling variants of the research center).
     * @req AUTO-2
     */
    const AUTO_BLOCKED_RE = /bingo center|research (center|centre|facility)/i;

    /**
     * Golden cookie upgrades the auto player may buy, with the assumed extra CpS they are worth,
     * as a share of the current CpS. These are ESTIMATES (a golden cookie upgrade does not add CpS
     * directly): frequency/duration upgrades matter a lot to a bot that catches every cookie, the
     * "+1 %" ones very little. Tune here if the auto player over- or under-values them.
     * @req AUTO-2, AUTO-3
     */
    const AUTO_GOLDEN_UPGRADES = {
        'Lucky day': 0.2,
        'Serendipity': 0.2,
        'Get lucky': 0.12,
        'Lasting fortune': 0.04,
        'Lucky digit': 0.01,
        'Lucky number': 0.01,
        'Lucky payout': 0.01,
        'Green yeast digestives': 0.01
    };

    /**
     * Upgrade pools that are never store purchases for the auto player (research, switches,
     * debug and heavenly upgrades).
     * @req AUTO-2
     */
    const AUTO_NON_STORE_POOLS = new Set([
        'tech',
        'toggle',
        'debug',
        'prestige',
        'prestigeDecor'
    ]);

    /**
     * Kitten upgrades and their milk factor: each one multiplies ALL production by
     * 1 + milkProgress x factor (x milk multipliers such as Santa's milk, assumed 1 here).
     * Unknown "Kitten ..." names use 0.1.
     * @req AUTO-2, AUTO-3
     */
    const AUTO_KITTEN_POWER = {
        'kitten helpers': 0.1,
        'kitten workers': 0.125,
        'kitten engineers': 0.15,
        'kitten overseers': 0.175,
        'kitten managers': 0.2,
        'kitten accountants': 0.2,
        'kitten specialists': 0.2,
        'kitten experts': 0.2,
        'kitten consultants': 0.2,
        'kitten assistants to the regional manager': 0.175,
        'kitten marketeers': 0.15,
        'kitten analysts': 0.125,
        'kitten executives': 0.115,
        'kitten admins': 0.11,
        'kitten strategists': 0.105
    };

    /**
     * Upper limits per building for the auto player: it never buys more than this many of them.
     * 57 Wizard towers is the sweet spot for mana, more only makes spells pricier.
     * @req AUTO-2
     */
    const AUTO_BUILDING_CAPS = { 'Wizard tower': 57 };

    /**
     * A purchase is also "insignificant" when it costs at most this fraction of the available bank
     * (0.1 %): with a huge bank the price no longer matters, so anything useful gets bought.
     * @req AUTO-4
     */
    const AUTO_BANK_FRACTION = 0.001;

    /**
     * Plain lowercase text of a game description (HTML tags removed).
     * @param {*} s
     * @returns {string}
     * @req AUTO-2
     */
    function autoStripHtml(s) {
        return String(s == null ? '' : s)
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    /**
     * Product of all active CpS buff multipliers (Frenzy x7, Clot x0.5, ...); 1 without buffs.
     * @returns {number}
     * @req AUTO-3
     */
    function autoBuffMult() {
        let m = 1;

        if (window.Game && Game.buffs) {
            for (const k of Object.keys(Game.buffs)) {
                const v = Number(Game.buffs[k] && Game.buffs[k].multCpS);

                if (Number.isFinite(v) && v > 0) m *= v;
            }
        }

        return m;
    }

    /**
     * Current cookies per second WITHOUT temporary buffs, so a Frenzy does not distort the value of
     * a purchase. Uses Game.unbuffedCps when the game has it, else CpS divided by the buff product.
     * @returns {number} NaN if unknown
     * @req AUTO-3
     */
    function autoUnbuffedCps() {
        const u = Number(Game.unbuffedCps);

        if (Number.isFinite(u) && u > 0) return u;

        const c = Number(Game.cookiesPs);

        if (!(c >= 0)) return NaN;

        const m = autoBuffMult();

        return m > 0 ? c / m : c;
    }

    /**
     * Smoothed income from CLICKING (cookies per second, 20 s time constant), from the growth of
     * Game.handmadeCookies. Together with CpS it is the income used to estimate how long saving up takes.
     * @param {number} now - Date.now()
     * @returns {number}
     * @req AUTO-3
     */
    function autoUpdateIncome(now) {
        const h = Number(Game.handmadeCookies);

        if (!Number.isFinite(h)) return 0;

        const st =
            runtime.autoHand ||
            (runtime.autoHand = { t: now, v: h, rate: 0 });

        const dt = (now - st.t) / 1000;

        if (dt >= 0.5) {
            const inst = Math.max(0, (h - st.v) / dt);
            const a = 1 - Math.exp(-dt / 20);

            st.rate += (inst - st.rate) * a;
            st.t = now;
            st.v = h;
        }

        return st.rate;
    }

    /**
     * Approximate CpS gained by buying ONE more of a building: its per-building production times the
     * global multiplier. For Grandmas the synergy of already bought grandma upgrades is added
     * (each extra grandma boosts the linked buildings by 1 % per N grandmas).
     * @param {Object} me - building
     * @param {{mult:number}} ctx
     * @returns {number} 0 if it cannot be estimated
     * @req AUTO-3
     */
    function autoBuildingGain(me, ctx) {
        const per = Number(me.storedCps);

        if (!(per > 0)) return 0;

        let gain = per * ctx.mult;

        if (
            me.name === 'Grandma' &&
            Array.isArray(Game.GrandmaSynergies) &&
            Game.Upgrades
        ) {
            for (const n of Game.GrandmaSynergies) {
                const up = Game.Upgrades[n];
                const b = up && up.bought ? up.buildingTie1 : null;

                if (b) {
                    const N = Math.max(1, Number(b.id) - 1);

                    gain +=
                        ((Number(b.storedTotalCps) || 0) *
                            ctx.mult *
                            0.01) /
                        N;
                }
            }
        }

        return gain;
    }

    /**
     * The "fingers" series of cursor upgrades: [name, value, kind]. 'Thousand fingers' ADDS 0.1 cookies per
     * non-cursor building to the mouse and every cursor; each further one MULTIPLIES that bonus. (The values
     * are read from the game's descriptions when an unknown member of the series shows up.)
     * @req AUTO-2, AUTO-3
     */
    const AUTO_FINGER_STEPS = [
        ['Thousand fingers', 0.1, 'add'],
        ['Million fingers', 5, 'mul'],
        ['Billion fingers', 10, 'mul'],
        ['Trillion fingers', 20, 'mul'],
        ['Quadrillion fingers', 20, 'mul'],
        ['Quintillion fingers', 20, 'mul'],
        ['Sextillion fingers', 20, 'mul'],
        ['Septillion fingers', 20, 'mul'],
        ['Octillion fingers', 20, 'mul'],
        ['Nonillion fingers', 20, 'mul']
    ];

    /**
     * The upgrades that double the click power ("The mouse and cursors are twice as efficient").
     * @req AUTO-2, AUTO-3
     */
    const AUTO_CURSOR_DOUBLERS = [
        'Reinforced index finger',
        'Carpal tunnel prevention cream',
        'Ambidextrous'
    ];

    /**
     * Product of all active click multiplier buffs (Click frenzy x777, Dragonflight x1111, ...).
     * @returns {number}
     * @req AUTO-3, AUTO-11
     */
    function autoClickBuffMult() {
        let m = 1;

        if (window.Game && Game.buffs) {
            for (const k of Object.keys(Game.buffs)) {
                const v = Number(Game.buffs[k] && Game.buffs[k].multClick);

                if (Number.isFinite(v) && v > 0) m *= v;
            }
        }

        return m;
    }

    /**
     * Cookies per click WITHOUT temporary click buffs (the game's computedMouseCps divided by them).
     * @returns {number} 1 if unknown
     * @req AUTO-3, AUTO-11
     */
    function autoPerClick() {
        const p = Number(Game.computedMouseCps);

        if (!(p > 0)) return 1;

        const m = autoClickBuffMult();

        return m > 0 ? p / m : p;
    }

    /**
     * Current bonus per non-cursor building given by the bought "fingers" upgrades (0 without Thousand fingers).
     * @returns {number}
     * @req AUTO-3
     */
    function autoFingerBonus() {
        let A = 0;

        for (const [n, v, k] of AUTO_FINGER_STEPS) {
            const u = Game.Upgrades && Game.Upgrades[n];

            if (u && u.bought) {
                if (k === 'add') A += v;
                else A *= v;
            }
        }

        return A;
    }

    /**
     * Estimated gain of a "fingers" upgrade (Thousand fingers, Million fingers, ...): the extra bonus
     * per non-cursor building goes to EVERY cursor (CpS) and to every click (clicks/s x bonus).
     * @param {Object} up
     * @param {number} idx - index in AUTO_FINGER_STEPS or -1 for an unknown member
     * @param {string} desc - plain lowercase description
     * @param {Object} ctx
     * @returns {{gain:number,type:string}|null}
     * @req AUTO-2, AUTO-3
     */
    function autoFingerGain(up, idx, desc, ctx) {
        const A = autoFingerBonus();

        let val;
        let kind;

        if (idx >= 0) {
            val = AUTO_FINGER_STEPS[idx][1];
            kind = AUTO_FINGER_STEPS[idx][2];
        } else {
            const add = desc.match(
                /\+\s*(\d+(?:\.\d+)?)\s*cookies for each non-cursor/
            );

            const mul = desc.match(/by\s+(\d+(?:\.\d+)?)/);

            if (add) {
                kind = 'add';
                val = Number(add[1]);
            } else if (mul) {
                kind = 'mul';
                val = Number(mul[1]);
            } else {
                return null;
            }
        }

        const dAdd = (kind === 'add' ? A + val : A * val) - A;

        if (!(dAdd > 0)) return null;

        const cur = ctx.cursor;
        const cursors = Number(cur && cur.amount) || 0;
        const denom = 0.1 + A * ctx.nonCursor;

        // the cursors' own tier multiplier, backed out of their current production
        const tierMult =
            cur && Number(cur.storedCps) > 0 && denom > 0
                ? Number(cur.storedCps) / denom
                : 1;

        return {
            gain:
                cursors * dAdd * ctx.nonCursor * tierMult * ctx.mult +
                dAdd * ctx.nonCursor * ctx.clickUnit * ctx.clicksPerSec,
            type: 'fingers'
        };
    }

    /**
     * Expected cookies per second from clicking while hammering, and how much that is compared to the CpS
     * ("share"). The estimate is (click value x clicks per second) x a calibration factor that the
     * probing (see autoHammerActive) keeps up to date.
     * @returns {{rate:number,share:number}}
     * @req AUTO-11
     */
    function autoClickEstimate() {
        const st = runtime.autoHammerState;
        const perClick = autoPerClick();

        const rate =
            perClick *
            Math.max(0, Number(data.config.clickFrenzyCps) || 8) *
            st.cal;

        const cps = autoUnbuffedCps();

        return {
            rate,
            share: rate / Math.max(Number.isFinite(cps) ? cps : 0, 0.1)
        };
    }

    /**
     * AUTO HAMMER: in auto play mode the big cookie is hammered whenever that is much better than idling,
     * i.e. clicking would add at least 'Auto: hammer when clicks add >=' (default 5 %) of the CpS. At the very
     * start (no CpS) that is always true, so the bot starts clicking on its own. When hammering is not worth
     * it, it still PROBES now and then (every 'probe every' seconds, for 'probe length' seconds): it hammers
     * briefly, measures the real cookies per second from clicking and updates the calibration factor of the
     * estimate. Re-evaluated at most once per second.
     * @returns {boolean} should the big cookie be hammered right now?
     * @req AUTO-11
     */
    function autoHammerActive() {
        if (
            data.config.autoPlay !== true ||
            data.config.autoHammer === false ||
            !window.Game ||
            !Game.ready
        ) {
            return false;
        }

        const st = runtime.autoHammerState;
        const now = Date.now();

        if (now < st.nextEvalAt) return st.on;

        st.nextEvalAt = now + 1000;

        try {
            const num = (v, d) => {
                const n = Number(v);

                return Number.isFinite(n) ? n : d;
            };

            const minShare = Math.max(0, num(data.config.autoHammerMinShare, 0.05));
            const probeEvery = Math.max(0, num(data.config.autoProbeIntervalSec, 300));
            const probeSec = clamp(num(data.config.autoProbeSec, 10), 2, 120);

            // finish a running probe: compare the measured clicking income with the expectation
            if (st.probeUntil && now >= st.probeUntil) {
                const secs = (now - st.probeT0) / 1000;
                const perClick = autoPerClick();

                const expected =
                    perClick *
                    Math.max(0, num(data.config.clickFrenzyCps, 8));

                const measured =
                    secs > 0
                        ? (num(Game.handmadeCookies, 0) - st.probeH0) / secs
                        : 0;

                if (expected > 0 && measured >= 0 && !clickFrenzyActive()) {
                    st.cal = clamp(measured / expected, 0.25, 4);
                }

                st.probeUntil = 0;
            }

            const est = autoClickEstimate();

            st.share = est.share;

            const wanted = est.share >= minShare;

            if (
                !wanted &&
                !st.probeUntil &&
                probeEvery > 0 &&
                now >= st.nextProbeAt &&
                !clickFrenzyActive()
            ) {
                st.probeUntil = now + probeSec * 1000;
                st.probeT0 = now;
                st.probeH0 = num(Game.handmadeCookies, 0);
                st.nextProbeAt = now + probeEvery * 1000;
            }

            const on = wanted || !!st.probeUntil;

            if (wanted !== st.wanted) {
                st.wanted = wanted;

                logAction(
                    'auto hammer',
                    wanted
                        ? `on (clicks add ~${Math.round(est.share * 100)}% of CpS)`
                        : 'off (clicking is not worth it now)'
                );
            }

            st.on = on;
        } catch (e) {
            st.on = false;
        }

        return st.on;
    }

    /**
     * Should the big cookie be hammered: the manual "Hammer cookie" button, or the auto hammer.
     * @returns {boolean}
     * @req CF-4, AUTO-11
     */
    function hammerActive() {
        return runtime.hammer || autoHammerActive();
    }

    /**
     * Classify a store upgrade and estimate the CpS it adds. Only these are considered (AUTO-2):
     *   golden   golden cookie upgrades (AUTO_GOLDEN_UPGRADES)
     *   grandma  grandma "cofactor" upgrades: grandmas twice as efficient + 1 % CpS of a building per N grandmas
     *            (recognised by the game's own list OR by the description text, so it works even if the game's
     *            internal fields differ)
     *   kitten   "Kitten helpers/workers/..." (CpS multiplier growing with the milk)
     *   biscuit  all cookie upgrades (pool 'cookie', +power % CpS)
     *   tier     building upgrades that make a building "twice as efficient"
     *   cursor   "The mouse and cursors are twice as efficient": cursor CpS AND click power
     *   fingers  Thousand/Million/... fingers (bonus per non-cursor building for cursors and clicks)
     *   click    mouse upgrades ("Clicking gains +1 % of your CpS")
     * Clicking gains are valued at ctx.clicksPerSec (the hammer rate) clicks per second.
     * Anything else returns null and is never bought.
     * @param {Object} up
     * @param {{cps:number,mult:number,biscuitBase:(number|null)}} ctx
     * @returns {{gain:number,type:string}|null}
     * @req AUTO-2, AUTO-3
     */
    function autoUpgradeGain(up, ctx) {
        const name = up.name;

        if (
            Object.prototype.hasOwnProperty.call(
                AUTO_GOLDEN_UPGRADES,
                name
            )
        ) {
            return {
                gain: ctx.cps * AUTO_GOLDEN_UPGRADES[name],
                type: 'golden'
            };
        }

        const gdesc = autoStripHtml(up.desc);

        // "Grandmas are twice as efficient. Farms gain +1% CpS per grandma."  /  "... per 2 grandmas."
        const gm = gdesc.match(
            /grandmas are twice as efficient\.?\s*(.+?)\s+gain\s*\+?\s*(\d+(?:\.\d+)?)\s*%\s*cps per\s*(?:(\d+)\s*)?grandma/
        );

        const isGrandma =
            !!gm ||
            (Array.isArray(Game.GrandmaSynergies) &&
                Game.GrandmaSynergies.includes(name)) ||
            (up.buildingTie1 && up.buildingTie2);

        if (isGrandma) {
            const g = up.buildingTie2 || (Game.Objects && Game.Objects.Grandma);

            let b = up.buildingTie1 || null;

            if (!b && gm) {
                // find the building by the plural name used in the description ("farms", "wizard towers")
                const plural = gm[1].trim();

                const all = Array.isArray(Game.ObjectsById)
                    ? Game.ObjectsById
                    : Object.values(Game.Objects || {});

                b =
                    all.find(
                        o =>
                            o &&
                            (String(o.plural || '').toLowerCase() === plural ||
                                String(o.name || '').toLowerCase() + 's' === plural)
                    ) || null;
            }

            if (!b || !g) return null;

            const pct = gm ? Number(gm[2]) : 1;

            const N = gm
                ? Math.max(1, Number(gm[3]) || 1)
                : Math.max(1, Number(b.id) - 1);

            return {
                gain:
                    ctx.mult *
                    ((Number(g.storedTotalCps) || 0) +
                        ((Number(b.storedTotalCps) || 0) *
                            (pct / 100) *
                            (Number(g.amount) || 0)) /
                            N),
                type: 'grandma'
            };
        }

        // kittens: a multiplier on ALL production that grows with the milk (achievements)
        if (/^kitten /i.test(String(name))) {
            const f =
                AUTO_KITTEN_POWER[String(name).toLowerCase()] || 0.1;

            const milk =
                Number.isFinite(Number(Game.milkProgress))
                    ? Number(Game.milkProgress)
                    : (Number(Game.AchievementsOwned) || 0) / 25;

            return {
                gain: ctx.cps * f * Math.max(0, milk),
                type: 'kitten'
            };
        }

        if (up.pool === 'cookie') {
            const p = Number(up.power);

            if (!(p > 0)) return null;

            if (ctx.biscuitBase == null) {
                let a = 1;

                const list = Array.isArray(Game.UpgradesById)
                    ? Game.UpgradesById
                    : Object.values(Game.Upgrades || {});

                for (const u of list) {
                    if (u && u.pool === 'cookie' && u.bought) {
                        a += (Number(u.power) || 0) / 100;
                    }
                }

                ctx.biscuitBase = a;
            }

            return {
                gain: (ctx.cps * (p / 100)) / ctx.biscuitBase,
                type: 'biscuit'
            };
        }

        const desc = autoStripHtml(up.desc);

        // mouse upgrades: every click gives +N % of the CpS
        const mm = desc.match(
            /clicking gains\s*\+?\s*(\d+(?:\.\d+)?)\s*%\s*of your cps/
        );

        if (mm) {
            return {
                gain:
                    ctx.cps *
                    (Number(mm[1]) / 100) *
                    ctx.clicksPerSec,
                type: 'click'
            };
        }

        // "fingers" series
        const fi = AUTO_FINGER_STEPS.findIndex(x => x[0] === name);

        if (
            fi >= 0 ||
            /gain from thousand fingers|for each non-cursor/.test(desc)
        ) {
            return autoFingerGain(up, fi, desc, ctx);
        }

        // cursor doubling: the cursors' CpS and the click power
        if (
            /mouse and cursors are twice as efficient/.test(desc) ||
            (up.buildingTie &&
                up.buildingTie === ctx.cursor &&
                desc.includes('twice as efficient'))
        ) {
            const cur = up.buildingTie || ctx.cursor;

            let n = 0;

            for (const nm of AUTO_CURSOR_DOUBLERS) {
                if (Game.Upgrades && Game.Upgrades[nm] && Game.Upgrades[nm].bought) {
                    n++;
                }
            }

            return {
                gain:
                    (Number(cur && cur.storedTotalCps) || 0) * ctx.mult +
                    Math.pow(2, n) * ctx.clickUnit * ctx.clicksPerSec,
                type: 'cursor'
            };
        }

        if (
            up.buildingTie &&
            desc.includes('twice as efficient')
        ) {
            return {
                gain:
                    (Number(up.buildingTie.storedTotalCps) || 0) *
                    ctx.mult,
                type: 'tier'
            };
        }

        return null;
    }

    /**
     * Current price of an upgrade.
     * @param {Object} up
     * @returns {number}
     */
    function autoPrice(up) {
        return typeof up.getPrice === 'function'
            ? Number(up.getPrice())
            : Number(up.basePrice);
    }

    /**
     * Read the game and list every purchase option the auto player is allowed to consider.
     * @returns {{skip:string}|{cands:Object[],ctx:Object}} skip = reason nothing can be planned now;
     *   candidates are {kind:'building'|'upgrade', type, name, obj, cost, dCps}
     * @req AUTO-2, AUTO-3, AUTO-6, AUTO-7
     */
    function autoCollect() {
        if (!window.Game || !Game.ready) {
            return { skip: 'game not ready' };
        }

        if (Game.OnAscend || Number(Game.AscendTimer) > 0) {
            return { skip: 'ascending' };
        }

        if (Game.promptOn) {
            return { skip: 'a prompt is open' };
        }

        const cps = autoUnbuffedCps();

        if (!(cps >= 0)) {
            return { skip: 'CpS unknown' };
        }

        const objs = Array.isArray(Game.ObjectsById)
            ? Game.ObjectsById
            : Object.values(Game.Objects || {});

        let raw = 0;

        for (const me of objs) {
            raw += Number(me && me.storedTotalCps) || 0;
        }

        const num = (v, d) => {
            const n = Number(v);

            return Number.isFinite(n) ? n : d;
        };

        const cfg = {
            insignificantSec: Math.max(0, num(data.config.autoInsignificantSec, 1)),
            goodFactor: Math.max(1, num(data.config.autoGoodFactor, 1.2)),
            biggerImpact: Math.max(1, num(data.config.autoBiggerImpact, 3)),
            reachSec: Math.max(0, num(data.config.autoReachSec, 1800)),
            maxPaybackSec: Math.max(1, num(data.config.autoMaxPaybackSec, 86400))
        };

        const ctx = {
            cps,
            mult: raw > 0 ? cps / raw : 1,
            income: cps + autoUpdateIncome(Date.now()),
            bank: num(Game.cookies, 0),
            reserve:
                Math.max(0, num(data.config.autoReserveSec, 0)) * cps,
            cfg,
            biscuitBase: null,
            cursor:
                (Game.Objects && Game.Objects.Cursor) ||
                objs.find(o => o && o.name === 'Cursor') ||
                null,
            nonCursor: 0,
            // clicks per second the bot will click (the hammer rate), used to value clicking upgrades
            clicksPerSec:
                data.config.autoHammer !== false || runtime.hammer
                    ? Math.max(0, num(data.config.clickFrenzyCps, 8))
                    : 0
        };

        for (const me of objs) {
            if (me && me.name !== 'Cursor') {
                ctx.nonCursor += Number(me.amount) || 0;
            }
        }

        // Cookies per "click unit": the click power is 2^(doubling upgrades) + fingers bonus x non-cursor
        // buildings + mouse % of CpS; the unit is 1 in the real game, and keeps the estimates right if the
        // game scales it. (Mouse upgrades are taken out first.)
        let doublers = 0;

        for (const nm of AUTO_CURSOR_DOUBLERS) {
            if (Game.Upgrades && Game.Upgrades[nm] && Game.Upgrades[nm].bought) {
                doublers++;
            }
        }

        let mousePct = 0;

        for (const u of Array.isArray(Game.UpgradesById)
            ? Game.UpgradesById
            : Object.values(Game.Upgrades || {})) {
            if (u && u.bought) {
                const m = autoStripHtml(u.desc).match(
                    /clicking gains\s*\+?\s*(\d+(?:\.\d+)?)\s*%\s*of your cps/
                );

                if (m) mousePct += Number(m[1]);
            }
        }

        const clickBase =
            autoPerClick() -
            (mousePct / 100) * (Number(Game.cookiesPs) || 0);

        const clickDenom =
            Math.pow(2, doublers) +
            autoFingerBonus() * ctx.nonCursor;

        ctx.clickUnit =
            clickBase > 0 && clickDenom > 0
                ? clickBase / clickDenom
                : 1;

        const cands = [];

        // Buildings (never while the store is in sell mode: buy() would SELL then).
        if (Game.buyMode !== -1) {
            for (const me of objs) {
                if (!me || me.locked) continue;

                const cap = AUTO_BUILDING_CAPS[me.name];

                if (cap != null && (Number(me.amount) || 0) >= cap) {
                    continue;
                }

                const cost = Number(me.price);

                if (!(cost > 0)) continue;

                const gain = autoBuildingGain(me, ctx);

                if (gain > 0) {
                    cands.push({
                        kind: 'building',
                        type: 'building',
                        name: me.name,
                        obj: me,
                        cost,
                        dCps: gain
                    });
                }
            }
        }

        const store = Array.isArray(Game.UpgradesInStore)
            ? Game.UpgradesInStore
            : [];

        for (const up of store) {
            if (!up || up.bought) continue;

            if (
                AUTO_BLOCKED_NAMES.has(up.name) ||
                AUTO_BLOCKED_RE.test(String(up.name)) ||
                AUTO_NON_STORE_POOLS.has(up.pool)
            ) {
                continue;
            }

            const g = autoUpgradeGain(up, ctx);

            if (!g || !(g.gain > 0)) continue;

            const cost = autoPrice(up);

            if (!(cost > 0)) continue;

            cands.push({
                kind: 'upgrade',
                type: g.type,
                name: up.name,
                obj: up,
                cost,
                dCps: g.gain
            });
        }

        return { cands, ctx };
    }

    /**
     * THE STRATEGY (pure function, no game access). For every option:
     *   payback = cost / dCps            seconds until it has paid for itself ("rentability")
     *   impact  = dCps / CpS             how much it changes production, regardless of cost
     *   wait    = time to afford it at the current income (CpS + clicking), after the reserve
     *   pp      = wait + payback         payback including the time spent saving up
     * "In reach" = affordable within reachSec and payback <= maxPaybackSec (or insignificant).
     * Decision:
     *   A) BUY at once when the cost is insignificant (<= insignificantSec of income, or <= 0.1 % of the bank).
     *   B) BUY when it is a good deal (pp <= goodFactor x the best pp in reach).
     *   Among everything that qualifies for A or B the best payback goes first. Both A and B are postponed when an option that is not affordable yet but in reach and good has at
     *   least biggerImpact x the impact of this one, and this one costs more than 10 % of it: then it is
     *   better to save up for the big one (else a stream of small purchases keeps the bank too low).
     *   Otherwise: nothing to buy now; report what we are saving for (lowest pp).
     * Defaults (1 s / 1.2 / 3 / 1800 s) come from a simulation and keep pace with a greedy
     * "lowest payback incl. waiting" player.
     * @param {Object[]} cands - {name, cost, dCps, ...}
     * @param {{cps:number,income:number,bank:number,reserve:number,cfg:Object}} ctx
     * @returns {{buy:(Object|null),why?:string,row?:Object,save?:(Object|null),saveRow?:Object,note?:string,rows:Object[]}}
     * @req AUTO-3, AUTO-4, AUTO-5, AUTO-6
     */
    function autoDecide(cands, ctx) {
        const cfg = ctx.cfg;
        const cpsEff = Math.max(ctx.cps, 0.1);
        const incEff = Math.max(
            ctx.income != null ? ctx.income : ctx.cps,
            0.1
        );
        const avail = ctx.bank - ctx.reserve;
        const rows = [];

        for (const c of cands) {
            if (!(c.cost > 0) || !(c.dCps > 0)) continue;

            const payback = c.cost / c.dCps;
            const wait =
                c.cost <= avail ? 0 : (c.cost - avail) / incEff;

            rows.push({
                c,
                payback,
                pp: wait + payback,
                impact: c.dCps / cpsEff,
                wait,
                affordable: wait === 0,
                insignificant:
                    c.cost <=
                    Math.max(
                        cfg.insignificantSec * Math.max(incEff, 0),
                        AUTO_BANK_FRACTION * Math.max(avail, 0)
                    )
            });
        }

        const inReach = rows.filter(
            r =>
                r.wait <= cfg.reachSec &&
                (r.payback <= cfg.maxPaybackSec || r.insignificant)
        );

        if (!inReach.length) {
            return { buy: null, save: null, note: 'nothing in reach', rows };
        }

        const bestPP = Math.min(
            ...inReach
                .filter(r => r.payback <= cfg.maxPaybackSec)
                .map(r => r.pp),
            Infinity
        );

        const good = r =>
            r.payback <= cfg.maxPaybackSec &&
            r.pp <= cfg.goodFactor * bestPP;

        const affordable = inReach
            .filter(r => r.affordable)
            .sort((a, b) => a.payback - b.payback);

        // Saving up: an option that is not affordable yet, in reach and good, with a much bigger
        // impact, holds back everything that is not cheap next to it (otherwise a stream of small
        // purchases would keep the bank too low to ever afford the big one).
        const targets = inReach.filter(
            r => !r.affordable && good(r)
        );

        const postponed = p =>
            targets.some(
                q =>
                    q.impact >= cfg.biggerImpact * p.impact &&
                    p.c.cost > 0.1 * q.c.cost
            );

        // Buy now: everything affordable that is insignificant (A) or a good deal (B) and not
        // postponed. The BEST payback goes first, so cheap junk never jumps the queue of a
        // better deal that is affordable at the same time.
        const buyable = affordable.filter(
            r =>
                !postponed(r) &&
                (r.insignificant || good(r))
        );

        if (buyable.length) {
            const p = buyable[0];

            return {
                buy: p.c,
                why: good(p)
                    ? 'good payback'
                    : 'insignificant cost',
                row: p,
                rows
            };
        }

        const save =
            inReach
                .filter(
                    r =>
                        !r.affordable &&
                        r.payback <= cfg.maxPaybackSec
                )
                .sort((a, b) => a.pp - b.pp)[0] || null;

        return {
            buy: null,
            save: save ? save.c : null,
            saveRow: save,
            note: save ? 'saving' : 'waiting',
            rows
        };
    }

    /**
     * Colour for the "how good is a buy" box: red (0, worst on offer) through amber (0.5) to
     * green (1, best on offer).
     * @param {number} rank - 0..1
     * @returns {string} rgb()
     * @req BUY-2
     */
    function buyRankColor(rank) {
        const stops = [
            [255, 90, 90],
            [255, 210, 90],
            [130, 255, 130]
        ];

        const seg = clamp(rank, 0, 1) * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(seg));
        const f = seg - i;

        const mix = (a, b) => Math.round(a + (b - a) * f);

        return `rgb(${mix(stops[i][0], stops[i + 1][0])},${mix(
            stops[i][1],
            stops[i + 1][1]
        )},${mix(stops[i][2], stops[i + 1][2])})`;
    }

    /**
     * Candidates + decision for the "how good is a buy" overlay, cached for ~500 ms (works whether or
     * not auto play is switched on; it never buys anything by itself).
     * @returns {{cands:Object[],decision:Object}|null} null while nothing can be planned
     * @req BUY-1, BUY-2
     */
    function buyValueSnapshot() {
        const now = Date.now();

        if (
            runtime.buyValueCache &&
            now < runtime.buyValueAt + 500
        ) {
            return runtime.buyValueCache;
        }

        runtime.buyValueAt = now;

        try {
            const g = autoCollect();

            if (g.skip) {
                runtime.buyValueCache = null;
            } else {
                runtime.buyValueCache = {
                    decision: autoDecide(g.cands, g.ctx)
                };
            }
        } catch (e) {
            runtime.buyValueCache = null;
        }

        return runtime.buyValueCache;
    }

    /**
     * Short human time for the HUD ("45s", "3m 20s", "2h 5m").
     * @param {number} sec
     * @returns {string}
     */
    function autoFmtTime(sec) {
        sec = Math.max(0, Math.round(sec));

        if (sec < 60) return `${sec}s`;

        if (sec < 3600) {
            return `${Math.floor(sec / 60)}m ${sec % 60}s`;
        }

        return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    }

    /**
     * Count one auto purchase.
     * @req AUTO-10
     */
    function recordAutoBuy() {
        data.stats.autoBuys =
            (Number(data.stats.autoBuys) || 0) + 1;

        scheduleSave();
    }

    /**
     * Compute (at most once per second, unless forced) the shopping plan and keep it in
     * runtime.autoPlan = {buy, save, note, why, at}. In dry-run mode a purchase is only logged
     * ("would buy", at most once per 30 s per item) and plan.buy stays null. Any error pauses the
     * auto player for 30 s and is logged.
     * @param {boolean} [force]
     * @returns {Object} the plan
     * @req AUTO-3, AUTO-4, AUTO-7, AUTO-9
     */
    function autoEvaluate(force) {
        const now = Date.now();

        if (
            !force &&
            runtime.autoPlan &&
            now < runtime.autoNextEvalAt
        ) {
            return runtime.autoPlan;
        }

        runtime.autoNextEvalAt = now + 1000;

        const plan = {
            at: now,
            buy: null,
            save: null,
            note: 'watching'
        };

        try {
            const g = autoCollect();

            if (g.skip) {
                plan.note = g.skip;
            } else {
                const d = autoDecide(g.cands, g.ctx);

                plan.why = d.why;
                plan.save = d.save || null;

                if (d.buy) {
                    if (data.config.autoDryRun === true) {
                        plan.note = `dry run: would buy ${d.buy.name}`;

                        const last =
                            runtime.autoWouldLog.get(d.buy.name) || 0;

                        if (now - last > 30000) {
                            runtime.autoWouldLog.set(d.buy.name, now);

                            logAction(
                                'auto play (dry run)',
                                `would buy ${d.buy.name}`,
                                {
                                    type: d.buy.type,
                                    cost: Math.round(d.buy.cost),
                                    dCps: d.buy.dCps,
                                    payback: d.row.payback,
                                    why: d.why
                                }
                            );
                        }
                    } else {
                        plan.buy = d.buy;
                        plan.row = d.row;
                        plan.note = `buying ${d.buy.name} (${d.why})`;
                    }
                } else if (d.save && d.saveRow) {
                    plan.note = `saving for ${d.save.name} (+${(
                        d.saveRow.impact * 100
                    ).toFixed(1)}% CpS, ~${autoFmtTime(
                        d.saveRow.wait
                    )})`;
                } else {
                    plan.note = d.note || 'watching';
                }
            }
        } catch (e) {
            plan.note = 'error, paused for 30 s';
            runtime.autoBlockUntil = now + 30000;

            logAction(
                'auto play error',
                String(e && e.message ? e.message : e)
            );
        }

        runtime.autoPlan = plan;

        return plan;
    }

    /**
     * Should the paw drop what it is doing / not start shopping? True when anything more important
     * is going on: a ready golden cookie, Click Frenzy, a cookie storm or chain (hurry mode), an FTHOF /
     * refill waiting, or the bot is paused/destroyed.
     * @returns {boolean}
     * @req AUTO-7, AUTO-8
     */
    function shoppingInterrupted() {
        return (
            runtime.destroyed ||
            !runtime.running ||
            hasGoodGolden() ||
            clickFrenzyActive() ||
            cookieStormActive() ||
            cookieChainActive() ||
            fthofOrRefillPending()
        );
    }

    /**
     * Is auto shopping allowed right now? Needs: mode on, not blocked after an error/failed purchase,
     * at least 400 ms since the last purchase, and nothing more important going on.
     * @returns {boolean}
     * @req AUTO-1, AUTO-7
     */
    function autoShoppingAllowed() {
        return (
            data.config.autoPlay === true &&
            !!window.Game &&
            !!Game.ready &&
            Date.now() >= runtime.autoBlockUntil &&
            Date.now() - runtime.lastAutoBuyAt >= 400 &&
            !shoppingInterrupted()
        );
    }

    /**
     * Is a purchase due? (allowed, and the current plan says buy). Also used to interrupt hammering and
     * idle play (see pendingPriorityWork()).
     * @returns {boolean}
     * @req AUTO-8
     */
    function autoShopReady() {
        if (!autoShoppingAllowed()) return false;

        const plan = autoEvaluate(false);

        return !!(plan && plan.buy);
    }

    /**
     * The store element of a purchase option (building row or upgrade crate), for the paw's visit.
     * @param {Object} c - candidate
     * @returns {Element|null}
     * @req AUTO-9
     */
    function autoStoreElement(c) {
        if (c.kind === 'building') {
            return document.getElementById(`product${c.obj.id}`);
        }

        const i = Array.isArray(Game.UpgradesInStore)
            ? Game.UpgradesInStore.indexOf(c.obj)
            : -1;

        return i >= 0
            ? document.getElementById(`upgrade${i}`)
            : null;
    }

    /**
     * Make the purchase through the game's own API (NOT by clicking the store, so the store's buy/sell and
     * bulk modes can never cause a mistake). Buildings are bought one at a time.
     * @param {Object} c - candidate
     * @returns {boolean} true if it really was bought
     * @req AUTO-7, AUTO-9
     */
    function autoBuy(c) {
        if (c.kind === 'building') {
            const me = c.obj;

            if (Game.buyMode === -1 || !(Game.cookies >= c.cost)) {
                return false;
            }

            const before = Number(me.amount) || 0;

            me.buy(1);

            return (Number(me.amount) || 0) > before;
        }

        const up = c.obj;

        if (up.bought || !(Game.cookies >= autoPrice(up))) {
            return false;
        }

        up.buy();

        return !!up.bought;
    }

    /**
     * Text of the HUD row "Auto play".
     * @returns {string}
     * @req AUTO-9
     */
    function autoStatusText() {
        if (data.config.autoPlay !== true) return 'off';

        const plan = runtime.autoPlan;

        const st = runtime.autoHammerState;

        const hammer =
            data.config.autoHammer === false
                ? ''
                : st.on
                  ? ` | hammering (clicks ~+${Math.round(st.share * 100)}% CpS${st.probeUntil ? ', probing' : ''})`
                  : ` | idling (clicks would add ~${Math.round(st.share * 100)}%)`;

        return (
            (data.config.autoDryRun === true ? '[dry run] ' : '') +
            (plan ? plan.note : 'starting...') +
            hammer
        );
    }

    /**
     * Auto play is opt-in: everything that belongs to it (its settings, the HUD row, its statistics)
     * is hidden until the mode is switched on.
     * @req AUTO-12
     */
    function applyAutoVisibility() {
        const on = data.config.autoPlay === true;

        const box = document.getElementById('ccsb-auto-settings');

        if (box) box.classList.toggle('open', on);

        const row = document.getElementById('ccsb-auto-row');

        if (row) row.style.display = on ? '' : 'none';
    }

    /**
     * Turn auto play on/off (persisted). Off by default.
     * @param {boolean} on
     * @req AUTO-1
     */
    function setAutoPlay(on) {
        data.config.autoPlay = !!on;
        runtime.autoPlan = null;
        runtime.autoNextEvalAt = 0;
        runtime.autoHammerState.on = false;
        runtime.autoHammerState.wanted = null;
        runtime.autoHammerState.nextEvalAt = 0;
        runtime.autoHammerState.probeUntil = 0;
        runtime.autoHammerState.nextProbeAt = 0;

        applyAutoVisibility();

        logAction('auto play', on ? 'on' : 'off');

        scheduleSave();
    }

    /**
     * Shopping task: re-plan, let the paw visit the store item (if it is visible; a visual press only,
     * no click is sent to the store), re-check that nothing more important came up, then buy through
     * autoBuy(). Records stats, logs "auto buy" with the numbers behind the decision, and blocks
     * re-planning for a moment after a failed attempt so it can never spin.
     * @returns {Promise<void>}
     * @req AUTO-7, AUTO-8, AUTO-9, AUTO-10
     */
    async function autoShop() {
        const plan = autoEvaluate(true);
        const c = plan && plan.buy;

        if (!c) {
            runtime.autoBlockUntil = Date.now() + 1500;

            return;
        }

        runtime.currentAction = 'auto-shop';
        runtime.currentTarget = `buying ${c.name}`;

        const el = autoStoreElement(c);
        const r = el ? visibleRect(el) : null;

        if (r) {
            const ok = await moveCursorTo(
                r.left + r.width / 2,
                r.top + r.height / 2,
                true,
                { abortIf: shoppingInterrupted }
            );

            if (!ok) return;

            await sleep(90);
        }

        if (shoppingInterrupted()) return;

        // visual press only
        runtime.pulseAt = performance.now();

        await sleep(70);

        // things may have changed while the paw was on its way
        const fresh = autoEvaluate(true);

        if (
            shoppingInterrupted() ||
            !fresh.buy ||
            fresh.buy.name !== c.name
        ) {
            return;
        }

        if (autoBuy(fresh.buy)) {
            runtime.lastAutoBuyAt = Date.now();
            runtime.autoNextEvalAt = 0;

            recordAutoBuy();

            logAction('auto buy', fresh.buy.name, {
                type: fresh.buy.type,
                cost: Math.round(fresh.buy.cost),
                dCps: fresh.buy.dCps,
                payback: fresh.row && fresh.row.payback,
                impact: fresh.row && fresh.row.impact,
                why: fresh.why
            });
        } else {
            runtime.autoBlockUntil = Date.now() + 3000;
        }
    }


    // ============================================================================
    // SECTION 11 - Scheduler (priorities)
    // ============================================================================

    /**
     * The heart of the bot; runs every 25 ms. If nothing is running it picks ONE task by priority (SCHED-1):
     *   1 ready golden cookies   -> clickGolden(first cookie of the planned route)
     *   2 real Click Frenzy      -> clickBigCookie
     *   3 FTHOF, else refill     -> castFthof / refillGrimoire (only outside Click Frenzy)
     *   4 auto play shopping     -> autoShop (only when a purchase is due)
     *   5 hammer mode            -> clickBigCookie
     *   6 queued happy dance     -> happyDance
     *   7 idle behaviour         -> idleWander
     * It also logs each wrath cookie once. When a task ends, the paw ponders where it stopped (idleStay).
     * A task that throws is logged and never stops the bot.
     * @req SCHED-1, SCHED-2, SCHED-3, SCHED-4, GC-1, GC-7, NFR-4, AUTO-8
     */
    function schedulerTick() {
        if (
            runtime.destroyed ||
            !runtime.running ||
            runtime.actionInProgress ||
            !window.Game ||
            !Game.ready
        ) {
            return;
        }

                const buffs =
            updateBuffAndLockState();

        const shimmers =
            getGoldenShimmers();

        // Log each wrath cookie once,
        // but never queue it.
        for (
            const wrath of
            shimmers.wrath
        ) {
            if (
                !runtime.seenWrath.has(
                    wrath.id
                )
            ) {
                runtime.seenWrath.add(
                    wrath.id
                );

                logAction(
                    'ignore wrath cookie',
                    'wrath',
                    {
                        shimmerId:
                            wrath.id
                    }
                );
            }
        }

        const aliveIds =
            new Set(
                Game.shimmers
                    .filter(
                        s =>
                            s &&
                            s.type ===
                                'golden'
                    )
                    .map(s => s.id)
            );

        for (
            const id of Array.from(
                runtime.seenWrath
            )
        ) {
            if (!aliveIds.has(id)) {
                runtime.seenWrath.delete(
                    id
                );
            }
        }

        const queue =
            buildGoldenQueue(
                shimmers.good
            );

        let task = null;

        // Absolute priority:
        // good golden cookies.
        if (queue.length) {
            task = () =>
                clickGolden(
                    queue[0].shimmer
                );
        } else if (
            clickFrenzyActive()
        ) {
            // Start moving shortly before
            // desired event time.
            if (
                Date.now() >=
                runtime.nextBigClickAt -
                    BIG_CLICK_LEAD_MS
            ) {
                task = clickBigCookie;
            }
        } else {
            const M = getGrimoire();

            const cost =
                getFthofCost(M);

            if (
                M &&
                buffs.length >= 1 &&
                cpsBuffOutlastsClickFrenzy(
                    buffs
                ) &&
                M.magic >= cost
            ) {
                task = castFthof;
            } else if (
                M &&
                buffs.length >= 2 &&
                cpsBuffOutlastsClickFrenzy(
                    buffs
                ) &&
                M.magic < cost &&
                !runtime.lockA &&
                !runtime.refillInFlight
            ) {
                task =
                    refillGrimoire;
            }
        }

        // Auto play: buy something when the plan says so (below FTHOF/refill,
        // above hammer mode).
        if (!task && autoShopReady()) {
            task = autoShop;
        }

        // Lowest real priority: keep hammering the big cookie (as if
        // Click Frenzy were active) while hammer mode is switched on.
        if (
            !task &&
            hammerActive() &&
            !clickFrenzyActive() &&
            Date.now() >=
                runtime.nextBigClickAt -
                    BIG_CLICK_LEAD_MS
        ) {
            task = clickBigCookie;
        }

        // A queued happy dance goes before idling around.
        if (
            !task &&
            runtime.danceQueued
        ) {
            task = happyDance;
        }

        if (
            !task &&
            data.config.idleWander !==
                false &&
            !hammerActive() &&
            !clickFrenzyActive() &&
            Date.now() >=
                runtime.nextIdleAt
        ) {
            task = idleWander;
        }

        // The dance is only for the moment right after the catch.
        if (task !== happyDance) {
            runtime.danceQueued = false;
        }

        if (!task) {
            runtime.currentAction =
                'idle';

            runtime.currentTarget =
                'none';

            return;
        }

        runtime.actionInProgress =
            true;

        Promise.resolve()
            .then(task)
            .catch(err => {
                console.error(
                    '[CC Good Boy] action failed:',
                    err
                );

                logAction(
                    'error',
                    String(
                        err &&
                            err.message
                            ? err.message
                            : err
                    )
                );
            })
            .finally(() => {
                runtime.actionInProgress =
                    false;

                // After real work, ponder right where it stopped.
                if (task !== idleWander) {
                    runtime.idleStay = true;

                    runtime.nextIdleAt =
                        Math.max(
                            runtime.nextIdleAt,
                            Date.now() + 250
                        );
                }

                if (runtime.running) {
                    runtime.currentAction =
                        'idle';

                    runtime.currentTarget =
                        'none';
                }
            });
    }

    // ============================================================================
    // SECTION 12 - User interface (styles, panel, settings, logs, debug tools)
    // ============================================================================

    /**
     * Insert the <style> element for the HUD, panels and overlay (pastel theme).
     * @req UI-7
     */
    function injectStyles() {
        const style =
            document.createElement(
                'style'
            );

        style.id = 'ccsb-style';

        style.textContent = `
#ccsb-panel, #ccsb-graphs, #ccsb-logs, #ccsb-debug {
    font-family: "Quicksand","Nunito","Varela Round","Segoe UI Rounded","Segoe UI","Comic Sans MS",ui-rounded,system-ui,sans-serif;
    color:#ffeaf6;
    box-sizing:border-box;
}

#ccsb-panel {
    position:fixed;
    top:8px;
    right:8px;
    z-index:2147483646;
    width:360px;
    max-height:calc(100vh - 16px);
    background:linear-gradient(160deg, rgba(50,27,68,.95), rgba(30,20,54,.95));
    border:2px solid #ff9ed2;
    border-radius:16px;
    box-shadow:0 8px 30px rgba(255,120,190,.30), inset 0 0 0 1px rgba(150,215,255,.35);
    font-size:11.5px;
    line-height:1.4;
    overflow:hidden;
}

#ccsb-panel * {
    box-sizing:border-box;
}

#ccsb-header {
    display:flex;
    align-items:center;
    gap:7px;
    padding:8px 10px;
    background:linear-gradient(90deg, rgba(255,158,210,.45), rgba(196,170,255,.36), rgba(150,215,255,.36));
    user-select:none;
    cursor:move;
    touch-action:none;
}

#ccsb-header button {
    cursor:pointer;
}

#ccsb-panel.dragging {
    opacity:.85;
}

#ccsb-version {
    font-size:10px;
    opacity:.8;
    color:#fff;
}

#ccsb-title {
    font-weight:800;
    flex:1;
    letter-spacing:.3px;
    color:#fff;
    text-shadow:0 1px 8px rgba(255,105,180,.75);
}

#ccsb-status-dot {
    width:9px;
    height:9px;
    border-radius:50%;
    background:#ff8fcf;
    box-shadow:0 0 9px #ff8fcf;
}

#ccsb-panel.paused #ccsb-status-dot {
    background:#b9a0ff;
    box-shadow:none;
}

#ccsb-body {
    padding:9px;
    overflow:auto;
    max-height:calc(100vh - 52px);
}

#ccsb-panel.minimized #ccsb-body {
    display:none;
}

#ccsb-panel button,
#ccsb-panel input,
#ccsb-graphs button,
#ccsb-logs button,
#ccsb-debug button,
#ccsb-logs input {
    font:inherit;
}

.ccsb-btn {
    color:#ffe6f4;
    background:rgba(255,158,210,.18);
    border:1px solid #ff9ed2;
    border-radius:999px;
    padding:3px 10px;
    cursor:pointer;
}

.ccsb-btn:hover {
    background:rgba(255,158,210,.38);
}

.ccsb-btn.active {
    background:rgba(255,143,207,.6);
    border-color:#fff;
}

.ccsb-row {
    display:flex;
    gap:6px;
    align-items:flex-start;
    margin:2px 0;
}

.ccsb-label {
    width:112px;
    color:#ffb3dc;
    flex:0 0 auto;
}

.ccsb-value {
    flex:1;
    overflow-wrap:anywhere;
}

.ccsb-buttons {
    display:flex;
    flex-wrap:wrap;
    gap:5px;
    margin:8px 0;
}

.ccsb-section {
    margin-top:7px;
    padding-top:6px;
    border-top:1px dashed rgba(255,158,210,.45);
}

.ccsb-stats-grid {
    display:grid;
    grid-template-columns:1fr auto;
    gap:2px 8px;
}

#ccsb-settings {
    display:none;
    margin-top:7px;
}

#ccsb-settings.open {
    display:block;
}

.ccsb-setting {
    display:grid;
    grid-template-columns:1fr 84px;
    align-items:center;
    gap:8px;
    margin:3px 0;
}

.ccsb-setting input[type=number] {
    width:84px;
    background:#2a1a3c;
    color:#ffeaf6;
    border:1px solid #ff9ed2;
    border-radius:8px;
    padding:2px 5px;
}

#ccsb-settings input[type=checkbox] {
    accent-color:#ff8fcf;
}

#ccsb-auto-settings {
    display:none;
    margin-top:8px;
    padding-top:6px;
    border-top:1px dashed rgba(255,158,210,.45);
}

#ccsb-auto-settings.open {
    display:block;
}

.ccsb-auto-title {
    color:#ffb3dc;
    margin-bottom:4px;
}

#ccsb-save-settings.dirty {
    background:rgba(255,143,207,.6);
    border-color:#fff;
}

#ccsb-save-status {
    align-self:center;
    color:#c9a6e6;
}

#ccsb-action-dock {
    display:flex;
    gap:5px;
    margin-top:8px;
}

.ccsb-action-chip {
    flex:1;
    text-align:center;
    border:1px solid rgba(150,215,255,.9);
    border-radius:999px;
    color:#e4f5ff;
    padding:3px 4px;
    background:rgba(150,215,255,.10);
}

#ccsb-graphs,
#ccsb-logs,
#ccsb-debug {
    display:none;
    position:fixed;
    z-index:2147483647;
    left:50%;
    top:50%;
    transform:translate(-50%,-50%);
    width:min(900px,calc(100vw - 50px));
    max-height:calc(100vh - 50px);
    overflow:auto;
    background:linear-gradient(160deg, rgba(46,25,64,.98), rgba(28,18,50,.98));
    border:2px solid #ff9ed2;
    border-radius:18px;
    box-shadow:0 12px 50px rgba(255,120,190,.35);
    padding:12px;
}

#ccsb-debug {
    width:min(560px,calc(100vw - 50px));
}

.ccsb-debug-note {
    color:#c9a6e6;
    font-size:10.5px;
    margin-bottom:8px;
}

.ccsb-debug-grid {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:6px;
}

.ccsb-debug-grid .ccsb-btn {
    text-align:left;
    padding:5px 10px;
}

#ccsb-debug-status {
    margin-top:10px;
    padding:6px 10px;
    border:1px dashed rgba(255,158,210,.45);
    border-radius:10px;
    min-height:1.6em;
}

#ccsb-debug-status.err {
    color:#ff9aa8;
}

.ccsb-modal-head {
    display:flex;
    align-items:center;
    gap:8px;
    margin-bottom:8px;
}

.ccsb-modal-head strong {
    flex:1;
    color:#fff;
    text-shadow:0 1px 8px rgba(255,105,180,.7);
}

.ccsb-chart {
    width:100%;
    height:300px;
    display:block;
    background:#241534;
    border:1px solid #6b4a86;
    border-radius:12px;
    margin:6px 0 14px;
}

#ccsb-log-filter {
    width:300px;
    max-width:55vw;
    background:#2a1a3c;
    color:#ffeaf6;
    border:1px solid #ff9ed2;
    border-radius:999px;
    padding:4px 10px;
}

#ccsb-log-table {
    width:100%;
    border-collapse:collapse;
    font-size:10.5px;
}

#ccsb-log-table th,
#ccsb-log-table td {
    border-bottom:1px solid #4a2f63;
    text-align:left;
    padding:3px 5px;
    vertical-align:top;
}

#ccsb-log-table th {
    position:sticky;
    top:0;
    background:#3a2352;
    color:#ffb3dc;
}

#ccsb-overlay {
    position:fixed;
    inset:0;
    z-index:2147483644;
    pointer-events:none;
    width:100vw;
    height:100vh;
}
`;

        document.head.appendChild(
            style
        );
    }

    /**
     * Apply the saved (dragged) position, keeping the panel fully on screen and letting the expanded
     * body scroll instead of running off the bottom.
     * @req UI-1
     */
    function applyPanelPosition() {
        if (!panel) return;

        const body =
            document.getElementById(
                'ccsb-body'
            );

        const pos = data.ui.panelPos;

        if (
            !pos ||
            !Number.isFinite(pos.left) ||
            !Number.isFinite(pos.top)
        ) {
            panel.style.left = '';
            panel.style.top = '';
            panel.style.right = '';

            if (body) {
                body.style.maxHeight = '';
            }

            return;
        }

        const rect =
            panel.getBoundingClientRect();

        const header =
            document.getElementById(
                'ccsb-header'
            );

        const headerH =
            (header &&
                header.getBoundingClientRect()
                    .height) ||
            32;

        const left = clamp(
            pos.left,
            0,
            Math.max(
                0,
                window.innerWidth -
                    (rect.width || 360)
            )
        );

        const top = clamp(
            pos.top,
            0,
            Math.max(
                0,
                window.innerHeight -
                    headerH
            )
        );

        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';

        // Let the expanded body scroll instead of
        // running off the bottom of the screen.
        if (body) {
            body.style.maxHeight =
                Math.max(
                    120,
                    window.innerHeight -
                        top -
                        headerH -
                        12
                ) + 'px';
        }
    }

    /**
     * Make the panel's title bar a drag handle (pointer events; buttons excluded). Saves the final position.
     * @req UI-1
     */
    function setupPanelDrag() {
        const header =
            document.getElementById(
                'ccsb-header'
            );

        if (!header) return;

        let drag = null;

        header.addEventListener(
            'pointerdown',
            e => {
                if (
                    e.button !== 0 ||
                    (e.target.closest &&
                        e.target.closest(
                            'button'
                        ))
                ) {
                    return;
                }

                const r =
                    panel.getBoundingClientRect();

                drag = {
                    id: e.pointerId,
                    dx: e.clientX - r.left,
                    dy: e.clientY - r.top
                };

                try {
                    header.setPointerCapture(
                        e.pointerId
                    );
                } catch (_) {}

                panel.classList.add(
                    'dragging'
                );

                e.preventDefault();
            }
        );

        header.addEventListener(
            'pointermove',
            e => {
                if (
                    !drag ||
                    e.pointerId !== drag.id
                ) {
                    return;
                }

                data.ui.panelPos = {
                    left: e.clientX - drag.dx,
                    top: e.clientY - drag.dy
                };

                applyPanelPosition();
            }
        );

        const end = e => {
            if (
                !drag ||
                e.pointerId !== drag.id
            ) {
                return;
            }

            drag = null;

            try {
                header.releasePointerCapture(
                    e.pointerId
                );
            } catch (_) {}

            panel.classList.remove(
                'dragging'
            );

            // Store the clamped, final position.
            const r =
                panel.getBoundingClientRect();

            data.ui.panelPos = {
                left: Math.round(r.left),
                top: Math.round(r.top)
            };

            scheduleSave();
        };

        header.addEventListener(
            'pointerup',
            end
        );

        header.addEventListener(
            'pointercancel',
            end
        );
    }

    /**
     * Window resize handler: re-fit the panel.
     * @req UI-1
     */
    function onPanelResize() {
        applyPanelPosition();
    }

    /**
     * Validate and clamp one setting typed into the UI (the ranges of section 5 of the header).
     * @param {string} key - config key
     * @param {string} raw - raw input text
     * @returns {number}
     * @req UI-4
     */
    function normalizeSetting(key, raw) {
        let value = Number(raw);

        switch (key) {
            case 'goldenMinIntervalMs':
                return clampInt(
                    value,
                    0,
                    5000,
                    200
                );

            case 'preClickDelayMs':
                return clampInt(
                    value,
                    0,
                    2000,
                    100
                );

            case 'goldenMinFadeCurve':
                return Number.isFinite(
                    value
                ) && raw !== ''
                    ? clamp(value, 0, 1)
                    : 0.55;

            case 'clickFrenzyCps':
                return clamp(
                    value || 8,
                    0.2,
                    50
                );

            case 'clickFrenzyJitterMs':
                return clamp(
                    value || 0,
                    0,
                    250
                );

            case 'cursorSpeedPxPerSec':
                return clamp(
                    value || 4200,
                    500,
                    20000
                );

            case 'autoHammerMinShare':
                return Number.isFinite(value) && raw !== ''
                    ? clamp(value, 0, 1000)
                    : 0.05;

            case 'autoProbeIntervalSec':
                return Number.isFinite(value) && raw !== ''
                    ? clamp(value, 0, 86400)
                    : 300;

            case 'autoProbeSec':
                return Number.isFinite(value) && raw !== ''
                    ? clamp(value, 2, 120)
                    : 10;

            case 'autoInsignificantSec':
                return Number.isFinite(value) && raw !== ''
                    ? clamp(value, 0, 3600)
                    : 1;

            case 'autoGoodFactor':
                return Number.isFinite(value) && raw !== ''
                    ? clamp(value, 1, 10)
                    : 1.2;

            case 'autoBiggerImpact':
                return Number.isFinite(value) && raw !== ''
                    ? clamp(value, 1, 100)
                    : 3;

            case 'autoReachSec':
                return Number.isFinite(value) && raw !== ''
                    ? clamp(value, 0, 86400)
                    : 1800;

            case 'autoMaxPaybackSec':
                return Number.isFinite(value) && raw !== ''
                    ? clamp(value, 60, 10000000)
                    : 86400;

            case 'autoReserveSec':
                return Number.isFinite(value) && raw !== ''
                    ? clamp(value, 0, 1000000)
                    : 0;

            case 'panicFactor':
                return Number.isFinite(
                    value
                ) && raw !== ''
                    ? clamp(value, 0.01, 1)
                    : 0.2;

            case 'hammerStepPx':
                return Number.isFinite(
                    value
                ) && raw !== ''
                    ? clamp(value, 0, 60)
                    : 3;

            case 'happyDanceMs':
                return clampInt(
                    value,
                    0,
                    10000,
                    2200
                );

            case 'idleSpeedPxPerSec':
                return clamp(
                    value || 320,
                    60,
                    2000
                );

            case 'chartHours':
                return clampInt(
                    value,
                    6,
                    720,
                    48
                );

            case 'retentionDays':
                return clampInt(
                    value,
                    1,
                    365,
                    30
                );

            case 'logLimit':
                return clampInt(
                    value,
                    100,
                    50000,
                    10000
                );

            default:
                return value;
        }
    }

    /**
     * Timer that clears the 'saved' note next to the Save button.
     */
    let saveStatusTimer = 0;

    /**
     * Mark the settings as (not) saved: glowing Save button + 'unsaved changes' text.
     * @req UI-4
     */
    function setSettingsDirty(dirty) {
        const btn =
            document.getElementById(
                'ccsb-save-settings'
            );

        const status =
            document.getElementById(
                'ccsb-save-status'
            );

        if (!btn || !status) return;

        clearTimeout(saveStatusTimer);

        btn.classList.toggle(
            'dirty',
            !!dirty
        );

        status.textContent = dirty
            ? 'unsaved changes ^w^'
            : '';
    }

    /**
     * Staged settings commit: validate/clamp every field, apply to data.config, store immediately,
     * and refresh the charts if open.
     * @req UI-4
     */
    function saveSettings() {
        if (!panel) return;

        for (
            const input of
            panel.querySelectorAll(
                '[data-setting]'
            )
        ) {
            const key =
                input.dataset.setting;

            const value =
                normalizeSetting(
                    key,
                    input.value
                );

            data.config[key] = value;
            input.value = value;
        }

        data.config.visuals =
            document.getElementById(
                'ccsb-visuals'
            ).checked;

        data.config.idleWander =
            document.getElementById(
                'ccsb-idle-wander'
            ).checked;

        data.config.showBuyValue =
            document.getElementById(
                'ccsb-buyvalue'
            ).checked;

        data.config.keepAlive =
            document.getElementById(
                'ccsb-keepalive'
            ).checked;

        keepAliveInit();

        data.config.autoDryRun =
            document.getElementById(
                'ccsb-auto-dry'
            ).checked;

        data.config.autoHammer =
            document.getElementById(
                'ccsb-auto-hammer'
            ).checked;

        runtime.autoNextEvalAt = 0;

        // Explicit save: write to storage right now.
        saveNow();

        setSettingsDirty(false);

        const status =
            document.getElementById(
                'ccsb-save-status'
            );

        if (status) {
            status.textContent =
                'saved :3';

            saveStatusTimer =
                setTimeout(() => {
                    status.textContent =
                        '';
                }, 2500);
        }

        if (
            graphPanel &&
            graphPanel.style.display ===
                'block'
        ) {
            drawGraphs();
        }
    }

    /**
     * Build the whole interface once at start: overlay canvas, HUD panel, graphs/logs/debug modals,
     * settings inputs and every event handler (minimize, pause, hammer, toggles, export, debug).
     * Element ids all start with 'ccsb-'.
     * @req UI-1, UI-2, UI-3, UI-4, UI-5, UI-6, UI-8
     */
    function createUi() {
        injectStyles();

        overlayCanvas =
            document.createElement(
                'canvas'
            );

        overlayCanvas.id =
            'ccsb-overlay';

        document.body.appendChild(
            overlayCanvas
        );

        overlayCtx =
            overlayCanvas.getContext(
                '2d'
            );

        panel =
            document.createElement(
                'div'
            );

        panel.id = 'ccsb-panel';

        panel.innerHTML = `
<div id="ccsb-header">
    <span id="ccsb-status-dot"></span>
    <span id="ccsb-title">CC Good Boy :3</span>
    <span id="ccsb-version" title="script version">v${VERSION}</span>
    <button class="ccsb-btn" id="ccsb-minimize" title="Minimize">−</button>
</div>
<div id="ccsb-body">
    <div class="ccsb-row">
        <span class="ccsb-label">Mood</span>
        <span class="ccsb-value" id="ccsb-state">—</span>
    </div>
    <div class="ccsb-row">
        <span class="ccsb-label">Chasing</span>
        <span class="ccsb-value" id="ccsb-target">—</span>
    </div>
    <div class="ccsb-row">
        <span class="ccsb-label">Shinies waiting</span>
        <span class="ccsb-value" id="ccsb-queue">0</span>
    </div>
    <div class="ccsb-row">
        <span class="ccsb-label">Click Frenzy</span>
        <span class="ccsb-value" id="ccsb-cf">OFF</span>
    </div>
    <div class="ccsb-row">
        <span class="ccsb-label">Buffies</span>
        <span class="ccsb-value" id="ccsb-buffs">none</span>
    </div>
    <div class="ccsb-row">
        <span class="ccsb-label">Grimoire</span>
        <span class="ccsb-value" id="ccsb-magic">unavailable</span>
    </div>
    <div class="ccsb-row">
        <span class="ccsb-label">LOCK_A</span>
        <span class="ccsb-value" id="ccsb-lock">OPEN</span>
    </div>
    <div class="ccsb-row">
        <span class="ccsb-label">Click cooldown</span>
        <span class="ccsb-value" id="ccsb-cooldown">ready</span>
    </div>
    <div class="ccsb-row">
        <span class="ccsb-label">Background</span>
        <span class="ccsb-value" id="ccsb-bg">...</span>
    </div>
    <div class="ccsb-row" id="ccsb-auto-row">
        <span class="ccsb-label">Auto play</span>
        <span class="ccsb-value" id="ccsb-auto">off</span>
    </div>

    <div class="ccsb-section">
        <div class="ccsb-stats-grid" id="ccsb-stats"></div>
    </div>

    <div class="ccsb-buttons">
        <button class="ccsb-btn" id="ccsb-pause">Pause :3</button>
        <button class="ccsb-btn" id="ccsb-hammer" title="Click the big cookie non-stop (like Click Frenzy). Lowest priority, above idling.">Hammer cookie :3</button>
        <button class="ccsb-btn" id="ccsb-auto-toggle" title="Full auto play: also buys buildings and upgrades (off by default).">Auto play :3</button>
        <button class="ccsb-btn" id="ccsb-toggle-graphs">Graphs ^w^</button>
        <button class="ccsb-btn" id="ccsb-toggle-logs">Logs owo</button>
        <button class="ccsb-btn" id="ccsb-toggle-debug">Debug tools :3</button>
        <button class="ccsb-btn" id="ccsb-toggle-settings">Settings :3</button>
    </div>

    <div id="ccsb-settings">
        <div class="ccsb-setting">
            <span>Patience before moving (ms)</span>
            <input data-setting="goldenMinIntervalMs" type="number" min="0" max="5000" step="10">
        </div>
        <div class="ccsb-setting">
            <span>Shy pause before click (ms)</span>
            <input data-setting="preClickDelayMs" type="number" min="0" max="2000" step="10">
        </div>
        <div class="ccsb-setting">
            <span>Wait till cookie is visible (0-1)</span>
            <input data-setting="goldenMinFadeCurve" type="number" min="0" max="1" step="0.05">
        </div>
        <div class="ccsb-setting">
            <span>Click Frenzy clicks/sec</span>
            <input data-setting="clickFrenzyCps" type="number" min="0.2" max="50" step="0.1">
        </div>
        <div class="ccsb-setting">
            <span>Wiggle ±ms</span>
            <input data-setting="clickFrenzyJitterMs" type="number" min="0" max="250" step="1">
        </div>
        <div class="ccsb-setting">
            <span>Click step max px (0 = stay put)</span>
            <input data-setting="hammerStepPx" type="number" min="0" max="60" step="0.5">
        </div>
        <div class="ccsb-setting">
            <span>Paw zoomies px/s</span>
            <input data-setting="cursorSpeedPxPerSec" type="number" min="500" max="20000" step="100">
        </div>
        <div class="ccsb-setting">
            <span>Storm/chain hurry factor (0.01-1)</span>
            <input data-setting="panicFactor" type="number" min="0.01" max="1" step="0.05">
        </div>
        <div class="ccsb-setting">
            <span>Paw idle speed px/s</span>
            <input data-setting="idleSpeedPxPerSec" type="number" min="60" max="2000" step="10">
        </div>
        <div class="ccsb-setting">
            <span>Happy dance length (ms, 0 = off)</span>
            <input data-setting="happyDanceMs" type="number" min="0" max="10000" step="100">
        </div>
        <div class="ccsb-setting">
            <span>Chart hours</span>
            <input data-setting="chartHours" type="number" min="6" max="720" step="1">
        </div>
        <div class="ccsb-setting">
            <span>Remember history (days)</span>
            <input data-setting="retentionDays" type="number" min="1" max="365" step="1">
        </div>
        <div class="ccsb-setting">
            <span>Log entries to keep</span>
            <input data-setting="logLimit" type="number" min="100" max="50000" step="100">
        </div>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px">
            <input id="ccsb-visuals" type="checkbox">
            Pretty overlays ^w^
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px">
            <input id="ccsb-idle-wander" type="checkbox">
            Idle playtime (paw wanders) :3
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="Shows cost/CpS payback time over every building and upgrade in the store (works with auto play off)">
            <input id="ccsb-buyvalue" type="checkbox">
            Show "how good is a buy" overlay :3
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="A practically silent AudioContext: the browser then does not throttle this tab in the background (needs one click on the page)">
            <input id="ccsb-keepalive" type="checkbox">
            Background keep-alive (silent audio) :3
        </label>

        <div id="ccsb-auto-settings">
            <div class="ccsb-auto-title">Auto play settings :3</div>
            <div class="ccsb-setting">
                <span>Auto: insignificant cost (s of income)</span>
                <input data-setting="autoInsignificantSec" type="number" min="0" max="3600" step="0.5">
            </div>
            <div class="ccsb-setting">
                <span>Auto: good deal (x best payback)</span>
                <input data-setting="autoGoodFactor" type="number" min="1" max="10" step="0.1">
            </div>
            <div class="ccsb-setting">
                <span>Auto: much bigger impact (x)</span>
                <input data-setting="autoBiggerImpact" type="number" min="1" max="100" step="0.5">
            </div>
            <div class="ccsb-setting">
                <span>Auto: in reach within (s)</span>
                <input data-setting="autoReachSec" type="number" min="0" max="86400" step="60">
            </div>
            <div class="ccsb-setting">
                <span>Auto: max payback (s)</span>
                <input data-setting="autoMaxPaybackSec" type="number" min="60" max="10000000" step="600">
            </div>
            <div class="ccsb-setting">
                <span>Auto: bank reserve (s of CpS)</span>
                <input data-setting="autoReserveSec" type="number" min="0" max="1000000" step="60">
            </div>
            <div class="ccsb-setting">
                <span>Auto: hammer when clicks add >= (x CpS)</span>
                <input data-setting="autoHammerMinShare" type="number" min="0" max="1000" step="0.01">
            </div>
            <div class="ccsb-setting">
                <span>Auto: probe hammering every (s, 0 = never)</span>
                <input data-setting="autoProbeIntervalSec" type="number" min="0" max="86400" step="30">
            </div>
            <div class="ccsb-setting">
                <span>Auto: probe length (s)</span>
                <input data-setting="autoProbeSec" type="number" min="2" max="120" step="1">
            </div>
            <label style="display:flex;gap:6px;align-items:center;margin-top:5px">
                <input id="ccsb-auto-hammer" type="checkbox">
                Auto: manage hammering :3
            </label>
            <label style="display:flex;gap:6px;align-items:center;margin-top:5px">
                <input id="ccsb-auto-dry" type="checkbox">
                Auto play dry run (log only) :3
            </label>
        </div>

        <div class="ccsb-buttons">
            <button class="ccsb-btn" id="ccsb-save-settings">Save settings :3</button>
            <span id="ccsb-save-status"></span>
        </div>
    </div>

    <div id="ccsb-action-dock">
        <div class="ccsb-action-chip" id="ccsb-dock-fthof">FTHOF</div>
        <div class="ccsb-action-chip" id="ccsb-dock-refill">REFILL</div>
    </div>
</div>`;

        document.body.appendChild(
            panel
        );

        graphPanel =
            document.createElement(
                'div'
            );

        graphPanel.id =
            'ccsb-graphs';

        graphPanel.innerHTML = `
<div class="ccsb-modal-head">
    <strong>CC Good Boy :3 hourly action graphs</strong>
    <button class="ccsb-btn" id="ccsb-close-graphs">Close :3</button>
</div>
<div>Golden-cookie clicks / hour by effect</div>
<canvas class="ccsb-chart" id="ccsb-golden-chart"></canvas>
<div>Grimoire actions / hour</div>
<canvas class="ccsb-chart" id="ccsb-grimoire-chart"></canvas>`;

        document.body.appendChild(
            graphPanel
        );

        logPanel =
            document.createElement(
                'div'
            );

        logPanel.id =
            'ccsb-logs';

        logPanel.innerHTML = `
<div class="ccsb-modal-head">
    <strong>CC Good Boy :3 action log</strong>
    <input id="ccsb-log-filter" placeholder="search the log :3">
    <button class="ccsb-btn" id="ccsb-export-json" title="Download logs (respects the filter) as JSON">Export JSON</button>
    <button class="ccsb-btn" id="ccsb-export-csv" title="Download logs (respects the filter) as CSV">Export CSV</button>
    <button class="ccsb-btn" id="ccsb-close-logs">Close :3</button>
</div>
<table id="ccsb-log-table">
    <thead>
        <tr>
            <th>time</th>
            <th>action</th>
            <th>meta</th>
            <th>extra</th>
        </tr>
    </thead>
    <tbody></tbody>
</table>`;

        document.body.appendChild(
            logPanel
        );

        debugPanel =
            document.createElement(
                'div'
            );

        debugPanel.id = 'ccsb-debug';

        debugPanel.innerHTML = `
<div class="ccsb-modal-head">
    <strong>CC Good Boy :3 debug tools (cheats)</strong>
    <button class="ccsb-btn" id="ccsb-close-debug">Close :3</button>
</div>
<div class="ccsb-debug-note">For testing the hunter without waiting for cookies. These change your game, so use a test save.</div>
<div class="ccsb-debug-grid">${DEBUG_TOOLS.map(
            (t, i) =>
                `<button class="ccsb-btn" data-debug="${i}">${escapeHtml(
                    t.label
                )}</button>`
        ).join('')}</div>
<div id="ccsb-debug-status">ready :3</div>`;

        document.body.appendChild(
            debugPanel
        );

                panel.classList.toggle(
            'minimized',
            !!data.ui.minimized
        );

        document.getElementById(
            'ccsb-minimize'
        ).textContent =
            data.ui.minimized
                ? '+'
                : '−';

        document
            .getElementById(
                'ccsb-settings'
            )
            .classList.toggle(
                'open',
                !!data.ui.settingsOpen
            );

        // Settings are staged: editing only marks them "unsaved".
        // They are validated, applied and stored on Save.
        for (
            const input of
            panel.querySelectorAll(
                '[data-setting]'
            )
        ) {
            input.value =
                data.config[
                    input.dataset.setting
                ];

            input.addEventListener(
                'input',
                () =>
                    setSettingsDirty(true)
            );

            input.addEventListener(
                'keydown',
                e => {
                    if (e.key === 'Enter') {
                        saveSettings();
                    }
                }
            );
        }

        const visuals =
            document.getElementById(
                'ccsb-visuals'
            );

        visuals.checked =
            !!data.config.visuals;

        visuals.addEventListener(
            'change',
            () =>
                setSettingsDirty(true)
        );

        const idleBox =
            document.getElementById(
                'ccsb-idle-wander'
            );

        idleBox.checked =
            data.config.idleWander !==
            false;

        idleBox.addEventListener(
            'change',
            () =>
                setSettingsDirty(true)
        );

        const buyValueBox =
            document.getElementById(
                'ccsb-buyvalue'
            );

        buyValueBox.checked =
            data.config.showBuyValue !== false;

        buyValueBox.addEventListener(
            'change',
            () =>
                setSettingsDirty(true)
        );

        const keepBox =
            document.getElementById(
                'ccsb-keepalive'
            );

        keepBox.checked =
            data.config.keepAlive !== false;

        keepBox.addEventListener(
            'change',
            () =>
                setSettingsDirty(true)
        );

        const autoHammerBox =
            document.getElementById(
                'ccsb-auto-hammer'
            );

        autoHammerBox.checked =
            data.config.autoHammer !== false;

        autoHammerBox.addEventListener(
            'change',
            () =>
                setSettingsDirty(true)
        );

        applyAutoVisibility();

        const dryBox =
            document.getElementById(
                'ccsb-auto-dry'
            );

        dryBox.checked =
            data.config.autoDryRun === true;

        dryBox.addEventListener(
            'change',
            () =>
                setSettingsDirty(true)
        );

        document
            .getElementById(
                'ccsb-auto-toggle'
            )
            .addEventListener(
                'click',
                () => {
                    setAutoPlay(
                        data.config.autoPlay !==
                            true
                    );

                    updatePanel();
                }
            );

        document
            .getElementById(
                'ccsb-save-settings'
            )
            .addEventListener(
                'click',
                saveSettings
            );

        document
            .getElementById(
                'ccsb-minimize'
            )
            .addEventListener(
                'click',
                () => {
                    data.ui.minimized =
                        !data.ui
                            .minimized;

                    panel.classList.toggle(
                        'minimized',
                        data.ui
                            .minimized
                    );

                    document.getElementById(
                        'ccsb-minimize'
                    ).textContent =
                        data.ui
                            .minimized
                            ? '+'
                            : '−';

                    applyPanelPosition();

                    scheduleSave();
                }
            );

        document
            .getElementById(
                'ccsb-pause'
            )
            .addEventListener(
                'click',
                () => {
                    runtime.running =
                        !runtime.running;

                    logAction(
                        runtime.running
                            ? 'bot resumed'
                            : 'bot paused',
                        'manual'
                    );

                    updatePanel();
                }
            );

        document
            .getElementById(
                'ccsb-hammer'
            )
            .addEventListener(
                'click',
                () => {
                    runtime.hammer =
                        !runtime.hammer;

                    if (runtime.hammer) {
                        runtime.nextBigClickAt =
                            Date.now();
                    } else {
                        // ponder where the paw stopped
                        runtime.idleStay = true;
                    }

                    logAction(
                        'hammer cookie',
                        runtime.hammer
                            ? 'on'
                            : 'off'
                    );

                    updatePanel();
                }
            );

        document
            .getElementById(
                'ccsb-toggle-settings'
            )
            .addEventListener(
                'click',
                () => {
                    data.ui.settingsOpen =
                        !data.ui
                            .settingsOpen;

                    document
                        .getElementById(
                            'ccsb-settings'
                        )
                        .classList.toggle(
                            'open',
                            data.ui
                                .settingsOpen
                        );

                    scheduleSave();
                }
            );

        document
            .getElementById(
                'ccsb-toggle-graphs'
            )
            .addEventListener(
                'click',
                toggleGraphs
            );

        document
            .getElementById(
                'ccsb-close-graphs'
            )
            .addEventListener(
                'click',
                toggleGraphs
            );

        document
            .getElementById(
                'ccsb-toggle-logs'
            )
            .addEventListener(
                'click',
                toggleLogs
            );

        document
            .getElementById(
                'ccsb-close-logs'
            )
            .addEventListener(
                'click',
                toggleLogs
            );

        document
            .getElementById(
                'ccsb-toggle-debug'
            )
            .addEventListener(
                'click',
                toggleDebug
            );

        document
            .getElementById(
                'ccsb-close-debug'
            )
            .addEventListener(
                'click',
                toggleDebug
            );

        debugPanel.addEventListener(
            'click',
            e => {
                const b =
                    e.target.closest &&
                    e.target.closest(
                        '[data-debug]'
                    );

                if (b) {
                    runDebugTool(
                        Number(
                            b.dataset.debug
                        )
                    );
                }
            }
        );

        document
            .getElementById(
                'ccsb-log-filter'
            )
            .addEventListener(
                'input',
                renderLogBrowser
            );

        document
            .getElementById(
                'ccsb-export-json'
            )
            .addEventListener(
                'click',
                () => exportLogs('json')
            );

        document
            .getElementById(
                'ccsb-export-csv'
            )
            .addEventListener(
                'click',
                () => exportLogs('csv')
            );

        updatePanel();
        resizeOverlay();

        setupPanelDrag();
        applyPanelPosition();

        window.addEventListener(
            'resize',
            resizeOverlay
        );

        window.addEventListener(
            'resize',
            onPanelResize
        );
    }

    /**
     * Show/hide the charts window (draws on open).
     * @req UI-5
     */
    function toggleGraphs() {
        const showing =
            graphPanel.style.display ===
            'block';

        graphPanel.style.display =
            showing
                ? 'none'
                : 'block';

        if (!showing) {
            drawGraphs();
        }
    }

    /**
     * Logs matching the current filter box (all logs if empty).
     * @returns {Object[]}
     * @req UI-6
     */
    function getLogsForExport() {
        const input =
            document.getElementById(
                'ccsb-log-filter'
            );

        const filter = (
            (input && input.value) ||
            ''
        )
            .trim()
            .toLowerCase();

        if (!filter) {
            return data.logs.slice();
        }

        return data.logs.filter(e =>
            `${e.action} ${e.meta} ${
                e.extra
                    ? JSON.stringify(
                          e.extra
                      )
                    : ''
            }`
                .toLowerCase()
                .includes(filter)
        );
    }

    /**
     * Trigger a browser download of a text file (Blob + temporary link).
     * @param {string} filename
     * @param {string} text
     * @param {string} mime
     * @req UI-6
     */
    function downloadTextFile(
        filename,
        text,
        mime
    ) {
        const blob = new Blob(
            [text],
            { type: mime }
        );

        const url =
            URL.createObjectURL(blob);

        const a =
            document.createElement('a');

        a.href = url;
        a.download = filename;
        a.style.display = 'none';

        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(url);
        }, 1000);
    }

    /**
     * Export the (filtered) logs as JSON ({exportedAt, version, count, logs[]}) or CSV
     * (time,ts,action,meta,extra; UTF-8 BOM for Excel).
     * @param {'json'|'csv'} format
     * @req UI-6
     */
    function exportLogs(format) {
        const logs =
            getLogsForExport();

        const stamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, '-');

        const iso = e =>
            new Date(
                e.ts * 1000
            ).toISOString();

        if (format === 'csv') {
            const esc = v => {
                const t = String(
                    v == null ? '' : v
                );

                return /[",\r\n]/.test(t)
                    ? '"' +
                          t.replace(
                              /"/g,
                              '""'
                          ) +
                          '"'
                    : t;
            };

            const rows = [
                'time,ts,action,meta,extra'
            ].concat(
                logs.map(e =>
                    [
                        iso(e),
                        e.ts,
                        e.action,
                        e.meta,
                        e.extra
                            ? JSON.stringify(
                                  e.extra
                              )
                            : ''
                    ]
                        .map(esc)
                        .join(',')
                )
            );

            // BOM so Excel reads UTF-8 correctly.
            downloadTextFile(
                `cc-smartbot-logs-${stamp}.csv`,
                '\uFEFF' +
                    rows.join('\r\n') +
                    '\r\n',
                'text/csv;charset=utf-8'
            );
        } else {
            downloadTextFile(
                `cc-smartbot-logs-${stamp}.json`,
                JSON.stringify(
                    {
                        exportedAt:
                            new Date().toISOString(),
                        version: VERSION,
                        count: logs.length,
                        logs: logs.map(
                            e =>
                                Object.assign(
                                    {
                                        time: iso(
                                            e
                                        )
                                    },
                                    e
                                )
                        )
                    },
                    null,
                    2
                ),
                'application/json'
            );
        }
    }

    // ---------- Debug tools (cheats) ----------
    // For testing the hunter without waiting for cookies. They use the
    // game's own spawning code, e.g. new Game.shimmer('golden', ...) with
    // a forced effect, exactly like the game's own Force the Hand of Fate.

    /**
     * Spawn a golden shimmer via the game's own constructor, optionally with a forced effect and size.
     * @param {string} label
     * @param {{wrath?:boolean,force?:string,sizeMult?:number}} spec
     * @returns {string} status text; throws if Game.shimmer is unavailable
     * @req DBG-1
     */
    function debugSpawnGolden(label, spec) {
        if (
            !window.Game ||
            typeof Game.shimmer !==
                'function'
        ) {
            throw new Error(
                'Game.shimmer is not available'
            );
        }

        const s = new Game.shimmer(
            'golden',
            spec.wrath
                ? { wrath: true }
                : { noWrath: true }
        );

        if (spec.force) {
            s.force = spec.force;
        }

        if (spec.sizeMult) {
            s.sizeMult = spec.sizeMult;
        }

        return `spawned: ${label}`;
    }

    /**
     * Set Grimoire mana to its maximum.
     * @returns {string} status; throws without a Grimoire
     * @req DBG-3
     */
    function debugFillMana() {
        const M = getGrimoire();

        if (!M) {
            throw new Error(
                'Grimoire not available (own a Wizard tower with its minigame first)'
            );
        }

        const max = Number(M.magicM);

        if (!Number.isFinite(max)) {
            throw new Error(
                'could not read the maximum mana'
            );
        }

        M.magic = max;

        return `mana filled (${formatNum(
            max
        )})`;
    }

    /**
     * The game has no real cooldown on Force the Hand of Fate, only its magic cost. So 'reset the FTHOF
     * cooldown' means: raise mana to exactly the FTHOF cost (enough for one cast, without filling the bar).
     * @returns {string} status
     * @req DBG-4
     */
    function debugResetFthofCooldown() {
        const M = getGrimoire();

        if (!M) {
            throw new Error(
                'Grimoire not available (own a Wizard tower with its minigame first)'
            );
        }

        const cost = getFthofCost(M);

        if (!Number.isFinite(cost)) {
            throw new Error(
                'could not read the FTHOF cost'
            );
        }

        if (Number(M.magic) >= cost) {
            return `FTHOF is already castable (mana ${formatNum(
                M.magic
            )} / ${formatNum(
                M.magicM
            )}, cost ${formatNum(cost)})`;
        }

        M.magic = cost;

        return `FTHOF castable now (mana set to its cost: ${formatNum(
            cost
        )} / ${formatNum(M.magicM)})`;
    }

    /**
     * The sugar lump refill has a 15 minute cooldown in the game. Resets Game.lumpRefill if it is a number;
     * if the game still says no, overrides Game.canRefillLump until the page reloads.
     * @returns {string} status
     * @req DBG-5
     */
    function debugResetRefillCooldown() {
        if (
            !window.Game ||
            typeof Game.canRefillLump !==
                'function'
        ) {
            throw new Error(
                'Game.canRefillLump is not available'
            );
        }

        if (
            typeof Game.lumpRefill ===
            'number'
        ) {
            Game.lumpRefill = 0;
        }

        if (Game.canRefillLump()) {
            return 'refill cooldown reset: lump refill is ready';
        }

        // Fallback (same as the well-known cheat): until the page reloads.
        Game.canRefillLump = () => true;

        return 'refill cooldown removed (canRefillLump overridden until reload)';
    }

    /**
     * Open LOCK_A (the bot's own lock that stops it from refilling twice in a row).
     * @returns {string} status
     * @req DBG-6, FT-6
     */
    function debugClearLockA() {
        const was = runtime.lockA;

        runtime.lockA = false;

        return was
            ? 'LOCK_A cleared'
            : 'LOCK_A was already open';
    }

    /**
     * Give cookies with the game's own Earn() so they also count as earned; that is what makes higher
     * buildings (e.g. Wizard tower) show up in the store, not just the bank balance.
     * @param {number} n
     * @param {string} label
     * @returns {string} status
     * @req DBG-2
     */
    function debugGrantCookies(n, label) {
        if (!window.Game) {
            throw new Error(
                'Game not available'
            );
        }

        if (
            typeof Game.Earn === 'function'
        ) {
            Game.Earn(n);
        } else {
            Game.cookies =
                (Number(Game.cookies) ||
                    0) + n;

            Game.cookiesEarned =
                (Number(
                    Game.cookiesEarned
                ) || 0) + n;
        }

        return `granted ${label} (bank now ${formatNum(
            Game.cookies
        )})`;
    }

    /**
     * Give n sugar lumps (Game.gainLumps if present, else added directly; unlocks lumps if locked).
     * @param {number} n
     * @returns {string} status
     * @req DBG-7
     */
    function debugGiveLumps(n) {
        if (!window.Game) {
            throw new Error(
                'Game not available'
            );
        }

        if (
            typeof Game.gainLumps ===
            'function'
        ) {
            Game.gainLumps(n);
        } else {
            if (Game.lumpsTotal === -1) {
                Game.lumpsTotal = 0;
                Game.lumps = 0;
            }

            Game.lumps =
                (Number(Game.lumps) || 0) +
                n;

            Game.lumpsTotal =
                (Number(Game.lumpsTotal) ||
                    0) + n;
        }

        return `gave ${n} sugar lumps (now ${formatNum(
            Game.lumps
        )})`;
    }

    /**
     * The buttons of the Debug tools panel, in display order: {label, run()}. run() returns a status
     * text or throws (the runner shows the error in red).
     * @req DBG-1..DBG-8
     */
    const DEBUG_TOOLS = [
        {
            label: 'Spawn random Golden Cookie',
            run: () =>
                debugSpawnGolden(
                    'random golden cookie',
                    {}
                )
        },
        {
            label: 'Spawn Wrath Cookie',
            run: () =>
                debugSpawnGolden(
                    'wrath cookie',
                    { wrath: true }
                )
        },
        {
            label: 'Spawn Frenzy Cookie',
            run: () =>
                debugSpawnGolden(
                    'frenzy cookie',
                    { force: 'frenzy' }
                )
        },
        {
            label: 'Spawn Click Frenzy Cookie',
            run: () =>
                debugSpawnGolden(
                    'click frenzy cookie',
                    { force: 'click frenzy' }
                )
        },
        {
            label: 'Spawn Building Frenzy Cookie',
            run: () =>
                debugSpawnGolden(
                    'building frenzy cookie',
                    {
                        force:
                            'building special'
                    }
                )
        },
        {
            label: 'Spawn Cookie Chain',
            run: () =>
                debugSpawnGolden(
                    'cookie chain',
                    { force: 'chain cookie' }
                )
        },
        {
            label: 'Spawn Cookie Storm',
            run: () =>
                debugSpawnGolden(
                    'cookie storm',
                    { force: 'cookie storm' }
                )
        },
        {
            label: 'Spawn Lucky Cookie',
            run: () =>
                debugSpawnGolden(
                    'lucky cookie',
                    {
                        force:
                            'multiply cookies'
                    }
                )
        },
        {
            label: 'Spawn Cookie Storm Drop',
            run: () =>
                debugSpawnGolden(
                    'cookie storm drop',
                    {
                        force:
                            'cookie storm drop',
                        sizeMult:
                            Math.random() *
                                0.75 +
                            0.25
                    }
                )
        },
        {
            label: 'Spawn Sweet Cookie (sugar lump)',
            run: () =>
                debugSpawnGolden(
                    'sweet cookie (sugar lump)',
                    {
                        force:
                            'free sugar lump'
                    }
                )
        },
        {
            label: 'Spawn Elder Frenzy Cookie (wrath)',
            run: () =>
                debugSpawnGolden(
                    'elder frenzy cookie (wrath)',
                    {
                        wrath: true,
                        force: 'blood frenzy'
                    }
                )
        },
        {
            label:
                'Grant 1 quadrillion cookies',
            run: () =>
                debugGrantCookies(
                    1e15,
                    '1 quadrillion cookies'
                )
        },
        {
            label: 'Fill Up Mana',
            run: debugFillMana
        },
        {
            label: 'Reset FTHOF cooldown',
            run: debugResetFthofCooldown
        },
        {
            label:
                'Reset Filling Up Mana cooldown',
            run: debugResetRefillCooldown
        },
        {
            label:
                'Clear LOCK_A (bot refill lock)',
            run: debugClearLockA
        },
        {
            label: 'Give 10 Sugar Lumps',
            run: () => debugGiveLumps(10)
        },
        {
            label: 'Auto play: explain store (log)',
            run: autoExplainStore
        }
    ];

    /**
     * Debug tool: list every upgrade currently in the store with what the auto player makes of it
     * (type, cost, estimated CpS gain, payback, or why it is ignored). Written to the log
     * ('auto explain') and the console; the status line shows a summary. Use it to find out why
     * something is not bought.
     * @returns {string} summary
     * @req DBG-9
     */
    function autoExplainStore() {
        const g = autoCollect();

        if (g.skip) return `cannot plan: ${g.skip}`;

        const store = Array.isArray(Game.UpgradesInStore)
            ? Game.UpgradesInStore
            : [];

        const byName = new Map(g.cands.map(c => [c.name, c]));

        const decision = autoDecide(g.cands, g.ctx);

        let known = 0;
        const rows = [];

        for (const up of store) {
            const c = byName.get(up.name);
            let status;

            if (c) {
                known++;

                status = `${c.type}: cost ${Math.round(c.cost)}, +${c.dCps.toFixed(2)} CpS, payback ${Math.round(c.cost / c.dCps)}s`;
            } else if (
                AUTO_BLOCKED_NAMES.has(up.name) ||
                AUTO_BLOCKED_RE.test(String(up.name))
            ) {
                status = 'blocked on purpose';
            } else if (AUTO_NON_STORE_POOLS.has(up.pool)) {
                status = `ignored (pool ${up.pool})`;
            } else {
                status = `NOT RECOGNISED - ${autoStripHtml(up.desc).slice(0, 110)}`;
            }

            rows.push({ name: up.name, status });

            logAction('auto explain', up.name, { status });
        }

        if (window.console && console.table) console.table(rows);

        return `${store.length} store upgrades, ${known} recognised. Decision now: ${
            decision.buy
                ? 'buy ' + decision.buy.name
                : decision.save
                  ? 'save for ' + decision.save.name
                  : decision.note || 'nothing'
        }. Details in the log (action "auto explain").`;
    }

    /**
     * Show a status line in the Debug tools panel.
     * @param {string} text
     * @param {boolean} ok
     * @req DBG-8
     */
    function setDebugStatus(text, ok) {
        const el =
            document.getElementById(
                'ccsb-debug-status'
            );

        if (!el) return;

        el.textContent = text;

        el.classList.toggle('err', !ok);
    }

    /**
     * Run one debug tool by index, log it ('debug tool') and show its status.
     * @param {number} i
     * @req DBG-8
     */
    function runDebugTool(i) {
        const tool = DEBUG_TOOLS[i];

        if (!tool) return;

        let ok = true;
        let msg = '';

        try {
            msg = tool.run();
        } catch (e) {
            ok = false;

            msg = String(
                e && e.message
                    ? e.message
                    : e
            );
        }

        logAction(
            'debug tool',
            tool.label,
            ok ? undefined : { error: msg }
        );

        setDebugStatus(
            ok ? msg : `failed: ${msg}`,
            ok
        );
    }

    /**
     * Show/hide the Debug tools window.
     * @req UI-8
     */
    function toggleDebug() {
        debugPanel.style.display =
            debugPanel.style.display ===
            'block'
                ? 'none'
                : 'block';
    }

    /**
     * Show/hide the log window (renders the table on open).
     * @req UI-6
     */
    function toggleLogs() {
        const showing =
            logPanel.style.display ===
            'block';

        logPanel.style.display =
            showing
                ? 'none'
                : 'block';

        if (!showing) {
            renderLogBrowser();
        }
    }

    /**
     * Escape text for safe use in innerHTML.
     * @param {*} s
     * @returns {string}
     */
    function escapeHtml(s) {
        return String(
            s == null ? '' : s
        )
            .replace(
                /&/g,
                '&amp;'
            )
            .replace(
                /</g,
                '&lt;'
            )
            .replace(
                />/g,
                '&gt;'
            )
            .replace(
                /"/g,
                '&quot;'
            )
            .replace(
                /'/g,
                '&#039;'
            );
    }

    /**
     * Refresh the HUD every 200 ms: Mood (+ hurry note), Chasing, Shinies waiting, Click Frenzy, Buffies,
     * Grimoire (mana, cost, lumps, refill state), LOCK_A, Click cooldown, statistics, button labels.
     * @req UI-2, UI-3, HURRY-2
     */
    function updatePanel() {
        if (
            !panel ||
            !window.Game
        ) {
            return;
        }

        const shimmers =
            getGoldenShimmers();

        const queue =
            buildGoldenQueue(
                shimmers.good
            );

        const buffs =
            positiveCpsBuffs();

        const M =
            getGrimoire();

        const cost =
            getFthofCost(M);

        const cooldown =
            Math.max(
                0,
                getClickDelayMs() -
                    (Date.now() -
                        runtime.lastClickAt)
            );

        panel.classList.toggle(
            'paused',
            !runtime.running
        );

        document.getElementById(
            'ccsb-state'
        ).textContent =
            runtime.running
                ? moodText(
                      runtime.currentAction
                  ) +
                  (urgencyFactor() < 1
                      ? ` [storm/chain: hurry x${urgencyFactor()}]`
                      : '')
                : 'paused (napping) zzz';

        document.getElementById(
            'ccsb-target'
        ).textContent =
            targetText(
                runtime.currentTarget
            );

        document.getElementById(
            'ccsb-queue'
        ).textContent =
            `${queue.length} ready / ${shimmers.pending.length} fading in / ${shimmers.wrath.length} yucky (wrath)`;

        document.getElementById(
            'ccsb-cf'
        ).textContent =
            clickFrenzyActive()
                ? 'ON (shinies still come first :3)'
                : 'off';

        document.getElementById(
            'ccsb-buffs'
        ).textContent =
            buffs.length
                ? buffs
                      .map(
                          b =>
                              `${b.name} x${formatNum(
                                  b.mult
                              )}`
                      )
                      .join(', ')
                : 'none yet';

        document.getElementById(
            'ccsb-magic'
        ).textContent =
            M
                ? `${formatNum(
                      M.magic
                  )} / ${formatNum(
                      M.magicM
                  )}; FTHOF ${formatNum(
                      cost
                  )}; lumps ${formatNum(
                      Game.lumps
                  )}; refill ${
                      Game.canRefillLump &&
                      Game.canRefillLump()
                          ? 'ready'
                          : 'cooldown'
                  }`
                : 'unavailable';

        document.getElementById(
            'ccsb-lock'
        ).textContent =
            runtime.lockA
                ? 'LOCKED'
                : 'OPEN';

        document.getElementById(
            'ccsb-cooldown'
        ).textContent =
            cooldown > 0
                ? `${Math.ceil(
                      cooldown
                  )} ms`
                : 'ready :3';

        document.getElementById(
            'ccsb-pause'
        ).textContent =
            runtime.running
                ? 'Pause :3'
                : 'Resume :3';

        if (data.config.autoPlay === true) {
            autoEvaluate(false);
        }

        document.getElementById(
            'ccsb-auto'
        ).textContent =
            autoStatusText();

        document.getElementById(
            'ccsb-bg'
        ).textContent =
            backgroundStatusText();

        const autoBtn =
            document.getElementById(
                'ccsb-auto-toggle'
            );

        autoBtn.textContent =
            data.config.autoPlay === true
                ? 'Auto play ON ^w^'
                : 'Auto play :3';

        autoBtn.classList.toggle(
            'active',
            data.config.autoPlay === true
        );

        const hammerBtn =
            document.getElementById(
                'ccsb-hammer'
            );

        hammerBtn.textContent =
            runtime.hammer
                ? 'Hammer ON ^w^'
                : 'Hammer cookie :3';

        hammerBtn.classList.toggle(
            'active',
            runtime.hammer
        );

        const stats =
            document.getElementById(
                'ccsb-stats'
            );

        const kinds =
            Object.entries(
                data.stats.byKind
            ).sort(
                (a, b) =>
                    b[1] - a[1]
            );

        stats.innerHTML = [
            `<span>Golden cookies :3</span><b>${data.stats.totalGolden}</b>`,
            ...kinds.map(
                ([kind, count]) =>
                    `<span style="padding-left:8px;color:#e7c6ff">${escapeHtml(
                        kind
                    )}</span><span>${count}</span>`
            ),
            `<span>FTHOF casts ^w^</span><b>${data.stats.fthofCasts}</b>`,
            `<span>Grimoire refills :3</span><b>${data.stats.grimoireRefills}</b>`,
            ...(data.config.autoPlay === true
                ? [
                      `<span>Auto purchases ^w^</span><b>${data.stats.autoBuys || 0}</b>`
                  ]
                : [])
        ].join('');
    }

    /**
     * Display-only cute wording for the internal action names (the names themselves stay untouched).
     * @param {string} action
     * @returns {string}
     * @req NFR-5
     */
    function moodText(action) {
        const map = {
            idle: 'idle :3 waiting for shinies',
            'idle-play': 'playing around :3',
            hammer: 'hammering the cookie owo',
            'auto-shop': 'shopping ^w^',
            'happy-dance': 'happy dance ^w^',
            'bored-click':
                'bored, poking the cookie owo',
            'golden-cookie': 'grabbing a shiny ^w^',
            'click-frenzy': 'click frenzy zoomies :3',
            fthof: 'casting FTHOF ^w^',
            'grimoire-refill':
                'refilling the grimoire :3'
        };

        return map[action] || action;
    }

    /**
     * Display wording for the current target.
     * @param {string} target
     * @returns {string}
     */
    function targetText(target) {
        const map = {
            none: 'nothing yet',
            'good golden cookie':
                'a good golden cookie',
            'big cookie': 'the big cookie'
        };

        return map[target] || target;
    }

    /**
     * Format a number for the HUD (thousands separators, one decimal for small values).
     * @param {*} n
     * @returns {string}
     */
    function formatNum(n) {
        n = Number(n);

        if (!Number.isFinite(n)) {
            return '—';
        }

        if (
            Math.abs(n) >= 1000
        ) {
            return Math.round(
                n
            ).toLocaleString();
        }

        return (
            Math.round(n * 10) /
            10
        ).toString();
    }

    // ============================================================================
    // SECTION 13 - Overlay and paw cursor rendering
    // ============================================================================

    /**
     * Size the overlay canvas to the window (device-pixel aware).
     * @req PAW-1
     */
    function resizeOverlay() {
        if (!overlayCanvas) {
            return;
        }

        const dpr =
            window.devicePixelRatio ||
            1;

        overlayCanvas.width =
            Math.max(
                1,
                Math.floor(
                    window.innerWidth *
                        dpr
                )
            );

        overlayCanvas.height =
            Math.max(
                1,
                Math.floor(
                    window.innerHeight *
                        dpr
                )
            );

        overlayCanvas.style.width =
            `${window.innerWidth}px`;

        overlayCanvas.style.height =
            `${window.innerHeight}px`;

        overlayCtx.setTransform(
            dpr,
            0,
            0,
            dpr,
            0,
            0
        );
    }

    /**
     * Per-frame overlay drawing (requestAnimationFrame): planned route (dashed pink), ready cookies
     * (pink numbered boxes), pending cookies (dashed lavender + fade %), wrath cookies (dashed red),
     * a ring on the big cookie during Click Frenzy, the real Grimoire buttons, and finally the paw.
     * Does nothing but clear when 'Pretty overlays' is off.
     * @req GC-2, GC-5, PAW-1, PAW-5
     */
    function drawOverlay() {
        runtime.drawRaf =
            requestAnimationFrame(
                drawOverlay
            );

        if (
            !overlayCtx ||
            !overlayCanvas
        ) {
            return;
        }

        const ctx = overlayCtx;

        ctx.clearRect(
            0,
            0,
            window.innerWidth,
            window.innerHeight
        );

        if (
            !data.config.visuals
        ) {
            return;
        }

        const shimmers =
            getGoldenShimmers();

        const queue =
            buildGoldenQueue(
                shimmers.good
            );

        // Planned route in pink.
        if (queue.length) {
            ctx.save();

            ctx.strokeStyle =
                'rgba(255,143,207,.85)';

            ctx.lineWidth = 1.6;

            ctx.setLineDash([
                6,
                5
            ]);

            ctx.beginPath();

            ctx.moveTo(
                runtime.cursor.x,
                runtime.cursor.y
            );

            for (
                const item of queue
            ) {
                ctx.lineTo(
                    item.pos.x,
                    item.pos.y
                );
            }

            ctx.stroke();
            ctx.restore();
        }

        // Good cookies:
        // pink hitboxes + numbers.
        queue.forEach(
            (item, index) => {
                const r =
                    visibleRect(
                        item.shimmer.l
                    );

                if (!r) return;

                drawRect(
                    ctx,
                    r,
                    'rgba(255,143,207,.98)',
                    2
                );

                ctx.save();

                ctx.font =
                    'bold 18px Consolas, monospace';

                ctx.textAlign =
                    'center';

                ctx.textBaseline =
                    'middle';

                ctx.lineWidth = 4;

                ctx.strokeStyle =
                    'rgba(60,20,80,.9)';

                ctx.strokeText(
                    String(index),
                    r.left +
                        r.width / 2,
                    r.top - 10
                );

                ctx.fillStyle =
                    'rgb(255,143,207)';

                ctx.fillText(
                    String(index),
                    r.left +
                        r.width / 2,
                    r.top - 10
                );

                ctx.restore();
            }
        );

        // Golden cookies still fading in: highlighted at once, but not
        // queued (and never clicked) until they pass the threshold.
        for (const item of shimmers.pending) {
            const r = looseRect(
                item.shimmer.l,
                34
            );

            if (!r) continue;

            drawRect(
                ctx,
                r,
                'rgba(196,170,255,.95)',
                2,
                [3, 3]
            );

            const label =
                Math.round(
                    item.curve * 100
                ) + '%';

            ctx.save();

            ctx.font =
                'bold 12px Consolas, monospace';

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3;

            ctx.strokeStyle =
                'rgba(60,20,80,.9)';

            ctx.strokeText(
                label,
                r.left + r.width / 2,
                r.top - 8
            );

            ctx.fillStyle =
                'rgb(196,170,255)';

            ctx.fillText(
                label,
                r.left + r.width / 2,
                r.top - 8
            );

            ctx.restore();
        }

        // Wrath cookies:
        // red + dashed, never clicked.
        for (
            const shimmer of
            shimmers.wrath
        ) {
            const r = looseRect(
                shimmer.l,
                34
            );

            if (r) {
                drawRect(
                    ctx,
                    r,
                    'rgba(255,70,70,.95)',
                    2,
                    [6, 4]
                );
            }
        }

        // Big cookie:
        // baby blue during Click Frenzy.
        if (clickFrenzyActive()) {
            const big =
                document.getElementById(
                    'bigCookie'
                );

            const r =
                visibleRect(big);

            if (r) {
                ctx.save();

                ctx.strokeStyle =
                    'rgba(150,215,255,.98)';

                ctx.lineWidth = 2;

                ctx.beginPath();

                ctx.arc(
                    r.left +
                        r.width / 2,
                    r.top +
                        r.height / 2,
                    Math.min(
                        r.width,
                        r.height
                    ) / 2,
                    0,
                    Math.PI * 2
                );

                ctx.stroke();
                ctx.restore();
            }
        }

        // Real Grimoire controls:
        // baby blue.
        const M =
            getGrimoire();

        if (M) {
            const spell =
                getFthofSpell(M);

            const f = spell
                ? visibleRect(
                      document.getElementById(
                          `grimoireSpell${spell.id}`
                      )
                  )
                : null;

            const refill =
                visibleRect(
                    document.getElementById(
                        'grimoireLumpRefill'
                    )
                );

            if (f) {
                drawRect(
                    ctx,
                    f,
                    'rgba(150,215,255,.98)',
                    2
                );
            }

            if (refill) {
                drawRect(
                    ctx,
                    refill,
                    'rgba(150,215,255,.98)',
                    2
                );
            }
        }

        // "How good is a buy" bounding box on every purchase option, on by default, works without
        // auto play: colour = how good it is RELATIVE TO THE OTHERS on offer right now (red = worst
        // payback on offer, green = best), so it re-ranks itself as the store changes.
        if (data.config.showBuyValue !== false) {
            const snap = buyValueSnapshot();

            if (snap && snap.decision.rows.length) {
                // Ranked on a LOG scale: paybacks span orders of magnitude (seconds to
                // days), and a single very bad option would otherwise squash every
                // other option into looking equally "best" on a linear scale.
                const logPaybacks = snap.decision.rows.map(row =>
                    Math.log(Math.max(row.payback, 0.001))
                );

                const best = Math.min(...logPaybacks);
                const worst = Math.max(...logPaybacks);
                const span = worst - best;

                for (const row of snap.decision.rows) {
                    const el = autoStoreElement(row.c);
                    const r = el ? visibleRect(el) : null;

                    if (!r) continue;

                    // 0 = worst on offer, 1 = best on offer (lower payback is better)
                    const rank =
                        span > 0
                            ? clamp(
                                  (worst -
                                      Math.log(
                                          Math.max(row.payback, 0.001)
                                      )) /
                                      span,
                                  0,
                                  1
                              )
                            : 1;

                    const color = buyRankColor(rank);

                    drawRect(
                        ctx,
                        r,
                        color,
                        1.6,
                        [4, 3]
                    );

                    // Score 0 (worst on offer) to 100 (best on offer), centred IN the box so it can
                    // never overlap a neighbour's number the way a label floating above it could.
                    const score = Math.round(rank * 100);

                    ctx.save();

                    ctx.font =
                        'bold 12px Consolas, monospace';

                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.lineWidth = 3;

                    ctx.strokeStyle =
                        'rgba(40,15,55,.9)';

                    ctx.strokeText(
                        String(score),
                        r.left + r.width / 2,
                        r.top + r.height / 2
                    );

                    ctx.fillStyle = color;

                    ctx.fillText(
                        String(score),
                        r.left + r.width / 2,
                        r.top + r.height / 2
                    );

                    ctx.restore();
                }
            }
        }

        updateCursorLean();

        drawVirtualCursor(
            ctx,
            runtime.cursor.x,
            runtime.cursor.y
        );
    }

    /**
     * Stroke a rectangle outline (optionally dashed) around an element.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Object} r - rect
     * @param {string} color
     * @param {number} [width]
     * @param {number[]} [dash]
     * @req GC-2
     */
    function drawRect(
        ctx,
        r,
        color,
        width,
        dash
    ) {
        ctx.save();

        ctx.strokeStyle = color;
        ctx.lineWidth = width || 2;

        if (dash) {
            ctx.setLineDash(dash);
        }

        ctx.strokeRect(
            Math.round(r.left) - 2,
            Math.round(r.top) - 2,
            Math.round(r.width) + 4,
            Math.round(r.height) + 4
        );

        ctx.restore();
    }

    /**
     * Open paw sprite (SVG, optimized from the supplied artwork, cropped to its content). It is drawn once
     * into an offscreen canvas MIRRORED so it faces left like a normal cursor; that canvas is stamped every
     * frame (cheap). If it cannot be loaded, drawFallbackPaw() is used instead.
     * @req PAW-2
     */
    const PAW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" style="shape-rendering:geometricPrecision;text-rendering:geometricPrecision;image-rendering:optimizeQuality;fill-rule:evenodd;clip-rule:evenodd" width="892" height="1247" viewBox="20 33 892 1247"><path fill="#51433a" stroke="#51433a" stroke-width=".5" d="M373.7 106.7c6 18 3.8 40.7 12.3 57.2l3.6 2.7q.3-.5.3-1 0-10.1.3-20.1 0-1 1-1.5a139 139 0 0 0 17.1 77c11.4 20.5 35.6 43 58.5 23.5q.6-.2.9.3a322 322 0 0 1-4.5 95c-3.4 5.7-4.7 6.7-11.4 6.9-15 4.8-27.2-3-40.9 9.7q-.9.7-.3 1.5c2.8.5 13.6-4 17.1-4.5 6.4-.6 14.8.1 20.9-1.2 2.6 1.2 10 6 11.3 8.4 7.4 28.5 6.4 89 1 118q0 4.7-.2 9.2 8 2 16.3 2.7c3-.1 13.8 5.6 12.7-.9-.7-1.7-17.2-7.8-20-8.8q-.5-.3-.2-.9 7.7-10.2 13.1-21.9c14.6-32 30.6-63 46.8-94 19-40.9 26.4-92.9 35.8-137 .6-.4 1-1.2 1.8-.4q-.6 4.1-.2 8.2c5.6 14.5 7.2 37.1 8 52.4-3.5 13.7 0 22.5 1.3 36 .2 2.2-2.2 3.4.7 4.5 2.9.8 1.5 1 3.8-1q2-.6 3.7-1.9l4.3-4.4q.3.4.2 1c-.6 5.1-3.2 14.1-2.1 18.9 0 1.7-2.2 4.2.8 4.8 3.1.4 3.2 0 4-2.8a92 92 0 0 1 8.3-6.6q3.8-2.4 6 1.3c3.2 6.3 3.8 12.4 11.3 15.2q-5.4 10.3-10.1 21c-1-.1-1.7 3-2.5 3.7-.3 1.3 0 3.2-2.2 2.3-7.5-7.3-14.5-17.3-26.3-15.6-1 0-6.2 3-4.3 4.1 16.8.8 18.7 6.7 31.3 15.8q.4.3.6.9l-2.3 10.4a576 576 0 0 1-19.6 93.4c-1.5 5.8-3.5 21.6-6.2 26l-2.2 2.3a8 8 0 0 0 3.8 4.7c12.2 7.5 24.6 15.8 36.8 23.3 1.4 1 2.6-.1 1.3-1.2-4-3.4-30.6-23.6-31-26-1.6-11.6 0-12.6 7-21.8 25-32.6 49.4-63.5 66.5-101.3 27.4-60.3 53.2-125 69.7-189.4 4-9.7 10.9-30.6 21.4-34.4 13-4.6 29 1.6 39.3 10q2 1.5-.5 1.9c-62 1.3-73.1 128.2-24 156.6l6 2.9c1.3 24-22.5 64.4-36.3 84q0 1.2.2 2.2l-3 2-.2 1.8c-9.3 2.9-11.7-2.8-19.9-4.7q-2.2 0-.7 1.7c4.5 4.3 9.7 7.5 14.4 11.5q1.7 1.4 1 3.5a227 227 0 0 1-10.8 30c-13.2 35-31.5 58.2-56.6 85.3-1.3 1.8-4 6-3.5 8.2 6.3 7 8.9 13.8 12.3 22.5q-.4.7-.4 1.7c1.8 8 1.9 16 2.6 24.2 1.1 8.9 4 18 6.5 26.7q3.4 8.4 8.2 16.2 0 .8-.4 1.4-2 .6-1.6 2.6l.2 32.7c-2.3 52.8-27 104.4-50.8 150.8-.6-.4-.8-2.9-1.8-1.4a87 87 0 0 1-20.8 18.5q-1.2-.5-1.1-1.7c1.8-5.4 4-10.2 3-16q-2.3-9-8.1-16.2a6 6 0 0 1-.2-2.5c63.6-64.7 79-173.5 11.9-242-65-70.8-150.8-100.9-230-30.6a149 149 0 0 1-37.4 29.6c-2.6 1.2-5.9-6.2-6.4-8.1-2.6-11.5 4.3-18.8 8.7-28.5l5.2-13.9q.6-.3 1.2 0c10.2 5.8 22.7 9.4 32.6 14.7q2-.3.5-1.6-4.5-3.5-9.5-6.3a850 850 0 0 0-24.2-9.8c4.9-28.8 5.1-58.6 8.9-87.6 7.2-55.4 18-112.2 15-168.2q-3.9-63-18.8-124.5c-3-17.4.2-31.9 14.2-43.3ZM409.9 315c2.3 18.4 22.3-4.9 31.3 1.8 4.6 3.5 9.2 10.8 15.9 8 4.6-5 3.3-29 1.4-35.2-4.7-7-6.9-20.3-10.5-26-3-5.2-7.4-3.5-9.9 1-3.4 12.2-5.6 13.6-14.4 22.6-5.6 8-12.7 17.9-13.8 27.8Zm311 61c.6 7.4 7 12.7 14.3 11.7 17-6.9 15.6-56.1 3.4-57.9-15.6 2-15.6 34.8-17.7 46.3Zm-312 1c.8 5.1 5 9.5 6.1 14.8 2 11.2 2.2 59 22.2 53.7q3.3-1.3 6.2-3.3c1.6 3.2 3 7 7.4 5 10.4-7.2 5.4-55 2.5-67-.3-18.9-2.3-25.2-23.6-24.6-6.7 0-19.2 15.4-20.7 21.3Zm126.4 71.3c.6 9.8 7.2 13.7 16.1 15q1.4 1.5 2.7 3.2c11.3 11 26.8-24.7 31.2-31.5 2-7.7-.6-20.8-.7-29.1-.5-9.2-5.9-13-11-19.7-2.9-5.8-3.3-13.6-10.2-16.2-5-.4-10 17.8-11.4 21.7-9.9 17.5-11.7 37.3-16.7 56.6ZM646.7 490a58 58 0 0 0 7.2 19.7c3.8 4.3 6.3.5 9.7-1.3q.4.5.2 1.1c-2.6 4.6-3.2 12.6 3.7 13.4 15.3-2 28.8-44.8 33.1-57.9 3.5-8.6 13.3-17.7 4.7-26.7-2.8-3.2-20.6 1.4-23.5 4-9 11.5-31.6 34.6-35.1 47.7ZM403 510.9a81 81 0 0 0 18.8-9.5c1.9-1.2 0-2-1.4-1.7a27 27 0 0 0-17.4 11.2Zm128.2-6.9c1 2.3 11.2 8.6 11.8 3.5-.2-2.6-11-7.8-11.8-3.5Zm303.9 19c-.5 15.6 1 38.3 12.3 50.1q.4.9-.4 1.5c-14.7 14.7-33 23.1-51.9 31-13.3 1-18.6-7.4-26.2-16.6 6.6-2.2 11.5 3.5 13.3 3a9 9 0 0 1 2.1-4q1.6-1.9 3.9-2.2c3.4.3 1 5.5 3 5q8-2.6 15.5-6.6c2-.5-.6 1.7 1.5 1.6q4-.8 8.1-2c13-5.1 12.2-11.7 7.2-22.1-.7-3.1 10-38 11.6-38.7ZM629 556q0 .6.4.9c3 .7 8.8 8.2 11.6 5.5 1-3.3-8.7-8.3-12-6.4Zm138.3 39.7a56 56 0 0 1 7.3 16.9c1 4.1-1.7 5.5-4.5 7.8 2.9-8-7.4-7.6-11.7-3.6-11.3 9.1-22.3 18.6-34.2 26.9-3.4 3.5-2.5 7.6 2 9.5l-2.1 1.9c-12.5-1.9-8.3-9-2.5-15.8l3-1.7q-1.2 1.3-3 1.3c-8.6-2.9-34.2 4.5-35.4-8.6-.7-5.6 0-11.5-1.3-16.9q.4-2.4 2.2-.6 1 1.4.2 2.7.8-.7 1.4-1.7c2.3-4 4.4-11 9.1-12.7a2 2 0 0 1 2 0v1.3c-2.2 4.8-6.7 14-7.3 18.9-3.6 4.4-5 13 3 13 6.5.8 15.5-2.2 22-3.3q5.7-.6 11.6-.9c7.2-.7 11-8.2 15.7-12.8 6.9-7.1 14.3-13 22-19.2z"/><path fill="#574940" stroke="#574940" stroke-width=".5" d="M114.9 348.8c-3.4 8.8-.4 28.2 11.7 28.6 5.1-.4 6.1-12.5 6.6-16.2q1-1 2.3-1c-6.4 36.8 18.8 79.2 53.7 92.3q-.7 4.4 2 8c13.3 21.8 21.3 16.4 44.6 16.8 29.6-3.4 5-30.8.1-31.4q9.9-9.6 12.8-23 .3-1 1.2-.3 17.4 32.6 22.4 69.3l-.7 2.8-3.6-2q-11.7-4.5-23.6-.8-1.4.3-.8 1.5-.6 2-2.6 1.6c.8-2.6-11-1.2-12.4-.8q-1.6.3-2.3 1.8c-19.6 7.2-25.6 14.3-28.5 34.6q-3.3 1.3-6.5 3.3c-6.4 3.6-10 11.1-13.6 17.2-13.4-47.2-26.6-100-52-142.4-5.1-9-32-44-21.2-52.8q4.9-4 10.4-7.1ZM835.2 523a199 199 0 0 0-11.6 38.7c5 10.4 5.9 17-7.2 22.1q-4 1.2-8 2c-2.2.1.4-2-1.6-1.6q-7.5 4-15.5 6.7c-2 .4.4-4.8-3-5q-2.2.3-3.9 2a9 9 0 0 0-2.1 4c-1.8.6-6.7-5.1-13.3-3-.8-.8-2.5-4.6-3.5-4.7q-.9 2-2.2 3.6c-.1 2.5 2.7 5.9 4 8q0 1.2-.4 2.4c-7.7 6.2-15.1 12-22 19.2-4.7 4.6-8.5 12.2-15.7 12.8q-6 .3-11.7.9c-6.4 1.1-15.4 4-21.8 3.3-8 0-6.7-8.6-3.1-13 .6-4.9 5.1-14.1 7.4-18.9v-1.2c5.3-7.8 14-10 19.7-16.4.3-1.9-1.6-.9 1.2-2.3 5.9-6.1 10.2-13.5 15-20.4 4.8-7.3 10.9-8.4 18.9-10.2 6.8-2.4 15.6-7.1 18.3-14.3 2.2-7.5 2-14.2 8-20 3.4-3.5 11.5-6.3 11.8-11.7l-1-3.1q15-13.5 28.9-28.5c4.4-5 28-33.8 29.2-37q1.1-.7 2-1.9l5.5-7.5 4.5-4.9c15.3-15.4 29.7-7 36.5 10.9q1.6 4 2.4 8.4-.3.6-1 .4c-15.5-7.5-31.5 7.9-40.7 19q-21 27-24 61.2Zm-576-39.2q4.5 1 7.2-2.8c1.4-3.7-2.6-3-4.4-1.4q-1.7 1.9-2.8 4.2ZM316.8 624c-31.1 13.4-8.7 62.2 3.3 82.5 15.4 25.6 39.4 48.2 70.9 48.9 2.2-.6 1.8-.8.5-1.7 3.6-3.6 7-4 11.9-3.7a3 3 0 0 0 1.3 2.2q-.4 1.2-1 2.3c-2.6 13.8-9.1 21.6-23 24q-3.5 1.7-5.3 5c-1.6-.6-1.2 1.8-2.6 2.4a7 7 0 0 1-7 1l-1.7.7q-9.1-5.5-18.4-10.8c-6-4.3-18-10.2-14-19.3-.9-1.1-4 .2-5.2.1-20.6 0-41.9-47.2-52-62.5-6.8-13.8-19.4-34.8-23.4-48.8-2.8-10 15-12.5 20.8-17 10.8-4.2 28.3-30 33-38.9a55 55 0 0 1 41-.9q.7.1 1 .9-4.2 1.4-8.1 3c-12.9 5.8-18.8 17.5-22 30.6Zm453.4-3.5c-14.5 10.8-30.5 20.7-44 32.8-4.4-2-5.3-6-2-9.5 12-8.3 23-17.8 34.3-27 4.3-4 14.6-4.4 11.7 3.7ZM418 856.8c4.1-8.7 13.4-10 21.2-14.3q3.8-2.1 7.3-4.6c9.6 9.4 18.5 20.8 28 30.7 3.2 6.2-1.7 6.7-5 9.6l-.9.2c-14.3-9.3-39-11.4-50.6-21.6Zm136.3 54.1c4.2 11.6-19.4 33.1-28 39.4-1.6-.7 0-3-.4-4.3-1.7-4.3-.8-1.2-3.5-2.4 10.6-8 4.9-18.7-6.7-20.2l-2 .4c-2.5-1 4.4-3 2-5.4l.2-1.7c-.6-.9-2.3-1-.8-2.2 7.2-7 16-11 26-8 2.7.3 11.6 4.3 13.2 4.4Z"/><path fill="#54453b" stroke="#54453b" stroke-width=".5" d="M272.3 491.9c4.5 32 6.7 54.5 27.7 80.6q1-.4 2.4-.3a50 50 0 0 0 9.5 6.4q-6.9 2.8-13.2 6.6c-2.2 1.5-16.5 12.5-8.3 13.7q7.1-4.5 14.4-8.5c-4.6 8.9-22.1 34.7-32.9 39-5.7 4.4-23.6 7-20.8 17 4 13.9 16.6 34.9 23.3 48.7 10.2 15.3 31.5 62.5 52.1 62.5 1.2 0 4.3-1.3 5.1-.1-3.9 9 8.1 15 14 19.3q9.4 5.2 18.5 10.8l1.6-.6q4 1.2 7-1c1.5-.7 1-3.1 2.7-2.5q1.8-3.3 5.2-5c14-2.4 20.5-10.2 23-24q.8-1.1 1-2.3a3 3 0 0 1-1.2-2.2c-5-.3-8.3 0-11.9 3.7 1.3.9 1.7 1.1-.5 1.7-31.5-.7-55.5-23.3-70.8-48.9-12.1-20.3-34.5-69-3.4-82.5-6.8 35.6 11.7 72.5 40.9 92.8 25.5 17.7 57.8 17.5 74.8-11.1q.3-1.3.9-2.5.7 1 .6 2.2-.8 16.2-4 32l-2 1.2q-.5 1.8.3 3.6 5.8 5.7 10.6 12.2c19.5 26 13.8 67.2 42.3 85l.3 7.1c-.2 5.6-1.5 12.2 3 16.6 6 5.6 11.2 10.7 14.7 18.2l1.4 1.3c-.4.2-2.3 1.5-2.7 1q-.5 1.5.2 3.1c6.5 13.4 19.6 11.5 32.3 11.7q.6.3.8 1.1c-8.8 5-24.2.9-34.1 1l-12.6-1.5c-1.1.1-3.7-.4-4.5.5q5.8 1.7 12 2.5c11.5 2.2 21.4 3.9 33.3 2.8 9.7-1.5 23-4.5 29 6.1-1.7-.1-10.5-4.1-13.3-4.4-10-3-18.8 1-26 8-1.5 1.1.2 1.3.8 2.2q0 1-.3 1.7c2.5 2.3-4.4 4.4-1.9 5.4l2-.4c11.6 1.5 17.3 12.2 6.7 20.2 2.7 1.2 1.8-1.9 3.5 2.4.4 1.3-1.2 3.6.5 4.3-26.3 15.7-46.6 31.3-62.1 58.4-33.4 55.7-68.5 110.2-102.4 165.6-39.2 62-87.8 102.1-165 97.3-89.8-7.2-147-85.2-164-167.8-10.1-37.1 1-92.2 35.4-113.5l7.8-3c19.3-4.8 43.9-4.2 64-6.7 63.2-5.7 110.4-43.1 135.7-100.4a93 93 0 0 1 19.2-34.8c12.3-12.5 24.8-5.1 39.2-2.7a171 171 0 0 0 36.7 20c.9 1.5 23.6 7 18.3 2.8-20.5-10-46.4-17.9-62.7-34.2q-19.6-25.6-38.6-51.6a51 51 0 0 1-5.7-10.3q-1.2-.8-2.7-1.4c-17.6-22-34.9-45.1-52.5-67.3a181 181 0 0 1-28.3-48.8c-6.3-33.8-12.7-67.3-21-100.8 3.7-6 7.3-13.6 13.7-17.2q3.1-2.1 6.5-3.3c2.9-20.3 9-27.4 28.5-34.6 3.4 3.1 11 .7 14.7-1q2 .3 2.6-1.6-.6-1.2.8-1.5 12-3.7 23.6.7l3.6 2zm-58 65.4c.6 4.7 2.8 9.3 2 14.1-2.4 11-2.4 10.4 5.8 17q.5.5 1 .2 4.2-5.2 8.3-10.8a183 183 0 0 1 33.8-27.1c10.8-7.3 6.7-25.6-8-21q-6 2.3-11.9 5c-.9.5-2.6.4-2-1a9 9 0 0 0 1-4.6l-1.9-2q-1.5.3-3.1 0c-10.1.8-23.5 21.3-25 30.2ZM418 856.8c11.6 10.2 36.3 12.3 50.6 21.6l1-.1c3.2-3 8-3.5 4.9-9.7-9.5-9.9-18.4-21.3-28-30.7a93 93 0 0 1-7.3 4.6c-7.8 4.2-17 5.6-21.2 14.3Z"/><path fill="#69594d" stroke="#69594d" stroke-width=".5" d="M434.3 297.1a46 46 0 0 1 9-23.1c.6-1.2-.3-1.6-.5-2.8a2 2 0 0 1 1.8.7 6 6 0 0 0-.7 2.2c3.6 4 2 11.7 4.7 16.7 2 4.6 6.2 8.2 8 12.8 3 7.2-3.8 15.1-11.2 11.5l-1.2-2.8c-5.4-4-9.9-7.7-9.9-15.2Zm286.6 79c2-11.5 2-44.4 17.7-46.3 12.2 1.8 13.6 51-3.4 58-7.3 1-13.7-4.4-14.3-11.7Zm-301-10c3.2-.6 2.7-4.6 5.7-6.1 10.5-6.4 23.6-1.7 24.8 11.4 0 6 2.3 16.5.6 22q-.8 1.3-1.3 2.8.9 1.5 1.2 3.1-.9 1-2 .2-.3-1-.2-2.3c-8.7-6.5-4.3-18.9-15-24.3-3.6-2-8.9-2-11.1-5.8a6 6 0 0 1-2.8-1ZM548.7 409c.8-6.8 6-19.8 10.9-24.6a17 17 0 0 0 3.7-2.8c2 .6 1.5 1.2 1.7 2.9 10 15.5 22.3 15.5 17.7 38.5-2.7 11-8.8 30.5-19.2 36.5q-1.4-8.7-2.4-17.5c-1.5-8.7-5.1-16.6-4.5-25.6q-1.8-.6-3.8-.7a7 7 0 0 1-4-6.8ZM669 489a60 60 0 0 1 10.6-25.5c-1.7-4.4 6.6-9.4 10.8-8 9.8 10.6-4.9 37.2-16 42.6-2.6 1.3-5.5-7.3-5.4-9.2Z"/><path fill="#020101" stroke="#020101" stroke-width=".5" d="m849 437 1 .3a531 531 0 0 1-29.2 37q-13.7 15-29 28.6C761 531 721.5 564 681.3 576.7q-6.2 1.2-12.5 1.5-.6.3-.3.9c4.5 11.4 7.3 22.9 10.2 34.8q.9 2.9.7 5.8-1.2 0-1.6-1c-2.7-10.2-7.5-19.1-11.2-29-3.4-8.6-6-15.4-12.3-22.4-.5-2.2 2.2-6.4 3.6-8.2 25-27.1 43.3-50.3 56.5-85.3q6.5-14.7 10.8-30 .8-2.1-1-3.5c-4.7-4-10-7.2-14.4-11.5q-1.5-1.7.7-1.7c8.2 2 10.7 7.6 20 4.7l.2-1.8 2.9-2q-.3-1-.2-2.1c13.8-19.7 37.6-60 36.4-84.1l-6-2.9c-49.2-28.4-38.2-155.3 24-156.6q2.3-.4.4-2c-10.2-8.3-26.3-14.5-39.3-9.9-10.5 3.8-17.3 24.7-21.4 34.4-16.5 64.3-42.3 129-69.7 189.4-17 37.8-41.5 68.7-66.6 101.3-6.9 9.2-8.5 10.2-6.8 21.9.3 2.3 26.8 22.6 30.9 26 1.3 1 0 2.1-1.3 1-12.1-7.4-24.6-15.7-36.7-23.2a8 8 0 0 1-3.9-4.7l2.2-2.3c2.8-4.4 4.7-20.2 6.3-26 9-31.2 15.7-61 19.6-93.4l2.2-10.4a1 1 0 0 0-.6-1c-12.5-9-14.5-14.9-31.3-15.7-2-1 3.3-4.2 4.3-4.1 11.8-1.7 18.8 8.4 26.3 15.6.1.6 1.8 3.3 2.5 2.1q1.7-3.2 2.7-6.8-.4-.6-.5-1.3 4.6-10.7 10.2-21c18-33.4 34.7-73.6 45.6-109.8.1-1.4 1.2-4-.4-5a51 51 0 0 1-21.4 8.3c-27.7 2-44-21.3-46.7-46.4A193 193 0 0 1 596 157c6.2-30.2 30-80.3 68.1-71.5q8.3 1.8 13.4 8.6l4.3 6.6c1.2-.5-.1-2.5-.3-3.4-19-49-61.5-34.7-87.7-1.2a81 81 0 0 0-10 22c-5.7 36.3-11 73-18.5 109-9.4 44-16.8 96-35.8 136.8a2018 2018 0 0 0-46.8 94.1q-5.4 11.7-13.1 22-.4.5.2.8c2.8 1 19.3 7.1 20 8.9 1.1 6.4-9.6.7-12.7.8q-8.3-.7-16.3-2.7.2-4.5.1-9.2c5.5-29 6.5-89.5-1-118a38 38 0 0 0-11.2-8.4c-6.1 1.3-14.5.6-20.9 1.2-3.5.6-14.3 5-17.1 4.5q-.6-.7.3-1.5c13.7-12.6 25.9-4.9 40.9-9.7 6.7-.2 8-1.2 11.4-6.9a322 322 0 0 0 4.5-95q-.3-.6-.9-.3c-23 19.5-47-3-58.5-23.4a139 139 0 0 1-17.2-77.1 88 88 0 0 1 10-34.4q4-7.5 11.3-11.7c1.5-1.2-1.4-1.6-2-1.5a48 48 0 0 0-36.7 10.3c-14 11.5-17.2 26-14.2 43.3q15 61.4 18.7 124.5c3 56-7.7 112.8-15 168.2-3.7 29-3.9 58.9-8.8 87.6a850 850 0 0 1 24.2 9.8q4.9 2.8 9.5 6.3 1.5 1.4-.4 1.6c-10-5.3-22.5-8.9-32.7-14.7q-.6-.3-1.2 0l-5.2 14c-4.4 9.6-11.3 16.9-8.7 28.4.6 1.9 3.8 9.3 6.4 8 15.5-8.5 25-17 37.3-29.5 79.3-70.3 165.2-40.2 230 30.7 67.3 68.4 51.8 177.2-11.8 242a103.5 103.5 0 0 1-120.6 12.6c-28.5-17.9-22.8-59-42.3-85q-4.9-6.6-10.6-12.3a6 6 0 0 1-.3-3.6l2-1.2q3.2-15.8 4-32 .1-1.2-.6-2.2-.6 1.2-.9 2.5c-17 28.6-49.3 28.8-74.8 11.1-29.2-20.3-47.7-57.2-41-92.8 3.3-13.1 9.2-24.8 22-30.6q4-1.7 8.2-3-.3-.7-1-.9c-14.3-4.9-27-5-41 1q-7.4 4-14.4 8.4c-8.3-1.2 6-12.2 8.2-13.7q6.3-3.8 13.2-6.6a36 36 0 0 1-9.5-6.4q-1.4 0-2.4.3c-21-26.1-23.2-48.7-27.7-80.6a204 204 0 0 0-22.4-69.3q-.9-.8-1.2.4-3 13.4-12.8 23c-13.1 11.4-30.8 12.3-46.7 6.5-35-13-60.1-55.5-53.7-92.3 1.9-7.9 6.2-16.9 14.2-20q1.8 0 3.3-.7-.6-.6-1.4-.5a78 78 0 0 0-47 16.9c-10.8 8.8 16 43.9 21 52.8 25.5 42.4 38.7 95.2 52 142.5a1733 1733 0 0 1 21 100.8 183 183 0 0 0 28.3 48.7c17.6 22.2 34.9 45.2 52.5 67.4q1.5.5 2.7 1.3 2.2 5.4 5.7 10.3 19 26 38.6 51.6c16.3 16.3 42.2 24.2 62.7 34.2 5.3 4.3-17.4-1.3-18.3-2.7-13-5.8-25.4-11.3-36.7-20-14.4-2.5-27-10-39.2 2.6a95 95 0 0 0-19.2 34.8C250.4 937.5 203.2 975 140 980.6c-20.1 2.5-44.7 1.9-64 6.7q-.5-.3-.7-.7 1.4-.4 2.3-1.5l3.9-.8c2.1-.4 1.8-2-.3-1.6-.1-1.2 6.3-.4 7.3-.9 21-4.7 43.5-2.7 65-6.9 69.3-11 114.8-64.2 130.3-130.5 3.1-16.7 4.1-49-1.4-64.4q-32.4-43.1-65-86c-9-14-19-27.7-21-44.7-11.4-36-16.5-73.3-26.5-109.7-12.3-41.5-23.6-84.3-44.4-122.6-8.2-14.8-18.9-28.4-25-44.3a234 234 0 0 0-27.3-40.3q-1.1-2.1-1-4.6 2.3-2 5.3-1.7c12.7.6 26 5.8 37 12 4 1.8 9.5 1 13.9.6a69 69 0 0 1 59.7 7.5c47.9 32.5 79.3 87 88.7 143.4 2.9 19.7 4.2 40.5 13.5 58.4 5.6 5.9 15.8 23.3 25.2 21.1 18-2 23.3-12.7 31-27.2 6-5 5-22 6.5-29.4 2-62 14.5-122.3 20-184 3.2-42-1-82.6-7.1-124-8.1-44.5-21.8-88.6 6.7-129.5 1.2-.6 3-3.5 4.3-1.7 1.9 6.9 1 13.2 4.4 20q1.1 2.7 3.7 2 11.4-4.4 23.5-3.2c51.7 6 70.8 58.6 68.3 104.4-1.2 15.3-3 32.5-7.5 47.2l3.5 25.8a288 288 0 0 1-4 66.9c-1 5.8-3.2 11-3.6 17.1 2 31.7 5.8 62 3.6 94-1.4 9-.5 18.6-3.6 27.2q0 1.8 1.3.4c8.9-16 17.5-30.6 24.7-47.5a15 15 0 0 0 2.8-4.1l2.5-7.3c1 1 1.2 2.4 2.3.2 8.7-18.5 19.4-36.2 28.9-54.3 17-35.3 18.5-77 29.5-114.5 13-45.1 13-94.5 25.1-140l1.3-3.2q.6.4 1.2 0c6-17.8 22.6-28.1 34.5-41.5q15.8-13.7 33.8-24.2 2.3-1 4.8-.8.3 1.8.2 3.6c-1.3 5.2-1 19.4 3 23 16.7 9.1 25.2 27.7 28.3 45.8l-1.1 1.3c0 1.2 1.9.3 2.5 1.2 5.8 28.2 6.2 52.6-1.2 80.5-3 13-9.3 21.7-14.9 32.8-13.4 22.3-18.2 49.1-27.9 73.3-9.6 23.2-20.5 50-35.7 70.1-2.2 6.1-5 18.2-6 25a431 431 0 0 1-19.2 94.9l-5.5 15.2q-.2 2 1.3.7 3.6-5.9 7.6-11.4c18-25 37-49 52.3-75.9 20.4-36.5 34.2-75.4 50-114 13.4-39 28-77.8 40-117.1 8.9-11.9 16.4-41.6 30-47.7q1.4-.6 2 .7c1.7 9.6.5 21 9 27.8a64 64 0 0 1 32.6 26.7c20.2 36.8 10.5 94.8-10.7 129.7a165 165 0 0 0-17.2 22.8c-8.5 20-15.7 40.7-25.7 60.1-5.5 11.2-13 20-20.4 29.6q-1.5 5.3-2.5 10.8a330 330 0 0 1-26.7 63c-10.6 18.3-25.8 34.1-37.3 51.9q-2.2 6.3 1.7 11.8c4.1 3.9 26.2-5.2 31-8 42.2-21.4 77.3-52.5 110.9-85.3 13.4-14.3 28.3-28.7 40.7-43.8ZM641.8 50.4l-8 5.5q-6.5 4.6-12.5 9.6.2.8 1 .7a106 106 0 0 1 14-4.5c5.5-.7 12.6-1 18 .1q.3 0 .4-.3-1.5-4.7-1.6-9.5-.1-3.8 1-7.5 0-.8-.6-1.3-6 3.3-11.7 7.2ZM367.4 89.8l-1 2q-.7 2-1.7 4a76 76 0 0 0-5.2 20.4q.6.8 1.3 0 3.8-6.5 9.5-11.5 4.3-3.6 9-6.8.8-1-.3-2l-2-4.9q-1.5-6-2.1-12.4-.8-.6-1.5.3a71 71 0 0 0-6 10.9Zm254 19a124 124 0 0 0-22.9 64c-1.8 27.2 3.3 66 37.5 68.6q5-.3 10-1c32.9-9.4 44.2-50 44.3-80.4 1.4-21.8-1.3-53.8-20-68.3-8.4-5.7-23.2-5-31.8.3a63 63 0 0 0-17 16.8Zm-219 8a73 73 0 0 0-4.3 13.2c-5 24-2.3 52.3 7.6 75 7.5 19 28 50.4 52.5 40.4q7-3.7 10.8-10.8c3.9-11 2.7-35.3 3.2-47.6a120 120 0 0 0-9.4-49c-5.3-13.8-23-34.4-37.8-37-12.9-1.5-17.4 5.2-22.6 15.8ZM753 152.9l-3.7 5.9q-2.1 3.8-4 7.9-.6 1.2.2 2.1a45 45 0 0 1 8-2.6q5.8-.6 11.5-.2 1 .2 1.5-.6-1.7-3-2.6-6.4a60 60 0 0 1-1.7-16q-1.1-.1-2 .8a60 60 0 0 0-7.2 9.1Zm13.8 38.5q-4.2 3-7.8 6.6c-27 29.3-31.1 89.2-8.7 122.2q6 8.1 14.2 13.8c16.5 11.7 30.8-18 35.8-29.8a176 176 0 0 0 12-50.2 117 117 0 0 0-7.4-52 51 51 0 0 0-8.9-14c-6-6.7-23-1.6-29.2 3.4ZM85.3 340.2q5.2 7 10 14 1.8 3.3 4.5.8l9.2-7 4.6-2.8q.8-1.1-.3-2.1-3-2.2-6.4-4a108 108 0 0 0-23.9-8c-1 0-4.2-.8-4.5.4q3.3 4.4 6.8 8.7Zm59.5 9.6A31 31 0 0 0 140 362q-2.4 14.8 1.5 29.2c10.1 31 32.7 58.8 67.5 60.1a37 37 0 0 0 22-7.2q4.2-3.7 7.5-8.1c4.1-9.5 4.4-26-1.5-35a277 277 0 0 0-14.8-19.2 164 164 0 0 0-35-31.5 89 89 0 0 0-16.3-8c-8.7-1.8-20.3 0-26.1 7.5Zm486 496.3c23.9-46.4 48.5-98 50.8-150.8l-.2-32.7q-.3-2 1.6-2.6c.2 0 11.8 14 18.5 16.5a1031 1031 0 0 0 24.7-23.2c13.5-12 29.5-22 44-32.8 2.8-2.3 5.5-3.7 4.5-7.8q-2.3-9-7.4-16.9c-1.3-2.1-4.1-5.5-4-8q1.4-1.7 2.2-3.6c1 .1 2.7 3.9 3.5 4.8 7.6 9.2 13 17.5 26.2 16.6 19-7.9 37.2-16.3 52-31q.7-.6.3-1.5c-11.4-11.8-12.8-34.6-12.3-50.1q3-34.2 24-61.3c9.2-11 25.2-26.4 40.7-19q.7.4 1-.3-.7-4.3-2.4-8.4c-6.8-17.9-21.2-26.3-36.4-10.9l-2.2-.2c10.5-11.2 19-31.4 36.1-32.8 1.6 0-.4 4.3-.1 5.3-2.4 6.4-5.1 17.4-1.1 23.5 20.3 24.4 13.9 76.4 2.8 104.1a94 94 0 0 1-42.8 49.2c-6 5.3-10.5 12.2-17.2 16.8a179 179 0 0 1-43.9 21.4c-11.1.3-12.8 7.4-20.8 13q-18.7 14.4-37.7 28.2a1007 1007 0 0 1-35 31c-8.3 13.3-14 34-19 49-9 30.4-16.6 59.7-32.6 87.4-3.5 5.3-14 24.1-17.8 27.1Zm253-447.7a34 34 0 0 0-5 4.5q-3.1 3.9-6.1 8.1-.8.9 0 1.6 5.2-1.5 10.7-.4 2.4 1.2 5 1.7c1.3-.6.5-3.7.6-5l.3-3.8q1.4-5.4 3.2-10.6c-.5-.9-1.7-.2-2.5 0a42 42 0 0 0-6.2 3.9Zm2 47.3-.9.3a25 25 0 0 0-5.9 3 58 58 0 0 0-7.3 5.7 106 106 0 0 0-31.9 81.3c0 8.6 4 28.4 10.6 34 5.2 2.9 17.8-11 21-14.6a156 156 0 0 0 10.7-13.3 100 100 0 0 0 12-23q2.5-6.4 4.2-13c4.1-13.7 7.2-44 3-57a14 14 0 0 0-5.2-3.4q-5.1-1.5-10.2 0Zm-626.6 38.1q1-2.3 2.8-4.2c1.8-1.6 5.8-2.3 4.4 1.4a7 7 0 0 1-7.2 2.8ZM241 495c-3.7 1.7-11.3 4.1-14.7 1q.6-1.5 2.3-1.8c1.4-.4 13.2-1.8 12.4.8Zm162 15.9c4.5-6 10-9.8 17.4-11.2 1.4-.3 3.3.5 1.4 1.6-2.6 2-16.5 10-18.8 9.6Zm128.2-6.9c.8-4.2 11.6 1 11.8 3.5-.6 5-10.9-1.2-11.8-3.5Zm-91.4 20.9a175 175 0 0 0-19 8q-23 12-41.9 29.6-.6.5-.4 1.3 1.5.1 2.9-.7c.8.5.1 1-.4 1.5a116 116 0 0 0-11.3 8.7q-7.5 6.7-14.3 14.2 0 .6.8 1 6.8 2.6 13.5 5.8c29.2 14 54.7 37 65 68.4 7.7 26 4.7 49.8-3.5 75 .2 2 6 6.8 7.4 8.6a88 88 0 0 1 13.9 23.9c5.3 12.7 7.6 26 11.8 39 14.4 44.6 78.1 47.3 113.8 29.3q8.5-4.3 16-10.3a144 144 0 0 0 36.6-47.3c29.2-57.4 32.5-129.4-10.2-181.1a277 277 0 0 0-64.4-57.1 178 178 0 0 0-45.3-20.4 115 115 0 0 0-71 2.5ZM351 586c1.3 2.6 4.6-1.3 3.6-2a6 6 0 0 0-3.6 2Zm-32.2 52c1.1 39.7 31.6 81.6 72.5 86.2 16.3.9 33.2-9.2 38.6-24.8 1.8-8 5.3-13.8 3.7-22.4-7-42.5-42.9-71.4-81.5-85.4-12-.3-26.5 12.7-29.7 24.3a66 66 0 0 0-3.6 22.1ZM629 844.7q.4 1.4.1 2.6a101 101 0 0 1-7.1 9.8 140 140 0 0 1-37 24.4c-4.3 3-9.5 15-13.3 19.6-11.4 16.4-23.5 37.3-39.2 49.9-22.9 14.4-44.3 27.5-59.2 51-35.6 57.7-72 115.2-107.5 173-42.4 69-101.7 112.6-186.3 98.8-88.7-16-143-102.1-154.3-186.3-3.6-39.4 7.4-81.2 44.7-100.8q.5 0 .7.7l-2 1.8q-.4.5-.4 1c-34.4 21.4-45.5 76.5-35.4 113.6 17 82.6 74.2 160.6 164 167.8 77.2 4.8 125.8-35.3 165-97.3 33.9-55.4 69-110 102.4-165.6 15.5-27.1 35.8-42.7 62-58.4 8.6-6.3 32.2-27.7 28-39.4-5.8-10.6-19.2-7.6-29-6.1-11.8 1-21.7-.6-33.3-2.8q.3-.6.8-.9 2.3 0 4.4-.6c10-.1 25.3 4 34.1-1 10.9-4.5 48.4-17.7 54.5-25.2q1 0 2 .4a167 167 0 0 0 20.5-11.5q12-7.5 20.8-18.5Z"/><path fill="#f3b5a9" stroke="#f3b5a9" stroke-width=".5" d="M556.2 542.7q36.6 23.5 64.4 57c-.7 1.6 7.8 23.6 9 27 11 37.2 16.6 70.2 5.9 108.4-1.5 11.4-16.4 38-30.2 33.7-8.3-5-17.2-5.2-17.9-16.8l-1-1.5c-.2-39.5 11.3-112.1-23.3-140.2-14.3-11-45-38.8-48.6-56.2q-.3-1 .8-1.3c4.5-3.4 35.5-8.4 39.9-9.7q.6 0 1-.4Zm-2 33.6q3.6 7.2 7.9 14l13.9 17.2a114 114 0 0 1 17.4 36.3q4 17.4 7.3 34.9c.9 1.8 4.2 7 6.7 6.3 6.8-2.4 12.5-8.8 11-16.4q-2.6-12-6-23.6-1.5-9-3.9-17.8l-6.3-19.8c-6.5-15.5-14.5-28.2-30.1-35.8a13 13 0 0 0-14.1.4z"/><path fill="#db9587" stroke="#db9587" stroke-width=".5" d="M882 447.2c-2 10-5.4 20-6.3 30.3q-.5 23.5-1.5 47a28 28 0 0 0 3.6 15.2q1.2 1 2 2.3c1.3.7 1.2-1.6 2.3.1l-5.2 6.8q-1.1.4-2.2 0c-5.6-11.2-2.9-23.4-2.8-35.4a205 205 0 0 1 6.5-58.5q.6-3 .6-6zM391 619.9q-5.6-3.1-11.5-5.8c-2.1-.6-10.4-1.8-11 1-.2 4.2.5 8.3 3.4 11.6 11.8 12.8 20.9 27.6 32 41 3.7 4.9 14.4 10 17.3 1.8 2.9-5.8-.7-12 .1-15.5q.6 0 .8.6c1.3 5.1 3.8 21.8-3.6 23.2q-6.6.6-11.6-4-6-5.7-11.3-11.9l-13.9-12c-5-5-6-12-9.4-18l-8-10.6c-3.8-8 .6-13.3 9.3-11.4a52 52 0 0 1 17.2 9q.5.5.2 1Z"/><path fill="#f9c0b6" stroke="#f9c0b6" stroke-width=".5" d="m895 446.4 1.1-.7q3 1.2 5.1 3.5c4.3 12.9 1.2 43.2-2.9 57-16.1 6.2-10.8-30-9.4-37zM554.2 576.3q1.7-2.2 3.8-4.2 6.8-4.5 14-.6c15.7 7.7 23.7 20.4 30.2 35.9l6.3 19.8a237 237 0 0 1 3.9 17.8q3.4 11.6 6 23.6c1.5 7.6-4.2 14-11 16.4-2.5.6-5.8-4.5-6.7-6.3a802 802 0 0 0-7.3-34.9 116 116 0 0 0-17.4-36.3l-14-17.2q-4.2-6.8-7.8-14Z"/><path fill="#e19e91" d="M885 446c-2.5 8.4-5.9 16.7-6.6 25.6q-.5 24.5-1.7 48.9a16 16 0 0 0 7 14.3q1.5.9 2.8.4l-4.4 7c-1-1.8-1 .5-2.2-.2q-.9-1.2-2.1-2.3a28 28 0 0 1-3.5-15.2q.9-23.5 1.4-47c1-10.2 4.2-20.3 6.4-30.3zM390.8 620l2.9 2.7c12 9 23.5 15.7 27.4 31.2-.8 3.7 2.8 9.8-.1 15.6-3 8.3-13.6 3-17.3-1.8-11.1-13.4-20.2-28.2-32-41-3-3.3-3.6-7.4-3.4-11.6.6-2.8 8.9-1.6 11-1q6 2.6 11.5 5.8m-17 1q.9.4 1.3 1.3c-.2 7.6 11.2 16.6 15.1 23 7 7.4 13.3 24.5 25.2 23.8 7.6-.6 4.5-17.3 1.6-21.7a95 95 0 0 0-35.2-29.5c-1.8.6-6.2-1.1-7.4.1q0 1.5-.6 3"/><path fill="#e9a99d" d="M374 621q.6-1.5.5-3c1.2-1.2 5.6.5 7.4 0 9.2 3 30.3 20.2 35.2 29.4 3 4.4 6 21.1-1.6 21.7-12 .7-18.2-16.4-25.2-23.9-4-6.3-15.3-15.3-15.1-23q-.4-.8-1.3-1.3m6 2q0 .8.5 1.4 1 .7 2 1.7-.3 4.2 2.3 7.5 9.8 12.4 18.8 25.3a14 14 0 0 0 12.5 4.6c6.4-10.1-3.9-22.3-11.7-28.3-5-3.3-13-12.3-19.2-11.9a9 9 0 0 1-1.8-2.2c-1.6-1.3-2.3 1.2-3.4 2"/><path fill="#efb3a8" stroke="#efb3a8" stroke-width=".5" d="M380 623c1-.7 1.8-3.2 3.4-1.9q.8 1.3 1.8 2.2c6.2-.4 14.2 8.6 19.2 11.9 7.9 6 18 18.2 11.7 28.3q-7.4.9-12.5-4.6-9-12.9-18.8-25.3a11 11 0 0 1-2.3-7.5l-2-1.7q-.5-.6-.5-1.4Zm7.1 5c0 1.2 1.9.9 2.5 2 1 8.3 11.1 24.5 19.8 26.2 1.6 3 1.8 1.5 4.2.9.7-2 1.3-2.7 0-4.6.9-8.3-16-22.4-23.8-22.9l-1.4-2.4q-.9-.3-1.3.7Z"/><path fill="#f6beb4" stroke="#f6beb4" stroke-width=".5" d="M387.1 628q.3-1 1.3-.8l1.4 2.4c7.8.5 24.7 14.6 23.9 22.9 1.2 1.9.6 2.6-.1 4.6-2.4.6-2.6 2-4.2-.9-8.7-1.7-18.8-18-19.8-26.3-.6-1-2.4-.7-2.5-2Z"/><path fill="#9aafb1" stroke="#9aafb1" stroke-width=".5" d="M878.9 402.9c2.5.2 5.3 6 7 7.9q2.4 2.5 2.4-1 .2-.6.7-.8c-.1 1.2.7 4.3-.6 5q-2.6-.7-5-1.8a22 22 0 0 0-10.7.4q-.7-.7 0-1.6 3-4.2 6.2-8.1Z"/><path fill="#c3d0d1" stroke="#c3d0d1" stroke-width=".5" d="M883.8 398.4c-.8 3.7 2.2 6.1 5.5 6.7l-.3 3.9q-.5.2-.7.8 0 3.6-2.4 1c-1.7-1.8-4.6-7.7-7-8q2.1-2.4 4.9-4.4Z"/><path fill="#ecf0f0" stroke="#ecf0f0" stroke-width=".5" d="M889.3 405.1c-3.3-.6-6.3-3-5.5-6.8q3-2.1 6.2-3.7c.8-.3 2-1 2.5 0q-1.8 5.2-3.2 10.5Z"/><path fill="#b36156" stroke="#b36156" stroke-width=".5" d="M209 451.3c-34.8-1.3-57.4-29.2-67.5-60.1l1.5.4c15.1-5.9 25.7 14 36 21.9 6.6 6.8 35 27.2 30 37.8Z"/><path fill="#ebaea2" stroke="#ebaea2" stroke-width=".5" d="M187.2 350.3a164 164 0 0 1 35 31.5c0 4.8 1.4 17.1-7.4 14.8-19.5-3.3-27.3-19-40.3-31.6-2.6-3.1-6.6-10.2-2.4-13.4q5.3-3.6 11.5-1.6 1.7 1.3 3.6.3ZM178 360l2.2 1.3c1.9 9 21.4 27.8 30.8 28.2 2.1.9 2.3 1.9 4.6.6.1-1.2 1.3-1.4 1.2-2.6a7 7 0 0 1-1.5-2.3c-.3-11.6-20.5-31-32.5-28-2-1-1.8 0-3.6.5q.1 1-.2 2zm718 85.7-1.2.7c-11.8-4.7-11.1 38.2-12 44.1.7 10.3-3.6 25.2 9.8 28.6q.8.3 1.5 0a79 79 0 0 1-4 9c-7.5-.6-11.3-9.5-11-16.2q0-15.8 1.7-31.5c0-6.7-.8-14 1.4-20.6l4-11.6q.5-1.5-.4-2.5 5.1-1.5 10.2 0Z"/><path fill="#f3b9ae" stroke="#f3b9ae" stroke-width=".5" d="m178 360 1-.3q.3-1 .2-2c1.8-.4 1.5-1.4 3.6-.6 12-2.9 32.2 16.5 32.5 28.1q.5 1.4 1.5 2.3c0 1.2-1 1.4-1.2 2.6-2.3 1.3-2.5.3-4.6-.6-9.4-.4-28.9-19.2-30.8-28.2z"/><path fill="#df9b8e" stroke="#df9b8e" stroke-width=".5" d="M171 342.3q3 1 6 2.5c-15.3 1-16 9-6.8 19.5 11.2 10.5 20.7 28.3 35.7 33.3 11.8 5.1 22 5.3 20.4-10.9l3 4c.7 10.4-7.5 15.2-17 12.3-20.6-4.1-30.3-23.2-44.2-36.7-4.5-5.5-10.3-12.7-6.6-20.1q3.4-4.3 8.7-3.4.5-.2.7-.5Z"/><path fill="#d58b7d" stroke="#d58b7d" stroke-width=".5" d="M171 342.3q-.3.4-.8.4-5.2-.8-8.7 3.5c-3.7 7.4 2 14.6 6.6 20 13.9 13.6 23.6 32.7 44.2 36.8 9.5 2.9 17.7-2 17-12.4q4 5.2 7.7 10.4-.6.2-.7.7c.1 22.5-33.5 13.4-43.5 6a288 288 0 0 0-33-34 269 269 0 0 1-15-24c5.8-7.4 17.4-9.2 26.2-7.4ZM879 449q0 3-.6 6a205 205 0 0 0-6.5 58.5c0 12-2.8 24.2 2.8 35.3q1.1.6 2.2.1-2.6 3.4-5.5 6.5c-2.3-1.2-3.2-6.5-3.4-9 2.1-20.3-.2-40.7 2.9-61 1-10 5.1-24.6 4.9-34q1.5-1.4 3.2-2.4Z"/><path fill="#91a9ab" stroke="#91a9ab" stroke-width=".5" d="M85.3 340.2c3.3.4 8.3 6 12.2 7q5.8 0 11.5.3v.5l-9.3 7q-2.6 2.4-4.4-.7-5-7.2-10-14Z"/><path fill="#c1ced0" stroke="#c1ced0" stroke-width=".5" d="M83 331.1q-.3 1.1-.9 2.1a90 90 0 0 0 6.8 6.4q2.9 2.3 6.2 3.9 1.6.8 3.4.6 3.8-1.8 7.7-3.3.8-.6.7-1.6 3.4 1.7 6.4 3.9 1 .9.3 2.1L109 348v-.5q-5.7-.2-11.5-.2c-4-1-8.9-6.7-12.2-7l-6.8-8.8c.3-1.2 3.5-.3 4.5-.4Z"/><path fill="#e6a295" stroke="#e6a295" stroke-width=".5" d="M796 188q5.6 6.3 9 14c-7.5-1.3-11.7-9.8-20.8-3.2-15.4 14.2-5 56.7 7.6 69 12.2 7.7 16.9-10.8 20.5-13.8q-.8 10.2-2.9 20.1c-.5 0-7.7 6.3-11 7-18.1 2.9-22.2-39.2-27-50.9-1.8-11.3 4-40.3 18-42.4q3.4 0 6.6.2ZM177 344.8a89 89 0 0 1 10.2 5.5q-1.9.9-3.6-.3-6.2-2-11.5 1.6c-4.2 3.2-.2 10.3 2.4 13.4 13 12.6 20.8 28.3 40.3 31.6 8.8 2.3 7.5-10 7.4-14.8l4 5c1.6 16.1-8.5 16-20.3 10.8-15-5-24.5-22.8-35.7-33.3-9.3-10.5-8.5-18.6 6.9-19.5Zm334 177.5a178 178 0 0 1 45.2 20.4q-.4.4-1 .4c-4.4 1.3-35.4 6.3-39.9 9.7q-1 .4-.8 1.3c3.5 17.4 34.3 45.2 48.6 56.2 34.6 28.1 23.1 100.7 23.3 140.3l1 1.4c.7 11.6 9.6 11.9 17.9 16.8 13.8 4.4 28.7-22.3 30.2-33.7 10.7-38.2 5.1-71.2-5.9-108.3-1.2-3.4-9.7-25.5-9-27 42.7 51.7 39.4 123.7 10.2 181-6 2-10.2 6.6-15.6 9.7-6.3 3.6-17.2 1-24.2 1.1-5-.5-13.5 1.8-17.4-1.6-6.5-6.8-4.2-19.2-2.9-27.5l5.5-29.8q.7-7.5 1-15.2c1.2-11.8 3.1-23.2.8-35l-5.6-29.3-6.8-21.5q-1.4-3.8-3.8-7-12-12.6-23.2-25.8-6-7.8-12.4-15.5l-23.2-23-5.3-5.6q-.3-.5-.2-1.2c-4-3.6-5.9-7.4-2.7-12.4z"/><path fill="#d78d80" stroke="#d78d80" stroke-width=".5" d="m796 188-6.5-.2c-14.2 2.1-20 31.1-18 42.4 4.7 11.7 8.8 53.8 27 50.9 3.2-.7 10.5-7 11-7a176 176 0 0 1-9.2 30c-10.2 1.7-24.5-9.7-26.5-20.2a420 420 0 0 0-9.4-44.9c1-2 .7-1.4.2-3.7 0-14.4-1.9-29.9 2.2-43.9 6.3-5 23.2-10.1 29.2-3.4Z"/><path fill="#aabbbd" stroke="#aabbbd" stroke-width=".5" d="M749.3 158.8q0 1 .9 1.3c3.6-.5 7.2 2.2 10.1 4 1.3.8 4.2.2 4.7 2q-5.7-.5-11.5.1a45 45 0 0 0-8 2.6q-.8-.9-.2-2.1z"/><path fill="#c6d2d3" stroke="#c6d2d3" stroke-width=".5" d="M753 153c3.3 3 4.6 5 9.1 6.5a4 4 0 0 1 1.8-.5q1 3.4 2.6 6.4-.5.8-1.5.6c-.5-1.7-3.4-1.1-4.7-2-3-1.7-6.5-4.4-10.1-3.9q-1-.3-.9-1.3z"/><path fill="#f3f5f6" stroke="#f3f5f6" stroke-width=".5" d="M763.9 159a4 4 0 0 0-1.8.6c-4.5-1.6-5.8-3.5-9.1-6.6q3.2-5 7.3-9.2.7-1 1.9-.7l.2 7.4a60 60 0 0 0 1.5 8.5ZM83 331.1a108 108 0 0 1 24 8 2 2 0 0 1-.8 1.7q-4 1.5-7.7 3.3-1.8.2-3.5-.6-3.3-1.5-6.1-4a90 90 0 0 1-6.8-6.3z"/><path fill="#cd8071" stroke="#cd8071" stroke-width=".5" d="M402.5 116.8q2.4 10.6 6.4 20.9 7.4 14.8 14.1 30 2 3.7 5 7 7.4 7 14.1 14.7c6.8 7.2 18.2 6.2 26 1.3q2-2 4.1-3.7c-.5 12.3.7 36.7-3.2 47.6a26 26 0 0 1-10.8 10.8q-1.5-.3-2-1.5c-.2-19.2-17-44.3-29.5-58.2a232 232 0 0 1-23-45c-.8-.7-1.3.8-1.9-1q-2.1-4.4-2.8-9.2-.1-.7-.9-.5 1.6-6.8 4.3-13.2Z"/><path fill="#bb6a5d" stroke="#bb6a5d" stroke-width=".5" d="M621.4 108.8c1 31.2-5.9 55.8 7.7 86.6 8.3 19.4 15.1 24.5 6.9 46-34.2-2.6-39.3-41.4-37.5-68.5 1.3-23.7 9.7-44.7 23-64.1ZM759 198q.8.6.7 1.8c1.7 26.2 2.5 55.9 7.4 81.5 6 18 10.5 36.2-15.4 37.9q-.9.3-1.4 1C728 287.2 732 227.3 759 198Zm112.7 256.7c.4 18.5-9.6 42.7-11.6 61.9q-2.7 17.4-20.3 19.4a106 106 0 0 1 32-81.3Z"/><path fill="#f3b7ab" stroke="#f3b7ab" stroke-width=".5" d="M651.6 120c.7-19.8 19.4-17.8 30.5-7.3 5 10.4 4.4 46.1-11.1 46.6-16.7-3-19.4-25.8-19.4-39.4ZM895 446.3q-3.3 11.3-6 22.7c-1.5 7.1-6.8 43.3 9.3 37a141 141 0 0 1-4.1 13q-.7.3-1.5 0c-13.4-3.4-9.1-18.3-9.9-28.6 1-6 .3-48.8 12.2-44.2Z"/><path fill="#eeb1a5" stroke="#eeb1a5" stroke-width=".5" d="M425 101c14.9 2.6 32.5 23.2 37.8 37h-.6l1.1 12.5c.7 9.7-2.3 17.6-11.3 22.1q-7.4 3-12.8-3.1a96 96 0 0 1-20.7-41.8c-2-8.4-.1-20.7 6.5-26.8Zm1.4 25a49 49 0 0 0 11 29c2.4 2.1 5.7 5.3 9 3 11-8.3 3.3-27.2-2.1-36.8-.7-1.7-1.2 0-2-.9-6.2-14.3-15.3-5.7-15.9 5.7ZM805 202a117 117 0 0 1 7.4 52c-3.6 3-8.3 21.5-20.5 13.7-12.7-12.2-23-54.7-7.6-69 9-6.5 13.3 2 20.7 3.4Zm-22.3 22c.8 8.6 2 24.8 12 28 12.5-.5 8.5-29 4.2-36.3-7.9-13.9-16-2.3-16.2 8.2Z"/><path fill="#f5bbb0" stroke="#f5bbb0" stroke-width=".5" d="M426.4 126c.6-11.4 9.7-20 15.8-5.7 1 .9 1.4-.8 2 .9 5.5 9.6 13.2 28.5 2.2 36.8-3.3 2.3-6.6-.9-9-3a49 49 0 0 1-11-29Zm356.2 98c.2-10.7 8.3-22.2 16.2-8.3 4.3 7.4 8.3 35.8-4.2 36.3-10-3.2-11.2-19.4-12-28Z"/><path fill="#df998c" stroke="#df998c" stroke-width=".5" d="M425 101c-6.6 6-8.5 18.3-6.5 26.7a96 96 0 0 0 20.7 41.8q5.4 6 12.8 3.1c9-4.4 12-12.4 11.3-22l-1-12.7.5.2c7 16 9.2 31.5 9.4 48.9l-4.1 3.7c-7.8 5-19.2 6-26-1.3a246 246 0 0 0-14.1-14.8q-3-3.2-5-7-6.7-15-14.1-30-4-10.1-6.4-20.8c5-10.6 9.6-17.3 22.5-15.9Z"/><path fill="#92a9ab" stroke="#92a9ab" stroke-width=".5" d="M364.7 95.9c.2 5.2 2.5 5.1 5.6 8.7q-5.7 5.1-9.5 11.7-.8.7-1.3-.1a76 76 0 0 1 5.2-20.3Z"/><path fill="#e7a598" stroke="#e7a598" stroke-width=".5" d="M670.3 91.7c18.7 14.5 21.4 46.4 20 68.3-2.5-.2-1.4 1.5-2.5 3-12.8 23.1-30.7 12.4-40-6.4a63 63 0 0 1-1.8-56c5.6-10 14.4-8.9 24.3-8.9ZM651.6 120c0 13.6 2.7 36.4 19.4 39.4 15.5-.5 16.2-36.2 11-46.6-11-10.5-29.7-12.5-30.4 7.2Zm233.3 326 1-.2q.9 1.1.4 2.5l-4 11.7c-2.2 6.5-1.3 13.8-1.4 20.5q-1.8 15.8-1.7 31.5c-.3 6.7 3.5 15.6 11 16.2q-1.6 3.6-3.7 7.1-1.4.4-2.7-.4-7.4-5.1-7.1-14.3 1.2-24.5 1.7-48.9c.7-8.9 4-17.2 6.5-25.7Z"/><path fill="#b3c3c5" stroke="#b3c3c5" stroke-width=".5" d="M366.4 91.8c1.8 3.3 2.2 5.8 7 5.3 1.6 0 4.6-2.6 5.6-1.1q1 .8.3 2-4.6 3-9 6.7c-3-3.7-5.5-3.6-5.6-8.8z"/><path fill="#d7e0e0" d="m367.4 89.8 1.4 3c1.5.7 2.4 2 3.9.4l2.5-.5q.6-1.2 1.9-1.7l1.9 5c-1-1.5-4 1-5.5 1.1-4.9.5-5.3-2-7.1-5.3z"/><path fill="#d4897a" stroke="#d4897a" stroke-width=".5" d="M670.3 91.7c-9.9 0-18.7-1.2-24.3 8.8a63 63 0 0 0 1.8 56.1c9.3 18.8 27.2 29.5 40 6.4 1.1-1.5 0-3.2 2.5-3 0 30.4-11.4 71-44.3 80.4q-5 .7-10 1c8.3-21.4 1.5-26.6-7-46-13.5-30.8-6.7-55.4-7.6-86.6a63 63 0 0 1 17-16.8c8.7-5.4 23.5-6 31.9-.3ZM349.9 617c-.7-20.3 24.9-12.4 34.7-5.1 18.9 15.7 39.5 26.7 41.3 54 3.5 28.7-8.5 24.7-26.6 12.5a167 167 0 0 0-27.8-19.5 51 51 0 0 1-21.6-42Zm71.3 37c-3.8-15.6-15.4-22.4-27.4-31.3l-3-2.8q.4-.5 0-1-7.9-6-17.3-9c-8.7-2-13.1 3.3-9.3 11.4l8 10.7c3.3 5.9 4.5 12.8 9.4 17.8q6.9 6.3 14 12.1 5.3 6 11.2 12 5 4.5 11.6 3.9c7.4-1.4 5-18 3.6-23.2q-.2-.6-.8-.6Z"/><path fill="#adbec0" d="M633.8 55.9c2.4 2 .8 4 2.5 5.8a106 106 0 0 0-14 4.5q-.8 0-1-.7 6-5 12.5-9.6"/><path fill="#d3dcdd" stroke="#d3dcdd" stroke-width=".5" d="M641.8 50.4q0 1.5-.9 2.5c-.3 2.9-.3 3.2 3 3.5q2.1.3 4.3-.6 2.6-1.7 4.9-3.8.2 4.8 1.6 9.5l-.3.3a59 59 0 0 0-18.1-.1c-1.7-1.8-.1-3.9-2.5-5.8z"/><path fill="#fafbfb" stroke="#fafbfb" stroke-width=".5" d="M653 52a33 33 0 0 1-4.8 3.8q-2.1.9-4.3.6c-3.3-.3-3.3-.6-3-3.5q.9-1 .9-2.5 5.7-3.9 11.7-7.2.6.5.5 1.3-1 3.7-1 7.5ZM377 91q-1.2.5-1.8 1.7l-2.5.5c-1.5 1.5-2.4.3-4-.5q-.5-1.5-1.3-3a71 71 0 0 1 6-10.8q.7-.9 1.5-.3.6 6.3 2.2 12.4Z"/><path fill="#b05d53" stroke="#b05d53" stroke-width=".5" d="M420.9 532.9c2.2 3.7 22.4-2.9 23.7 14.8-.7 14.7 4.7 31.6 4.2 45.4a59 59 0 0 0 23.4 58.2c9.8 9.7 25.7 1.3 38 12 13 11 2 59.9-3.4 75-3.4 13.3 10.6 33.3 16.3 45.2 11 19.7 24.8 27 45 35 10 5 12.1 9.5 10.1 20-35.7 18-99.4 15.3-113.8-29.3-4.2-13-6.5-26.3-11.8-39q.2-1 1-1.7c13.8 2.6 10.4 9.4 17.6 17.8 4.9 4.3 14.2 12.8 20.7 13.1 1.6 2.2 1.8.9 3.8.6 1.7-1.4 1-2 0-3.5 1.7-10.2-11.5-27.5-15.6-37a22 22 0 0 0-5.7-6.4c-8.7-6.4-17-12.6-24.6-20.3a12 12 0 0 0-5.4-2.5l-1.5-1.3a72 72 0 0 0-3.5 7c-.7 3.1 0 6.2.3 9.4q-.3.6-1 1c-1.5-1.9-7.2-6.7-7.4-8.8 8.2-25.1 11.2-49 3.6-74.9-10.4-31.4-35.9-54.4-65-68.4q1-.3 2-.9l-2-4.6q-1.7-6.8.7-13.4 0-1.2-.8-2 5.4-4.8 11.3-8.8c.5-.5 1.2-1 .4-1.5q-1.4.8-2.9.7-.2-.8.4-1.3a185 185 0 0 1 41.9-29.6Z"/><path fill="#a9554c" stroke="#a9554c" stroke-width=".5" d="M452.6 770.2a88 88 0 0 0-13.9-23.9q.7-.3 1-1c-.3-3-1-6.2-.3-9.4q1.5-3.6 3.5-6.9l1.5 1.2q3 .6 5.4 2.6c7.5 7.7 15.9 14 24.6 20.3q3.5 2.6 5.7 6.4c4.1 9.5 17.3 26.8 15.6 37 1 1.5 1.7 2.1 0 3.5-2 .3-2.2 1.6-3.8-.6-6.5-.3-15.8-8.8-20.7-13-7.2-8.5-3.8-15.3-17.6-18q-.8.7-1 1.8Z"/><path fill="#c27063" stroke="#c27063" stroke-width=".5" d="M440 524.9q.5 1 1.6 1 6.4-.9 11.9 2.4l2 2.2-1.2 1c2.3 8.8 2 16.8 2.4 25.6 2.5 11.1 21.4 8.2 25 23.7.4 3.4-5.6 7-7.1 9.9-5.1 11-22.3 38.8-4.3 46.3 17.6 5.9 24.9 11.5 44.3 8 20 1.8 17.8 27.8 12.3 41.2-.6 17.9-7.1 32-11.3 49-2 13.3 11.7 28.6 18.2 39.5 7 8 14.7 9.3 19.8 21.2 5.9 7.8 23.6 16.9 32 23 3.6 2.3 5.8 7.3 8.6 9.3q-7.5 6-16 10.3c2-10.5-.1-15-10-20-20.3-8-34.1-15.3-45.1-35-5.7-11.9-19.7-31.9-16.3-45.2 5.3-15.1 16.4-64 3.5-75-12.4-10.7-28.3-2.3-38-12a59 59 0 0 1-23.5-58.2c.5-13.8-5-30.7-4.2-45.4-1.3-17.7-21.5-11.1-23.7-14.8a175 175 0 0 1 19-8ZM318.6 638q0-11.5 3.6-22c3.2-11.7 17.7-24.7 29.7-24.4 38.6 14 74.5 42.8 81.5 85.4 1.6 8.5-2 14.3-3.7 22.4a39 39 0 0 1-38.6 24.8c-40.9-4.6-71.4-46.5-72.5-86.2Zm31.2-21c-.5 17 8.3 31.8 21.6 42 10.6 5.6 18.6 12 27.8 19.4 18 12.2 30.1 16.2 26.6-12.4-1.8-27.4-22.4-38.4-41.3-54.1-9.8-7.3-35.4-15.2-34.8 5Z"/><path fill="#bd6c5f" stroke="#bd6c5f" stroke-width=".5" d="M398.1 130q.7-.2 1 .5.5 4.8 2.7 9.2c.6 1.8 1.1.3 2 1a232 232 0 0 0 23 45c12.4 13.9 29.2 39 29.4 58.2q.5 1.2 2 1.5c-24.6 10-45-21.3-52.5-40.5a130 130 0 0 1-7.6-74.9ZM140 362c7.5 2.4 41.2 41.7 50.2 50.3 15.5 12.3 36.4 7.2 40.8 31.8a37 37 0 0 1-22 7.2c5-10.6-23.4-31-30-37.8-10.3-7.8-20.9-27.8-36-22q-.7 0-1.5-.3A69 69 0 0 1 140 362Zm229.8 211.3q1 1 .8 2-2.4 6.8-.7 13.5l2 4.6-2 1q-6.7-3.3-13.6-6-.7-.3-.8-1 6.8-7.4 14.3-14Z"/><path fill="#cc7c6e" stroke="#cc7c6e" stroke-width=".5" d="M766.8 191.4c-4 14-2.2 29.5-2.2 43.9.5 2.3.8 1.7-.2 3.7 4 15 7 29.6 9.4 45 2 10.4 16.3 21.8 26.5 20.2-5 11.8-19.3 41.5-35.8 29.8a57 57 0 0 1-14.2-13.8q.5-.7 1.4-1c26-1.7 21.4-20 15.4-38-5-25.5-5.6-55.2-7.4-81.4q0-1.2-.7-1.8 3.6-3.7 7.8-6.6Zm-622 158.4q6.9 12.3 15 24a288 288 0 0 1 33 33.9c10 7.4 43.6 16.5 43.5-6q.1-.6.7-.7c5.9 9 5.6 25.5 1.5 35q-3.3 4.4-7.5 8c-4.4-24.5-25.4-19.4-40.8-31.7-9-8.6-42.7-47.9-50.2-50.3a31 31 0 0 1 4.8-12.2Zm731 101.5c.2 9.5-4 24.2-5 34.2-3 20.2-.7 40.6-2.8 61 .2 2.4 1 7.7 3.4 9-3.2 3.5-15.8 17.4-21 14.5-6.6-5.6-10.7-25.4-10.6-34q17.6-2 20.3-19.4c2-19.2 12-43.4 11.6-61.9zM481 517.8c8.1 8 3 12.6-2 20.3-7.3 12.1 18 27 25.8 32.6 20 16 31.5 41.7 46.9 62 7.3 11.8 9 28.8 9.7 42.5 6.2 34.7.9 70.2 1.5 105.3q0 14.7 13.4 20.7c9.6 3.2 28.7 9 38.4 3.6q.8-.1 1.4.4a144 144 0 0 1-21.9 23c-2.8-2-5-7-8.6-9.3-8.4-6.1-26.1-15.2-32-23-5-11.9-12.8-13.1-19.8-21.2-6.5-10.9-20.2-26.2-18.2-39.5 4.2-17 10.7-31.1 11.3-49 5.5-13.4 7.8-39.4-12.3-41.3-19.4 3.6-26.7-2-44.2-7.9-18.1-7.5-1-35.3 4.2-46.3 1.5-3 7.5-6.5 7-9.9-3.5-15.5-22.4-12.6-24.9-23.7-.4-8.8-.1-16.8-2.4-25.6l1.2-1-2-2.2q-5.5-3.3-11.9-2.4a2 2 0 0 1-1.7-1 115 115 0 0 1 41-7.1Z"/><path fill="#da9183" stroke="#da9183" stroke-width=".5" d="M481 517.8c10.1 0 20.2 1.8 30 4.5l-16.2 18.8c-3.2 5.1-1.4 8.9 2.7 12.5l.2 1.2q2.7 2.7 5.3 5.7l23.2 22.9q6.3 7.6 12.4 15.5 11.2 13.2 23.2 25.7 2.4 3.3 3.8 7.1l6.8 21.5q3 14.6 5.6 29.3c2.3 11.8.4 23.2-.9 35q-.1 7.5-.9 15.2l-5.5 29.7c-1.3 8.4-3.6 20.8 2.9 27.5 3.9 3.5 12.5 1.2 17.4 1.7 7-.2 17.9 2.4 24.2-1.2 5.4-3 9.5-7.6 15.6-9.5a159 159 0 0 1-14.7 24.3q-.7-.5-1.5-.4c-9.6 5.3-28.7-.4-38.3-3.6q-13.5-6-13.4-20.7c-.6-35 4.7-70.6-1.5-105.3-.8-13.7-2.4-30.7-9.7-42.5-15.4-20.3-27-46-47-62-7.6-5.5-33-20.5-25.7-32.6 5-7.7 10.1-12.4 2-20.3Z"/><path fill="#5b4d43" stroke="#5b4d43" stroke-width=".5" d="M595.9 157c-1.6.2-1.4 3.8-2 5-2.8 32-20 47.9-3.6 81.2 1 1.7 3.7 6 5.4 6.8 19.9-14.8 18.6 13.8 27.8 13.7 11.2.4 11.3-12 17.5-18q11.8-1.7 21.4-8.2c1.6.9.5 3.5.4 5a616 616 0 0 1-45.6 109.7c-7.6-2.8-8.2-8.9-11.4-15.2q-2.3-3.8-6-1.3a92 92 0 0 0-8.3 6.6c-.8 2.9-.9 3.2-4 2.8-3-.6-.8-3-.8-4.8-1.1-4.8 1.5-13.8 2.1-18.8q.1-.7-.2-1.1l-4.3 4.5q-1.5 1.2-3.7 1.7c-2.3 2-1 1.9-3.8 1-2.8-1-.5-2.2-.7-4.4-1.3-13.5-4.8-22.3-1.4-36-.7-15.3-2.3-38-8-52.4q-.3-4.1.3-8.2c-.7-.8-1.1 0-1.8.4 7.5-36 12.8-72.6 18.4-109a81 81 0 0 1 10-21.9c26.3-33.5 68.7-47.8 87.8 1.2.2 1 1.5 2.9.3 3.4l-4.3-6.6a23 23 0 0 0-13.4-8.6c-38-8.8-62 41.3-68.1 71.5Z"/><path fill="#4f4038" stroke="#4f4038" stroke-width=".5" d="M595.9 157a193 193 0 0 0-1.6 42.3c2.6 25 19 48.3 46.7 46.4-6.2 6-6.3 18.4-17.5 18-9.2.1-8-28.4-27.8-13.7-1.7-.7-4.5-5.1-5.4-6.8-16.4-33.3.8-49.2 3.6-81.2.6-1.2.4-4.7 2-5Z"/><path fill="#584b42" stroke="#584b42" stroke-width=".5" d="M391.1 144q-.9.5-.9 1.5-.3 10-.3 20 0 .6-.3 1.1L386 164c-8.5-16.5-6.4-39.2-12.3-57.2a48 48 0 0 1 36.7-10.3c.6 0 3.5.3 2 1.5a30 30 0 0 0-11.3 11.7 88 88 0 0 0-10 34.4Z"/><path fill="#605147" stroke="#605147" stroke-width=".5" d="M646.7 490c3.5-13 26.1-36.2 35-47.7 3-2.6 20.7-7.2 23.6-4 8.6 9-1.2 18.1-4.7 26.7-4.3 13-17.8 56-33.1 58-7-.9-6.3-9-3.7-13.5q.1-.6-.2-1.1c-3.4 1.8-6 5.6-9.7 1.3a58 58 0 0 1-7.2-19.7Zm-410.8-44c5 .5 29.5 28 0 31.3-23.4-.4-31.4 5-44.8-16.7q-2.6-3.7-1.9-8c15.9 5.7 33.6 4.7 46.7-6.7Zm433 43c0 1.8 2.9 10.4 5.5 9 11.1-5.3 25.8-32 16-42.5-4.2-1.4-12.5 3.6-10.8 8A60 60 0 0 0 669 489Z"/><path fill="#5e4f45" stroke="#5e4f45" stroke-width=".5" d="M409 377c1.5-6 14-21.4 20.7-21.4 21.3-.7 23.3 5.7 23.6 24.7 2.9 12 7.9 59.7-2.5 66.9-4.4 2-5.8-1.8-7.4-5q-3 2.1-6.2 3.3c-20 5.3-20.3-42.5-22.2-53.7-1-5.3-5.3-9.7-6-14.9Zm10.8-11a6 6 0 0 0 2.8 1.1c2.2 3.7 7.5 3.8 11 5.8 10.8 5.5 6.4 17.9 15.1 24.3q0 1.2.3 2.3 1 .8 1.9-.2-.3-1.6-1.2-3.1l1.3-2.9c1.7-5.4-.7-15.9-.6-22-1.1-13-14.3-17.7-24.8-11.3-3 1.6-2.5 5.5-5.8 6Zm115.5 82.3c5-19.3 6.8-39 16.7-56.6 1.4-4 6.5-22.1 11.4-21.7 6.9 2.6 7.3 10.4 10.2 16.2 5.1 6.7 10.5 10.5 11 19.7.1 8.3 2.7 21.4.7 29-4.4 7-20 42.5-31.2 31.6l-2.7-3.2c-8.9-1.3-15.6-5.2-16-15Zm13.5-39.3q0 4.7 4 6.8 2 .1 3.8.7c-.6 9 3 16.9 4.5 25.6q1 8.8 2.4 17.5c10.4-6 16.5-25.4 19.2-36.5 4.6-23-7.8-23-17.6-38.6-.2-1.7.3-2.3-1.7-2.9a17 17 0 0 1-3.7 2.8c-5 4.7-10 17.7-10.9 24.6ZM214.3 557.3c1.5-9 14.9-29.4 25-30.2q1.5.3 3.1 0l2 2a9 9 0 0 1-1.1 4.6c-.6 1.4 1.1 1.5 2 1a156 156 0 0 1 12-5c14.7-4.6 18.7 13.7 7.9 21a183 183 0 0 0-33.8 27.1l-8.2 10.8a1 1 0 0 1-1-.1c-8.3-6.7-8.3-6.2-6-17 1-4.9-1.3-9.5-1.9-14.2Z"/><path fill="#615348" stroke="#615348" stroke-width=".5" d="M410 315c1-10 8.1-19.8 13.7-27.8 8.8-9 11-10.4 14.4-22.6 2.5-4.5 6.8-6.2 10-1 3.5 5.7 5.7 19 10.4 26 1.9 6.1 3.2 30.2-1.4 35.2-6.7 2.8-11.3-4.5-16-8-9-6.7-29 16.6-31.2-1.8Zm24.3-17.9c0 7.5 4.5 11.1 10 15.2l1.1 2.8c7.4 3.6 14.1-4.3 11.1-11.5-1.7-4.6-5.9-8.2-8-12.8-2.5-5-1-12.7-4.6-16.7q.2-1.2.7-2.2a2 2 0 0 0-1.8-.7c.2 1.2 1 1.6.5 2.8a46 46 0 0 0-9 23.1Zm-298.8 63q-1.4.2-2.3 1.1c-.5 3.7-1.5 15.8-6.6 16.2-12-.4-15.1-19.8-11.7-28.6a78 78 0 0 1 36.7-9.8q.8-.1 1.4.5-1.5.6-3.3.7c-8 3.1-12.3 12.1-14.2 20Z"/><path fill="#4c3c34" stroke="#4c3c34" stroke-width=".5" d="m791.9 502.9 1 3.1c-.3 5.4-8.4 8.2-11.8 11.7-6 5.8-5.8 12.5-8 20-2.7 7.1-11.5 11.8-18.3 14.3-8 1.8-14.1 2.8-19 10.2-4.7 7-9 14.3-15 20.3-2.7 1.5-.8.5-1 2.4-5.9 6.4-14.5 8.6-19.8 16.3a2 2 0 0 0-2 0c-4.8 1.7-7 8.7-9.2 12.7a6 6 0 0 1-1.4 1.7q.8-1.3-.2-2.7-1.8-1.8-2.2.6c1.3 5.4.5 11.3 1.2 17 1.3 13 26.9 5.6 35.5 8.5q1.8 0 3-1.3-1.5.7-3 1.7c-5.8 6.8-10 14 2.5 15.8Q713 666 701.5 676.5C694.8 674 683.2 660 683 660q.3-.6.4-1.4-4.9-7.8-8.2-16.2c-2.5-8.6-5.4-17.8-6.5-26.7-.7-8.2-.8-16.2-2.6-24.2q0-1 .4-1.7c3.7 9.8 8.4 18.7 11.2 28.9q.4 1 1.6 1 .2-3-.7-5.8c-3-12-5.7-23.4-10.2-34.8q-.2-.6.3-1 6.3-.1 12.5-1.4C721.4 564 761 531 792 502.9Zm-190 324a6 6 0 0 0 0 2.4 41 41 0 0 1 8.2 16.1c1 6-1.1 10.7-3 16.1q0 1.3 1 1.7c-3.1 2.2-17.8 11-20.5 11.5q-.9-.4-1.9-.4c-6 7.5-43.6 20.7-54.5 25.2q-.1-.8-.8-1.1c-12.7-.1-25.8 1.7-32.3-11.7q-.7-1.5-.2-3.2c.4.6 2.3-.7 2.7-1l-1.4-1.1a57 57 0 0 0-14.8-18.3c-4.4-4.4-3.1-11-2.9-16.6l-.3-7a103 103 0 0 0 120.6-12.7Z"/><path fill="#080605" d="M629 556.1c3.4-2 13 3.1 12.1 6.4-2.8 2.7-8.5-4.8-11.6-5.5q-.4-.3-.4-.9"/><path fill="#070606" fill-opacity=".9" d="m860 422.9 2 .2-4.5 4.9-5.6 7.5q-.6 1.2-1.9 1.8l-1-.3q5-7.4 11-14.1"/><path fill="#26211e" fill-opacity=".7" d="m630.8 846.1-.5 1.9-6 9c-.9 1.3-1-.3-2.3 0q4-4.6 7.1-9.6.3-1.4 0-2.7c1-1.5 1.1 1 1.7 1.4"/><path fill="#1c1714" d="M497.1 900.5q-2.2.8-4.4.6-.6.3-.8.9-6-.9-11.9-2.5c.8-1 3.4-.4 4.5-.5z"/><path fill="#362d27" d="M607 373.2q0 .7.5 1.3-1 3.6-2.7 6.8c-.7 1.2-2.4-1.5-2.5-2.1 2.3 1 1.9-1 2.2-2.3.8-.7 1.4-3.8 2.5-3.7"/><path fill="#403630" d="M351 586a6 6 0 0 1 3.5-2c1 .7-2.3 4.6-3.6 2"/><path fill="#1e1714" fill-opacity=".9" d="M81.2 982.7c2-.4 2.4 1.2.3 1.6l-3.9.8q-1 1-2.3 1.4.2.5.7.8l-7.8 3q0-.6.3-1.1l2.1-1.8a1 1 0 0 0-.7-.8q4-1.4 7.7-3.2 1.8-.7 3.6-.7"/></svg>`;

    /**
     * Closed paw (fist) sprite shown for the whole click pulse. Same coordinate system as PAW_SVG (its
     * arm and palm are aligned to the open paw), mirrored the same way.
     * @req PAW-2, PAW-3
     */
    const PAW_SVG_CLOSED = `<svg xmlns="http://www.w3.org/2000/svg" style="shape-rendering:geometricPrecision;text-rendering:geometricPrecision;image-rendering:optimizeQuality;fill-rule:evenodd;clip-rule:evenodd" width="892" height="1247" viewBox="20 33 892 1247"><g transform="translate(-12 111) scale(0.79)"><path fill="#040303" stroke="#040303" stroke-width=".5" d="M37.2 1248c0-36.2 13-71.6 35.3-100 23-28.9 51.3-38.4 87-41.8 38.6-3.4 75.3-5.2 109.5-25.6 60.5-35.9 86-94.6 111.4-156.6 7.4-16.8 11.8-21.5 29-28 1-1.8-1.8-4.8-2.6-6.4-37.4-43.9-66.6-92.4-96.2-141.6a136 136 0 0 1-12.5-34.5c-7.1-43.2 13.6-93 30.5-132.2a140 140 0 0 1 53.1-62c9.7-11.1 18.4-22 24.6-35.4 24.3-52.3 46.8-101.9 92.2-139.8 17.2-13.1 35.6-22 57.5-23.7 7.3-.2 16.8-13.9 22.7-18.2 2.3-1.6 5.8-5 8.2-1.6 5.3 6.3 6.1 27.9 11.2 30.7a88 88 0 0 1 29 29.1q2.7 4 7.2 2.3a107 107 0 0 1 52.2-13.8c6.5-1 12-8.8 17.5-12.2q3-1.9 5.3.4c5 6.2 5.7 21 11.4 24.7 25.6 13 35.2 26.2 47.3 51.6 3.5 1.6 18.6 1.4 21.9-2.2 3.2-3 10.4-12.5 14.1-5.8 4.9 7.1 5.2 15.6 14 19.3 10.2 4.3 18.4 9.8 27.2 16.6 27.8 26 35 45.2 36.5 83.2.3 7.5 7.5 8.4 13.4 11l4.4-1.6c4.5-1.1 8 9.4 11.4 11.7 32.2 22.6 49.2 48.6 54.8 88 2.6 31.5-8.7 55.8-25.3 81.5-12.6 18.8-28.7 29-48 40-5 4-8.5 13.5-11.8 19.2-16.8 36-31.3 72.9-49.6 108.2-4.9 9.5-10.9 18.4-16.3 27.5-15 22.8-38.1 35.6-60.6 49.7L721.6 977c-2.4 3 3 6.4 4 9 13.6 20.4-12 42-24.6 55.5-20.3 17.2-42.4 33.2-58.8 54.4-62.8 84.7-104.3 182-164.6 268.2-36.4 47.2-71.1 76.6-128.9 94.4-64.6 17.2-125.4 12-184.7-19C96 1402 39 1327.8 37.2 1248Zm535.4-932.4-2 2-1.9 2.1-3.8 4.3q-5.3 5.7-10.3 11.6-3.4 3.7-6.2 7.8c.6 1 6.1.7 7.4 1q9 1.5 18 4 9 3 17.7 7.2l.4-.2q0-6.8-.8-13.4l-.3-5c-1.6-11-2.8-21.8-6.9-32.4q-.4-.3-1 .1-5.2 5.4-10.3 11ZM474 505.8c20 3.8 38 10.7 53.9 24 10.6 9.9 19 13.6 32.2 19.5q8.4 5.3 16.4 11a1 1 0 0 0 1-.4c9.4-10.8 14.4-32.4 20.3-45.8q.8-1.8-1-1.5c-47.8 36.5-113-10.3-107.5-67.5a89 89 0 0 1 38.9-64q7.2-4.4 15-7.7a64 64 0 0 1 74.6 23.9q5.5 9.5 8.5 20 .8 1.2 1.5.1 1.6-17.7-.1-35.4a61 61 0 0 0-29.7-43.6q-1-.6-1.6.3.6 8.7.6 17.4c-.3 1.5 1.2 6-1.5 5.8-17.3-7.6-32.8-12-51.6-14.7-.6-.4-4.7-.9-3.5-2.3l14.8-17q1.1-1.5-.7-1.8c-58.5 5.8-100.4 70.7-123.9 119-11.6 21.8-20.4 48.8-36.2 67.8q-.5 1.3 1 1.2a155 155 0 0 1 78.6-8.3Zm222.7-155-2.8 3.1-1.6 1.9q-6 6.5-11.6 13.3-3 3.5-5.5 7.4.4.6 1.2.7 11 1.5 21.6 4a240 240 0 0 1 17.3 5.6q.5-.6.3-1.3l-.9-8.4a178 178 0 0 0-8-35.4q-.8-.6-1.5 0zm-36.5 65.6q4.2-2.4 9-4.1c35.2-11.3 70.4 5.1 81.5 40.9 2.4 9.1 4 22.1 2 31.4q.6 2.3 1.9.3c8.7-28.2 14-56.2.7-84a100 100 0 0 0-6.1-10.1q-12-15.4-29.7-23.4c-1.2.2-.6 1.3-.7 2l2.1 22q0 1.5-1.4 1.6-9.7-3.3-19.6-6.3-10.3-2.7-21-4.4l-3.7-.7-7.7-1.5q-1.2-.3-1.2-1.3a898 898 0 0 0 18.1-21.8q.9-1 0-1.9c-12-2-50.6 6.4-51.8 21.3q2.4 15.9 1.2 31.9-1.8 17.7-4 35.2.6.6 1 0a88 88 0 0 1 29.4-27.1Zm-114.3-38.6q-7.5 2.4-14 6.8a95 95 0 0 0-12 9.3C499.5 414 489 443 497.3 471.2c17.1 55.7 90.3 69 115.9 12q8-18.7 10-39A83 83 0 0 0 622 421a59 59 0 0 0-12.7-26.3 58 58 0 0 0-63.4-16.9ZM791 419l-.5.8-1.5 2-.9 1.2a200 200 0 0 0-14.3 21q-.9 1-.1 2a263 263 0 0 1 21.3 2.2q.3.7 1.1.5 9 1.8 17.5 5a2 2 0 0 0 .5-2.1 163 163 0 0 0-3-14.6q-3.6-14.7-10.2-28.2-.8-.8-1.6 0-4.4 4.9-8.2 10.2Zm-137 7.5-4.2 3.3a89 89 0 0 0-23 32.3c-4 18.1-17 34.4-12.9 53.6 9.4 51.7 79.2 68.4 111.5 26.6q6-8 10.8-17.2c10-20.3 16.2-46.8 9.9-69q-.9-3.1-2-6.1a60 60 0 0 0-17.8-24.7q-12-9.4-27.2-11.2-9-1-18 .3a60 60 0 0 0-27.2 12Zm114.5-3.4q1 9 1 17.7.8 0 1.1-.6l12-18.1q1.2-2.7-1.7-2.5-4.5 0-9 .7-2.9 0-3.4 2.8Zm51 27.8 1.2 7.4q-.9 1-2.2 1.3a282 282 0 0 0-32.2-8q-8.2-1.1-16.7-1.4-.7 0-1.2.6a166 166 0 0 1-14.3 47.8q0 1.2 1.2 1a69 69 0 0 1 35.7-19.9c42.5-6 68 27 70 66.3q.1 5.6-.4 11-.5 6.5-2 12.8c1 1 1.5-.3 2-1 10.1-23.5 18.4-45 12.8-71a93 93 0 0 0-18.8-39 105 105 0 0 0-38-28.9q-2-.6-2 1.2zm-38.5 37q-3 1.2-6 2.9a82 82 0 0 0-23.1 19c-7.5 8.2-11 20-17.5 29-3.1 6-11.4 13.8-13.6 19.3-13.4 46.3 36 88.5 80.5 73.4q10.3-3.8 19-10.2c7-5.9 13.9-12.6 19-20q8.5-13.2 13-28.2 4-15 3.2-30.3a87 87 0 0 0-5-23 55 55 0 0 0-37.4-34.6c-10.6-3-22-1.5-32 2.6Zm35.4 277c4.9 47.3-11 93-46.6 124.9-45.3 40.8-120.3 45.1-157.3-8.7-25.2-38.8-20.9-86.7-48.8-125.3-7.1-10.8-31.5-41.4-46.5-33.1l-6.3 4c-14 11.2-32.4 21.9-50.4 24.2a3 3 0 0 1-2.3-.5q10.1-4.6 20.2-9.6a150 150 0 0 0 33-22q.4-.5.4-1.1l-18.3-7.5c-14-6.5-25-13.2-35.5-24.6q-.7-.7-.3-1.5l26.4 15.4a175 175 0 0 0 55 18.2q16.8 2.6 33.6 0 .8-.2.2-.8-14.7-2.7-27.7-10c-37.4-23.6-53.6-70.4-33-110.8q14-24 41.2-29.5 10.8-1.4 21.3 1.6 1.3 0 1-1.1c-31.7-24.1-46.3-25.8-85.5-19.2q-1.8-1.1 0-2.2 18.4-7.8 38.2-6.9c1-.4-.2-1.6-.6-2a116 116 0 0 0-81.7-27.2c-53.5 1.5-90 26.2-112.3 74.5-19.5 44.7-45.4 106-21.5 153.4q5.6 12.2 12.9 23.5c25.2 41.7 50.1 82.2 81.8 119.7 24 30.2 56 42 90 57.3 1.4.5 6.5 2.5 7 3.4q-.4.8-1.3.6l-17.6-5.3a266 266 0 0 1-67.9-34c-3.4-1-7.3.2-10.6 1.1-12.2 3.4-16.6 13.7-21.6 24.1-36.1 86.6-77.6 165.4-180.7 178.8-59.4 6.9-105.6 3.2-139.3 61.5q-10 17.4-16.1 36.7c-10.2 35-6.7 73 7.2 106.6 50.2 119.2 177 179.4 301.1 138.7 50.3-16.8 87.2-49.9 118-92q10-13.8 19-28c31.4-50.2 59.3-103 89.5-154 23.8-38 47.7-83.4 82.1-113 17.6-15 36.7-28.2 50.4-47.1 7.2-10.6 12.2-23-.6-31.9-6-4.4-15.8.4-22.5 1.1a132 132 0 0 1-44 .2l-13.6-2.3q-2.7-.7 0-1.3c12 .5 23.7 1.4 35.7.4 27-.5 52.7-12 75.8-25 42-22.7 63.7-43.7 84.2-87.2 12.5-25.6 23.4-52 35.1-78l16.4-34.5a1 1 0 0 0-1-.4q-8 1.5-16.1.8c-.7-.1-2.2-.2-1.2-1.2q20.7-3.6 38.9-14.6c41.4-25.4 66.8-80.8 53-128.4q-5.4-16.5-14.8-31a97 97 0 0 0-26.1-26.5q-1.5-.5-1.3 1.1 3 9.7 5.3 19.5 1 5.2 1.7 10.7.4 2-1.5 2.4c-10.6-3.5-20.5-7-31.6-8.7l-3.7-.8q-6.8-.8-13.4-1.8-2-.4-2.5-2.2 2-4.4 4.6-8.1c6.3-9 11.8-18.3 18.5-27q.4-1-.8-1.5c-4-1.5-7.5-3.4-11.9-2.7q-5.2 14.1-10.7 28.2a269 269 0 0 1-16 27.5 129 129 0 0 1-37.2 39.5c-11.8 10.8-22.2 31.3-21.6 47.1-.2.6-.4 1.9-1.3 1.1l-3.1-8q-2.4-1.2-4.9-2.1c-3-1.7 1.4-2.8 2.4-3.8 4.2-4.3 9.5-17.3 13-23l4.5-7q-.5-.6-1-.3a68.5 68.5 0 0 1-89.5-69.5c0-1.1 1.5-3 .4-3.8q-.7.2-1.2.8c-4.4 9.4-16.4 32.4-17.4 41.6l.7 5.8c-1.7 1.7-4.1-2.2-5.6-2.8-1-.7-6.3-1-6-2.8l3.5-2.5c5.4-7.3 11.7-27.1 17-36.2.4-.6.4-2-.8-1.4-40.3 18.6-99.8-12-95.5-60.2q0-1-1-1.1-9.8 25.7-19.9 51.5c-1 4 .8 6.2 2 9.7q-.7.6-1.9.3l-6.2-2q-1.4-.1-.9 1.1 6 6.3 11.3 12.8c3.6 4.4 27 7 33.4 9.8 64.3 19.5 152.3 67.4 179 132.7q9 21.6 12 44.8ZM892 549l-5 7-2 3q-5.3 7.5-10.3 15-.4.3 0 .8a221 221 0 0 1 25.3 4q7.5 2.5 15.2 4.8.5-.3.2-1l-2.7-11.6-1-3-1-4q-3.7-13-10.7-24.5a1 1 0 0 0-1 .1q-3.7 4.6-7 9.4Zm-354.1 28q-5 2.8-9.2 6.4a67 67 0 0 0-20.2 41.7 82 82 0 0 0 49.5 82.5c15 6 34.2 8.4 45.3-6.1a67 67 0 0 0 11.2-23.2A97 97 0 0 0 617 647c-3.5-27.8-20.8-73.2-53.5-76a47 47 0 0 0-25.6 5.9Zm84.1 69c1 5.7 4.8 11 7.2 16.2q4.5 9.7 8 19.8c2 8 5.2 17 4.6 25.3-1 1.3-2.6.5-4 .6q-7.4-2-14.9-3.7c-3.3-.4-10.2-2.3-13.2-1.7a63 63 0 0 1-43.5 21.2q-12.1.4-24.1.1-.1.6.3 1.1c40.5 34 47 75.3 60 123.2 17.6 58.5 72.4 81.4 128.5 60a178 178 0 0 0 17.2-8.7q14.3-9 26.1-21c45.8-48.6 49.4-122.1 13.9-177.6l-2-3a196 196 0 0 0-49-49 404 404 0 0 0-38-24l-20-11q-17.9-8.7-36.2-15.6-21-7.4-42.6-12c-.6 0-1.7-.7-2 .3 13 17.4 20.8 38.1 23.7 59.5Zm316.5 32.8a101 101 0 0 1-38 56c-53.4 32.5-108.8-14.6-90.8-72.5a105 105 0 0 1 59.4-60.8l5.7-1.8c50.5-11.3 76.4 34.5 63.7 79.1ZM868 607.2l-5.2 2.4q-6.2 3.3-12 7.2-4.6 3.3-9 7.2a99 99 0 0 0-18.4 21.8 70 70 0 0 0-10.5 52.2c7.2 28.2 35.1 48.2 64.3 41.4q17-4.4 29.8-16.4 9.3-9.5 16.2-20.7a104 104 0 0 0 10-24.1 79 79 0 0 0 3-29.2c-2.5-28.6-22.5-48.9-52.2-45.9q-8.2 1-16 4.1ZM621 674a74 74 0 0 1-4 14q-2 4.5-3.7 9.3c.9.9 4.2.7 5.5 1l5 1q6.4 1.5 12.7 3.5 1-.6.6-1.8l-2-9q-3.6-15-10.7-28.7-.5-1.3-1.8-1.3z"/><path fill="#be6d62" stroke="#be6d62" stroke-width=".5" d="M623 704.2q7.5 1.7 15 3.7 0 .6.4 1.2a8 8 0 0 1 6.2 3.7c3.6 6.1 13 12.6 12 20.2a113 113 0 0 0-1 38.4q-.5.7-1.2 1.2.4.8.4 1.8c-5.8 17.5-9.7 37.4 3 53q6 6.9 12.7 13.2.8-.4 1.3 0 2.4 3.8 6.1 6 4.2 2.2 8.5 4l1.1-1.3 1.6 3.8c4.4 5.6 13.1 6.5 17.4 10.5a30 30 0 0 1 18 8q.8-.4 1.3.1c6.6 6 14.7 8.7 15.5 19q-.3.5-1 .8a5 5 0 0 0 2.5 3q3 1.5 5.9 2-.8 1.4-2.3 2 .8.6 1.8 1A178 178 0 0 1 731 908c-1.4-1.8-.3-2 1.5-3-5.1-3.2-7.3-7-9.6-12.4a14 14 0 0 0-10.5-5.4q-1-.4-2-1.3c1 .3 1.6-1.8 1.2-2.5-2.5.6-8.7-2.4-10.8-3.7q-6.4-4-12.4-8.7c-1.5-2.5 0-1.4-2.8-1.2l-3.2-2.3c.4-.6 2.3-1.3 1-2.1-2.5 1-6.6-3-8.9-2.8l-1.2-1.3q-2 0-3.7.6c-1.2-.8.4-2.1.2-3.2q-2-.2-4.1-.8c-1.6-.7-5.3-3.3-4-5.4q-1.4-.4-2.6-1.1c-.3-1 1.4-2.4.4-3q-.7.3-1.6 0-2.4-1.4-4.8-2.1-2.5-4.5-4.6-9.4c-5.6-12.4-5.7-26.8-6-40.2l1-1.2c-5.8-12 2.6-24.2-.3-37.1a66 66 0 0 0-14.6-31.3c-2-3.5-6-17.2-4-20.6-1.5-.4-3.5-.5-1.6-2.3Z"/><path fill="#91a7a6" stroke="#91a7a6" stroke-width=".5" d="M617 688q1 1.5 2.5 2l1 4 1.1 2.5q-1.8.4-2.8 1.9c-1.3-.4-4.6-.2-5.5-1.1q1.7-4.7 3.8-9.3Z"/><path fill="#a0b3b2" d="M618.5 683.8c.5 1 .8 3 2.3 1.4l.3 5.2q.6 2.3 1.9 4.2a37 37 0 0 1 4.7 3q-1.5.6-3 .7-.7.4-.9 1l-5-1q1-1.5 2.8-1.8l-1.1-2.5-1-4q-1.6-.5-2.4-2z"/><path fill="#e0e6e7" d="M635 692q1.3 4.5 2 9c-1.6.6-2-.8-2.6-2q-6-2-10-6.8l-1.6-5.7c-.8-2.5 1.5-7.7-3-7.6q.7-2.4 1.2-4.9 1.8 0 2.6-1.7l1.4 4c1 5.4.4 15.4 6.4 17.8z"/><path fill="#ae5e54" stroke="#ae5e54" stroke-width=".5" d="M823.4 645.8q.5.6 1.2.9l1.8-.8q2 6.1 3 12.6c-.4 8.4-3.4 23-2 31q.4 2.1 1.1 4.1c1.7-.7 3 1.4 4 2.4l1.4.7c.3 4.8 1.8 8 4.8 11.8-2 1.4-1 .6-1.3 2.5-1.4 1.8-1.2 1.3.3 2.5-1 5-2.7 9-8.2 10.1q1.1-1.2 1.1-3.1c-2.4-2.3-2.3-5.8-1.8-8.8l-7.4-2c-1.2-1.2 2.8-14.4-8.5-11.7a70 70 0 0 1 10.5-52.2ZM623 704.2c-1.9 1.8.1 2 1.6 2.3-2 3.4 2 17 4 20.6a66 66 0 0 1 14.6 31.3c2.9 12.9-5.5 25 .4 37.1l-1 1.2c.2 13.4.3 27.8 6 40.2q2 4.8 4.5 9.4 2.4.8 4.8 2 .7.4 1.6 0c1 .7-.7 2-.4 3q1.2.9 2.6 1.2c-1.3 2 2.4 4.7 4 5.4q2 .6 4 .8c.3 1-1.3 2.4 0 3.2q1.6-.7 3.6-.6l1.2 1.3c2.3-.3 6.4 3.8 9 2.8 1.2.8-.7 1.5-1.1 2.1l3.2 2.3c2.7-.2 1.3-1.3 2.8 1.2q6 4.6 12.4 8.7c2.1 1.3 8.3 4.3 10.8 3.7.4.7-.1 2.8-1.2 2.5q1 .8 2 1.3 6.4.4 10.5 5.4c2.3 5.5 4.5 9.2 9.6 12.4-1.8 1-3 1.2-1.5 3-56.1 21.5-110.9-1.4-128.5-59.9-13-47.9-19.5-89.2-60-123.2q-.4-.5-.3-1.1 12 .3 24-.1a63 63 0 0 0 43.6-21.2c3-.6 9.9 1.3 13.2 1.7Z"/><path fill="#ce7f72" stroke="#ce7f72" stroke-width=".5" d="M699.1 624.7a404 404 0 0 1 38.1 24.1c-16 2.4-34.2-12.6-49-11.7a91 91 0 0 1-9.8 2.2q-.9 1.8-1.2 3.9c-1.6 6.6-.4 13.3-1.4 20a4 4 0 0 1-1.5 3.3c6.1 6.6 5 20.3 13.9 29.7l.3 1.8c9.6 5.9 9.6 33.5 15.1 37.5l-.8 1.4q2.3 6.9 2.9 14.1 1 26 4.6 51.5c4.2 4.2.2 25.7 3.2 31a4 4 0 0 0-1.3 3.9c.8 11.1 33.6 31.5 43.3 31q.6.6 1.3 1 5.4 0 10.1 2.6l-.5 1.5q1.5 0 2.6 1.1l2.6 3.7a1 1 0 0 0 1-.6q.7.6 1.7.6-12 12-26.1 21.1-1-.3-1.8-1 1.5-.5 2.3-2-3-.5-5.9-1.8a5 5 0 0 1-2.4-3.1q.6-.3.9-.9c-.8-10.3-9-12.9-15.5-18.9q-.5-.5-1.3-.2a31 31 0 0 0-18-8c-4.3-4-13-4.8-17.4-10.4l-1.6-3.8-1 1.3a86 86 0 0 1-8.6-4 20 20 0 0 1-6-6q-.7-.4-1.4 0-6.7-6.3-12.6-13.2c-12.8-15.6-9-35.5-3.1-53q0-1-.4-1.8l1.2-1.2a113 113 0 0 1 1-38.4c1-7.6-8.4-14-12-20.2a8 8 0 0 0-6.3-3.7l-.3-1.2c1.3-.1 3 .7 3.9-.6.6-8.3-2.5-17.3-4.6-25.3 4.6-2.8 7.6-5.2 6.1-11.5q.8-.4 1.4-1 0-1.7 1-3.2a42 42 0 0 0-.3-28.2c-2.3-11.2 3-16.9 13.9-15.1 8.3-1.2 13.9-1.8 21.5 2.8a3 3 0 0 0 1.8-1c1.3-.7 3 0 3.8-1.4q4 1.7 8 1.4l1.9 1.2q1.2-1 2.7-1.3Z"/><path fill="#db9286" stroke="#db9286" stroke-width=".5" d="M868 607.2c-.2 2.2 3.2.9 4 2.7q-.4-.3-.3-1 .9.3 1.2 1c-3 6.9-8.4 16.5-6.8 24 7.7 17.3 11.7 54.3 34.7 57.5 14.8.5 20.1-3 29-13.7l1.2.4v-2.6q0-.7.5-1.2l.7 3q.4.6 1 .9a104 104 0 0 1-10 24c-.6-.3-1.7-1.7-.6-2.1-10.4-4.5-27.2 6-38.2-6-9.9-11.5-27.3-45-25.2-59.9 2.4-8.9 5-15.2 3.6-24.6zm-130.8 41.6a196 196 0 0 1 49 49q-1.2.7-2.4 1c-5.3-5.2-11.4-9.8-14-17q0-1 .3-2a34 34 0 0 1-8.8-8.9l-2.1-.6-3.5-2.5q-2.5-2.5-4-5.5c-15.7.3-34-18.1-54.8-14.9-11.6.3-2.3 21.3-3.4 28a4 4 0 0 0 1 2.1q-1 .6-1.1 1.8.6 3.6 1.8 7a161 161 0 0 1 25.4 84q.2 1.7 1 3.2l-1 1.1c.4 15.8-6.3 53.2 5 65q-.3.5-.1 1.1 5.4 3.5 11 6.6c6.3 3.4 16.8-.7 21 2.3l2-1.3q1.4.9 2 2.4l1-2.4c3.6 2.2 2.6-4.5 5-.6l1.6-1.6c8.4-.8 12.2-5.2 16.9-11.5q1 0 2-.3.7-3 2.8-5a3 3 0 0 1 2-1 284 284 0 0 0 6.3-15.3 546 546 0 0 1 6.2-35.2c2.2-10-6-29.2-5.7-40.3-2.1-9.8-13.7-27.5-11.4-36.7 35.5 55.5 31.9 129-13.9 177.5q-.9 0-1.8-.6a1 1 0 0 1-1 .6l-2.5-3.7a4 4 0 0 0-2.6-1.1l.5-1.5a19 19 0 0 0-10.1-2.6q-.8-.4-1.3-1c-9.7.5-42.5-19.9-43.3-31q-.6-2.5 1.3-4c-3-5.2 1-26.7-3.2-30.9q-3.7-25.5-4.6-51.5-.6-7.2-2.9-14.1l.8-1.4c-5.5-4-5.5-31.6-15-37.5l-.4-1.8c-9-9.4-7.8-23.1-13.9-29.7a4 4 0 0 0 1.5-3.3c1-6.7-.2-13.4 1.4-20q.2-2.1 1.2-3.9a91 91 0 0 0 9.8-2.2c14.8-1 33 14 49 11.7Z"/><path fill="#c27166" stroke="#c27166" stroke-width=".5" d="M528.7 583.3q1 .4 2 1.3c-5.2 21.7 3.8 36.2 12.8 55.3 1.7 3.2 14.5 19.8 18 18.5a5 5 0 0 0 2 1.4q3.5 1 7 1.7c-1 1.7-2.6 3 1 2.2 5.1 1 10.4 3.5 15.5 4.7 9.8 2.7 22.4-1.3 27.5 9.8a67 67 0 0 1-11.2 23.2c-2.6-3-7.2-1.7-10.6-3.4-8.3-7.2-10.6-7.3-21.4-9-7.7-1.8-13.1-7.9-19.7-12q-.9-.6-2.1-.4l-1-1.3-3 .3a47 47 0 0 0-7.5-10q-.7-.4-1.5 0c-1.8-4-5.2-7.8-7.8-11.6q-7-13.8-16-26.3c-3.6-4.1-2.9 2-3.2 4q-.3-3.4-1-6.7a67 67 0 0 1 20.2-41.7Zm150.4 30.6 20 10.8q-1.6.3-2.7 1.3l-1.9-1.2q-4 .3-8-1.4c-.8 1.3-2.5.7-3.8 1.4a3 3 0 0 1-1.8 1c-7.6-4.6-13.2-4-21.5-2.8-10.9-1.8-16.2 3.9-13.9 15 2.9 10.3 3.8 18 .2 28.3q-.7 1.5-1 3.2-.5.6-1.3 1c1.5 6.3-1.5 8.7-6.1 11.5a237 237 0 0 0-8-19.8c2-2 2.2.2 3.1 1.5a5 5 0 0 0 5 0c16.9-7.1-7.5-42.6 12.4-48.3C661 616 668 618 679 614Z"/><path fill="#a9bbba" d="M887 556c4.6-.8 4.8 4.3 6.4 7.1q2 1 3.4 2.5 1.5 3.4 3.6 6.4l-.3 6.7-1.2-.4c1.3-8-7-13.7-11.8-18.9q-1-.4-2-.4z"/><path fill="#c3d0d0" stroke="#c3d0d0" stroke-width=".5" d="m889.3 552.8 2.5 2q1.6 3 2.6 6.3 1.2 1 2.5 1.6a11 11 0 0 0 7.7 7.4q2.1-.3 4.1.7c2-.4 1.5-1.5 2.7.8q.5-.6 1.4-.6l2.7 11.7q.2.6-.2 1l-15.2-5q0-3.3.3-6.7-2.1-3-3.6-6.4-1.5-1.5-3.4-2.5c-1.6-2.8-1.8-7.9-6.3-7z"/><path fill="#b36157" stroke="#b36157" stroke-width=".5" d="M751.8 509.8q.8 1.1.6 2.5l-4.7 9.6c-2.7 5.3 2.4 21.7.7 29.2-.4 16.8 11.2 35.6 19.8 49.4q.6.3 1.2 0c1 .8.6 1.3 2 .9 7.1 10.2 17.4 9.6 21.1 14.3q.7-.4 1.5-.3c5.9 3.4 6.2 9.1 5.4 15.1q.8.6 1.8 1c-44.5 15.1-93.9-27.1-80.6-73.4 2.3-5.6 10.6-13.3 13.7-19.2 6.6-9.1 10-20.9 17.5-29.1ZM643 598.2c-.3.8-2.3 1-1.6 1.9q1.7.8 3.5 1.2l1.7 1.7q1.4-.1 2.7.2 3 1.7.2 3.6-1 0-2-.3c-4.6 2.8-12.1 4.3-14 10-1.7-.3-1.3.3-2.2 1.3l-3 1.7c1.7 8.4 4.3 16.1-1.5 23.8a3 3 0 0 0-1.5.5l-.7 1.8-1-3q-.3-.9-1-.4c.1 1.3 1.2 3.3-.5 3.8a128 128 0 0 0-23.6-59.5c.2-1 1.3-.3 2-.4Q622 591 643 598.2ZM508.5 625q.7 3.3 1 6.7c.3-2-.4-8.1 3.1-4q9 12.5 16.1 26.3c2.6 3.8 6 7.6 7.8 11.6q.8-.4 1.5 0 4.5 4.5 7.6 10 1.5 0 2.9-.3l1 1.3q1.2-.2 2.1.5c6.6 4 12 10.1 19.7 11.9 10.8 1.7 13 1.8 21.4 9 3.4 1.7 8 .3 10.6 3.4-11 14.5-30.2 12.2-45.3 6.1a82 82 0 0 1-49.5-82.5Z"/><path fill="#bc6a5f" stroke="#bc6a5f" stroke-width=".5" d="M754.6 506.7c5.4 8 .3 29.9 1 39.6 1.6 10.3 11.8 41.9 20.2 50.4 8.7 14.1 45 6.4 43 23.1q.4 1 1.4 1.5a76 76 0 0 1-19 10.2q-1-.4-1.8-1c.8-6 .5-11.7-5.3-15q-.8-.1-1.5.2c-3.8-4.7-14-4-21.1-14.3-1.5.4-1-.1-2-1q-.8.4-1.3 0c-8.6-13.7-20.2-32.5-19.8-49.3 1.8-7.5-3.4-23.9-.7-29.2l4.7-9.6q.2-1.5-.6-2.5zM643 598.2q18.4 6.9 36.1 15.7c-11.1 4-18 2.1-29.4 1.6-19.8 5.6 4.6 41-12.3 48.2a5 5 0 0 1-5 0c-1-1.3-1-3.6-3-1.5-2.5-5.1-6.3-10.5-7.3-16.1 1.7-.6.6-2.6.6-3.9q.5-.5 1 .3l.8 3.1q.6-.8.7-1.8a3 3 0 0 1 1.6-.5c5.8-7.7 3.2-15.3 1.6-23.8l2.9-1.7c1-1 .5-1.5 2.1-1.3 2-5.7 9.5-7.2 14.2-10l1.8.4q3-2 0-3.7-1.5-.3-2.8-.2l-1.7-1.7q-1.8-.5-3.5-1.2c-.7-1 1.2-1 1.6-1.9Z"/><path fill="#c6766a" stroke="#c6766a" stroke-width=".5" d="M765.7 496.7q1.9 3.7 1 7.7a74 74 0 0 0-4 43.9l-.5 3q.8 0 1.7.4.1 1.5-.4 2.8c5 9.4 7.9 26.9 16 33.6q0 1 .2 1.7c19.7 13 35.6 16.3 58.8 8.6a3 3 0 0 1 0 2.1q.2.5.7.8c-5.1 7.4-12 14.1-19 20q-1-.4-1.3-1.5c1.9-16.7-34.4-9-43.1-23.1-8.4-8.5-18.6-40-20.3-50.4-.6-9.7 4.5-31.6-.9-39.6q5.4-5.2 11-10Zm85 120.1q1 1 2.4.8c3.6 3.2 3.8 7.9 3.2 12.4l-3.5 22.3q-.4 4 .9 7.7c2.4 5.1 4.2 11.1 7.2 15.8q8.4 10.6 16.4 21.4.7.4 1.5.4a8 8 0 0 0 2 5l.7-.2c.6 1.7.5 3.3 2 1q1.3 1.2 3 1.3l4.2 4a42 42 0 0 0 5 3.3q7.1 2.4 14 5.5c-1 1-4.3 3.9-2.7 5.5a68 68 0 0 1-29.8 16.4q-1.5-.4-2.8-1l2-1.2a5 5 0 0 0 .4-6.6q.3-.7.8-1.1l-1.4-2q-1.6-4.6-4.5-8.7-7.2-6.8-13.8-14.2c-11-11.6-11.3-23-14-37.6l-.4-5.3v-11.4q.8.4 1.4 0c-.7-6.4.3-12.6.3-19-.2-3.3-.5-5.5-3.3-7.4q4.2-3.8 8.8-7.1Z"/><path fill="#d48577" stroke="#d48577" stroke-width=".5" d="M774.9 490.8c7.6 7.1-7.8 38-1.6 51 10.8 23.8 13.8 38.4 40.4 48.8 15 5.2 29.5-11.9 35.9-23.3.7 1.5 1 4.8 2.6 5.8q-4.5 15-13 28.2-.5-.2-.8-.8a3 3 0 0 0 0-2.1c-23.1 7.7-39 4.4-58.7-8.6l-.2-1.7c-8.1-6.7-11-24.2-16-33.6q.5-1.4.4-2.8l-1.7-.4.5-3a74 74 0 0 1 4-43.9q.9-4-1-7.7 4.4-3.3 9.1-6Zm88 118.8c1.3 9.4-1.3 15.7-3.7 24.6-2 14.8 15.3 48.4 25.2 59.8 11 12.1 27.8 1.6 38.2 6-1 .5 0 2 .6 2.3q-6.9 11.3-16.2 20.7c-1.6-1.6 1.7-4.4 2.6-5.5q-6.7-3.1-13.9-5.5a42 42 0 0 1-5-3.3l-4.3-4q-1.5-.2-3-1.2c-1.4 2.2-1.3.6-2-1h-.7a8 8 0 0 1-1.9-4.9q-.8 0-1.5-.4a567 567 0 0 0-16.4-21.4c-3-4.7-4.8-10.6-7.2-15.7q-1.3-3.8-.9-7.8 1.6-11.1 3.6-22.3c.5-4.5.3-9.2-3.3-12.4q-1.4.4-2.4-.8 6-3.9 12.1-7.2Z"/><path fill="#556664" d="M794.9 448.2q.8-.1 1.1.5-.8.2-1.1-.5"/><path fill="#97acac" stroke="#97acac" stroke-width=".5" d="M794.6 442.1q0 3 .3 6.1-10.7-1.5-21.3-2.3-.8-.9 0-1.9l6-9.2q.4 1 1.6 1c6.6-3.6 10.6-1 12.5 5.9q.4.3 1 .4Z"/><path fill="#cc7a6e" stroke="#cc7a6e" stroke-width=".5" d="M653.8 426.5q.6 1.4 1.7.5c3.7 4-.4 14-1.1 19-2.4 17.3 5.3 40 11.8 56.3 1.2.8 1-.9 2.3 1.3 2.8.3 4.7 3 6.7 4.8q0 .8.5 1.4 2.8 1.5 4.8 3.8.4-.8 1-1.2 1.8 1 3.8 1.3c3.7 1.7 5 4.3 6.8 7.7 2.5 1.2 1 .8 1.6 2.3 6.4 6.5 30.4 10.6 37.3 2.9l4.5-6.3c1.5.9-2 2.8.6 4.8q-4.6 9-10.8 17.2c-2.8-3.1-12.4-.2-16.5-1.8a69 69 0 0 1-46-25.9c-10.5-16.7-19.5-46-15.4-65.8.7-5.3 4.5-14.1 2.3-19z"/><path fill="#a3b8b7" stroke="#a3b8b7" stroke-width=".5" d="M788 423c1.6-.2.5 1.5.8 2.4a9 9 0 0 1 1.5 3.8c1.2 4 6 8.5 4.3 12.9q-.5 0-1-.4c-1.8-7-5.8-9.6-12.5-6q-1 0-1.5-.9 4-6 8.4-11.8Z"/><path fill="#d4dddd" d="M790.4 419.8q2.5 3.2 5.3 6c3 5.5-1.8 10 4.7 14.3 3.5 1.2 5.3 4.1 9 1.3q1.5.6 2.8.6l.7 3c-3.8-1.8-12.6 3.8-16.3-5.6-1.7-4.6-2.3-11.3-5.7-15-.5-1.6.2-2.3-2-2.5zM890 552c3.3-.5 3.6 3.6 4.9 5.7 2.5 2.7 3.7 3.6 4.6 7.5 1.5 2.4 7.5 3.8 9.9 2.4q1.3.1 2.5.6l.9 3q-.9 0-1.4.5c-1.2-2.3-.8-1.2-2.7-.8q-2-1.1-4.2-.7a11 11 0 0 1-7.6-7.4q-1.4-.7-2.5-1.5-1-3.4-2.6-6.5l-2.5-1.9z"/><path fill="#e5eaea" d="M791 419c8.4-.6 8 5.5 7.1 11.6q-.3 2.3.2 4.6 3.6 2 7.3 3.7c2.3.5 4-2.6 5.4-2l1.2 5q-1.5 0-2.7-.5c-3.7 2.8-5.6-.1-9-1.3-6.6-4.2-1.9-8.8-4.8-14.3a65 65 0 0 1-5.3-6zm101 130c2.8 0 2.5 3.5 4.7 4.7 1 3.3 3.7 4 3.2 7.8 2.8 7.1 6.6 1.7 9.5 3.3q.5-.8 1.4-.7l1 4q-1.1-.4-2.4-.6c-2.4 1.4-8.4 0-9.9-2.4-1-3.9-2-4.8-4.6-7.5-1.3-2.1-1.6-6.2-5-5.7z"/><path fill="#f6f6f6" stroke="#f6f6f6" stroke-width=".5" d="M811 437c-1.4-.7-3 2.4-5.4 1.9q-3.8-1.6-7.3-3.7-.5-2.2-.2-4.6c.9-6.1 1.3-12.2-7.1-11.6q3.9-5.3 8.2-10.2.7-.7 1.6 0 6.6 13.5 10.2 28.2ZM635 692l-3.6 2.1c-6-2.4-5.4-12.4-6.4-17.7l-1.4-4q-.8 1.6-2.6 1.6 1-6 1.6-12 1.3 0 1.8 1.2Q631.5 677 635 692Z"/><path fill="#b6635a" stroke="#b6635a" stroke-width=".5" d="M519.8 393.9c5 8.2 6.9 13.8 6.4 23.5 0 4.8 2 8.7 3.3 13.2q1 7.2 3.5 13.9a141 141 0 0 0 21.2 27c7.8 5.4 14 16 24.2 17 13.3 1.7 20 6.5 29.4-6.2q1.5-1.6 3.6-2c.7 1 .2 2.8 1.9 2.8-25.6 57-98.8 43.8-115.8-12-8.5-28 2.1-57 22.3-77.2Zm130 35.9c2.1 4.9-1.7 13.7-2.4 19-4 19.7 5 49.1 15.4 65.8a69 69 0 0 0 46 25.9c4.1 1.7 13.7-1.3 16.5 1.8-32.3 41.8-102.1 25.1-111.5-26.6-4.2-19.2 9-35.5 13-53.6a89 89 0 0 1 23-32.3Zm192 194.2c3 1.8 3.2 4 3.4 7.3 0 6.4-1 12.6-.3 19q-.7.4-1.4 0v11.4q0 2.6.5 5.3c2.6 14.6 3 26 13.9 37.6q6.6 7.5 13.8 14.2 3 4 4.5 8.7l1.4 2q-.5.4-.8 1a5 5 0 0 1-.3 6.7l-2.1 1.3 2.8 1c-29.2 6.7-57.1-13.3-64.3-41.5 11.3-2.6 7.3 10.5 8.5 11.7l7.4 2c-.4 3-.6 6.5 1.8 8.8q0 1.8-1.1 3.2c5.5-1.1 7.1-5.2 8.2-10.2-1.4-1.2-1.7-.7-.3-2.5.4-1.8-.7-1.1 1.3-2.5-3-3.7-4.5-7-4.8-11.8l-1.4-.7c-1-1-2.3-3.1-4-2.4q-.7-2-1.1-4.1c-1.4-8 1.6-22.6 2-31q-1-6.5-3-12.6l-1.8.8q-.7-.3-1.2-.9a99 99 0 0 1 18.5-21.8Z"/><path fill="#cd7c70" stroke="#cd7c70" stroke-width=".5" d="M531.8 384.6q.3.8.9 1.2c6.8 2.5 2.7 15.4 2.6 20.6 1 6.7 8.5 32.6 14.1 37.7 18 17.4 31.4 37.1 56.8 18.6 9.9-5.3 8.5-16.7 15.3-24.2.7 1.3-.1 5.4 1.8 5.6a130 130 0 0 1-10 39c-1.7 0-1.2-1.8-2-2.8q-2 .4-3.5 2c-9.4 12.7-16 8-29.4 6.2-10.1-1-16.4-11.6-24.2-17-7.4-7.1-16-18.4-21.2-27a68 68 0 0 1-3.5-13.9c-1.3-4.5-3.3-8.4-3.3-13.2.5-9.7-1.3-15.3-6.4-23.5q5.7-5.1 12-9.3Z"/><path fill="#d98c7f" stroke="#d98c7f" stroke-width=".5" d="M546 377.8c1.3 2.9 5.6-1.8 7.7.7l-2.1 1.3q-4.8 11-7.2 22.7c5.6 4.7 7.6 20.8 9.2 27.7 2.1 9.3 16 17.6 22.4 24.4 19 6.6 36.6-.3 40.6-21.5q.8-7.2 1.3-14.6 1-1.2 2 0c.6 1.6 0 2.4 2.1 2.5a83 83 0 0 1 1.3 23.1c-2-.2-1-4.3-1.8-5.6-6.8 7.5-5.4 19-15.3 24.2-25.4 18.6-38.8-1.2-56.8-18.6-5.6-5.1-13-31-14.1-37.7.1-5.2 4.2-18-2.6-20.6q-.6-.4-.9-1.2 6.6-4.4 14.1-6.8Zm135 36.6q0 .9.6 1.6l4.1.4q-4 6-8.2 11.7c-9.3 12.6 7 62.4 22 63.4q.5 1.5 2 1 0 1.8 1.8 2.2c18 5.9 30.6-.9 36.4-18.6q.1-.8-.2-1.5 1.1-.8 1.4-2l1.8-16.5c.6-1.7 2 .2 3.3 0 6.3 22.2.2 48.7-10 69-2.6-2 1-4-.5-4.8l-4.5 6.3c-7 7.7-30.9 3.6-37.3-3-.5-1.4.8-1-1.6-2.2-1.7-3.4-3.1-6-6.8-7.7a10 10 0 0 1-3.8-1.3q-.6.4-1 1.2-2-2.4-4.8-3.8l-.6-1.4c-1.9-1.9-3.9-4.5-6.6-4.8-1.3-2.2-1-.5-2.3-1.3-6.5-16.2-14.2-39-11.8-56.4.7-4.9 4.8-15 1-18.9q-1 1-1.6-.5 12-9.6 27.3-12.1Z"/><path fill="#f2b6ab" stroke="#f2b6ab" stroke-width=".5" d="M583 377.2a56 56 0 0 1 26.3 17.5c-.5 2.2-1.4 0-2.1 1.3-6 13.4 8.7 23-9.8 37.9a13 13 0 0 1-5 2.8c-1.5-1.4-.2-1.7-2.4-.5-16.8 2.8-42.2-34.5-22.4-47l12.6-6.6a8 8 0 0 0 3.5-3.1c-1.1-.7-2.3-1.1-.7-2.3Z"/><path fill="#e6a196" stroke="#e6a196" stroke-width=".5" d="M583 377.2c-1.6 1.2-.4 1.6.7 2.3q-1.3 2-3.5 3.1l-12.6 6.6c-19.8 12.5 5.6 49.8 22.4 47 2.2-1.2 1-1 2.5.5q2.7-.9 5-2.8c18.4-15 3.7-24.5 9.7-37.9.7-1.4 1.6 1 2.1-1.3A59 59 0 0 1 622 421c-2-.1-1.5-1-2-2.5q-1-1.2-2 0-.5 7.4-1.4 14.6c-4 21.2-21.7 28-40.5 21.5-6.5-6.8-20.4-15.1-22.5-24.4-1.6-7-3.6-23-9.2-27.7q2.4-11.7 7.2-22.7l2.1-1.3c-2.1-2.5-6.4 2.2-7.8-.7a58 58 0 0 1 37.1-.7Z"/><path fill="#cfd8d7" d="M694 354c6.6 2.2 4.7 16.9 14.6 18.8 1-.1 4.2.4 4.6-.8h.7q.2 2.5.8 5.1-5-.9-10-2.4-2-1-3.6-2.8l-.8-3a1 1 0 0 0-1 .1c-3.4-4.5-6-7.4-7-13.3z"/><path fill="#bccaca" stroke="#bccaca" stroke-width=".5" d="M574.3 337c1 8.6 9.2 10.4 15 4.7a3 3 0 0 1 1.8.3q.8 6.7.8 13.4l-.4.2q-8.6-4.2-17.7-7.3-1-1.5-.2-3a8 8 0 0 0-.7-5.2 4 4 0 0 0 1.4-3.1Zm125 32a1 1 0 0 1 1 0l.9 3q1.5 1.6 3.6 2.7 5 1.5 9.9 2.4l1 8.4q.1.8-.4 1.3-8.5-3.2-17.3-5.7c.2-3.6.5-8.4 1.2-12Zm89.6 52.9c2.2.2 1.5 1 2 2.5 3.4 3.7 4 10.4 5.7 15 3.7 9.4 12.5 3.8 16.3 5.6l1.1 6.6a2 2 0 0 1-.5 2q-8.5-3-17.5-4.9-.3-.6-1.1-.5-.4-3-.3-6.1c1.7-4.4-3-8.8-4.3-12.9a9 9 0 0 0-1.5-3.8c-.3-1 .8-2.6-.8-2.4zm-169 257c4.4-.1 2 5.1 2.9 7.6l1.6 5.7q4 4.8 10 6.8c.6 1.2 1 2.6 2.7 2q.4 1.2-.6 1.8a141 141 0 0 0-12.7-3.5q.3-.6.8-1 1.6-.1 3-.7a37 37 0 0 0-4.6-3q-1.3-2-1.9-4.2l-.3-5.2c-1.5 1.6-1.8-.3-2.3-1.4z"/><path fill="#8da4a4" stroke="#8da4a4" stroke-width=".5" d="m554.6 335.6 5.3 6c.4 2.2-3.5.5-4.1 2.8-1.3-.3-6.8 0-7.4-1q2.9-4 6.2-7.8Z"/><path fill="#9aaead" stroke="#9aaead" stroke-width=".5" d="M564.9 324c-.2 5.8 8.7 12.4 8 16a8 8 0 0 1 .7 5.3q-.9 1.5.2 3-9-2.5-18-3.9c.6-2.3 4.5-.6 4.1-2.7l-5.3-6.1zm127.4 31.8c1 5.8 3.6 8.7 7 13.2-.8 3.7-1 8.5-1.3 12.1q-10.7-2.5-21.6-4-.7 0-1.2-.6 2.5-3.9 5.5-7.4 5.6-6.8 11.6-13.4ZM885 559q1 0 2.1.4c4.8 5.1 13.1 10.8 11.8 18.9q-12-2.4-24.2-3.5-.3-.5 0-.8z"/><path fill="#c7d2d1" stroke="#c7d2d1" stroke-width=".5" d="m568.7 319.7-.5 2q1.3-.4 2.5 0c4 4.8 3.4 9.4 3.6 15.3a4 4 0 0 1-1.4 3c.7-3.6-8.2-10.2-8-16z"/><path fill="#d7dfdf" d="M570.7 317.7q1 1.5 2.6 2.4c5 5.3-1 23.7 10.7 20.7 1.3-.6 5.7-2.2 6-3.6l.8-.2.3 5a3 3 0 0 0-1.8-.3c-5.8 5.7-14 4-15-4.7-.2-5.9.4-10.5-3.6-15.4q-1.2-.3-2.5.1l.5-2z"/><path fill="#e8ebec" d="M572.6 315.6q.5 2 2 .8 0 2 1.9 2.7a11 11 0 0 1 1.6 7.3c1.1 4.5 5.1 10.2 10.4 8q.3 1.6 1.5 2.8c-.3 1.4-4.7 3-6 3.6-11.7 3-5.7-15.4-10.6-20.7q-1.6-1-2.7-2.4zm124 35.1 1.3 2.9c5.9 3.3 3.5 8.7 6 13.2q2.4.9 4.7 2.3c3.2.2 3.1-.1 4.6 3-.4 1.1-3.6.6-4.6.7-9.9-2-8-16.7-14.7-18.9z"/><path fill="#f8f8f8" stroke="#f8f8f8" stroke-width=".5" d="m590.8 337-.8.2a6 6 0 0 1-1.5-2.8c-5.3 2.2-9.3-3.5-10.4-8a11 11 0 0 0-1.6-7.3 3 3 0 0 1-1.9-2.7q-1.5 1.2-2-.8l10.4-10.9q.4-.5 1 0c4 10.5 5.1 21.2 6.8 32.3Zm123.1 35h-.7c-1.5-3-1.4-2.7-4.6-3q-2.2-1.3-4.8-2.2c-2.4-4.5 0-10-5.9-13.2l-1.2-2.9 8.5-9q.8-.6 1.5 0a178 178 0 0 1 7.2 30.3Zm196.9 192q-1 0-1.4.8c-3-1.6-6.7 3.8-9.5-3.3.5-3.7-2.2-4.5-3.2-7.8-2.2-1.2-2-4.7-4.6-4.7q3.3-4.8 7-9.4a1 1 0 0 1 1 0 98 98 0 0 1 10.6 24.4Z"/><path fill="#4b3d34" stroke="#4b3d34" stroke-width=".5" d="m544 347.2-.4 1h-1q-7.8 3.6-15.3 7.6c-3.3 2.2-6.7 4.4-7.3 8.7q-.5 9 5.5 15.7a3 3 0 0 0 2.7 1 89 89 0 0 0-39 64c-2.2.2-1 5-1.6 6.5l-2.7-3.9c-3.5 2-3.5 21.2-4.2 25.2q-.2 6 2.8 11.2l1.3.5c0 1.8-3.7 2-3.6 3.6l2.4 1q1.5.5 2.9 0c.5.5-.6 5.5-2 5.3a14 14 0 0 0-7.3-5.8q-1.2.5-.5 1.6l-.8 1q-1 2.7-1.4 5.6c.4 2 .4 6.3 2.1 7.6q-1.5.2-2.6 1.2a155 155 0 0 0-78.7 8.3q-1.4 0-.9-1.2c15.8-19 24.6-46 36.2-67.9 23.5-48.2 65.4-113 123.9-118.8q1.9.3.7 1.8l-14.8 17c-1.2 1.4 2.9 2 3.5 2.3Zm131.2 34.4c-5 1.3-9.6 4.2-14.3 6.3-3.5 2-7.1 5.1-6.3 9.6l-1.6.7q-3.4 5.3.3 10.3 2.9 2.5 5 5.5c1 1.4-1 1.5 0 2.3l1.9.1a88 88 0 0 0-29.3 27.1q-.6.6-1 0 2.1-17.5 3.9-35.2 1.2-16-1.2-32c1.2-14.8 39.7-23.1 51.8-21.2q.9.9 0 2a898 898 0 0 1-18 21.7q0 1 1 1.3zm94.5 508.2c1.3 2.2.9.9-.2 2.3-.6 6.6 3.4 9.5 8.8 12.2l.4 1.6q1.5-.2 3-1.2c2.7-.3 3.5 1 4.8 3 1.3-2 3.5-2 5-3.7.5-1-.6-.8-1-1.6q1-3 4.3-3.6a74 74 0 0 0 8.3-1.7c4.7-1.8 9.2-7.2 12.7-10.7 4.1-4.4 6.9-11.2 12.2-14.1q.4-1.6 1.6-2.8.7 0 1.5.6c-20.5 43.5-42.2 64.5-84.2 87.1-23.1 13.2-48.8 24.6-75.8 25q-.2-.6-.8-.9-7.5-.5-14.8-.3-2.2-.6 0-1h10q2.1-.3.2-1.1c-4.4-.5-8.1-2-9.7-6.4q-.6-2-.5-4-1.5-.6-2.8-1.4-3.8-.8-7.4-2.2l-1 .2-.8-2.5q-.9 0-.7-1l2-4q-.9 0-1.7-.3.6-1.3.3-2.7l1.2-1.1a3 3 0 0 0-3.1-1q-.6-.1-.3-.7c2.7-3.2 5.7-6.7 5.7-11a3 3 0 0 1-1.7-.5l.2-1.8q-.9-3-3.6-4.8a1 1 0 0 0-1-.5q-1.9 2.8-1.7-.5c2.5-2 1.6-.5 0-3.4-3.6-11-7.9-14.4-16.6-21.4-3.9-6-7-11.9-13.8-15.1-3.6-3.3-4.3-7.4-4.3-12.3q.9-.5 2-.8.5-.4.4-1l-4.5-.2a3 3 0 0 1-1.8-1.1l-2 1.3q-.7-2.3-2-4.3c-1.8.8-3.8-.1-5.4-1.1-.2-1.2 1-1.1 1.5-1.8-2.2-.6-2.6-.1-4.1-2-2.1 3-1.9.6-3-1.5-10-8.2-12.7-13.6-26.2-7.9l-2 1.4 1.3 1a1 1 0 0 1-1 .4q-3.7-.8-7.1.7-.4-.8 0-1.7-3.6-3-8-4.7c1-3-1.2-1.2-2.8-2.4l-3.2-2.4-1 1.2q-2.9-2.2-5.1-5.2l.7-1.5q.3-5.4 1.4-10.5-.6.3-1.3 0 .9-1.1 2.2-1.1 1.5-1.4 2.3-3.3.7-2.6.5-5.3.3-.7 1.1-.6 1 1 2.3 1.6.4-.4 0-1c-2.9-4 .3-7.7 5-6.1.7-.6.2-2 .6-2.9 2-4.5 5.1-11.7 0-15.5-.5-1.3 1.1-.3 1.6-1q-.5-1.2-.2-2.7l-1.2-1q1-2.1 3.2-.8c.7-1.7.3-2 2-3.2-2-1.2-.3-2-1.7-3.8q-.9 0-1.8-.4l2-2.8q1-2.3-.3-4.4c-3 .2-2.2-.5-2-2.4-.2-1-2.6-2.4-1.3-3.3h1q2-3.7-1-7l1.2-1.1q.6-3.3 0-6.6l-1.6-.4a207 207 0 0 1-3.4-15.4c-2-7.4-9.3-14-16-17-1.4 1-1.4 2.3-2.2 3.8-8-.6-7-.4-12.7-6l6.3-4c15-8.3 39.4 22.3 46.5 33 27.9 38.7 23.6 86.6 48.8 125.4 37 53.8 112 49.5 157.3 8.7Z"/><path fill="#53453c" stroke="#53453c" stroke-width=".5" d="M446 509.6q.1.6.8 1c3.5.7 4.7 4 5 7.1l-.4 5q1.5-.9 1.7.8c.5 1.7 0 4.6-2.4 3.8-1.8-.6-3.3-2-2 1.3l-3.5-.6q-1.5.9-1.9 2.6 2.4 1-.2 2v-.2c-1.9 3-.6 5.2 1.2 7.6-.4 1.7-1.5-.4-1.9-.7q-.6 1.5.2 3.2c-1.5 1.2-1.6 1-.1 2.6a21 21 0 0 1-11.9 3.4l-1-1q-1.2 1.2-3 1.2a25 25 0 0 0-9 6c-.6-.7-1.5-2.5-2.3-1q-2.6 5-5 10.2-1 2.2-.5 4.6.2.6-.3 1.2l-1-1.3q-2 2.5 0 4.8l1.4.5q.9 5-2.7 1.5c-5.1-2.2-4 2.7-2.6 5.3l-5.2.7q-.7.3-1.2 1 .8.1 1.2-.5a2 2 0 0 0-1.6.7q1.5 2 2.8 4.1c3.2 3.6 7.1 1.2 11 1q.3 1 1 2.1l3 .6c2.4-.7 2.2-2 2.7 2q1.7 3.3 5.2 2.2 1.5 1.3 3.5 2c5.2 4.2 3.7 9.5 2.4 15.1 1.3.8 2-.7 3.7.8q1 1.5 1.4 3.3c3.5-1 2.6-2.4.5-4.5a275 275 0 0 1 16.4 4.4q.8.9 1 2.1l1-.2q7.6 2.4 15.5 1.5l1.6.8q1.5-3 2.5-6.1a6 6 0 0 1 6.8-2.6q1.2 1 2.6 1.4l1.2 3.2-.2-.2c1.5 1.7 4.1 1.2 6 .3q.7.4 1.2 1 4-1.3 8-2.2-.9-2 .6-3.8c1.7-1.7 2-.6.2-2.2a20 20 0 0 1 3.5-2 5 5 0 0 0 1.5-5.3c0-1.3-2.4-2-.7-3 2-2.3 5.7-3.8 8.5-2-20.7 40.3-4.5 87.1 33 110.7-3.2 2.2-6.4 2.4-6.5 7.3-.3 2 1.8 1.4.3 3.5a175 175 0 0 1-55-18.2l-26.4-15.4q-.5.8.3 1.6c10.5 11.3 21.5 18 35.5 24.5l18.3 7.5q.1.6-.4 1a150 150 0 0 1-33 22.1q-10.1 5-20.2 9.6a3 3 0 0 0 2.3.5c18-2.3 36.4-13 50.4-24.1 5.7 5.5 4.7 5.3 12.7 5.9.8-1.5.8-2.8 2.1-3.9 6.8 3.1 14 9.7 16 17a207 207 0 0 0 3.5 15.5q.9 0 1.7.4.4 3.3 0 6.6l-1.4 1.2q3 3 1.2 7l-1.1-.1c-1.3.9 1 2.3 1.2 3.3 0 2-1 2.6 2.1 2.4q1.4 2.1.3 4.4-1.1 1.2-2 2.8l1.8.4c1.3 1.7-.4 2.6 1.6 3.8-1.6 1.2-1.3 1.5-2 3.2q-2-1.3-3.1.8l1.1 1q-.2 1.5.3 2.7c-.5.7-2-.3-1.6 1 5.1 3.7 2 11 0 15.5-.4.9 0 2.3-.7 2.9-4.6-1.6-7.8 2-4.8 6q.2.7-.1 1-1.2-.5-2.3-1.5-.8 0-1.1.6.2 2.7-.5 5.3a8 8 0 0 1-2.3 3.3q-1.3 0-2.2 1 .6.4 1.3 0-1 5.2-1.4 10.6l-.7 1.5q2.2 3 5.2 5.2l.9-1.2 3.2 2.4c1.5 1.2 3.9-.6 2.9 2.4q4.2 1.8 7.8 4.7-.3.9 0 1.7 3.5-1.5 7.2-.7.6.1 1-.4l-1.3-1 2-1.4c13.4-5.7 16.2-.3 26.2 8 1.1 2 .9 4.5 3 1.4 1.5 1.9 2 1.4 4.1 2-.6.7-1.7.6-1.5 1.8 1.6 1 3.6 2 5.4 1q1.3 2.1 2 4.4l2-1.3q.7 1 1.8 1l4.5.3q.1.6-.5 1l-2 .8c.1 4.9.8 9 4.4 12.3 6.9 3.2 10 9 13.8 15.1 8.7 7 13 10.5 16.7 21.4 1.5 2.9 2.3 1.5 0 3.4q-.3 3.3 1.5.5.7 0 1.1.5 2.7 1.7 3.6 4.8l-.2 1.8q.7.4 1.6.4c.1 4.4-3 8-5.6 11q-.2.6.3.9a3 3 0 0 1 3.1.9l-1.2 1q.2 1.5-.3 2.8.8.3 1.7.3l-2 4q-.2 1 .7 1 .3 1.3.9 2.5l1-.2q3.4 1.5 7.3 2.2 1.3.9 2.8 1.3-.1 2 .5 4c1.6 4.5 5.3 6 9.7 6.5q2 .8-.2 1l-10 .1q-2.2.4 0 1 7.5-.2 14.8.3.6.3.8 1c-12 1-23.7.1-35.7-.4q-2.7.6 0 1.3l13.6 2.3q22 3.6 44-.2 1.2.8 2.6 1.2c-.6.7-2.3 1.5-.2 2.1 2.7-1 3-.4 5.1 1 2.4-.5 3.9-1.4 5.3 1.2 5.7 1 7 4 11.7 7.2q.5.6.3 1.3c-5.1 6.6-3.8 10-1.7 16.8-13.7 19-32.8 32.2-50.4 47.1-34.4 29.6-58.3 75-82.1 113-30.2 51-58.1 103.8-89.5 154q-1-.9-2.3-1.3-7 3.9-11.4 10.6c1 .8 2.2 1.2 0 2-.8 0-2.6-1.7-3.3-1q-3.4 3.5-6.5 7.1-1.5-2.6-2.2.4c.2 3.1-1 2 2 4 1.8 1.4 3 5.4 4.8 6.1-30.9 42.2-67.8 75.2-118 92q-2-.5-3.8-.5.9-.4 1.4-1.3c.4-12 2-13.2 13-17.2q7.1-3 8.5-10.4 1.5-.4 2.7-1.3.3-.7-.4-1c-3.6 1.4-3.7-3.3-3.9 3.9-1.5 1.2-2.3.1-3.2-1q-.6.3-1.2 0c-1.9-5.6-11.3-9.6-13.8-2.7-2-1.5-6 1.2-8 2-1.9-3.5-2.8-6.2-7.2-7l-2.9-.1q.4-.7 0-1.5l-2.7.7-2.2-1.4-2 4.3q-.5-1.5-2-1.8l-4.5.9c-1 2.3.4 3 1.6 4.7q-4.3 1.4-8.8 2.3c-2.3.9-.5 1.5-3.8-.3q-.8 0-1.4.2c-1.2-2-1-1.2-3-1l-2-1.3q-.7.3-.5 1 1 1.9-.6 3.3c-1.5-1-2.2.5-.9 1.4q1.5.4 3-.5.3 1-.6 2l-2.4-.5q-.5.7 0 1.5c-2.3.5-2.6 1.6-5.1.7l-1 .4q-1.5-1.7-2.5-4-.7-.5-1.5 0c-1-1.6-.9-1.8-2.1 0-3-2-.5-4.2-2-5.3l-1.7.7a6 6 0 0 1-2.6-2.4q-1-2.4-1.2-5c-1.5-.6-1.2.7-2.7-1.7a64 64 0 0 1-3.3-7.3c-.8-1-1.7.7-2.3 1q-1.5-3.3-3.1 0c-1.6-.6-1.9-1.2-3-2.3q-.9 1.3-2.2 2.2a3 3 0 0 1-.8 3q-.6.1-1.2-.2l-1.8-2q-1 1.2-2.1 2.2.5 1 0 2c-1.2-.3-.6-2.7-1.4-3.7q-2.7-3.3-6.4-1.2l-1-1.4-3 2.4-1.1-1.3q-.9 1-1 2.3-.7-.3-.9-1.1 0-3-.3-5.8l3-.8q.6-.4.2-1-3.8-1.2-8-1.4-.7.4-1 1.1-.7-2.4-2.4-.5c-2.1.5-3-.9-4.6-1.8q-1.4 2.3-3 4.3c-1.7-4.2-2.7-1.7-5.8-1.8q-.4-1.3-1.4-2.3-7.6-4.2-15.6-7.9-.7-1.3-1-2.8-1-2.3-3.3-1.4-1.6 1-2.8 2.3c-.4-4.5-4.3-3.5-4 0l-1-1.6q.1-1.2-.2-2-1-.5-2-.6c3.6-.8-1.3-5.2-2.8-5.7-.1.6.6 2.3-.8 2l-4.4-4.4q.7-.8 1-1.5c-4-4.8-11.7-8.4-17-11.5.5-.9 1.5-2.5.1-3.1-2.7.5-3.6 3-3-1-1.1-2.6-4.3-5-6-7.3q-4.2-4.5-4.3-10.7c-1.7-3.3-.8 2.5-2.8-.8.7-1.2 1.3-3-.9-2l-.9-1.6a4 4 0 0 0-.3-1.8l-4-.6q1-1.5 1-3t-.8-2.3q-1 1-1 2.5a8 8 0 0 0-1.2-3.2q1 0 2-.4 0-2 1-3.7c-.1-2.4-2-.2-2.8.2q.6-2.6.2-5.1a2 2 0 0 0-1.3-1q2.2-.6.7-2-2 .2-3.7 0 .6-.7.5-1.6a22 22 0 0 1-8.4-5.6q-1.8.5-1 2.2-1.5.5-1.8-1l.2-7.5q0-3.7-2-7l-3.6-3.5c.8-.6 2 .1 2.4-1-1.3-1.8-2 0-.4-2.5q-1-5.7.6-11.5 1.2-2 1.8-4.2 1.4.6 2.7.1.3 1.4 1.1 2.4a3 3 0 0 0 .8-3.5q-1.2-1.6-2.9-2.8 1-.1 2.1.3c1-.8 1.2-2.9 0-3.5q-3.8 1-7.2-1l-2.8-2c-.7.3-1.1 2.1-2 1.2a3 3 0 0 0 .5-2 9 9 0 0 1-2.5-4c.7-.9 1.4 1 2 1.2q.7-.3.5-1.1c-1-1.6-1.4-6.3-2.6-7.2q2.2-2.9 2-6.7.2-.6 1-.4.6 1 .4 2.2.3 2.1 1.8.6 2.4-1.6-.2-2.6c1.2-1.6 2.3-2 1-4a5 5 0 0 1 2 .2c2 .2 4.8-2.3 4.6-4.2-.8-1-1.6 1-2.5 1.2-.2-1-3.2-5.2-4.2-3.2l1.3 2.3q.3.9 0 1.8-.6-1.6-2-1-1.2-2.5-2 0c-.6-2.6.5-6.4-3-3-2-1.6-2-1.9-4 0l.3-3.2c-.2-1-.9-3.7-2.3-2.9-.8-1-.7-1.5-2-1l-2.5-5.1c-1.7-1-1.3 2.6-1.6 3.2-5.6-2.2-.3-5.2-2-6.3q-1.2 1.2-2.7 2a4 4 0 0 1-3.4-.8q.8-2-.9-3.3-2 1.4-4 2.4c-1.1-.7-.2-2.7-.6-3.8-.3-1.6-2.7-4.6-4.4-4-1 .8-3.1 2.8-2 4.7-1.9 1.3-1.2-3-1.2-3.8l1.4-1.2-2.3-3.5h-.7a5 5 0 0 1-3 1.8q-2.3.1-4.4-.7-1 1.8 1.1 1.4c1.6 2.1 1.3 1.7.4 4l-.2 3.1c-1-2-2.7-1.8-4.6-1a7 7 0 0 0-1.5 4q-1.5-2.8-4.1-4.6c-1.4-.2-1.2.9-2 1.6q-.3-1.5.3-3.2c-.2-.8-.5-3.5-1.7-3q-2 .4-1.4 2.1-1.5 0-3.2-.7-.9 0-1.4.8c-.6 3.5 0 4-3.5 2 .2-.9 1-1.7 0-2.3q-2.4.7-4.5-.7a25 25 0 0 1-2.5-4.3q-.7 1-1 2.3l-.7-2.7q6-19.2 16-36.7c33.8-58.3 80-54.6 139.4-61.5 103-13.4 144.6-92.2 180.7-178.8 1.4-.4 4.8-5.2 6.2-6.4 3.9-4.8 8.2-16.9 16.3-12.3q1 .9 2.2 1.5l7.5-8a266 266 0 0 0 85.5 39.3q.8.2 1.3-.6c-.5-1-5.6-2.9-7-3.4 2.5-4.7 1.7-11-4.8-11l-4.6 1.5q-.1-1 .2-2l-1.2-1v-3q.8.3 1.5-.2 0-1.4-1.5-1.5-1.5.7-3 .8.5-1.5-1-2.2c1-.7 3.5-1.1 3.4-2.7l-1.5-1.2c3.5-7.4-.6-15.2-5.9-20.5q-4.5-4.4-9.8-1.3-.3-.6-.3-1.3-4.6-1-8.8-2.6 0-.8-.4-1.6-1.8-3-4.6-4.9.2-2.2-1.5-.7l-.6 3a10 10 0 0 0-7.6-5.8q-2.2.2-4.5-.3l-.2-4q.1-1 .5-2c-1.3-1.3-2 .8-3.2 1.2-2.5-1.8-3.5 2-3.3-2.4q-1.5-4.2-5-7c-.1-1.6 1.9-.7 1.7-2.6l-3-2.2-1.5-3.2c-.9.7-1.5 3.2-3 2.2q.4-1 .5-2H422q-1.3-1.3-2.7-2l-1.2-6q0-.8-.7-1.1l-2 2.3c-1-2.3-2.5-2.2-4.4-3.3-1.6-1.3 0-.8.6-1.8a84 84 0 0 1-7-8.3c.5-3-.7-3-2.3-.7-1-1.9-.8-1.3-2 0l-3.6-4.9-1.5-1.3q-.6.3-1-.2-1.2-3.7-.4-7.6-.7-.4-1.5 0c-1-2.8-2.5-3.8-2.2-7.1q1.5.7 1.8-.8l-2.5-3.4q-.9 1.6-1 3.4-.5-2.6-2-4.5a29 29 0 0 0-5-5c-1.2.2-1.4 1.9-2.2 2.6q-1-.5-1.9-1.4-.5 0-.9.2 0-2.5-.3-5.1a9 9 0 0 0-5.9-6.3c-2.3-.2.6 2.1-1.5 1.5a4 4 0 0 1-1.4-2.2l2-.6q.9-1.5 2.3-2.5-1.2-2.3-3.2-.8 0-2.3.6-4.4a8 8 0 0 0-1.3-5.3q-1.2-.6-2.3-1.5c-2.1.7-1-.7-.9-2l-2.3-2 1.4-1.9c-2.9-1.8-1.3-4 0-6q-1.6-1.3-2.7-3.1-1.2-.8-2.4.2c-1.2-1.5-1.5-1.6-3.2-2.2l.3-1a15 15 0 0 0-5.8-2.3l-4.2-.3q0-1.2-.4-2.5c-.8-2.5-1.9-.8-3-.2-4.7-1-9-2-13.4 1a35 35 0 0 1-3.8 3.9q-7.2-11.4-13-23.5c-23.8-47.4 2-108.7 21.6-153.4 22.2-48.4 58.8-73 112.3-74.5Z"/><path fill="#463830" stroke="#463830" stroke-width=".5" d="M545.1 707a89 89 0 0 0 27.7 9.9q.6.6-.2.9a113 113 0 0 1-33.6-.1c1.5-2-.6-1.4-.3-3.5 0-5 3.3-5.1 6.4-7.3Zm-128 195.7-7.5 8q-1.2-.6-2.2-1.5c-8.1-4.6-12.4 7.5-16.3 12.3-1.4 1.2-4.8 6-6.2 6.4 5-10.4 9.4-20.7 21.6-24.1 3.3-.9 7.1-2.1 10.6-1.1ZM48.8 1204.9l.8 2.7q0-1.4.9-2.3a25 25 0 0 0 2.5 4.3q2.2 1.5 4.5.7c1 .6.2 1.4 0 2.2 3.6 2 2.9 1.6 3.5-1.9q.5-.8 1.4-.8 1.5.7 3.2.7-.7-1.9 1.4-2.1c1.2-.5 1.5 2.2 1.7 3q-.6 1.5-.2 3.2c.7-.7.5-1.8 1.9-1.6q2.5 1.8 4.1 4.6 0-2.2 1.5-4c1.9-.8 3.6-1 4.6 1l.2-3.1c1-2.3 1.2-1.9-.4-4q-2.2.4-1-1.4 2 .9 4.3.7a5 5 0 0 0 3-1.8h.7l2.3 3.5-1.4 1.2c0 .8-.7 5 1.2 3.8-1.1-1.9 1-3.8 2-4.7 1.7-.6 4.1 2.4 4.4 4 .4 1.1-.5 3.1.6 3.8l4-2.3q1.5 1.2 1 3.2a4 4 0 0 0 3.3.7q1.6-.7 2.7-2c1.7 1.2-3.6 4.2 2 6.4.3-.6-.1-4.2 1.6-3.2l2.4 5.1c1.4-.5 1.3 0 2 1 1.5-.8 2.2 2 2.4 3l-.4 3c2-1.8 2-1.4 4 .2 3.6-3.5 2.5.3 3 3q1-2.7 2-.1 1.5-.6 2 1 .4-.9.1-1.8l-1.3-2.3c1-2 4 2.2 4.2 3.2.9-.1 1.7-2.2 2.5-1.1.2 1.8-2.6 4.3-4.6 4a5 5 0 0 0-2-.1c1.3 2 .2 2.4-1 4q2.6 1 .2 2.6-1.5 1.5-1.8-.6a3 3 0 0 0-.5-2.2q-.7-.2-1 .4c.1 2.4-.3 5-1.9 6.7 1.2.9 1.6 5.6 2.6 7.2q.2.8-.5 1c-.6-.1-1.3-2-2-1q.6 2.3 2.5 4a3 3 0 0 1-.6 1.9c1 1 1.4-1 2-1.3l2.9 2.1a9 9 0 0 0 7.2 1c1.2.6 1 2.7 0 3.5q-1-.5-2-.3 1.5 1.2 2.8 2.8a3 3 0 0 1-.8 3.5q-1-1-1-2.4-1.6.5-2.8 0-.6 2.1-1.8 4.2a25 25 0 0 0-.6 11.4c-1.7 2.5-.9.7.4 2.5-.3 1.1-1.6.4-2.4 1l3.6 3.6q2 3.1 2 7l-.2 7.4q.3 1.6 1.9 1-.9-1.6.9-2.2c1.8 2.5 5.6 4.3 8.4 5.6a2 2 0 0 1-.5 1.6q1.8.2 3.7 0 1.5 1.4-.7 2 .9.2 1.3 1 .4 2.6-.2 5c.8-.3 2.7-2.5 2.7 0a8 8 0 0 0-.9 3.6l-2 .4q.9 1.4 1.2 3.2 0-1.5 1-2.5 1 1 .8 2.3 0 1.5-1 3l4 .6q.5.9.3 1.8l1 1.6c2-1 1.5.8.8 2 2 3.3 1.1-2.5 2.8.8q.1 6.2 4.3 10.7c1.7 2.2 4.9 4.7 6 7.3-.6 4 .3 1.5 3 1 1.4.6.4 2.3-.1 3.1 5.3 3 13 6.7 17 11.6l-1 1.4 4.4 4.3c1.4.4.7-1.3.8-2 1.5.6 6.4 5 2.8 5.8l2 .6q.3 1 .2 2l1 1.5c-.3-3.4 3.6-4.4 4 0q1.3-1.2 2.8-2.2 2.3-.7 3.2 1.4l1.1 2.8q8 3.7 15.6 8 1 .9 1.4 2.2c3 .1 4.1-2.4 5.8 1.8q1.7-2 3-4.3c1.6 1 2.5 2.3 4.6 1.9q1.6-2 2.4.4.3-.7 1-1 4.2 0 8 1.4.4.4-.2.9l-3 .8.3 5.8q.2.8.9 1.1.1-1.3 1-2.3l1 1.3 3-2.4q.7.6 1 1.4 4-2.1 6.5 1.2c.8 1 .2 3.4 1.5 3.8q.3-1-.1-2.1l2.1-2.1 1.9 2q.5.3 1.1.1a3 3 0 0 0 .8-3q1.3-.9 2.2-2.2c1.1 1.1 1.4 1.7 3 2.3q1.5-3.2 3 0c.7-.3 1.6-2 2.4-1q1.4 3.8 3.3 7.3c1.5 2.4 1.2 1.1 2.8 1.7q0 2.6 1 5a6 6 0 0 0 2.7 2.4l1.8-.7c1.4 1-1.2 3.4 1.9 5.4 1.2-2 1-1.7 2.1 0q.8-.5 1.5 0 .9 2.2 2.4 4l1-.5c2.6 1 2.9-.2 5.2-.7q-.4-.8 0-1.5l2.4.4q.9-.8.6-2-1.5 1-3 .6c-1.3-.9-.6-2.3.9-1.4q1.7-1.5.6-3.2-.2-.8.4-1.1l2.2 1.4c1.8-.3 1.7-1 2.9.9l1.4-.2c3.3 1.8 1.5 1.2 3.8.3q4.5-1 8.9-2.3c-1.2-1.6-2.8-2.4-1.7-4.7l4.5-.9q1.5.3 2 1.8l2-4.3 2.2 1.4 2.6-.7q.5.8.1 1.5h3c4.3.9 5.3 3.6 7.2 7 2-.7 5.9-3.4 7.9-1.9 2.5-7 12-3 13.8 2.7q.6.3 1.2 0c1 1.1 1.8 2.2 3.2 1 .3-7.2.3-2.5 4-4q.6.5.3 1.1-1.2.9-2.7 1.3-1.5 7.5-8.5 10.4c-11 4-12.6 5.3-13 17.2q-.5.9-1.4 1.3 1.8 0 3.7.6c-124 40.7-251-19.5-301-138.7a163 163 0 0 1-7.3-106.6Z"/><path fill="#eeb0a5" stroke="#eeb0a5" stroke-width=".5" d="M699 414q15.1 2 27.2 11.3c-5.6 8-16.5-2.4-23.9 1.5a46 46 0 0 0-14.1 14q-2.3 5.1-1.2 10.6c1.4 8.7 6.8 13.5 13.2 19 5.7 5.3 13 6 19.3 1q.5.5.8 1.2a9 9 0 0 0 4.4-5.5c.5-1-.4-4.1 1.5-3.6 2.7-2.3 3-4.5 3-7.8q.5-.6 1.3-.1c4.5-7.2-7-14.4-2.1-22.4 1-1.8 3.6-.7 3.9-2.4q7.6 8.4 11.8 19.2c-1.7.8-1.5.9-2.6-.5-9.4 8.7-4.5 24.6-13.1 33.4q-3.5 2.8-7.9 3.7c-1.4-2-.8-1-2.2 0-1.8.7-5.6 1.9-6.8-.2q-.4.6-1 1a40 40 0 0 1-25.8-23.8c-1.3-8.4-3.4-15.9-5.9-24-2.1-13 11.3-16.3 20.9-18.8 1-.4 5-2.2 3.6-3.7q-2.4-1-5-1.6zm114 71.2a55 55 0 0 1 37.4 34.6c-1.5 3.6-3.7 6.8-4.5 10.7q-1.1 7.5-1.6 15-4.1 21.2-25.7 21.4c-2.3 1.6-1.5.8-3.4-.3-6.8-1.6-12.6-6.2-18.4-9.8q-.7-.3-1.3-.2l-3.6-9-6-21.4a67 67 0 0 1 0-20.7q1.4-5.7 6-9.2 9.3-4 18.4-8.3 1.8 0 3.4-.5c-1.2-.7-2.3-1-.7-2.3Zm-9.8 41.1 1 5.2q4.2 2.7 7.8 6.1l1.3.6q0 .8.4 1.7 1.4 0 1.8-1.5c1 1.2 1.4 2 3.2 2 18.6-1.7 14-16.5 10.2-28.7-1-2.7-1.8-4.8-5.1-4.8-5.6-.8-16.3.7-17.2 7.6-1 .6-1.9-.8-2.5.2zm80.8 76.8c29.7-3 49.7 17.3 52.1 46-1.8-.8-2.4-4.9-3.3-6.5q-.8-1-1.7 0 .3 4 .2 8c-1.3 7.8-5.1 14.8-8 22.2-4.1 7.5-14.2 7.2-21.6 8.2-14.7-.9-19.1-16.5-23.6-28-2-8.4-3.5-21.8-1.4-30.3q2.6-7.5 6.6-14.3l.1-.9c3-1.1 0-2.2-1-3q1-.3 1.6-1.4Zm5.2 32.1c.4 7.3 3 12 7.8 17.3l10.7.2q1.8-.4 3.6-1.1 1.7-1.3 3.6-2.2l-.5-2q.8-.9 1.3-2-.9-.5-1.3-1.3 1-3.4 2.3-6.6l-1.1-1.4c-3.6-17.2-18.7-18.7-24.6-1.5zM702 660.5c2.2-1 2.2-2.1 5.2-2.1 2-1 .7-1.7 2.5.5 1.3.3 1.6-1.4 2.7-2 6.7-6.6 24.5 11 33.3 11.3 1.5.5 1.2 2.2 3 1.2.5 1.8.7 2.9 2.2 4.3 7.6 7.7 26 23.7 31 31.8 5.7 17.3 13.4 28.3 12.7 47.4 3 13.4 4.9 20 2 34.2-1.5 7.2-5 13.9-4 21.4-12 14.9-11.2 22.6-34.1 23.8q-4 0-7.9.3c-2.7-3.5-8-3.9-12-4q-.4-.8-1-1.3-.8 1.3-2.1 2.2-1.5-.5-1.9-2 .7-.2.4-.8-.6-.6-1.4-.1a20 20 0 0 0-.8-5c0-2-4.7-9-4-10-3-3.1-2-8.4-2.2-12.4 2.1-26.3 2.4-56.4-5.3-81.8-5.8-16.6-18.1-39.6-18.3-56.9Zm28.4 45c-.1 5.4 1.9 9.7 3 14.9 2.3 11.1 2.8 23.2 8.6 33.3 1.4 2.2 5 9.5 6.7 10.8q-.3 2.7.9 5 1.3 2.2 3 4-.6.4-1.1 1 1.2.9 2 2.1l1.1-1q3.6 4 9 5c6.2.6 9-5.8 8-11 2-1 2.4-4 2.5-6q-.6-7.3-1.9-14.6-.2-.8-.7-1.4c1.8-1.1 1.4-1 0-2.1q3.2-4.2 1.8-9.4c-1.7-6.6-7.3-9.4-11.4-14.4-4.4-6.2-7-12.4-14.2-16-1-1.5-1.1-2-2.1 0a20 20 0 0 0-8.4-3.2c-2 .3-6.5.4-6.8 3Z"/><path fill="#e39e93" stroke="#e39e93" stroke-width=".5" d="M884 603.1q-.6 1-1.7 1.5c1.1.7 4.2 1.8 1.1 3v.8a73 73 0 0 0-6.7 14.3c-2 8.4-.6 21.8 1.4 30.3 4.5 11.4 8.9 27.1 23.6 28 7.4-1 17.5-.7 21.6-8.3 2.9-7.3 6.7-14.3 8-22.1q.1-4-.2-8 .9-1 1.7 0c1 1.6 1.5 5.7 3.3 6.4q1.4 14.9-2.8 29.2a2 2 0 0 1-1.1-.9l-.7-3q-.4.5-.6 1.1a9 9 0 0 1 .1 2.7l-1.2-.4c-8.9 10.7-14.2 14.2-29 13.7-23-3.2-27-40.2-34.6-57.5-1.7-7.5 3.7-17.1 6.8-24q-.4-.8-1.3-1-.2.7.3 1c-.8-1.8-4.2-.5-4-2.7a56 56 0 0 1 16-4Zm-97.9 94.7 2.1 3c-2.3 9.2 9.3 27 11.4 36.7-.2 11 7.9 30.3 5.7 40.3a546 546 0 0 0-6.2 35.2q-3 7.8-6.3 15.3a3 3 0 0 0-2 1 10 10 0 0 0-2.9 5q-.9.3-1.9.3c-4.7 6.3-8.5 10.7-16.9 11.5l-1.6 1.6c-2.4-3.9-1.4 2.8-5 .6l-1 2.4q-.6-1.5-2-2.4l-2 1.3c-4.2-3-14.7 1.1-21-2.3q-5.6-3-11-6.6-.3-.5.1-1.1c-11.3-11.8-4.6-49.2-5-65l1-1.1q-.8-1.5-1-3.2a162 162 0 0 0-25.4-84q-1.2-3.4-1.8-7 0-1.2 1.1-1.8a4 4 0 0 1-1-2.1c1-6.7-8.2-27.7 3.4-28 20.9-3.2 39 15.2 54.8 14.9q1.5 3 4 5.5l3.5 2.6q1 0 2 .5c2.3 3.5 5.6 6.4 8.9 8.8l-.3 2.1c2.6 7.2 8.7 11.8 14 17q1.2-.3 2.3-1ZM702 660.5c.2 17.3 12.5 40.3 18.3 57 7.7 25.3 7.4 55.4 5.3 81.7.3 4-.8 9.3 2.2 12.3-.7 1.1 4 8.2 4 10.1q.7 2.5.8 5 .8-.4 1.4 0 .3.7-.4 1 .4 1.5 1.9 1.9 1.3-.9 2.1-2.2l1 1.3c4 .1 9.3.6 12 4q3.9-.4 7.9-.3c23-1.2 22.2-9 34.2-23.8-1.1-7.5 2.4-14.2 3.9-21.4 2.9-14.3 1-20.8-2-34.2.7-19-7-30-12.7-47.4-5-8-23.4-24-31-31.8-1.5-1.4-1.7-2.5-2.3-4.3-1.7 1-1.4-.7-2.9-1.2-8.8-.2-26.6-18-33.3-11.3-1 .6-1.4 2.3-2.7 2-1.8-2.2-.5-1.5-2.5-.5-3 0-3 1.1-5.2 2.1Z"/><path fill="#e39c90" stroke="#e39c90" stroke-width=".5" d="M813 485.2c-1.6 1.3-.5 1.6.7 2.3q-1.6.5-3.4.5-9 4.4-18.4 8.3a16 16 0 0 0-6 9.2 67 67 0 0 0 0 20.7l6 21.5 3.6 9q.7-.2 1.3 0c5.8 3.7 11.6 8.3 18.4 9.9 2 1 1 1.9 3.4.3q21.6-.2 25.7-21.5.5-7.5 1.6-15c.8-3.8 3-7 4.5-10.5a87 87 0 0 1 5 23q-.5.7-.6 1.6l-.2 3.2q-.8-.4-1.5 0c-5.8 13.2-18.2 38.6-36.5 33.3-10.4-3.8-22.3-6.6-27.2-17.8-2.5-9.8-4.1-17-9.6-25.9-4.4-9.9-1-33.3 3.1-43.1q1.9-3.2 4.2-6c-1.6-1.7-5.4 2.7-6.2-.4 10-4.1 21.5-5.6 32-2.6Z"/><path fill="#db9083" stroke="#db9083" stroke-width=".5" d="M781 487.8c.7 3 4.5-1.3 6 .4a47 47 0 0 0-4 6c-4.1 9.8-7.6 33.2-3.2 43.1 5.5 8.9 7 16 9.6 25.9 4.9 11.2 16.8 14 27.2 17.8 18.3 5.3 30.7-20.1 36.5-33.3q.7-.4 1.5 0l.2-3.2q.1-.9.6-1.7.7 15.4-3.2 30.3c-1.6-1-1.9-4.2-2.6-5.8-6.4 11.4-20.8 28.5-36 23.3-26.5-10.4-29.5-25-40.3-48.8-6.2-13 9.2-43.9 1.6-51q3-1.7 6-3Z"/><path fill="#e7a498" stroke="#e7a498" stroke-width=".5" d="M681 414.4q9-1.4 18-.3-.4.6-.6 1.4 2.5.6 5 1.6c1.2 1.5-2.7 3.3-3.7 3.7-9.6 2.5-23 5.9-20.9 18.8 2.5 8.1 4.7 15.6 5.9 24 4.7 12 13.6 20 25.8 23.9l1-1c1.2 2 5 .8 6.8.1 1.4-1 .8-2 2.2 0q4.5-.9 7.9-3.7c8.6-8.8 3.7-24.7 13.1-33.4 1.1 1.4.9 1.3 2.6.5l1.9 6c-1.3.3-2.7-1.6-3.3.1l-1.8 16.4q-.3 1.4-1.4 2 .3.8.2 1.6c-5.8 17.7-18.4 24.5-36.4 18.6q-1.8-.4-1.8-2.3-1.5.6-2-.9c-15-1-31.3-50.8-22-63.4q4.3-5.9 8.2-11.7-2 0-4.1-.5-.7-.6-.5-1.5ZM617 647q-.6 0-.9.6l-.5 3.1q-.7-.3-1.6 0c-16 10.8-22.9 5.2-39.6-.9a49 49 0 0 1-12.7-10l-1.5-.5a84 84 0 0 1-21-56.5q-.5-3-1.4-6a47 47 0 0 1 25.7-5.7c32.7 2.7 50 48.1 53.5 75.9Zm-47.4-43a108 108 0 0 0 18.2 18.8c7.2 4 17.7-2 13.6-10.5-2.8-5.5-7.4-11.3-5.9-17.8a3 3 0 0 0-2.2-1.4c-5 .3-16.3-4-20 .6a13 13 0 0 0-1.8 8.8 4 4 0 0 0-1.9 1.4Z"/><path fill="#d4867a" stroke="#d4867a" stroke-width=".5" d="M537.9 576.9q.8 3 1.3 6c0 22.4 6.9 39 21 56.4l1.5.5q5.6 6 12.7 10c16.7 6 23.6 11.7 39.6.9q.7-.3 1.6 0l.5-3q.3-.6.9-.7 1.3 15.8-2.5 31.2c-5-11-17.7-7-27.5-9.8-5.1-1.2-10.4-3.8-15.5-4.7-3.6.8-2-.5-1-2.2q-3.5-.6-7-1.7a5 5 0 0 1-2-1.4c-3.5 1.3-16.3-15.3-18-18.5-9-19-18-33.6-12.8-55.3q-1-.9-2-1.3 4.2-3.7 9.1-6.4Z"/><path fill="#f5bbb1" stroke="#f5bbb1" stroke-width=".5" d="M726.2 425.3q3.3 2.5 6 5.5c-.2 1.7-2.8.6-3.8 2.4-4.9 8 6.6 15.2 2.1 22.4q-.8-.5-1.4.1c0 3.3-.2 5.5-2.9 7.8-1.9-.5-1 2.5-1.5 3.6a9 9 0 0 1-4.4 5.5q-.3-.7-.8-1.1c-6.3 4.9-13.6 4.2-19.3-1.2-6.4-5.4-11.8-10.2-13.2-19q-1-5.4 1.2-10.5a46 46 0 0 1 14.1-14c7.4-3.9 18.3 6.4 24-1.5Zm77 101 .9-11.6c.6-1 1.5.4 2.5-.2.9-7 11.6-8.4 17.2-7.6 3.3 0 4 2.1 5 4.8 4 12.2 8.5 27-10.1 28.6-1.8 0-2.2-.7-3.2-2q-.4 1.5-1.8 1.6-.4-.9-.4-1.7-.7-.1-1.3-.6-3.6-3.4-7.8-6zm-233.6 77.6a4 4 0 0 1 2-1.4q-.8-4.6 1.6-8.8c3.8-4.6 15.2-.3 20.1-.6q1.5.1 2.2 1.4c-1.6 6.5 3 12.3 5.9 17.8 4.1 8.4-6.4 14.6-13.6 10.5a105 105 0 0 1-18.2-18.9Zm319.6 31.3 1.8-.6c5.9-17.2 21-15.7 24.6 1.5l1.1 1.4q-1.3 3.1-2.3 6.6.4.8 1.3 1.3l-1.3 2q.4 1 .5 2-1.9.9-3.6 2.2-1.8.7-3.6 1.1l-10.7-.2c-4.8-5.3-7.4-10-7.8-17.3Zm-158.9 70.3c.3-2.6 4.8-2.7 6.8-3q4.5.5 8.4 3.2c1-2 1-1.5 2.1 0 7.2 3.6 9.8 9.8 14.2 16 4 5 9.7 7.8 11.4 14.4q1.4 5.2-1.8 9.4c1.4 1 1.8 1 0 2.1l.7 1.4q1.3 7.3 1.9 14.6c-.1 2-.5 5-2.6 6 1.2 5.2-1.7 11.6-8 11q-5.3-.8-8.9-5l-1 1a8 8 0 0 0-2.1-2.1q.4-.6 1.2-1a20 20 0 0 1-3.1-4q-1.1-2.3-.9-5c-1.7-1.3-5.3-8.6-6.7-10.8-5.8-10-6.3-22.2-8.5-33.3-1.2-5.2-3.2-9.5-3-14.9Z"/><path fill="#5d5046" stroke="#5d5046" stroke-width=".5" d="m490 547.9-4.2 1.5q-3.9 2.8-1.3 7 .4.7 1.2 1.1-2 1.5-3.6 3.2c-.3.9-.6 3.8 1.3 2.7.8 2.2 1.8 5.5 3.4 7.3.1-.9 0-4.2 1.5-3.5q1.5 1.3 3 2c5.4.7 10.2 4 14.8 6.6 4.9 2.2 9.4-1.4 13-4.3q4.5-1.3 9.3-1.7c5.2-.7 6.4-4.6 9.1-8.4q2.3-.1 4.4-.5 5.6.1 9 4.4 1.1.8 2.4 1.3a59 59 0 0 0-41.1 29.5c-2.8-1.7-6.5-.2-8.5 2-1.7 1 .7 1.7.7 3.1q.9 3.2-1.5 5.3a20 20 0 0 0-3.5 2c1.8 1.6 1.5.5-.2 2.2a3 3 0 0 0-.6 3.8q-4 .9-8 2.1-.5-.6-1.2-1c-1.9 1-4.5 1.5-6-.2l.2.2-1.1-3.2q-1.5-.3-2.6-1.4a6 6 0 0 0-6.8 2.6l-2.6 6-1.6-.8q-7.8 1-15.4-1.4l-1 .2q-.3-1.2-1.1-2A275 275 0 0 0 435 611c2 2.1 3 3.4-.5 4.5a9 9 0 0 0-1.4-3.3c-1.7-1.5-2.4 0-3.7-.8 1.3-5.6 2.8-11-2.4-15.1q-1.9-.7-3.5-2-3.4 1-5.2-2.2c-.5-4-.3-2.7-2.7-2q-1.5 0-3-.6l-1-2.2c-3.8.3-7.8 2.7-11-.9q-1.2-2.1-2.8-4.1a2 2 0 0 1 1.6-.7q-.4.7-1.2.4.4-.6 1.2-1l5.2-.6c-1.3-2.6-2.5-7.5 2.6-5.3q3.6 3.4 2.7-1.5l-1.4-.5q-2-2.3 0-4.8.4.8 1 1.3.4-.6.4-1.2-.6-2.4.4-4.6 2.4-5.2 5-10.2c.8-1.5 1.7.3 2.3 1q2.5-2.4 5.4-4.3 1.8-1 3.7-1.7 1.7 0 2.9-1.3l1 1.1q6.5.1 11.9-3.4c-1.5-1.7-1.4-1.4.1-2.6q-.9-1.5-.2-3.2c.4.3 1.5 2.4 1.9.7-1.8-2.4-3-4.5-1.1-7.6v.2q2.5-1 .1-2 .4-1.7 1.9-2.6l3.4.6c-1.2-3.3.3-1.9 2.1-1.3 2.4.8 2.9-2.1 2.4-3.8q-.2-1.6-1.7-.8l.3-5c-.2-3.1-1.4-6.4-4.9-7q-.6-.5-.8-1.1c30-1 59 7.2 81.7 27.2.4.4 1.7 1.6.6 2q-19.8-.9-38.3 6.9-1.7 1.1 0 2.2Zm451.4 34.9c-6.5 1.7-9-1.1-13.1-5.5-.7-1.9-2.4-2.1-4-2.9-5.3-1.2-3.1 2.4-5 2.5a240 240 0 0 0-5.2-19.5q-.3-1.5 1.2-1.1a97 97 0 0 1 26.1 26.5Z"/><path fill="#64564c" stroke="#64564c" stroke-width=".5" d="M544 347.2c18.7 2.7 34.2 7.1 51.5 14.7 2.7.2 1.2-4.3 1.5-5.8 2-1.2-.2-5.7 1.3-7q2.5 3 5.2 5.8c6.2 5.8 14.5 11 10 20.6q.6.4.9 1.2 1 7.6 1.7 15.3-.4.9-1.3 1.2a64 64 0 0 0-71.6-19.8q-1.2 0-2.2-.6c1.6-2-.4-3-1.7-4.4-.9-5.8 4.2-11.6 5.6-17 .3-2 1-2.1-1.3-3.2zm9.3 219.4-2.4-1.2a12 12 0 0 0-9-4.5l-4.4.5c-2.7 3.8-3.9 7.7-9.1 8.4q-4.8.4-9.2 1.7c-3.7 2.9-8.2 6.5-13 4.3-4.7-2.7-9.5-5.9-14.8-6.5q-1.7-.8-3-2c-1.6-.8-1.5 2.5-1.6 3.4-1.6-1.8-2.6-5-3.4-7.3-1.9 1.1-1.6-1.8-1.3-2.7q1.6-1.7 3.6-3.2-.7-.4-1.2-1.1-2.6-4.2 1.3-7l4.3-1.5c39.2-6.6 53.8-4.9 85.4 19.2q.4 1.2-.9 1.1-10.5-3-21.3-1.6Zm388.1 16.2q9.3 14.5 14.9 31c-4.5 8.1-1.4 12.3-1.6 20.7-1.7 6.9-1.2 19.4-5.1 25-4.5 4.3-9.7 6.1-6 14q.3.6-.1 1.1-.8-.4-1.4 0l-3 7.4q0-1.5-.5-3.2c12.7-44.6-13.1-90.4-63.7-79.1.4-1-.9-1-1.4-1.2l2.1-1q-.7-.6-1.7-1.1-1.5-2.4.3-4.7c2-2.5 15-8 13.7-10.4 11 1.8 21 5.2 31.6 8.7q2-.4 1.5-2.4-.6-5.4-1.7-10.7c1.9-.1-.3-3.7 5-2.5 1.6.8 3.3 1 4 3 4 4.3 6.6 7 13.1 5.4Z"/><path fill="#594b41" stroke="#594b41" stroke-width=".5" d="M627.7 382q-.4.3-.5.8 0 2.5-.6 4.9l-1.1-1.3-1.8 2c-1.3 4.1-1.6 7-6 8.9l-2.9-4q.9-.4 1.3-1.3a253 253 0 0 0-1.7-15.3q-.3-.7-1-1.3c4.6-9.6-3.7-14.7-9.9-20.5l-5.2-5.7c-1.5 1.2.7 5.7-1.3 6.8q0-8.7-.6-17.3.6-.9 1.6-.4a61 61 0 0 1 29.7 43.7Zm-84-33.8c2.1 1 1.5 1.1 1.2 3.2-1.4 5.4-6.5 11.2-5.6 17 1.3 1.4 3.3 2.4 1.7 4.4q1 .6 2.2.6a112 112 0 0 0-15 7.7 3 3 0 0 1-2.7-1q-6-6.6-5.5-15.6c.5-4.3 4-6.5 7.3-8.7q7.5-4 15.3-7.5.5-.3 1-.1Zm242.5 103.3 8.7 1.7.2.6-3 .3c1.1 1.3 2.6 1.6 1 3.6-.7 2-3.2 2.5-5 3l-3.5 3.3q-.3 3-1.5 5.7c-.4 1.9 3.5 2.8 4.2 4.4 1 3.7 1.4 2.4 4.4 3.3l-3.2.9c-2.3 2.4 3-.7 2.4 1.4q-3.4.7-6.7 1.7c-1.3-.6-2.3-.4-1.6-2q-.9-.5-2-.5c-9.8 1.8-11.4-8.6-7.7-15.5q2.3-4.9 5.6-9.3l.1-2q3-.6 6 0z"/><path fill="#615349" stroke="#615349" stroke-width=".5" d="M749.2 390.8a100 100 0 0 1 6.1 10c-7.6 19.8 10 30.8-2.7 50.5q-.7 1.2-2 1.9c-11-35.8-46.2-52.2-81.4-41l-2.9-.7q-1-2.7-2.3-5.5c-3-12.7 4.7-13.4 11.2-21.3l.5-1.5q1.7 0 3.4-.4l-.1-.6q10.5 1.8 21 4.5 9.7 3 19.5 6.3 1.4-.2 1.4-1.5-.2-4.2-.7-8.5c2 .6.2-4 .4-4.8 1.3-1.3 3.5.4 4.2 1.5q.7 2.1 1 4.2 2.6.6 5.4.2c3.8.6 5.5.4 8.5 2.7 1.8 1.8 5.6 6.4 8.1 6.7q-.2-1.8 1.4-2.7Zm105.3 68a93 93 0 0 1 18.8 39c-5.5 14.6-4.7 31.7-9.7 45.7q-.5 2.2-2.6 2.5c-2-39.3-27.6-72.4-70-66.3.6-2.1-4.8 1-2.5-1.4l3.2-.9c-3-.9-3.4.4-4.4-3.3-.7-1.6-4.6-2.5-4.2-4.4q1.2-2.8 1.5-5.7l3.5-3.3c1.8-.5 4.3-1 5-3 1.6-2 .1-2.3-1-3.6q1.5 0 3-.3l-.2-.6q12 2.8 23.5 6.4 1.4-.3 2.2-1.3l-1.2-7.4.5.2q.3-1.5.2-3.2 1 1.8 1.3 3.7 2.1-2 4.7-3.3c8.4-1.6 17.1 4.3 22.4 10.3q.8-1.2 2-1.9 2 1.4 4 2.1Z"/><path fill="#53453d" stroke="#53453d" stroke-width=".5" d="M749.2 390.8q-1.5.9-1.3 2.7c-2.5-.3-6.4-4.8-8.1-6.7-3.1-2.3-4.8-2.1-8.6-2.7a13 13 0 0 1-5.5-.3q0-2-.9-4c-.7-1.2-3-3-4.1-1.6-.3.7 1.4 5.4-.5 4.8l-1.4-13.6c0-.7-.4-1.8.7-2a79 79 0 0 1 29.7 23.4ZM627.7 382q1.8 17.7 0 35.4-.8 1-1.4-.1-3-10.5-8.5-20c4.4-1.8 4.6-4.8 6-8.9q.7-1 1.7-2l1 1.3q.6-2.4.7-4.9 0-.5.5-.8Zm47.5-.4 3.8.6v.6q-1.6.4-3.3.4l-.5 1.5c-6.5 7.9-14.3 8.6-11.2 21.3q1.3 2.8 2.3 5.5l2.9.8a63 63 0 0 0-9 4.1h-2c-1-1 1.1-1 .2-2.4q-2.2-3-5.1-5.5-3.8-5-.3-10.3l1.6-.7c-.8-4.5 2.8-7.6 6.3-9.6 4.7-2.1 9.3-5 14.3-6.3Zm80.1 19.3c13.4 27.8 8 55.8-.7 84q-1.2 2.1-1.8-.3c1.8-9.3.3-22.3-2.1-31.4q1.2-.7 1.9-2c12.6-19.6-4.9-30.6 2.7-50.3Zm99.2 57.9q-2-.7-4-2.1-1.2.6-2 1.9c-5.3-6-14-12-22.4-10.3q-2.6 1.3-4.7 3.3-.3-2-1.3-3.7.1 1.5-.2 3.2l-.5-.2-4.9-19.8q0-1.8 2-1.2c15.4 6.7 27 16.3 38 28.9Zm18.8 39c5.6 26-2.7 47.5-12.9 71-.4.7-.9 2-1.8 1A113 113 0 0 0 861 546q2.1-.3 2.6-2.5c5-14 4.2-31 9.7-45.7Zm83 116c13.7 47.6-11.6 103-53.1 128.4q-.7-.3-.9-1 .8-3.6-1.6-6.5a101 101 0 0 0 37.9-55.9q.5 1.6.5 3.3l3-7.4q.7-.6 1.4 0 .4-.6.1-1.1c-3.7-8 1.5-9.8 6-14.1 4-5.5 3.4-18.1 5.1-25 .2-8.4-2.9-12.6 1.6-20.7ZM716 1016.1c-2-6.8-3.4-10.2 1.7-16.8q0-.7-.3-1.3c-4.6-3.2-6-6.1-11.7-7.2-1.4-2.6-2.9-1.7-5.3-1.1-2.2-1.5-2.4-2.1-5-1-2.2-.7-.5-1.4.1-2.1l-2.6-1.3c6.8-.7 16.5-5.5 22.5-1 12.8 8.9 7.8 21.2.6 31.8Z"/><path fill="#493a32" stroke="#493a32" stroke-width=".5" d="M768.4 423q.5-2.6 3.4-2.7 4.5-.6 9-.7 3-.1 1.7 2.5l-12 18q-.4.7-1 .7-.2-8.9-1.1-17.7ZM496.9 938c-34-15.3-66-27-90-57.3-31.7-37.5-56.6-78-81.8-119.7q2-1.8 3.8-3.9c4.4-3 8.7-2 13.4-1 1.1-.6 2.2-2.3 3 .2q.4 1.3.4 2.5l4.2.3q3 .6 5.8 2.4l-.3 1c1.7.5 2 .6 3.2 2q1.2-.9 2.4-.1 1 1.8 2.7 3c-1.3 2.1-2.9 4.3 0 6.1l-1.4 2 2.3 2c0 1.2-1.2 2.6.9 1.9l2.3 1.6a8 8 0 0 1 1.3 5.2l-.6 4.4q2-1.5 3.2.8-1.4 1-2.4 2.5l-2 .6q.4 1.3 1.5 2.2c2 .6-.8-1.7 1.5-1.5a9 9 0 0 1 5.9 6.3l.3 5 1-.1q.7.9 1.8 1.4c.8-.7 1-2.4 2.2-2.5a29 29 0 0 1 5 4.9 9 9 0 0 1 2 4.5q.1-1.8 1-3.4l2.5 3.4q-.3 1.5-1.8.8c-.3 3.3 1.1 4.3 2.2 7.1q.8-.4 1.5 0-.7 3.9.3 7.6.5.5 1.1.2l1.5 1.3 3.7 5c1-1.4 1-2 2 0 1.5-2.4 2.7-2.4 2.2.6q3.3 4.5 7 8.3c-.6 1-2.2.5-.6 1.8 2 1.1 3.4 1 4.5 3.3l1.9-2.3q.6.3.7 1.1.8 3 1.2 6 1.4.7 2.7 2h1.8q0 1-.5 2c1.5 1 2.1-1.5 3-2.2l1.6 3.2 3 2.2c0 1.9-1.9 1-1.7 2.5q3.3 3 4.9 7.1c-.2 4.4.8.6 3.3 2.4 1.2-.4 1.9-2.5 3.2-1.3l-.5 2q.3 2.1.2 4.1 2.2.6 4.5.3 5.2 1 7.6 5.8l.6-3q1.7-1.5 1.5.7 2.8 2 4.6 4.9.3.7.4 1.6 4.3 1.6 8.8 2.6 0 .8.3 1.3 5.4-3 9.8 1.3c5.3 5.3 9.4 13.1 6 20.5q.8.5 1.4 1.2c0 1.6-2.4 2-3.5 2.7q1.7.6 1 2.2 1.5 0 3-.8 1.5 0 1.6 1.5-.8.5-1.5.1v3l1.2 1q-.3 1.2-.2 2.1l4.6-1.5c6.5 0 7.3 6.3 4.8 11Zm-2.8 392.2q-9 14.2-19 28c-1.7-.8-2.9-4.7-4.7-6.1-3-2-1.8-1-2-4q.8-3.1 2.2-.5 3-3.6 6.5-7.1c.7-.7 2.5 1 3.4 1 2-.8 1-1.2-.1-2q4.4-6.7 11.4-10.6 1.3.4 2.3 1.3Z"/><path fill="#44352e" stroke="#44352e" stroke-width=".5" d="M489.3 445.1c-5.5 57.2 59.7 104 107.6 67.5q1.6-.3 1 1.5c-6 13.4-11 35-20.4 45.8a1 1 0 0 1-1 .4q-8-5.7-16.4-11c-13.1-5.9-21.6-9.6-32.2-19.6a115 115 0 0 0-54-24q1.3-.8 2.7-1.1c-1.7-1.3-1.7-5.6-2-7.6q.3-2.9 1.3-5.6l.8-1q-.6-1.1.5-1.6 4.7 1.5 7.3 5.9c1.4 0 2.5-5 2-5.4q-1.5.4-2.9 0l-2.4-1c-.1-1.6 3.6-1.8 3.6-3.6l-1.3-.5q-3-5.1-2.8-11.1c.7-4 .7-23.2 4.2-25.3l2.7 4c.6-1.6-.6-6.4 1.7-6.7ZM851.9 593q.3.6.3 1.4c-2 3.3-2.8 13 1 15.1a105 105 0 0 0-43.4 52.9c-18 57.9 37.4 105 90.9 72.4q2.5 3 1.6 6.5.1.7.9 1-18 11-39 14.6c-.9 1 .6 1.1 1.3 1.2q8 .7 16-.8.7-.1 1 .4-8.3 17.2-16.3 34.5c.1-2.3.1-2.2-1.8-3q-2-1.6.2-2.6.3-2.7.3-5.6a8 8 0 0 0-6-6.8q-7.1-1.6-14.2-2.6c-2 1-.4 1.7-2.3.1a15 15 0 0 1-3.6-1.7l-12.3-7.5q-3.3 4.1-8.3 2-.1-1.1-.7-2.1-.7 1.2-.8 2.6h-.4q-3-23.1-12-44.7C777.5 655 689.5 607 625.2 587.5c-6.5-2.7-29.8-5.4-33.4-9.8q-5.4-6.5-11.3-12.8-.5-1.2 1-1.1l6.2 2q1 .3 1.9-.3c-1.2-3.5-3.2-5.8-2-9.7l19.9-51.6q.8.3.9 1.2c-4.3 48.1 55.2 78.8 95.6 60.2 1.1-.6 1 .7.7 1.4-5.3 9-11.6 29-17 36.1q-1.7 1.4-3.5 2.5c-.3 1.9 5 2.2 6 2.9 1.5.6 3.9 4.5 5.6 2.8l-.7-5.8c1-9.2 13-32.2 17.4-41.6q.5-.6 1.2-.8c1.1.8-.4 2.7-.3 3.8a68.4 68.4 0 0 0 89.3 69.5q.6-.3 1 .2-2 3.6-4.3 7.1c-3.5 5.7-8.9 18.7-13.1 23-1 1-5.3 2.1-2.4 3.8q2.6.9 4.9 2.2 1.7 3.9 3.1 7.9c.9.8 1.1-.5 1.3-1-.6-16 9.8-36.4 21.6-47.2a129 129 0 0 0 37.1-39.5Z"/><path fill="#4c3e36" stroke="#4c3e36" stroke-width=".5" d="M786.2 451.5a4 4 0 0 1-1.7.6q-3-.6-5.9 0l-.1 2q-3.2 4.4-5.6 9.3c-3.7 7-2 17.3 7.7 15.5q1.1 0 2 .5c-.7 1.6.3 1.4 1.6 2a69 69 0 0 0-29 18.2q-1.2.2-1.2-1a168 168 0 0 0 14.3-47.9q.5-.5 1.2-.5 8.4.3 16.7 1.3Zm98 129c-10.7 2.5-20 6.6-24 17.8l4.6-.7q2.5 0 4 2c-1.4 1.3-3.4 1.9.4 2q-8.3 3.2-16 7.8c-3.8-2-3-11.8-1-15.1q0-.8-.3-1.4 9-13.3 16.1-27.5 5.5-14.1 10.7-28.2c4.4-.7 8 1.2 12 2.7q1 .4.7 1.6c-6.7 8.6-12.1 18-18.5 26.9a42 42 0 0 0-4.6 8q.4 2 2.5 2.3z"/><path fill="#5b4d43" stroke="#5b4d43" stroke-width=".5" d="m884.2 580.5 3.7.8c1.4 2.5-11.7 8-13.7 10.4a4 4 0 0 0-.3 4.7l1.7 1.1-2.1 1c.5.3 1.8.2 1.4 1.2q-3 .8-5.7 1.8c-3.8 0-1.8-.6-.5-2q-1.4-1.9-3.9-1.9l-4.6.7c4-11.2 13.3-15.3 24-17.8Zm-18 211.6c-11.7 26-22.6 52.4-35.2 78q-.6-.5-1.4-.6a5 5 0 0 0-1.6 2.8c-5.3 3-8 9.7-12.2 14-3.5 3.6-8 9-12.7 10.8a74 74 0 0 1-8.3 1.7 5 5 0 0 0-4.4 3.6c.5.8 1.6.5 1.1 1.6-1.5 1.7-3.7 1.7-5 3.7-1.3-2-2.1-3.3-4.8-3q-1.5.9-3 1.2 0-.7-.4-1.6c-5.4-2.7-9.4-5.5-8.8-12.2 1.1-1.5 1.5 0 .2-2.3A145 145 0 0 0 816.2 765h.5q0-1.5.8-2.7.6 1 .7 2.2 4.9 2 8.3-2l12.3 7.4a15 15 0 0 0 3.6 1.7c2 1.6.4.9 2.3-.1q7.1 1 14.2 2.6 5.1 1.5 6 6.8 0 2.9-.3 5.6-2.3 1-.2 2.5c2 .9 2 .8 1.8 3.1Z"/></g></svg>`;

    /**
     * Sprite bookkeeping. w/h = sprite units, hx/hy = click point (middle claw tip) after mirroring,
     * drawH = on-screen height in css px, canvas/closedCanvas = rasterized sprites (null until loaded).
     * @req PAW-2
     */
    const PAW_SPRITE = {
        w: 892, // sprite size in its own units
        h: 1247,
        hx: 257, // click point (middle claw tip), after mirroring
        hy: 4,
        drawH: 60, // on-screen height in css px
        canvas: null,
        closedCanvas: null, // fist, used during the click pulse
        loading: false
    };

    /**
     * Draw an SVG once into an offscreen canvas, mirrored so the paw faces left, and hand the canvas to done().
     * @param {string} svg
     * @param {function(HTMLCanvasElement):void} done
     * @req PAW-2
     */
    function rasterizePaw(svg, done) {
        try {
            const img = new Image();

            img.onload = () => {
                try {
                    const scale = Math.max(
                        2,
                        window.devicePixelRatio || 1
                    );

                    const ph = Math.round(
                        PAW_SPRITE.drawH * scale
                    );

                    const pw = Math.round(
                        (ph * PAW_SPRITE.w) /
                            PAW_SPRITE.h
                    );

                    const c =
                        document.createElement(
                            'canvas'
                        );

                    c.width = pw;
                    c.height = ph;

                    const g = c.getContext('2d');

                    // mirror: the paw faces left
                    g.translate(pw, 0);
                    g.scale(-1, 1);
                    g.drawImage(img, 0, 0, pw, ph);

                    done(c);
                } catch (e) {
                    console.warn(
                        '[CC Good Boy] Could not prepare a paw sprite:',
                        e
                    );
                }
            };

            img.onerror = () => {
                console.warn(
                    '[CC Good Boy] A paw sprite failed to load.'
                );
            };

            img.src =
                'data:image/svg+xml;charset=utf-8,' +
                encodeURIComponent(svg);
        } catch (e) {
            console.warn(
                '[CC Good Boy] Paw sprite error:',
                e
            );
        }
    }

    /**
     * Rasterize both paw sprites (open + closed) once at start.
     * @req PAW-2
     */
    function loadPawSprite() {
        if (PAW_SPRITE.loading) {
            return;
        }

        PAW_SPRITE.loading = true;

        rasterizePaw(PAW_SVG, c => {
            PAW_SPRITE.canvas = c;
        });

        rasterizePaw(PAW_SVG_CLOSED, c => {
            PAW_SPRITE.closedCanvas = c;
        });
    }

    // ---- Lively cursor: lean into the movement, squish on click ----------

    /**
     * Click pulse: the paw shows the fist and shrinks to `scale` around its click point within downMs, then
     * springs back within upMs (~80 ms in total).
     * @req PAW-3
     */
    const CLICK_PULSE = {
        scale: 0.92,
        downMs: 25,
        upMs: 55
    };

    /**
     * True from the press until the pulse is over (the fist is shown).
     * @param {number} now - performance.now()
     * @returns {boolean}
     * @req PAW-3
     */
    function clickPulseActive(now) {
        const dt = now - runtime.pulseAt;

        return (
            !!runtime.pulseAt &&
            dt >= 0 &&
            dt <
                CLICK_PULSE.downMs +
                    CLICK_PULSE.upMs
        );
    }

    /**
     * Scale factor of the click pulse at time `now` (1 when idle, CLICK_PULSE.scale at the bottom).
     * @param {number} now
     * @returns {number}
     * @req PAW-3
     */
    function clickPulseScale(now) {
        if (!runtime.pulseAt) return 1;

        const dt = now - runtime.pulseAt;

        if (
            dt < 0 ||
            dt >= CLICK_PULSE.downMs + CLICK_PULSE.upMs
        ) {
            return 1;
        }

        const k =
            dt < CLICK_PULSE.downMs
                ? dt / CLICK_PULSE.downMs
                : 1 -
                  (dt - CLICK_PULSE.downMs) /
                      CLICK_PULSE.upMs;

        return 1 - (1 - CLICK_PULSE.scale) * k;
    }

    /**
     * Lean into the direction of horizontal movement (smoothed, up to ~0.22 rad), so the paw never glides
     * around perfectly upright. Updates runtime.lean once per frame.
     * @req PAW-3
     */
    function updateCursorLean() {
        const now = performance.now();

        const st =
            runtime.leanState ||
            (runtime.leanState = {
                x: runtime.cursor.x,
                t: now
            });

        const dt = (now - st.t) / 1000;

        if (dt <= 0) return;

        const vx =
            (runtime.cursor.x - st.x) / dt;

        st.x = runtime.cursor.x;
        st.t = now;

        let target = 0;

        // ignore long gaps (e.g. hidden tab)
        if (dt < 0.25) {
            target =
                Math.sign(vx) *
                Math.min(
                    1,
                    Math.pow(
                        Math.abs(vx) / 1800,
                        0.6
                    )
                ) *
                0.22;
        }

        runtime.lean +=
            (target - runtime.lean) *
            (1 - Math.exp(-dt / 0.09));
    }

    /**
     * Draw the paw at (x, y) = its click point: translate, rotate (lean + dance tilt), scale (click pulse), then the
     * sprite twice (pink halo pass, dark drop-shadow pass). Uses the fist while the click pulse runs.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x
     * @param {number} y
     * @req PAW-1, PAW-2, PAW-3
     */
    function drawVirtualCursor(
        ctx,
        x,
        y
    ) {
        if (PAW_SPRITE.canvas) {
            const h = PAW_SPRITE.drawH;

            const w =
                (h * PAW_SPRITE.w) /
                PAW_SPRITE.h;

            // relative to the click point, so the paw can tilt around it
            const dx =
                -(PAW_SPRITE.hx /
                    PAW_SPRITE.w) *
                w;

            const dy =
                -(PAW_SPRITE.hy /
                    PAW_SPRITE.h) *
                h;

            // Canvas shadow sizes are in device pixels.
            const dpr =
                window.devicePixelRatio ||
                1;

            ctx.save();
            ctx.translate(x, y);

            const tilt =
                (runtime.cursorTilt || 0) +
                (runtime.lean || 0);

            if (tilt) {
                ctx.rotate(tilt);
            }

            const pulse = clickPulseScale(
                performance.now()
            );

            if (pulse !== 1) {
                ctx.scale(pulse, pulse);
            }

            // the fist while the click pulse is running
            const sprite =
                clickPulseActive(
                    performance.now()
                ) && PAW_SPRITE.closedCanvas
                    ? PAW_SPRITE.closedCanvas
                    : PAW_SPRITE.canvas;

            // 1) strong pink halo: lifts the dark paw off dark backgrounds
            ctx.shadowColor =
                'rgba(255,150,215,.95)';

            ctx.shadowBlur = 14 * dpr;

            ctx.drawImage(
                sprite,
                dx,
                dy,
                w,
                h
            );

            // 2) dark drop shadow: separates it from light backgrounds
            ctx.shadowColor =
                'rgba(12,0,28,.85)';

            ctx.shadowBlur = 6 * dpr;
            ctx.shadowOffsetX = 3 * dpr;
            ctx.shadowOffsetY = 5 * dpr;

            ctx.drawImage(
                sprite,
                dx,
                dy,
                w,
                h
            );

            ctx.restore();

            return;
        }

        drawFallbackPaw(ctx, x, y);
    }

    /**
     * Small drawn paw, only used until (or if) the sprite is unavailable.
     * @req PAW-2
     */
    function drawFallbackPaw(
        ctx,
        x,
        y
    ) {
        ctx.save();
        ctx.translate(x, y);

        const tilt =
            (runtime.cursorTilt || 0) +
            (runtime.lean || 0);

        if (tilt) {
            ctx.rotate(tilt);
        }

        const pulse = clickPulseScale(
            performance.now()
        );

        if (pulse !== 1) {
            ctx.scale(pulse, pulse);
        }

        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#7a3f9d';
        ctx.fillStyle = '#ffb8de';
        ctx.shadowColor =
            'rgba(255,120,190,.65)';
        ctx.shadowBlur = 6;

        const bean = (
            cx,
            cy,
            rx,
            ry,
            rot
        ) => {
            ctx.beginPath();

            ctx.ellipse(
                cx,
                cy,
                rx,
                ry,
                rot,
                0,
                Math.PI * 2
            );

            ctx.fill();
            ctx.stroke();
        };

        // four toe beans
        bean(3.8, 9.4, 3, 3.9, -0.45);
        bean(9, 4.4, 3, 3.9, -0.15);
        bean(15.4, 4.4, 3, 3.9, 0.15);
        bean(20.6, 9.4, 3, 3.9, 0.45);

        // main pad
        bean(12.2, 18, 7.8, 6.3, 0);

        ctx.restore();
    }

    // ============================================================================
    // SECTION 14 - Charts
    // ============================================================================

    /**
     * Stable hue (0..359) for a string; gives each effect its own chart colour.
     * @param {string} str
     * @returns {number}
     */
    function hashHue(str) {
        let h = 0;

        for (
            let i = 0;
            i < str.length;
            i++
        ) {
            h =
                ((h << 5) -
                    h +
                    str.charCodeAt(i)) |
                0;
        }

        return (
            Math.abs(h) % 360
        );
    }

    /**
     * Pastel chart colour for a series name.
     * @param {string} name
     * @returns {string} hsl() colour
     */
    function chartColor(name) {
        return `hsl(${hashHue(
            name
        )}, 88%, 76%)`;
    }

    /**
     * Size and clear a chart canvas (device-pixel aware).
     * @param {HTMLCanvasElement} canvas
     * @returns {{ctx:CanvasRenderingContext2D,w:number,h:number}}
     * @req UI-5
     */
    function prepareCanvas(
        canvas
    ) {
        const dpr =
            window.devicePixelRatio ||
            1;

        const cssW =
            Math.max(
                300,
                canvas.clientWidth ||
                    820
            );

        const cssH =
            Math.max(
                220,
                canvas.clientHeight ||
                    300
            );

        canvas.width =
            Math.floor(
                cssW * dpr
            );

        canvas.height =
            Math.floor(
                cssH * dpr
            );

        const ctx =
            canvas.getContext('2d');

        ctx.setTransform(
            dpr,
            0,
            0,
            dpr,
            0,
            0
        );

        ctx.clearRect(
            0,
            0,
            cssW,
            cssH
        );

        return {
            ctx,
            w: cssW,
            h: cssH
        };
    }

    /**
     * Redraw both charts if the charts window is open.
     * @req UI-5
     */
    function drawGraphs() {
        if (
            !graphPanel ||
            graphPanel.style.display ===
                'none'
        ) {
            return;
        }

        drawGoldenGraph(
            document.getElementById(
                'ccsb-golden-chart'
            )
        );

        drawGrimoireGraph(
            document.getElementById(
                'ccsb-grimoire-chart'
            )
        );
    }

    /**
     * The hourly bucket timestamps shown on the charts (setting 'Chart hours', default 48).
     * @returns {number[]}
     * @req UI-5
     */
    function getChartHours() {
        const hours =
            clampInt(
                data.config.chartHours,
                6,
                720,
                48
            );

        const end =
            hourKey(Date.now());

        const arr = [];

        for (
            let i = hours - 1;
            i >= 0;
            i--
        ) {
            arr.push(
                end -
                    i * 3600000
            );
        }

        return arr;
    }

    /**
     * Generic hourly chart: axes, grid, one line/area per series, legend.
     * @param {HTMLCanvasElement} canvas
     * @param {{name:string,color:string,values:number[]}[]} series
     * @param {string} title
     * @req UI-5
     */
    function drawChartBase(
        canvas,
        series,
        title
    ) {
        const {
            ctx,
            w,
            h
        } = prepareCanvas(canvas);

        const margin = {
            left: 45,
            right: 16,
            top: 34,
            bottom: 34
        };

        const plotW =
            w -
            margin.left -
            margin.right;

        const plotH =
            h -
            margin.top -
            margin.bottom;

        const hours =
            getChartHours();

        let maxY = 1;

        for (const s of series) {
            for (
                const v of s.values
            ) {
                maxY =
                    Math.max(
                        maxY,
                        v
                    );
            }
        }

        ctx.fillStyle =
            '#241534';

        ctx.fillRect(
            0,
            0,
            w,
            h
        );

        ctx.strokeStyle =
            '#6b4a86';

        ctx.lineWidth = 1;

        ctx.strokeRect(
            margin.left,
            margin.top,
            plotW,
            plotH
        );

        ctx.font =
            '10px Consolas, monospace';

        ctx.fillStyle = '#e7c6ff';
        ctx.textAlign = 'right';
        ctx.textBaseline =
            'middle';

        for (
            let i = 0;
            i <= 4;
            i++
        ) {
            const y =
                margin.top +
                (plotH * i) / 4;

            const val =
                Math.round(
                    maxY *
                        (1 - i / 4)
                );

            ctx.fillText(
                String(val),
                margin.left - 6,
                y
            );

            ctx.strokeStyle =
                'rgba(255,190,230,.12)';

            ctx.beginPath();

            ctx.moveTo(
                margin.left,
                y
            );

            ctx.lineTo(
                margin.left +
                    plotW,
                y
            );

            ctx.stroke();
        }

        const tickEvery =
            Math.max(
                1,
                Math.ceil(
                    hours.length / 8
                )
            );

        ctx.textAlign =
            'center';

        ctx.textBaseline =
            'top';

        for (
            let i = 0;
            i < hours.length;
            i += tickEvery
        ) {
            const x =
                margin.left +
                (hours.length <= 1
                    ? 0
                    : (i /
                          (hours.length -
                              1)) *
                      plotW);

            const d =
                new Date(
                    hours[i]
                );

            ctx.fillStyle =
                '#c9a6e6';

            ctx.fillText(
                `${String(
                    d.getHours()
                ).padStart(
                    2,
                    '0'
                )}:00`,
                x,
                margin.top +
                    plotH +
                    7
            );
        }

        for (const s of series) {
            ctx.strokeStyle =
                s.color;

            ctx.lineWidth = 1.8;

            ctx.setLineDash([]);

            ctx.beginPath();

            s.values.forEach(
                (v, i) => {
                    const x =
                        margin.left +
                        (hours.length <=
                        1
                            ? 0
                            : (i /
                                  (hours.length -
                                      1)) *
                              plotW);

                    const y =
                        margin.top +
                        plotH -
                        (v / maxY) *
                            plotH;

                    if (i === 0) {
                        ctx.moveTo(
                            x,
                            y
                        );
                    } else {
                        ctx.lineTo(
                            x,
                            y
                        );
                    }
                }
            );

            ctx.stroke();
        }

        // Legend.
        let lx =
            margin.left;

        let ly = 10;

        ctx.font =
            '10px Consolas, monospace';

        for (const s of series) {
            const labelW =
                ctx.measureText(
                    s.name
                ).width + 25;

            if (
                lx + labelW >
                w - 10
            ) {
                lx =
                    margin.left;

                ly += 13;
            }

            ctx.fillStyle =
                s.color;

            ctx.fillRect(
                lx,
                ly + 2,
                10,
                3
            );

            ctx.fillStyle =
                '#ffe6f4';

            ctx.textAlign =
                'left';

            ctx.textBaseline =
                'top';

            ctx.fillText(
                s.name,
                lx + 14,
                ly
            );

            lx += labelW;
        }

        if (!series.length) {
            ctx.fillStyle =
                '#c9a6e6';

            ctx.textAlign =
                'center';

            ctx.textBaseline =
                'middle';

            ctx.font =
                '12px Consolas, monospace';

            ctx.fillText(
                `No ${title} data yet`,
                margin.left +
                    plotW / 2,
                margin.top +
                    plotH / 2
            );
        }
    }

    /**
     * Chart of golden-cookie clicks per hour, one series per effect.
     * @param {HTMLCanvasElement} canvas
     * @req UI-5
     */
    function drawGoldenGraph(
        canvas
    ) {
        const hours =
            getChartHours();

        const kinds =
            new Set();

        for (const h of hours) {
            const bucket =
                data.hourly[
                    String(h)
                ];

            if (
                bucket &&
                bucket.golden
            ) {
                Object.keys(
                    bucket.golden
                ).forEach(k =>
                    kinds.add(k)
                );
            }
        }

        const series =
            Array.from(kinds)
                .sort()
                .map(kind => ({
                    name: kind,
                    color:
                        chartColor(
                            kind
                        ),
                    values:
                        hours.map(
                            h =>
                                (data.hourly[
                                    String(
                                        h
                                    )
                                ] &&
                                    data
                                        .hourly[
                                        String(
                                            h
                                        )
                                    ]
                                        .golden &&
                                    data
                                        .hourly[
                                        String(
                                            h
                                        )
                                    ]
                                        .golden[
                                        kind
                                    ]) ||
                                0
                        )
                }));

        drawChartBase(
            canvas,
            series,
            'golden-cookie'
        );
    }

    /**
     * Chart of FTHOF casts and Grimoire refills per hour.
     * @param {HTMLCanvasElement} canvas
     * @req UI-5
     */
    function drawGrimoireGraph(
        canvas
    ) {
        const hours =
            getChartHours();

        const series = [
            {
                name:
                    'FTHOF casts',
                color:
                    chartColor(
                        'FTHOF casts'
                    ),
                values:
                    hours.map(
                        h =>
                            (data.hourly[
                                String(
                                    h
                                )
                            ] &&
                                data
                                    .hourly[
                                    String(
                                        h
                                    )
                                ]
                                    .fthof) ||
                            0
                    )
            },
            {
                name:
                    'Grimoire refills',
                color:
                    chartColor(
                        'Grimoire refills'
                    ),
                values:
                    hours.map(
                        h =>
                            (data.hourly[
                                String(
                                    h
                                )
                            ] &&
                                data
                                    .hourly[
                                    String(
                                        h
                                    )
                                ]
                                    .refill) ||
                            0
                    )
            }
        ];

        drawChartBase(
            canvas,
            series,
            'Grimoire'
        );
    }

    /**
     * Fill the log table (newest first, filtered by the search box, at most 2000 rows).
     * @req UI-6
     */
    function renderLogBrowser() {
        if (!logPanel) {
            return;
        }

        const tbody =
            logPanel.querySelector(
                'tbody'
            );

        const filter =
            (
                document.getElementById(
                    'ccsb-log-filter'
                ).value || ''
            )
                .trim()
                .toLowerCase();

        const rows = [];

        for (
            let i =
                data.logs.length - 1;
            i >= 0 &&
            rows.length < 2000;
            i--
        ) {
            const e =
                data.logs[i];

            const hay =
                `${e.action} ${e.meta} ${
                    e.extra
                        ? JSON.stringify(
                              e.extra
                          )
                        : ''
                }`.toLowerCase();

            if (
                filter &&
                !hay.includes(filter)
            ) {
                continue;
            }

            const d =
                new Date(
                    e.ts * 1000
                );

            rows.push(
                `<tr>` +
                    `<td>${escapeHtml(
                        d.toLocaleString()
                    )}</td>` +
                    `<td>${escapeHtml(
                        e.action
                    )}</td>` +
                    `<td>${escapeHtml(
                        e.meta
                    )}</td>` +
                    `<td>${escapeHtml(
                        e.extra
                            ? JSON.stringify(
                                  e.extra
                              )
                            : ''
                    )}</td>` +
                `</tr>`
            );
        }

        tbody.innerHTML =
            rows.join('') ||
            '<tr><td colspan="4" style="color:#c9a6e6">Nothing matches yet :3</td></tr>';
    }

    // ============================================================================
    // SECTION 15 - Lifecycle (start / destroy / real-mouse sync)
    // ============================================================================

    /**
     * Start the bot once the game is ready: refuse a second instance, expose the API, build the UI, load the
     * paw sprites, start the timers (scheduler 25 ms, panel 200 ms, charts 2 s, overlay per frame) and install
     * the real-mouse sync and the unload save.
     * @req API-1, NFR-2, MOUSE-1
     */
    function start() {
        if (
            window.__CCSmartGoldenComboBot
        ) {
            console.warn(
                '[CC Good Boy] Already running.'
            );
            return;
        }

        window.__CCSmartGoldenComboBot =
            {
                version: VERSION,

                pause: () => {
                    runtime.running =
                        false;

                    updatePanel();
                },

                resume: () => {
                    runtime.running =
                        true;

                    updatePanel();
                },

                state: runtime,
                clickFrenzySec:
                    estimateClickFrenzySec,
                data,
                save: saveNow,
                destroy
            };

        createUi();

        loadPawSprite();

        runtime.nextIdleAt =
            Date.now() + 1500;

        bgInit();

        keepAliveInit();

        runtime.schedulerTimer = bgEvery(
            schedulerTick,
            25
        );

        runtime.panelTimer =
            window.setInterval(
                updatePanel,
                200
            );

        runtime.graphTimer =
            window.setInterval(
                () => {
                    if (
                        graphPanel &&
                        graphPanel.style
                            .display ===
                            'block'
                    ) {
                        drawGraphs();
                    }
                },
                2000
            );

        drawOverlay();

        window.addEventListener(
            'beforeunload',
            saveNow
        );

        USER_SYNC_EVENTS.forEach(type =>
            window.addEventListener(
                type,
                syncGameMouseFromUser,
                true
            )
        );

        logAction(
            'bot started',
            `v${VERSION}`
        );

        console.log(
            '[CC Good Boy] Loaded uwu. window.__CCSmartGoldenComboBot exposes pause/resume/state/data/destroy.'
        );
    }

    /**
     * A real (trusted) event, as opposed to the bot's synthetic ones.
     * @param {Event} e
     * @returns {boolean}
     * @req MOUSE-1
     */
    function isUserEvent(e) {
        return !!e && e.isTrusted === true;
    }

    /**
     * Before the game handles one of the USER's mouse events, tell it where the real mouse is (the game reads
     * Game.mouseX/Y for the floating click numbers) by re-sending a mousemove at the event's coordinates.
     * Otherwise a manual click would show its number wherever the paw or the last bot click left those values.
     * Runs in the capture phase on window, so it is before the game's own handlers.
     * @param {MouseEvent} e
     * @req MOUSE-1
     */
    function syncGameMouseFromUser(e) {
        if (
            !isUserEvent(e) ||
            !e.target ||
            runtime.destroyed
        ) {
            return;
        }

        dispatchMouse(
            e.target,
            'mousemove',
            e.clientX,
            e.clientY,
            0
        );
    }

    /**
     * The user mouse events that trigger syncGameMouseFromUser().
     * @req MOUSE-1
     */
    const USER_SYNC_EVENTS = [
        'mousedown',
        'mouseup',
        'click'
    ];

    /**
     * Stop everything and remove all elements/listeners (exposed on the API; useful for hot reloading).
     * @req API-1
     */
    function destroy() {
        runtime.destroyed = true;
        runtime.running = false;

        USER_SYNC_EVENTS.forEach(type =>
            window.removeEventListener(
                type,
                syncGameMouseFromUser,
                true
            )
        );

        bgStop(runtime.schedulerTimer);

        keepAliveStop();

        if (bgClock.worker) {
            bgClock.worker.terminate();
        }

        clearInterval(
            runtime.panelTimer
        );

        clearInterval(
            runtime.graphTimer
        );

        if (runtime.drawRaf) {
            cancelAnimationFrame(
                runtime.drawRaf
            );
        }

        if (runtime.saveTimer) {
            clearTimeout(
                runtime.saveTimer
            );
        }

        saveNow();

        window.removeEventListener(
            'resize',
            resizeOverlay
        );

        window.removeEventListener(
            'resize',
            onPanelResize
        );

        window.removeEventListener(
            'beforeunload',
            saveNow
        );

        [
            'ccsb-panel',
            'ccsb-graphs',
            'ccsb-logs',
            'ccsb-debug',
            'ccsb-overlay',
            'ccsb-style'
        ].forEach(id => {
            const el =
                document.getElementById(
                    id
                );

            if (el) {
                el.remove();
            }
        });

        delete window
            .__CCSmartGoldenComboBot;

        console.log(
            '[CC Good Boy] Destroyed... bye bye :c'
        );
    }

    /**
     * Poll every 500 ms until the game object, its shimmer list and the big cookie exist, then start().
     * @req NFR-2
     */
    function waitForGame() {
        if (
            !window.Game ||
            !Game.ready ||
            !Array.isArray(
                Game.shimmers
            ) ||
            !document.getElementById(
                'bigCookie'
            )
        ) {
            setTimeout(
                waitForGame,
                500
            );

            return;
        }

        start();
    }

    waitForGame();
})();
