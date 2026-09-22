# Cursor Manager Refactor — Modules / Actions / Jobs / Queue

Status: **APPROVED — DONE except visual suite** (Phases 1-6 code/docs/version done; visual tests not run — files absent from checkout)

Goal: introduce the architecture the operator asked for —

- **Modules** decide *what* to do and *when* (golden hunter, auto play, FTHOF, hammer,
  pondering/idle, dance).
- **Actions** know *how* to do one thing (click an element, visit a spot, hammer, buy,
  dance, ponder).
- **Jobs** are instances of actions inside a queue. A job carries parameters, a click-at
  position, a move-to speed and a priority.
- **Actions always expose `cursor_at_position`**; the job/queue calls it once the cursor
  has arrived at the job position.
- The **CursorManager owns the queue and the cursor** and works the queue ordered by
  priority.

The effect: a module that wants to click `(466, 233)` only enqueues an action job — it
never touches cursor math, delays, travel animation or `humanClick` again.

---

## 1. Analysis of the current architecture

### 1.1 What exists today

- `Scheduler.tick()` (25 ms) classifies shimmers, builds the golden queue, calls
  `selectTask()` (`src/scheduler/priority.ts`) and runs ONE selected async task to
  completion (`runtime.actionInProgress` guard).
- Tasks are whole workflows. Each task hand-rolls the same choreography:
  1. optional reaction/click delay (`ClickTiming.waitForClickGap`)
  2. move the paw (`CursorController.moveCursorTo`)
  3. pre-click pause (`ClickTiming.waitPreClick`)
  4. re-check aborts
  5. click (`ClickTiming.humanClick`)
- The choreography is duplicated in:
  - `src/hunting/click-golden.ts`
  - `src/hunting/click-big-cookie.ts` (also its own fixed-timeline loop)
  - `src/hunting/fthof.ts` (twice: cast + refill)
  - `src/autoplay/shopping.ts` (visual press only)
  - `src/idle/idle-behavior.ts` (bored clicks + look-only visits)
- Priority logic lives in **two** places that can drift apart:
  `src/scheduler/priority.ts` (`selectTask`) and `src/idle/pending-work.ts`
  (`PendingWork.isPending`).
- `CursorController` is documented as "SOLE owner of `runtime.cursor` mutation", but that
  rule is already violated: `IdleBehavior.ponder()` and `HappyDance` also write
  `runtime.cursor` directly.

### 1.2 Why extending is tedious / regression-prone

A new module today must:

1. implement the whole travel/pause/click choreography correctly,
2. wire a new tier into `selectTask()` **and** `PendingWork` (two files),
3. manage its own abort predicates,
4. touch `main.ts` composition, the scheduler deps type, HUD state text, and tests.

That is 5+ integration points, and any missed delay/speed/hurry rule is a regression.

### 1.3 What must be preserved (non-negotiable, from AGENTS.md)

- SCHED-1 priority order, one unit of work at a time, preemption within ~a frame.
- GC-3/GC-4 reaction delay + re-acquire of the pulsing cookie center.
- CF-1..6 hammer fixed-timeline rate independent of scheduler ticks.
- FT-4/FT-5 re-check conditions right before clicking, click delay + pre-click pause.
- AUTO-9 visual press only (no real store click).
- DANCE-1..4 and IDLE-1..4 behavior incl. yield within a frame.
- Config: `cursorSpeedPxPerSec`, `idleSpeedPxPerSec`, `goldenMinIntervalMs`,
  `preClickDelayMs`, `panicFactor` (hurry), `hammerStepPx`, `clickFrenzyCps`,
  `clickFrenzyJitterMs`.
- MOUSE-1/MOUSE-2 real-mouse rules and NFR-8 visual honesty (paw moves + pulse when any
  game-state change fires).

---

## 2. Target architecture

### 2.1 Concepts

```
Module ──enqueue──▶ CursorJob { action, priority, position, speed, key }
                         │
                         ▼
                 CursorManager (owns queue + runtime.cursor)
                         │  highest priority first, preemptive
                         ▼
                  job steps: wait click gap → move (config/hurry speed)
                             → pre-click pause → cursor_at_position(ctx)
```

