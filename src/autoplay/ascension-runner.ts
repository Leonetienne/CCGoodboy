import { DragTreeAction, WaitWhileAction } from '../actions/ascension';
import { DragonClickAction } from '../actions/krumblor';
import { WrinklerPopAction } from '../actions/wrinkler-pop';
import { sayCant, sayYay } from '../core/console-voice';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import {
  crateClickable,
  getAscendCancelButton,
  getAscendConfirmButton,
  getHeavenlyCrate,
  getLegacyButton,
  getReincarnateButton,
  getReincarnateConfirmButton,
  openPromptId,
  panToCrate,
} from '../game/ascension-dom';
import { visibleRect } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import { elementCenter } from '../game/grimoire-dom';
import { wrinklerPokeCanvasPoint } from '../game/wrinkler-dom';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';
import { formatNum } from '../ui/format';
import type { AscensionPlanner } from './ascension';
import type { AscensionPlan } from './ascension-strategy';
import { nextAscensionStep, type AscendCrate, type AscendState, type AscendStep } from './ascension-steps';

/** A step whose element doesn't show up for this long pauses the module. */
const STUCK_MS = 5000;
/** On the ascension screen longer than this: the rest of the list is skipped, so a crate that
 * can't be bought never keeps the bot in heaven. */
const MAX_HEAVEN_MS = 3 * 60 * 1000;
/** A crate whose purchase failed this often is skipped. */
const MAX_BUY_FAILS = 3;
/** Drags towards a crate before it counts as reachable wherever it ended up. */
const MAX_PANS = 4;
/** The scheduler holds still this long after reincarnating (like LIFE-1 at start-up). */
export const ASCEND_SETTLE_MS = 3000;
/** ASC-12: the lucky level must keep its 7s at least this long before the bot starts (the
 * walk to Legacy and the two clicks), plus LUCKY_MARGIN_PER_POP_SEC per wrinkler to pop. Once
 * "Ascend" is clicked the level is frozen: the game earns nothing during the animation. */
export const LUCKY_MARGIN_SEC = 30;
export const LUCKY_MARGIN_PER_POP_SEC = 5;
/** With its own "Ascend" prompt open, only this much is left to do. */
const LUCKY_MARGIN_CONFIRM_SEC = 2;

/** Auto play: ascends when the planner says so (ASC-10). Pops every wrinkler (their cookies
 * count for prestige, and ascending would throw them away), clicks Legacy and "Ascend",
 * buys the heavenly shopping list crate by crate, clicks Reincarnate and "Yes", then resets
 * the bot's per-run state. One step per scheduler tick, re-derived from the live game
 * (nextAscensionStep), every step a real click or a visible drag (NFR-8). */
