import type { PersistedData } from '../core/persisted-data';
import type { IGameAdapter } from '../game/game-adapter';
import { formatNum, formatShort } from '../ui/format';
import { planAscension, prestigeMult, type AscensionPlan } from './ascension-strategy';
import { planHeavenlyShopping, type HeavenlyShopPlan } from './heavenly-shopping';
import { autoFmtTime } from './shopping';

/** How far back the measured income looks (ASC-2): long enough that a golden cookie combo is
 * one bump in it, not the whole picture. */
export const ASC_INCOME_WINDOW_MS = 30 * 60 * 1000;
/** Minimum history before the measured income replaces unbuffed CpS. */
const ASC_INCOME_MIN_SPAN_MS = 2 * 60 * 1000;
/** One sample of all-time cookies every this often. */
const ASC_SAMPLE_EVERY_MS = 5000;
/** The plan is recomputed at most this often (HUD + overlay both read it). */
const ASC_PLAN_TTL_MS = 500;

/** Cookies the attached wrinklers give when popped: counted for prestige, since the bot pops
 * them all before ascending (ASC-1/ASC-10). */
function wrinklerStash(game: IGameAdapter): number {
  let sum = 0;

  for (const w of game.getWrinklers()) {
    if (w && w.phase > 0 && w.sucked > 0) sum += w.sucked * game.getWrinklerPopMult(w.type === 1);
  }

  return sum;
}

interface CookieSample {
  t: number;
  total: number;
}

/** Ascension planner (ASC-*): read-only. Measures how fast the run earns prestige, and turns
 * the live game into an AscensionPlan for the HUD row and the overlay. It never ascends. */
export class AscensionPlanner {
  private samples: CookieSample[] = [];
  private cache: AscensionPlan | null = null;
  private cacheAt = 0;
  /** ASC-12: how long the routine before an ascension takes (the runner's estimate), so a
   * lucky level is only planned where it is still ahead once the routine is done. */
  leadSec: () => number = () => 0;

  constructor(
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
  ) {}

  /** Cookies per second over the last ASC_INCOME_WINDOW_MS (everything that counts for
   * prestige: CpS, clicks, golden cookies, popped wrinklers); unbuffed CpS until there is
   * enough history. */
  measuredIncome(now: number, total: number): number {
    const last = this.samples[this.samples.length - 1];

    if (last && total < last.total) {
      this.samples = [];
    }

    if (!last || now - last.t >= ASC_SAMPLE_EVERY_MS || total < last.total) {
      this.samples.push({ t: now, total });
    }

    while (this.samples.length > 2 && now - this.samples[1]!.t >= ASC_INCOME_WINDOW_MS) {
      this.samples.shift();
    }

    const first = this.samples[0]!;
    const span = now - first.t;

    if (span >= ASC_INCOME_MIN_SPAN_MS) {
      return Math.max(0, (total - first.total) / (span / 1000));
    }

    const cps = this.game.getUnbuffedCps();
    return Number.isFinite(cps) && cps > 0 ? cps : 0;
  }

  /** The current plan, or null while the game is not ready or on the ascension screen/intro
   * (there is no run to judge then). */
  plan(now = Date.now()): AscensionPlan | null {
    if (this.cache && now < this.cacheAt + ASC_PLAN_TTL_MS) return this.cache;

    this.cacheAt = now;
    this.cache = null;

    if (!this.game.isReady() || this.game.isAscending()) return null;

    try {
      const totalCookies = this.game.getCookiesReset() + this.game.getCookiesEarned() + wrinklerStash(this.game);

      this.cache = planAscension({
        prestige: this.game.getPrestige(),
        heavenlyChips: this.game.getHeavenlyChips(),
        totalCookies,
        hcFactor: this.game.getHCFactor(),
        income: this.measuredIncome(now, totalCookies),
        runSec: Math.max(0, (now - this.game.getRunStartDate()) / 1000),
        heavenly: this.game.getHeavenlyUpgrades(),
        luckyWaitSec: this.data.config.ascendLuckyWaitSec ?? 86400,
        minBoost: this.data.config.ascendMinBoost ?? 2,
        shopWaitSec: this.data.config.ascendShopWaitSec ?? 21600,
        shopWaitShare: this.data.config.ascendShopWaitShare ?? 0.1,
        leadSec: this.leadSec(),
        routineIncome: Math.max(0, Number(this.game.getUnbuffedCps()) || 0),
      });
    } catch (_e) {
      this.cache = null;
    }

    return this.cache;
  }

  /** On the ascension screen: what to buy with the chips owned right now (ASC-9, no waiting;
   * null elsewhere). */
  shoppingNow(): HeavenlyShopPlan | null {
    if (!this.game.onAscendScreen()) return null;

    const prestige = this.game.getPrestige();

    return planHeavenlyShopping({
      heavenly: this.game.getHeavenlyUpgrades(),
      prestige,
      heavenlyChips: this.game.getHeavenlyChips(),
      fromLevel: prestige,
      etaTo: (level) => (level <= prestige ? 0 : Infinity),
      shopWaitSec: 0,
      luckyWaitSec: 0,
    });
  }