- **Action**: a class implementing `CursorAction`. It declares what the job should do and
  provides `cursor_at_position(ctx)`.
- **Job**: an `enqueue()`d action instance. The manager assigns it an id, records its
  priority/label/key/dueAt.
- **Queue**: `CursorManager`'s ordered job list. Lower numeric priority runs first.
- **`cursor_at_position`**: called by the manager after the cursor is at the job's
  position and the pre-click pause is over. For a continuous action (hammer/dance/ponder)
  this method runs the whole loop and resolves when the action is finished or preempted.

### 2.2 Priorities (SCHED-1 → numeric)

```ts
export const JOB_PRIORITY = {
  GOLDEN: 0,        // good golden cookie
  CLICK_FRENZY: 1,  // real Click Frenzy clicking
  FTHOF: 2,         // Force the Hand of Fate
  REFILL: 3,        // sugar-lump mana refill
  AUTO_SHOP: 4,     // due auto purchase
  HAMMER: 5,        // manual/auto hammer outside frenzy
  HAPPY_DANCE: 6,   // queued post-catch dance
  IDLE: 7,          // idle wander/ponder
} as const;
```

Lower number = higher priority. Modules assign the priority when enqueueing.

### 2.3 Core contract (target TypeScript shapes)

New directory `src/cursor/` for the manager + queue types; `src/actions/` for concrete
actions. Existing module directories (`src/hunting`, `src/autoplay`, `src/idle`) become
thin decision producers that build actions.

```ts
// src/cursor/types.ts
export interface CursorJobContext {
  runtime: RuntimeState;
  data: PersistedData;
  game: IGameAdapter;
  clock: BackgroundClock;
  hurry: HurryMode;
  clickTiming: CursorClickTiming;  // waitForClickGap / waitPreClick / humanClick
  cursor: CursorMover;             // low-level travel (moveCursorTo / glideCursor / setPosition)
  enqueue: (action: CursorAction, opts?: EnqueueOpts) => CursorJob;
  abortRequested: () => boolean; // true when a higher-priority job wants in
}

export interface CursorAction {
  /** Human/debug label, e.g. 'click golden cookie', 'buy Cursor'. */
  label: string;
  /** Where to move before calling cursor_at_position. Static point or a re-evaluated
   *  getter (pulsing cookies). null = no travel, call at current position. */
  target?: CursorPoint | (() => CursorPoint | null) | null;
  /** Optional per-job speed (px/s). Undefined = config cursorSpeedPxPerSec / hurry. */
  moveSpeed?: number;
  /** Optional per-job travel duration clamp (ms). */
  moveMaxMs?: number;
  /** Wait 'Patience before moving' since the last click before travelling. Default true.
   *  Ignored when `beforeMove` is set. */
  waitClickGap?: boolean;
  /** Wait 'Shy pause before click' after arrival. Default true. */
  preClickPause?: boolean;
  /** Abort travel/pause when a good golden cookie becomes ready. Default true. Golden
   *  cookie jobs themselves set this to false. */
  abortOnGolden?: boolean;
  /** Re-evaluate target() after the pre-click pause and settle again if it moved
   *  (golden cookies pulse). Default false. */
  reacquire?: boolean;
  /** Optional pre-travel step (e.g. a reaction delay tied to a specific event). Returning
   *  false cancels the job. When set, it replaces the generic click-gap wait. */
  beforeMove?: (ctx: CursorJobContext) => boolean | Promise<boolean>;
  /** Checked before/during wait+travel, and once more right before cursor_at_position.
   *  Returning true aborts the job (manager resolves it as cancelled). */
  abortIf?: (ctx: CursorJobContext) => boolean;
  /** HUD state while running, e.g. { action: 'golden-cookie', target: 'good golden cookie' }. */
  hud?: { action: string; target: string };
  /** Called by the manager at the click-at position. One-shot actions click here and
   *  return; continuous actions run their loop here and return when finished. */
  cursor_at_position(ctx: CursorJobContext): Promise<void> | void;
}

export interface CursorJob {
  id: number;
  action: CursorAction;
  priority: number;
  label: string;
  key?: string;          // dedup key, e.g. `golden:${shimmer.id}`
  dueAt: number;         // 0 = ready now
  state: 'queued' | 'running' | 'done' | 'cancelled';
  done: Promise<'done' | 'cancelled'>; // resolves once the job settles
}
```

