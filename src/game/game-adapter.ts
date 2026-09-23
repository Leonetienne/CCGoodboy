import type { CpsBuff, GameBuilding, GameShimmer, GameUpgrade, GameWrinkler, GrimoireMinigame, RawBuff } from './types';

/** Every access to the live Cookie Clicker `Game` object goes through this interface. It is
 * the one mockable seam between our logic and the page's own global. */
export interface IGameAdapter {
  isPresent(): boolean;
  isReady(): boolean;
  getFps(): number;
  hasBuff(name: string): boolean;
  hasUpgrade(name: string): boolean;
  getAuraMult(name: string): number;
  getGrimoire(): GrimoireMinigame | null;
  getRawBuffs(): Record<string, RawBuff>;
  getShimmers(): GameShimmer[];
  getGoldenChainCount(): number;
  getLastGoldenEffect(): string;
  positiveCpsBuffs(): CpsBuff[];
  estimateClickFrenzySec(): number;
  cpsBuffOutlastsClickFrenzy(buffs?: CpsBuff[]): boolean;
  clickFrenzyActive(): boolean;
  canRefillLump(): boolean;
  getLumps(): number;
  getAskLumpsPref(): number;
  setAskLumpsPref(value: number): void;
  isLumpRipe(): boolean;
  lumpsUnlocked(): boolean;
  /** The open menu screen ('prefs', 'stats', 'log', ...), '' while the buildings are shown. */
  getOnMenu(): string;

  // ---- auto play raw accessors (business logic lives in autoplay/, not here) ----
  getBuildings(): GameBuilding[];
  getBuildingByName(name: string): GameBuilding | null;
  getUpgrades(): GameUpgrade[];
  getUpgradeByName(name: string): GameUpgrade | null;
  getUpgradesInStore(): GameUpgrade[];
  getGrandmaSynergyNames(): string[];
  getUnbuffedCps(): number;
  getCookiesPs(): number;
  getHandmadeCookies(): number;
  getComputedMouseCps(): number;
  getCookies(): number;
  getBuyMode(): number;
  isAscending(): boolean;
  isPromptOpen(): boolean;
  getMilkProgress(): number | null;
  getAchievementsOwned(): number;
  /** Game.prestige: the prestige level (each level is worth +1% CpS at full heavenly potential). */
  getPrestige(): number;

  // ---- Grandmapocalypse / wrinklers (WRINK-*) ----
  /** Game.elderWrath: 0 = calm, 1 awoken (One mind), 2 displeased, 3 angered. */
  getElderWrath(): number;
  getWrinklers(): GameWrinkler[];
  getWrinklersMax(): number;
  /** Share of CpS every attached wrinkler digests (Game.cpsSucked, n x 5%). */
  getCpsSucked(): number;
  /** Chance per game frame that ONE empty wrinkler slot spawns a wrinkler, at the current
   * stage (0 while elderWrath is 0) or at `stage` if given. */
  getWrinklerSpawnChance(stage?: number): number;
  /** Multiplier applied to a wrinkler's digested cookies when it pops (1.1 base, upgrades,
   * Dragon Guts, Pantheon; x3 for a shiny one). */
  getWrinklerPopMult(shiny: boolean): number;

  // ---- debug-tools-only raw operations (see ui/debug/debug-tools.ts) ----
  spawnGoldenShimmer(opts: { wrath?: boolean }): Record<string, unknown>;
  spawnCookieChain(): Record<string, unknown>;
  resetLumpRefillCooldown(): 'ready' | 'overridden';
  earnCookies(n: number): void;
  gainLumps(n: number): void;
  ripenLump(): void;
  spawnFedWrinklers(fedSec: number): number;
  spawnWrinkler(): number;
}

export class GameAdapter implements IGameAdapter {
  isPresent(): boolean {
    return !!window.Game;
  }

  isReady(): boolean {
    return !!(window.Game && window.Game.ready);
  }

  getFps(): number {
    const Game = window.Game;
    return Game ? Number(Game.fps) || 0 : 0;
  }

  hasBuff(name: string): boolean {
    const Game = window.Game;
    return !!(Game && typeof Game.hasBuff === 'function' && Game.hasBuff(name));
  }