export class AscensionRunner {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly stats: StatsRecorder,
    private readonly planner: AscensionPlanner,
    private readonly shoppingInterrupted: () => boolean,
  ) {}

  private enabled(): boolean {
    return this.data.config.autoPlay === true && this.data.config.autoAscend !== false;
  }

  /** The plan says ascend now and nothing more important is going on (ASC-10 gates). */
  wantNow(): boolean {
    if (!this.enabled() || !this.runtime.running || !this.game.isReady() || this.game.isAscending()) return false;
    // Its own pause only: shopping's (autoBlockUntil) says nothing about ascending, and
    // shopping pauses itself whenever it is refused, e.g. while the "Ascend" prompt is open.
    if (Date.now() < this.runtime.ascendBlockUntil) return false;

    // Its own "Ascend" prompt may be open; any other prompt holds it back.
    if (this.game.isPromptOpen() && !(this.runtime.ascendOurs && openPromptId() === 'Ascend')) return false;
    if (this.shoppingInterrupted() || this.game.positiveCpsBuffs().length) return false;

    const p = this.planner.plan();
    return !!p && p.verdict === 'ascend' && this.luckyLevelLastsLongEnough(p);
  }

  /** ASC-12: when the shopping list needs 7s, the level the ascension lands on must still have
   * them once the wrinklers are popped and the prompt clicked; a lucky level about to pass is
   * let go (the plan then waits for the next one). Nothing to check without lucky wishes. */
  private luckyLevelLastsLongEnough(p: AscensionPlan): boolean {
    if (p.shop.sevens <= 0) return true;
    return p.luckySafeSec >= this.luckyMarginSec();
  }

  private luckyMarginSec(): number {
    if (this.runtime.ascendOurs && openPromptId() === 'Ascend') return LUCKY_MARGIN_CONFIRM_SEC;

    const pops = this.game.getWrinklers().filter((w) => w && w.phase === 2).length;
    return LUCKY_MARGIN_SEC + LUCKY_MARGIN_PER_POP_SEC * pops;
  }

  /** The live game as nextAscensionStep() sees it. */
  state(): AscendState {
    const onScreen = this.game.onAscendScreen();
    const intro = this.game.isAscendIntro();
    const prompt = this.game.isPromptOpen() ? openPromptId() || '?' : '';

    // Back in a normal game without its prompt: whatever it started is over.
    if (!onScreen && !intro && prompt !== 'Ascend' && prompt !== 'Reincarnate') this.runtime.ascendOurs = false;

    const all = this.game.getWrinklers();
    const wrinklers = all
      .filter((w) => w && w.phase === 2 && wrinklerPokeCanvasPoint(w, all))
      .sort((a, b) => b.sucked - a.sucked)
      .map((w) => w.id);

    return {
      want: !onScreen && !intro && this.wantNow(),
      ours: this.runtime.ascendOurs,
      prompt,
      intro,
      onScreen,
      wrinklers,
      toBuy: onScreen && this.runtime.ascendOurs ? this.toBuy() : [],
    };
  }

  /** What's left of the shopping list for the chips on hand (ASC-9), minus what it gave up on. */
  private toBuy(): AscendCrate[] {
    if (Date.now() - this.runtime.ascendOursAt > MAX_HEAVEN_MS) return [];

    const shop = this.planner.shoppingNow();
    if (!shop) return [];

    const ids = new Map(this.game.getHeavenlyUpgrades().map((u) => [u.name, u.id]));

    return shop.items
      .filter((item) => !this.runtime.ascendSkip.has(item.name) && ids.has(item.name))
      .map((item) => {
        const id = ids.get(item.name)!;
        const el = getHeavenlyCrate(id);
        const dragged = (this.runtime.ascendPans.get(id) || 0) >= MAX_PANS;

        return { id, name: item.name, clickable: crateClickable(el) || (dragged && !!visibleRect(el)) };
      });
  }

  /** The next step, or null while there is nothing to do. */
  step(): AscendStep | null {
    if (!this.enabled() || !this.runtime.running || !this.game.isReady()) return null;
    if (Date.now() < this.runtime.ascendBlockUntil) return null;

    const s = nextAscensionStep(this.state());
    return s.kind === 'wait' ? null : s;
  }

  /** Something for the paw to do (the scheduler, PendingWork and hammering use it). A dry
   * run only logs, so it never counts as pending. */
  pending(): boolean {
    return !!this.step() && this.data.config.autoDryRun !== true;
  }

  /** ASC-11: one plain line on what the BOT does about ascending, for the HUD row and the
   * cards. Always there (also with auto play off), so nobody has to guess from a missing line;
   * '' only when there is no plan to talk about. */
  botLine(): string {
    const c = this.data.config;

    if (this.game.onAscendScreen() || this.game.isAscendIntro()) {
      if (this.runtime.ascendOurs) return 'Paw: buying the pink ones, then reincarnating';
      return "Paw: you ascended yourself, so the buying is up to you";
    }

    const p = this.planner.plan();
    if (!p) return '';

    if (c.autoPlay !== true) return "Paw: auto play is off, so it won't ascend by itself";
    if (c.autoAscend === false) return 'Paw: "Auto: ascend" is off, so it won\'t ascend by itself';
    if (c.autoDryRun === true) return 'Paw: dry run, it only writes "would ascend" in the log';

    if (p.verdict === 'waiting') return `Paw: will ascend by itself at level ${formatNum(p.shop.level)}`;
    if (p.verdict !== 'ascend') return 'Paw: will ascend by itself once it pays off';

    const s = this.step();
    if (s && s.kind === 'pop-wrinkler') return 'Paw: popping the wrinklers first, then ascending';
    if (s) return 'Paw: ascending now';

    return `Paw: will ascend once ${this.holdReason()}`;
  }

  /** Why an ascension that is due isn't happening yet. */
  private holdReason(): string {
    if (!this.runtime.running) return 'unpaused';
    if (Date.now() < this.runtime.ascendBlockUntil) return 'its pause after a hiccup is over';
    if (this.game.isPromptOpen()) return 'the open prompt is closed';
    if (this.game.positiveCpsBuffs().length) return 'the buffs are over';
    if (this.shoppingInterrupted()) return 'golden cookies and frenzies are done';

    const p = this.planner.plan();
    if (p && !this.luckyLevelLastsLongEnough(p)) return 'the next lucky level (this one ends too soon for its 7s)';

    return 'it is safe';
  }

  /** The next single step as a job, or null. */
  job(): JobRequest | null {
    const s = this.step();
    if (!s) return null;

    if (this.data.config.autoDryRun === true) {
      const now = Date.now();
      const last = this.runtime.autoWouldLog.get('ascend') || 0;

      if (now - last > 60000) {
        this.runtime.autoWouldLog.set('ascend', now);
        const p = this.planner.plan();
        this.log.log('auto play (dry run)', 'would ascend', p ? { prestige: p.prestige, gain: p.gain, buys: p.shop.items.map((i) => i.name).join(', ') } : undefined);
      }

      return null;
    }

    const req = this.jobFor(s);

    if (req) {
      this.runtime.ascendStuckSince = 0;
    } else if (!this.runtime.ascendStuckSince) {
      this.runtime.ascendStuckSince = Date.now();
    } else if (Date.now() - this.runtime.ascendStuckSince > STUCK_MS) {
      this.runtime.ascendStuckSince = 0;
      this.block(10000, `I can't find what to click for "${s.kind}"`);
    }

    return req;
  }

  private jobFor(s: AscendStep): JobRequest | null {
    const sameStep = (now: AscendStep | null) => !!now && now.kind === s.kind && (!('id' in s) || ('id' in now && now.id === s.id));
    const stillWanted = () => sameStep(this.step());
    const key = `ascend:${s.kind}${'id' in s ? `:${s.id}` : ''}`;

    const click = (label: string, target: string, el: () => Element | null, worked: () => boolean, onResult: (ok: boolean) => void, onClicked?: () => void): JobRequest | null => {
      if (!elementCenter(el())) return null;

      return {
        action: new DragonClickAction({ label, target, point: () => elementCenter(el()), el, stillWanted, worked, onResult, onClicked, mood: 'ascend' }),
        priority: JOB_PRIORITY.AUTO_SHOP,
        key,
      };
    };
    const orFail = (why: string, onOk: () => void) => (ok: boolean) => (ok ? onOk() : this.block(3000, why));

    switch (s.kind) {
      case 'pop-wrinkler':
        return {
          action: new WrinklerPopAction(s.id, this.game, () => !stillWanted(), (popped, gained) => {
            if (!popped) return this.block(3000, 'a wrinkler did not pop');
            this.stats.recordWrinklerPop();
            this.log.log('pop wrinkler', 'before ascending', { id: s.id, gained: Math.round(gained) });
          }),
          priority: JOB_PRIORITY.AUTO_SHOP,
          key,
        };

      case 'open-legacy':
        return click(
          'ascend',
          'the Legacy button',
          getLegacyButton,
          () => openPromptId() === 'Ascend',
          (ok) => {
            if (ok) return;
            this.runtime.ascendOurs = false;
            this.block(3000, 'the Legacy button did not ask "Ascend"');
          },
          // The prompt opens with the click itself: it is ours from that moment, so nothing
          // else gets a tick in between (and nothing mistakes it for someone else's prompt).
          () => {
            this.runtime.ascendOurs = true;
            this.runtime.ascendOursAt = Date.now();
          },
        );

      case 'confirm-ascend': {
        const p = this.planner.plan();

        return click(
          'ascend',
          '"Ascend"',
          getAscendConfirmButton,
          () => this.game.isAscending(),
          orFail('"Ascend" did not start the ascension', () => {
            this.runtime.ascendOursAt = Date.now();
            this.stats.recordAscension();
            this.log.log('ascend', p ? `level ${formatNum(p.prestige)} + ${formatNum(p.gain)} = ${formatNum(p.pendingLevel)}` : 'ascended', {
              prestige: p?.prestige,
              gain: p?.gain,
              plan: p?.shop.items.map((i) => i.name).join(', '),
            });
            sayYay('Ascending!! See you on the other side, cookies ^w^');
          }),
        );
      }

      case 'cancel-ascend':
        return click('cancel ascending', '"Cancel"', getAscendCancelButton, () => !this.game.isPromptOpen(), (ok) => {
          if (!ok) return this.block(3000, 'the "Ascend" prompt did not close');
          this.runtime.ascendOurs = false;
          this.log.log('ascend', 'cancelled: the moment passed');
        });

      case 'intro':
        return {
          action: new WaitWhileAction('ascend', 'the ascend animation', () => this.game.isAscendIntro()),
          priority: JOB_PRIORITY.AUTO_SHOP,
          key,
        };

      case 'pan': {
        const el = () => getHeavenlyCrate(s.id);

        if (!panToCrate(el())) {
          this.skip(s.name, 'its crate is not in the tree');
          return null;
        }

        return {
          action: new DragTreeAction({
            label: 'drag the heavenly tree',
            target: s.name,
            delta: () => {
              this.runtime.ascendPans.set(s.id, (this.runtime.ascendPans.get(s.id) || 0) + 1);
              return panToCrate(el());
            },
            pan: (dx, dy) => this.game.panAscendTree(dx, dy),
            stillWanted,
          }),
          priority: JOB_PRIORITY.AUTO_SHOP,
          key,
        };
      }

      case 'buy': {
        const price = this.game.getHeavenlyUpgrades().find((u) => u.id === s.id)?.price ?? 0;

        return click(
          `buy ${s.name}`,
          s.name,
          () => getHeavenlyCrate(s.id),
          () => !!this.game.getHeavenlyUpgrades().find((u) => u.id === s.id)?.bought,
          (ok) => {
            if (ok) {
              this.log.log('heavenly upgrade', `bought ${s.name}`, { price });
              return;
            }

            const fails = (this.runtime.ascendFails.get(s.id) || 0) + 1;
            this.runtime.ascendFails.set(s.id, fails);

            if (fails >= MAX_BUY_FAILS) this.skip(s.name, 'buying it did not work');
            else this.block(3000, `buying ${s.name} did not work`);
          },
        );
      }

      case 'reincarnate':
        return click('reincarnate', 'the Reincarnate button', getReincarnateButton, () => openPromptId() === 'Reincarnate', orFail('Reincarnate did not ask "Yes"', () => {}));

      case 'confirm-reincarnate':
        return click(
          'reincarnate',
          '"Yes"',
          getReincarnateConfirmButton,
          () => !this.game.onAscendScreen(),
          orFail('"Yes" did not reincarnate', () => {
            this.runtime.resetForNewRun(ASCEND_SETTLE_MS);
            this.log.log('ascend', `reincarnated at level ${formatNum(this.game.getPrestige())}`, { chipsLeft: this.game.getHeavenlyChips() });
            sayYay('Back in the mortal world, time to bake again :3');
          }),
        );
    }

    return null;
  }

  /** Gives up on one heavenly upgrade for this ascension. */
  private skip(name: string, why: string): void {
    this.runtime.ascendSkip.add(name);
    this.log.log('ascend', `skipping ${name}: ${why}`);
    sayCant(`Wanted to buy ${name} in heaven, but ${why}, so I'm skipping it :c`);
  }

  private block(ms: number, why: string): void {
    this.runtime.ascendBlockUntil = Date.now() + ms;
    this.log.log('ascend', `paused: ${why}`);
    sayCant(`Wanted to ascend, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }
}