`CursorManager` public surface:

```ts
class CursorManager {
  enqueue(action: CursorAction, opts?: EnqueueOpts): CursorJob;
  enqueueAndWait(action: CursorAction, opts?: EnqueueOpts): Promise<'done' | 'cancelled'>;
  createAction(action: CursorAction, label: string, opts?: EnqueueOpts): CursorJob;
  cancel(keyOrId: string | number): void;
  has(keyOrId: string | number): boolean;
  hasPendingJobs(): boolean;
  isIdle(): boolean;
  waitUntilIdle(): Promise<void>;   // test/teardown helper
  get currentJob(): CursorJob | null;
  destroy(): void;
}
```

Convenience for the operator's `createAction(myActionClass(x, y), 'foobar')` style:

```ts
// thin helper on CursorManager
createAction(action: CursorAction, label: string, opts?: EnqueueOpts): CursorJob;
```

### 2.4 Execution model (how the queue preserves current behavior)

1. `enqueue()` adds the job; if the queue was idle it starts processing.
2. Processing picks the highest-priority, non-cancelled, due job.
3. If a running job has lower priority than the new head, the manager flips the running
   job's `abortRequested` flag; the running action observes it via `ctx.abortRequested()`
   in its loop/waits and returns promptly (SCHED-2's "within a frame" is preserved because
   `moveCursorTo`/`waitUntil`/`clock` polling all check it).
4. For the chosen job the manager:
   - sets HUD state (`action.hud`), marks job `running`;
   - if `waitClickGap`, waits `clickTiming.waitForClickGap(abortIf)` (applies hurry factor);
   - evaluates `target()`; if non-null, calls `cursor.moveCursorTo(x, y, goldenAbort,
     { speed, abortIf })` — speed defaults to `config.cursorSpeedPxPerSec /
     hurry.urgencyFactor()` exactly as today;
   - if `preClickPause`, waits `clickTiming.waitPreClick(abortIf)`;
   - if `reacquire`, re-evaluates `target()` and settles again if it moved;
   - checks `abortIf` one final time;
   - calls `action.cursor_at_position(ctx)` and awaits it;
   - marks the job `done` and leaves the cursor exactly where the action ended
     ("stays at its new position until a new job takes effect").
5. A job's `cursor_at_position` may call `ctx.enqueue()` to chain follow-up work
   (e.g. a golden click enqueues the happy dance; the hammer loop enqueues nothing and
   just keeps its loop).

### 2.5 Sole writer of the cursor

`CursorManager` becomes the only component allowed to mutate `runtime.cursor` (via the
low-level `CursorController` it owns). `IdleBehavior.ponder` and `HappyDance` stop writing
`runtime.cursor` directly; they become actions and receive travel/animation primitives from
the context. `dispatchMove` stays inside `CursorController`/low-level travel.

---

## 3. Mapping: current tasks → new actions/modules

| Today | Becomes | Type |
|---|---|---|
| `ClickGoldenTask` | `GoldenCookieAction` + thin `GoldenHunter` module | one-shot + `reacquire` |
| `ClickBigCookieTask` | `HammerAction` (continuous, fixed timeline) | continuous |
| `FthofActions.castFthof` | `FthofAction` (generic click-element with game preconditions) | one-shot |
| `FthofActions.refillGrimoire` | `RefillAction` | one-shot |
| `AutoPlayEngine.shop` | `AutoPlayModule` enqueues `VisualPressAction` (move + pulse, no store click) | one-shot |
| `HappyDance` | `DanceAction` | continuous, no target |
| `IdleBehavior` | `IdleModule` producing `VisitAction` / `DriftAction` / `BoredClickAction` / `PonderAction` | mixed |
| `Scheduler.selectTask` + `PendingWork` | `selectJobRequest()` (pure) + queue state | producer |

Modules keep all their **decision logic** (golden fade/route planning, FTHOF outlast
checks, auto valuation, hammer worthiness, dance eligibility, idle rolls) exactly where it
is today. Only the *execution choreography* moves into the manager/actions.