  hasUpgrade(name: string): boolean {
    try {
      const Game = window.Game;
      return !!(Game && typeof Game.Has === 'function' && Game.Has(name));
    } catch (_e) {
      return false;
    }
  }

  getAuraMult(name: string): number {
    try {
      const Game = window.Game;
      if (Game && typeof Game.auraMult === 'function') {
        return Number(Game.auraMult(name)) || 0;
      }
    } catch (_e) {
      /* fall through */
    }
    return 0;
  }

  getGrimoire(): GrimoireMinigame | null {
    try {
      const Game = window.Game;
      return Game && Game.Objects && Game.Objects['Wizard tower'] && Game.Objects['Wizard tower'].minigame
        ? Game.Objects['Wizard tower'].minigame
        : null;
    } catch (_e) {
      return null;
    }
  }

  getRawBuffs(): Record<string, RawBuff> {
    const Game = window.Game;
    return Game && Game.buffs ? Game.buffs : {};
  }

  getShimmers(): GameShimmer[] {
    const Game = window.Game;
    return Game && Array.isArray(Game.shimmers) ? Game.shimmers : [];
  }

  getGoldenChainCount(): number {
    const Game = window.Game;
    if (Game && Game.shimmerTypes && Game.shimmerTypes.golden) {
      return Number(Game.shimmerTypes.golden.chain) || 0;
    }
    return 0;
  }