  /** HUD row "Ascension" (ASC-5): the same lines as the Legacy card (ASC-6) joined into one;
   * '' when there is nothing to show (no prestige and nothing gained yet). `botLine` is what
   * the bot does about it (ASC-11). */
  statusText(botLine = '', now = Date.now()): string {
    const onScreen = this.shoppingNow();
    const lines = onScreen ? heavenScreenLines(onScreen, this.game.getHeavenlyChips()) : null;

    if (lines) return [...lines, botLine].filter(Boolean).join('; ');

    const p = this.plan(now);
    if (!p || (p.prestige <= 0 && p.gain <= 0)) return '';

    return [...planLines(p), botLine].filter(Boolean).join('; ');
  }
}

/** The answer in two lines (ASC-5): a headline that says what to do — ASCEND NOW, WAIT or NOT
 * YET — and why. */
export function verdictLines(p: AscensionPlan): string[] {
  switch (p.verdict) {
    case 'no-gain':
      return ['NOT YET: no prestige level to gain', `next level in ${formatShort(p.cookiesToNextLevel)} cookies`];
    case 'too-small':
      return [
        'NOT YET: too few levels to be worth it',
        `CpS bonus would grow x${p.boost.toFixed(2)}, wanted x${(prestigeMult(p.neededLevel) / prestigeMult(p.prestige)).toFixed(2)} (level ${formatNum(p.neededLevel)}, ${fmtEta(p.neededEtaSec)})`,
      ];
    case 'growing':
      return ['NOT YET: prestige still comes in fast', `${formatNum(p.rateNow)} levels/h now, ${formatNum(p.rateAvg)} levels/h on average this run`];
    case 'waiting':
      return [`WAIT: ascend at level ${formatNum(p.shop.level)} (${fmtEta(p.shop.etaSec)})`, `then the chips also pay for ${p.shop.waitFor}`];
    case 'ascend':
      return ['ASCEND NOW', 'prestige only trickles in and the chips pay for the list below'];
  }
}

/** The collapsed Legacy card (ASC-6): the level after ascending and the one-word answer,
 * "Lv 54,369 · ASCEND NOW" / "· WAIT" / "· NOT YET". */
export function compactLine(p: AscensionPlan): string {
  const answer = p.verdict === 'ascend' ? 'ASCEND NOW' : p.verdict === 'waiting' ? 'WAIT' : 'NOT YET';
  return `Lv ${formatNum(p.pendingLevel)} \u00b7 ${answer}`;
}

/** Everything the Legacy card and the HUD row say about a plan, one fact per line (ASC-5/6). */
export function planLines(p: AscensionPlan): string[] {
  const lines = [
    ...verdictLines(p),
    `Prestige: ${formatNum(p.prestige)} -> ${formatNum(p.pendingLevel)}`,
    `CpS bonus after ascending: x${p.boost.toFixed(2)}`,
    `Heavenly chips to spend: ${formatNum(p.chipsAfter)}`,
  ];

  // What to buy only matters once ascending is on the table.
  if (p.verdict === 'ascend' || p.verdict === 'waiting') lines.push(...heavenLines(p.shop));

  return lines;
}

/** The heavenly shopping list (ASC-9): what an ascension at shop.level buys, and the next wish
 * it does NOT wait for. */
export function heavenLines(shop: HeavenlyShopPlan): string[] {
  const n = shop.items.length;
  const lines = [n ? `Buy in heaven: ${n} upgrade${n === 1 ? '' : 's'} (${formatShort(shop.cost)} chips)` : 'Buy in heaven: nothing'];

  return lines.concat(laterLines(shop));
}

/** The next wish, which this ascension does NOT wait for, and how much of it the chips left
 * over after the list already cover (they carry over to the next ascension). */
function laterLines(shop: HeavenlyShopPlan): string[] {
  const saving = savingProgress(shop);
  if (!shop.next || !saving) return [];

  return [
    `Later: ${shop.next.name} (${formatShort(saving.need)} chips)`,
    `  ${formatShort(saving.have)} chips left over after buying = ${Math.floor(saving.share * 100)}% of it`,
  ];
}

/** The ascension screen (ASC-7): what to buy with the chips on hand, in the pink boxes' order. */
export function heavenScreenLines(shop: HeavenlyShopPlan, chips: number): string[] {
  const n = shop.items.length;
  const lines = n
    ? [`BUY THE PINK ONES, in order (1, 2, 3...)`, `${n} upgrade${n === 1 ? '' : 's'} for ${formatShort(shop.cost)} of your ${formatShort(chips)} chips`, 'then click Reincarnate']
    : ['NOTHING TO BUY: click Reincarnate', `you have ${formatShort(chips)} chips`];

  return lines.concat(laterLines(shop));
}

/** Chips left after the shopping list towards the next wish (ASC-9): "25.8K" of "44.4K", as a
 * share (0-1). */
export function savingProgress(shop: HeavenlyShopPlan): { have: number; need: number; share: number } | null {
  if (!shop.next) return null;

  const have = Math.max(0, shop.chipsAt - shop.cost);
  const need = shop.next.cost;

  return { have, need, share: need > 0 ? Math.min(1, have / need) : 1 };
}

/** "~3m 20s", or "never at this income" without income. */
export function fmtEta(sec: number): string {
  return Number.isFinite(sec) ? `~${autoFmtTime(sec)}` : 'never at this income';
}