---

## 4. File layout (target)

```
src/
  cursor/
    types.ts                 # CursorAction, CursorJob, CursorJobContext, JOB_PRIORITY, EnqueueOpts
    cursor-manager.ts        # queue owner + executor + createAction helper
  actions/
    click-element.ts         # generic real click on an element (fthof/refill/bored/golden base)
    visual-press.ts          # move + pulse only (auto-shop)
    golden-cookie.ts         # golden click action (stats/log/dance queue)
    hammer.ts                # fixed-timeline hammer loop (click frenzy + hammer mode)
    dance.ts                 # happy dance animation
    ponder.ts                # figure-eight animation
  hunting/                   # becomes modules: golden-hunter.ts, fthof-module.ts, hammer-module.ts
  autoplay/                  # shopping.ts/auto-hammer.ts become modules producing jobs
  idle/                      # idle-module.ts producing visit/drift/bored/ponder jobs
  scheduler/                 # priority.ts → selectJobRequest(), scheduler.ts → producer
```

`CursorController` stays in `src/input/cursor-controller.ts` as the low-level animator
(rename later if desired; not required for this refactor).

---

## 5. Config preservation rules

The manager centralizes these so actions can't forget them:

- travel speed: `job.moveSpeed ?? cursorSpeedPxPerSec / hurry.urgencyFactor()`,
  clamped as `moveCursorTo` does today (`22..420 ms` default duration clamp, opts.maxMs).
- idle travel: idle module passes `speed = idleSpeedPxPerSec`, `maxMs = 6000`.
- `waitClickGap` / `preClickPause` use `ClickTiming` (already multiplies hurry factor).
- hammer rate/jitter/step: unchanged `nextBigCookiePoint` + fixed-timeline loop inside
  `HammerAction`.
- golden fade threshold + hurry: unchanged `GoldenCookieModel`/`HurryMode`.
- MOUSE rules: `dispatchMove` silence during cosmetic jobs is driven by HUD action names;
  the manager keeps the same `SILENT_MOVE_ACTIONS` set for `idle/idle-play/happy-dance/
  bored-click/auto-shop` travel.

---

## 6. Phased to-do list

Check items off as they land. Every phase must end green: `make typecheck` + `make test`.

### Phase 1 — Skeleton and queue core (new code only, no behavior change)

- [x] Add `src/cursor/types.ts` (`JOB_PRIORITY`, `CursorAction`, `CursorJob`,
      `CursorJobContext`, `EnqueueOpts`, `JobRequest`).
- [x] Add `src/cursor/cursor-manager.ts` (ordered queue, dedup by key, preemption via
      `abortRequested`, travel/pause/`cursor_at_position` pipeline, `createAction` helper,
      single writer of `runtime.cursor`).
- [x] Add generic `ClickElementAction`, `MoveAction`, `VisualPressAction` under
      `src/actions/`.
- [x] Unit tests (`tests/unit/cursor-manager.test.ts`): ordering, dedup, preemption,
      speed default/hurry override, click gap + pre-click pause, `cursor_at_position`
      invocation, "cursor stays at new position", abort-before-click.
- [x] Run `make typecheck` and `make test`.

### Phase 2 — Migrate one-shot flows (FTHOF, refill, auto-shop, golden)

- [x] `FthofAction` + `RefillAction` replace `FthofActions`' travel/click choreography;
      keep preconditions, verification, stats/log and LOCK_A logic.
- [x] `AutoPlayModule.shop` enqueues `VisualPressAction`; keep re-evaluate + `autoBuy`
      gating and the 90 ms/70 ms visual timing.
- [x] `GoldenCookieAction` replaces `ClickGoldenTask` (reaction delay, `reacquire` of
      pulsing center, stats/log, dance eligibility unchanged).
- [x] Rewire `main.ts` composition for these three; old task classes become unused (removed
      in Phase 6).
- [x] Update `fthof.test.ts` / `click-golden.test.ts`; add `actions/*` tests.
- [x] `make typecheck` + `make test` green.

### Phase 3 — Hammer / Click Frenzy