  /** All active buffs that multiply CpS (multCpS > 1), sorted by name. */
  positiveCpsBuffs(): CpsBuff[] {
    const buffs = this.getRawBuffs();
    const out: CpsBuff[] = [];

    for (const key of Object.keys(buffs)) {
      const buff = buffs[key];
      if (!buff) continue;

      const mult = Number(buff.multCpS);
      if (Number.isFinite(mult) && mult > 1) {
        out.push({
          key,
          name: buff.name || buff.dname || key,
          mult,
          time: Number(buff.time) || 0,
        });
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /** Rough length (seconds) a Click Frenzy would have if it fired now: 13s x 2 (Get lucky) x
   * 1.1 (Lasting fortune) x (1 + 0.05 x Epoch Manipulator aura). Small +1% upgrades and the
   * Pantheon bonus are ignored on purpose (precision is not needed). */
  estimateClickFrenzySec(): number {
    try {
      let mod = 1;

      if (this.hasUpgrade('Get lucky')) mod *= 2;
      if (this.hasUpgrade('Lasting fortune')) mod *= 1.1;

      mod *= 1 + this.getAuraMult('Epoch Manipulator') * 0.05;

      return Math.ceil(13 * mod);
    } catch (_e) {
      return 13;
    }
  }

  /** The 'outlast' rule: is there a CpS buff with at least estimateClickFrenzySec() seconds
   * left? A FTHOF that rolls Click Frenzy is only worth it when that frenzy fully overlaps a
   * buff. */
  cpsBuffOutlastsClickFrenzy(buffs?: CpsBuff[]): boolean {
    const cfSec = this.estimateClickFrenzySec();
    const fps = this.getFps() || 30;

    return (buffs || this.positiveCpsBuffs()).some((b) => b.time / fps >= cfSec);
  }

  clickFrenzyActive(): boolean {
    return this.hasBuff('Click frenzy');
  }

  getLastGoldenEffect(): string {
    const Game = window.Game;
    return Game && Game.shimmerTypes && Game.shimmerTypes.golden ? Game.shimmerTypes.golden.last : '';
  }

  canRefillLump(): boolean {
    const Game = window.Game;
    return !!(Game && typeof Game.canRefillLump === 'function' && Game.canRefillLump());
  }

  getLumps(): number {
    const Game = window.Game;
    return Game ? Number(Game.lumps) || 0 : 0;
  }

  getAskLumpsPref(): number {
    const Game = window.Game;
    return Game && Game.prefs ? Game.prefs.askLumps : 0;
  }

  setAskLumpsPref(value: number): void {
    const Game = window.Game;
    if (Game && Game.prefs) {
      Game.prefs.askLumps = value;
    }
  }

  /** True while the growing sugar lump is truly ripe: age (since Game.lumpT) is between
   * lumpRipeAge and lumpOverripeAge. Below that it is still growing/only "mature" (clicking
   * gambles a 50% botched harvest); at/above lumpOverripeAge the game auto-harvests it on its
   * own next tick, so there is nothing left to click. */
  isLumpRipe(): boolean {
    const Game = window.Game;
    if (!Game || typeof Game.canLumps !== 'function' || !Game.canLumps()) return false;

    const lumpT = Number(Game.lumpT);
    const ripeAge = Number(Game.lumpRipeAge);
    const overripeAge = Number(Game.lumpOverripeAge);
    if (!Number.isFinite(lumpT) || !Number.isFinite(ripeAge) || !Number.isFinite(overripeAge)) return false;

    const age = Date.now() - lumpT;
    return age >= ripeAge && age < overripeAge;
  }

  lumpsUnlocked(): boolean {
    try {
      const Game = window.Game;
      return !!(Game && typeof Game.canLumps === 'function' && Game.canLumps());
    } catch (_e) {
      return false;
    }
  }

  getOnMenu(): string {
    const Game = window.Game;
    return Game && typeof Game.onMenu === 'string' ? Game.onMenu : '';
  }

  getBuildings(): GameBuilding[] {
    const Game = window.Game;
    if (!Game) return [];
    return Array.isArray(Game.ObjectsById) ? Game.ObjectsById : Object.values(Game.Objects || {});
  }

  getBuildingByName(name: string): GameBuilding | null {
    const Game = window.Game;
    return (Game && Game.Objects && Game.Objects[name]) || null;
  }

  getUpgrades(): GameUpgrade[] {
    const Game = window.Game;
    if (!Game) return [];
    return Array.isArray(Game.UpgradesById) ? Game.UpgradesById : Object.values(Game.Upgrades || {});
  }

  getUpgradeByName(name: string): GameUpgrade | null {
    const Game = window.Game;
    return (Game && Game.Upgrades && Game.Upgrades[name]) || null;
  }

  getUpgradesInStore(): GameUpgrade[] {
    const Game = window.Game;
    return Game && Array.isArray(Game.UpgradesInStore) ? Game.UpgradesInStore : [];
  }

  getGrandmaSynergyNames(): string[] {
    const Game = window.Game;
    return Game && Array.isArray(Game.GrandmaSynergies) ? Game.GrandmaSynergies : [];
  }

  getUnbuffedCps(): number {
    const Game = window.Game;
    return Game ? Number(Game.unbuffedCps) : NaN;
  }

  getCookiesPs(): number {
    const Game = window.Game;
    return Game ? Number(Game.cookiesPs) : NaN;
  }

  getHandmadeCookies(): number {
    const Game = window.Game;
    return Game ? Number(Game.handmadeCookies) : NaN;
  }

  getComputedMouseCps(): number {
    const Game = window.Game;
    return Game ? Number(Game.computedMouseCps) : NaN;
  }

  getCookies(): number {
    const Game = window.Game;
    return Game ? Number(Game.cookies) || 0 : 0;
  }

  getBuyMode(): number {
    const Game = window.Game;
    return Game ? Number(Game.buyMode) : 1;
  }

  isAscending(): boolean {
    const Game = window.Game;
    return !!(Game && (Game.OnAscend || Number(Game.AscendTimer) > 0));
  }

  isPromptOpen(): boolean {
    const Game = window.Game;
    return !!(Game && Game.promptOn);
  }

  getMilkProgress(): number | null {
    const Game = window.Game;
    const v = Game ? Number(Game.milkProgress) : NaN;
    return Number.isFinite(v) ? v : null;
  }

  getAchievementsOwned(): number {
    const Game = window.Game;
    return Game ? Number(Game.AchievementsOwned) || 0 : 0;
  }

  getPrestige(): number {
    const Game = window.Game;
    return Game ? Math.max(0, Number(Game.prestige) || 0) : 0;
  }

  getElderWrath(): number {
    const Game = window.Game;
    return Game ? Number(Game.elderWrath) || 0 : 0;
  }

  getWrinklers(): GameWrinkler[] {
    const Game = window.Game;
    return Game && Array.isArray(Game.wrinklers) ? Game.wrinklers : [];
  }

  getWrinklersMax(): number {
    try {
      const Game = window.Game;
      if (Game && typeof Game.getWrinklersMax === 'function') {
        return Number(Game.getWrinklersMax()) || 0;
      }
    } catch (_e) {
      /* fall through */
    }
    return 10;
  }

  getCpsSucked(): number {
    const Game = window.Game;
    return Game ? Number(Game.cpsSucked) || 0 : 0;
  }

  /** Mirrors Game.UpdateWrinklers: 0.00001 x elderWrath per frame, x eff('wrinklerSpawn'),
   * x5 with Unholy bait, x2.5/2/1.5 with Scorn in the Pantheon; 0.1 with the debug-only
   * Wrinkler doormat. */
  getWrinklerSpawnChance(stage?: number): number {
    try {
      const Game = window.Game;
      if (!Game) return 0;

      const wrath = stage != null ? stage : Number(Game.elderWrath) || 0;
      if (wrath <= 0) return 0;

      let chance = 0.00001 * wrath;

      if (typeof Game.eff === 'function') chance *= Number(Game.eff('wrinklerSpawn')) || 1;
      if (this.hasUpgrade('Unholy bait')) chance *= 5;

      const scorn = this.godLevel('scorn');
      if (scorn === 1) chance *= 2.5;
      else if (scorn === 2) chance *= 2;
      else if (scorn === 3) chance *= 1.5;

      if (this.hasUpgrade('Wrinkler doormat')) chance = 0.1;

      return chance;
    } catch (_e) {
      return 0;
    }
  }

  /** Mirrors the pop branch of Game.UpdateWrinklers. */
  getWrinklerPopMult(shiny: boolean): number {
    let m = 1.1;

    if (this.hasUpgrade('Sacrilegious corruption')) m *= 1.05;
    m *= 1 + this.getAuraMult('Dragon Guts') * 0.2;
    if (shiny) m *= 3;
    if (this.hasUpgrade('Wrinklerspawn')) m *= 1.05;

    const scorn = this.godLevel('scorn');
    if (scorn === 1) m *= 1.15;
    else if (scorn === 2) m *= 1.1;
    else if (scorn === 3) m *= 1.05;

    return m;
  }

  /** Pantheon slot (1-3) of a god, 0 when not slotted or the Pantheon isn't loaded. */
  private godLevel(god: string): number {
    try {
      const Game = window.Game;
      return Game && typeof Game.hasGod === 'function' ? Number(Game.hasGod(god)) || 0 : 0;
    } catch (_e) {
      return 0;
    }
  }

  spawnGoldenShimmer(opts: { wrath?: boolean }): Record<string, unknown> {
    const Game = window.Game;

    if (!Game || typeof Game.shimmer !== 'function') {
      throw new Error('Game.shimmer is not available');
    }

    return new Game.shimmer('golden', opts.wrath ? { wrath: true } : { noWrath: true });
  }

  /** Spawns the first cookie of a REAL cookie chain. Unlike a plain forced 'chain cookie'
   * shimmer, this one is marked as the spawn lead, so the game restarts the golden-cookie
   * spawn timer after it pops and keeps the chain going. */
  spawnCookieChain(): Record<string, unknown> {
    const Game = window.Game;

    if (!Game || typeof Game.shimmer !== 'function') {
      throw new Error('Game.shimmer is not available');
    }

    const shimmer = new Game.shimmer('golden', { noWrath: true });
    shimmer.spawnLead = 1;
    shimmer.force = 'chain cookie';

    return shimmer;
  }

  /** The sugar lump refill has a 15 minute cooldown in the game. Resets Game.lumpRefill if it
   * is a number; if the game still says no, overrides Game.canRefillLump until the page
   * reloads. */
  resetLumpRefillCooldown(): 'ready' | 'overridden' {
    const Game = window.Game;

    if (!Game || typeof Game.canRefillLump !== 'function') {
      throw new Error('Game.canRefillLump is not available');
    }

    if (typeof Game.lumpRefill === 'number') {
      Game.lumpRefill = 0;
    }

    if (Game.canRefillLump()) {
      return 'ready';
    }

    Game.canRefillLump = () => true;
    return 'overridden';
  }

  /** Gives cookies with the game's own Earn() so they also count as earned; that is what makes
   * higher buildings (e.g. Wizard tower) show up in the store, not just the bank balance. */
  earnCookies(n: number): void {
    const Game = window.Game;

    if (!Game) {
      throw new Error('Game not available');
    }

    if (typeof Game.Earn === 'function') {
      Game.Earn(n);
    } else {
      Game.cookies = (Number(Game.cookies) || 0) + n;
      Game.cookiesEarned = (Number(Game.cookiesEarned) || 0) + n;
    }
  }

  /** Gives n sugar lumps (Game.gainLumps if present, else added directly; unlocks lumps if
   * locked). */
  gainLumps(n: number): void {
    const Game = window.Game;

    if (!Game) {
      throw new Error('Game not available');
    }

    if (typeof Game.gainLumps === 'function') {
      Game.gainLumps(n);
    } else {
      if (Game.lumpsTotal === -1) {
        Game.lumpsTotal = 0;
        Game.lumps = 0;
      }

      Game.lumps = (Number(Game.lumps) || 0) + n;
      Game.lumpsTotal = (Number(Game.lumpsTotal) || 0) + n;
    }
  }

  /** Debug-only: rewinds Game.lumpT so the growing sugar lump is put into its ripe window
   * (just past lumpRipeAge), for testing the harvest module without waiting ~23 real hours. */
  ripenLump(): void {
    const Game = window.Game;

    if (!Game) {
      throw new Error('Game not available');
    }

    if (typeof Game.canLumps === 'function' && !Game.canLumps()) {
      throw new Error('sugar lumps not unlocked yet (bake a billion cookies first)');
    }

    if (typeof Game.lumpT !== 'number') {
      throw new Error('no sugar lump is growing yet');
    }

    if (typeof Game.computeLumpTimes === 'function') {
      Game.computeLumpTimes();
    }

    const ripeAge = Number(Game.lumpRipeAge);
    if (!Number.isFinite(ripeAge)) {
      throw new Error('Game.lumpRipeAge is not available');
    }

    Game.lumpT = Date.now() - ripeAge - 1000;
  }

  /** Debug-only: spawns ONE wrinkler into the first free slot through the game's own
   * Game.SpawnWrinkler, so it crawls in (~10s) like a natural one. Leaves the stage alone.
   * Returns its slot id. */
  spawnWrinkler(): number {
    const Game = window.Game;

    if (!Game || !Array.isArray(Game.wrinklers) || typeof Game.SpawnWrinkler !== 'function') {
      throw new Error('Game.SpawnWrinkler is not available');
    }

    const max = this.getWrinklersMax();
    const w = (Game.wrinklers as GameWrinkler[]).find((x) => x.id < max && x.phase === 0);

    if (!w) {
      throw new Error(`every wrinkler slot is taken (${max})`);
    }

    Game.SpawnWrinkler(w);

    return w.id;
  }

  /** Debug-only: fills every empty wrinkler slot with an attached wrinkler that has already
   * digested `fedSec` seconds' worth (at the full slot count), and puts the Grandmapocalypse
   * at stage 1 if it is calm, so wrinklers keep respawning. Returns how many were added. */
  spawnFedWrinklers(fedSec: number): number {
    const Game = window.Game;

    if (!Game || !Array.isArray(Game.wrinklers)) {
      throw new Error('Game.wrinklers is not available');
    }

    if (!(Number(Game.Objects && Game.Objects.Grandma && Game.Objects.Grandma.amount) >= 1)) {
      throw new Error('needs at least one grandma (no grandmas = no Grandmapocalypse)');
    }

    const cps = Number(Game.cookiesPs) || 0;
    if (!(cps > 0)) {
      throw new Error('needs some CpS first (wrinklers digest a share of it)');
    }

    if (!(Number(Game.elderWrath) > 0)) {
      Game.elderWrath = 1;
    }

    const max = this.getWrinklersMax();
    let added = 0;

    for (const w of Game.wrinklers as GameWrinkler[]) {
      if (w.id >= max || w.phase !== 0) continue;

      if (typeof Game.SpawnWrinkler === 'function') {
        Game.SpawnWrinkler(w);
      }

      w.type = 0;
      w.close = 1;
      w.phase = 2;
      w.sucked = fedSec * cps * 0.05 * max;
      added++;
    }

    Game.recalculateGains = 1;

    return added;
  }
}