- [x] `HammerAction` (continuous job) ported from `ClickBigCookieTask`: same
      `nextBigCookiePoint`, press-at-due math, fixed timeline, resync rule, jitter cap,
      only-frenzy logging, abort on golden/FTHOF/refill/auto-shop (hammer mode only).
- [x] `HammerModule` enqueues it with `CLICK_FRENZY` or `HAMMER` priority; keep
      `hammerActive()` composition (`runtime.hammer` / `AutoHammer`).
- [x] Update `click-big-cookie.test.ts`.
- [x] `make typecheck` + `make test` green.

### Phase 4 — Cosmetic motions into the manager (sole cursor writer)

- [x] `DanceAction` (continuous, no target) ported from `HappyDance`; DANCE-1..4 preserved.
- [x] `PonderAction` (figure-eight) + `IdleModule` producing `VisitAction` / `DriftAction` /
      `BoredClickAction`; IDLE-1..4 preserved (incl. 22% bored-click roll and
      `idleStay` after real work).
- [x] Remove direct `runtime.cursor` writes from `IdleBehavior`/`HappyDance`; add a test
      asserting only the manager (and its low-level controller) mutates `runtime.cursor`.
- [x] Update `happy-dance.test.ts` / `idle-behavior.test.ts`.
- [x] `make typecheck` + `make test` green.

### Phase 5 — Scheduler becomes a producer

- [x] `selectJobRequest()` in `src/scheduler/priority.ts` replaces `selectTask()`: same
      cascade, returns `{ action, priority, key, dueAt? } | null`.
- [x] `Scheduler.tick()` classifies shimmers/logs wrath/builds the queue, then enqueues
      the selected job (dedup via key) instead of running tasks; remove
      `runtime.actionInProgress` task-run path.
- [x] `PendingWork` derives pending state from module conditions + manager queue state
      (keep one source of truth).
- [x] Update `priority.test.ts` / `scheduler.test.ts` / `pending-work.test.ts`.
- [x] `make typecheck` + `make test` green.

### Phase 6 — Cleanup, docs, version, verification

- [x] Delete dead task choreography — the old travel/click code is gone; the former task
      files are now thin module classes (`ClickGoldenTask`, `ClickBigCookieTask`,
      `FthofActions`, `HappyDance`, `IdleBehavior`) that only produce job requests.
- [x] Grep-audit: no `runtime.cursor.x/y =` outside `src/input/cursor-controller.ts`;
      `moveCursorTo`/`glideCursor` callers are only actions (via ctx), the manager, and the
      low-level controller.
- [x] Update `AGENTS.md` module map + §7 state table + §6.5 job model + testing counts.
- [x] Bump `VERSION` in `src/core/constants.ts` **and** `version` in `package.json`
      (both 4.1.0), add changelog entry (NFR-1).
- [x] `make typecheck`, `make test`, `make build` green (175 tests / 26 files).
- [ ] Run `./run-vis-tests.sh` for golden/wrath/storm/chain/hammer/auto-shop/dance and
      fix any drift. NOT RUN: this checkout has no `tests/visual/` and no
      `./run-vis-tests.sh` (the visual suite files are absent from the workspace).
- [x] Final diff review: only intended changes, no leftovers.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Timing drift (golden reaction, hammer rate, auto-shop pulse) | Phased port; keep pure decision math identical; keep `ClickTiming`/`nextBigCookiePoint` untouched; visual suite |
| Preemption subtleties (abort semantics) | Queue-level `abortRequested` + final abort check before `cursor_at_position`, mirroring today's checks; dedicated manager tests |
| Regression in idle/dance cosmetic behavior | Port animation math verbatim; sole-writer test + existing unit tests |
| Test churn (many tests import removed classes) | Port tests phase-by-phase; only remove old files in Phase 6 |
| Behavior spec in AGENTS.md drifts | Phase 6 updates AGENTS.md, VERSION, changelog |

## 8. How to resume after a session swap

1. Read this file and check the boxes.
2. `make test` / `make typecheck` to see where the previous session stopped.
3. Continue with the first unchecked phase item; never skip a phase.
4. After each checked item, leave the repo in a compiling, green-test state.
