import type { IGameAdapter } from '../../../src/game/game-adapter';
import type { CpsBuff, GameBuilding, GameShimmer, GameUpgrade, GameWrinkler, GrimoireMinigame, RawBuff } from '../../../src/game/types';

/** A hand-written stand-in for GameAdapter, settable per test. Everything defaults to the
 * "Game not ready" shape so a test only needs to override what it cares about. */
export class FakeGameAdapter implements IGameAdapter {
  present = true;
  fps = 30;
  buffNames = new Set<string>();
  upgradeNames = new Set<string>();
  auraMults: Record<string, number> = {};
  grimoire: GrimoireMinigame | null = null;
  rawBuffs: Record<string, RawBuff> = {};
  shimmers: GameShimmer[] = [];
  goldenChainCount = 0;
  ready = true;
  lastGoldenEffect = '';
  refillable = false;
  lumps = 0;
  askLumpsPref = 0;
  lumpRipe = false;
  lumpsOn = false;
  onMenu = '';
  buildings: GameBuilding[] = [];
  buildingsByName: Record<string, GameBuilding> = {};
  upgrades: GameUpgrade[] = [];
  upgradesByName: Record<string, GameUpgrade> = {};
  upgradesInStore: GameUpgrade[] = [];
  grandmaSynergyNames: string[] = [];
  unbuffedCps = NaN;
  cookiesPs = NaN;
  handmadeCookies = NaN;
  computedMouseCps = NaN;
  cookies = 0;
  buyMode = 1;
  ascending = false;
  promptOpen = false;
  milkProgress: number | null = null;
  achievementsOwned = 0;
  prestige = 0;
  runStartDate = Date.now();
  elderWrath = 0;
  wrinklers: GameWrinkler[] = [];
  wrinklersMax = 10;
  cpsSucked = 0;
  wrinklerSpawnChance = 0;
  wrinklerPopMult = 1.1;
  dragonLevel = 0;
  dragonAuras: [number, number] = [0, 0];
  selectingDragonAura = -1;
  specialTabs: string[] = [];
  specialTab = '';
  krumblorUnlocked = false;
  easterEggsUnlocked = 0;
  halloweenCookiesUnlocked = 0;
  christmasUpgradesUnlocked = 0;
  valentinesCookiesUnlocked = 0;
  santaLevel = 0;
  reindeerSpawned = 0;
  shimmerFieldWidth = 1000;

  isPresent(): boolean {
    return this.present;
  }

  isReady(): boolean {
    return this.present && this.ready;
  }

  getFps(): number {
    return this.fps;
  }

  hasBuff(name: string): boolean {
    return this.buffNames.has(name);
  }

  hasUpgrade(name: string): boolean {
    return this.upgradeNames.has(name);
  }

  getAuraMult(name: string): number {
    return this.auraMults[name] || 0;
  }

  getGrimoire(): GrimoireMinigame | null {
    return this.grimoire;
  }

  getRawBuffs(): Record<string, RawBuff> {
    return this.rawBuffs;
  }

  getShimmers(): GameShimmer[] {
    return this.shimmers;
  }

  getGoldenChainCount(): number {
    return this.goldenChainCount;
  }

  positiveCpsBuffs(): CpsBuff[] {
    const out: CpsBuff[] = [];

    for (const key of Object.keys(this.rawBuffs)) {
      const buff = this.rawBuffs[key];
      if (!buff) continue;

      const mult = Number(buff.multCpS);
      if (Number.isFinite(mult) && mult > 1) {
        out.push({ key, name: buff.name || buff.dname || key, mult, time: Number(buff.time) || 0 });
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  estimateClickFrenzySec(): number {
    let mod = 1;
    if (this.hasUpgrade('Get lucky')) mod *= 2;
    if (this.hasUpgrade('Lasting fortune')) mod *= 1.1;
    mod *= 1 + this.getAuraMult('Epoch Manipulator') * 0.05;
    return Math.ceil(13 * mod);
  }

  cpsBuffOutlastsClickFrenzy(buffs?: CpsBuff[]): boolean {
    const cfSec = this.estimateClickFrenzySec();
    const fps = this.fps || 30;
    return (buffs || this.positiveCpsBuffs()).some((b) => b.time / fps >= cfSec);
  }

  clickFrenzyActive(): boolean {
    return this.hasBuff('Click frenzy');
  }

  getLastGoldenEffect(): string {
    return this.lastGoldenEffect;
  }

  canRefillLump(): boolean {
    return this.refillable;
  }

  getLumps(): number {
    return this.lumps;
  }

  getAskLumpsPref(): number {
    return this.askLumpsPref;
  }

  setAskLumpsPref(value: number): void {
    this.askLumpsPref = value;
  }

  isLumpRipe(): boolean {
    return this.lumpRipe;
  }

  lumpsUnlocked(): boolean {
    return this.lumpsOn;
  }

  getOnMenu(): string {
    return this.onMenu;
  }

  getBuildings(): GameBuilding[] {
    return this.buildings;
  }

  getBuildingByName(name: string): GameBuilding | null {
    return this.buildingsByName[name] || null;
  }

  getUpgrades(): GameUpgrade[] {
    return this.upgrades;
  }

  getUpgradeByName(name: string): GameUpgrade | null {
    return this.upgradesByName[name] || null;
  }

  getUpgradesInStore(): GameUpgrade[] {
    return this.upgradesInStore;
  }

  getGrandmaSynergyNames(): string[] {
    return this.grandmaSynergyNames;
  }

  getUnbuffedCps(): number {
    return this.unbuffedCps;
  }

  getCookiesPs(): number {
    return this.cookiesPs;
  }

  getHandmadeCookies(): number {
    return this.handmadeCookies;
  }

  getComputedMouseCps(): number {
    return this.computedMouseCps;
  }

  getCookies(): number {
    return this.cookies;
  }

  getBuyMode(): number {
    return this.buyMode;
  }

  isAscending(): boolean {
    return this.ascending;
  }

  isPromptOpen(): boolean {
    return this.promptOpen;
  }

  getMilkProgress(): number | null {
    return this.milkProgress;
  }

  getAchievementsOwned(): number {
    return this.achievementsOwned;
  }

  getPrestige(): number {
    return this.prestige;
  }

  getRunStartDate(): number {
    return this.runStartDate;
  }

  getElderWrath(): number {
    return this.elderWrath;
  }

  getWrinklers(): GameWrinkler[] {
    return this.wrinklers;
  }

  getWrinklersMax(): number {
    return this.wrinklersMax;
  }

  getCpsSucked(): number {
    return this.cpsSucked;
  }

  getWrinklerSpawnChance(stage?: number): number {
    return stage != null ? 0.00001 * stage : this.wrinklerSpawnChance;
  }

  getWrinklerPopMult(shiny: boolean): number {
    return shiny ? this.wrinklerPopMult * 3 : this.wrinklerPopMult;
  }

  spawnGoldenShimmer(_opts: { wrath?: boolean }): Record<string, unknown> {
    throw new Error('Game.shimmer is not available');
  }

  spawnReindeer(): Record<string, unknown> {
    this.reindeerSpawned++;
    return { type: 'reindeer' };
  }

  spawnCookieChain(): Record<string, unknown> {
    throw new Error('Game.shimmer is not available');
  }

  resetLumpRefillCooldown(): 'ready' | 'overridden' {
    return 'ready';
  }

  earnCookies(n: number): void {
    this.cookies += n;
  }

  gainLumps(n: number): void {
    this.lumps += n;
  }

  ripenLump(): void {
    this.lumpRipe = true;
  }

  spawnFedWrinklers(_fedSec: number): number {
    return 0;
  }

  spawnWrinkler(): number {
    const w = this.wrinklers.find((x) => x.id < this.wrinklersMax && x.phase === 0);
    if (!w) throw new Error('every wrinkler slot is taken');
    w.phase = 1;
    return w.id;
  }

  getDragonLevel(): number {
    return this.dragonLevel;
  }

  getDragonAuras(): [number, number] {
    return this.dragonAuras;
  }

  getSelectingDragonAura(): number {
    return this.selectingDragonAura;
  }

  getSpecialTabs(): string[] {
    return this.specialTabs;
  }

  getSpecialTab(): string {
    return this.specialTab;
  }

  unlockEasterEggs(): number {
    return this.easterEggsUnlocked;
  }

  unlockHalloweenCookies(): number {
    return this.halloweenCookiesUnlocked;
  }

  unlockChristmasUpgrades(): number {
    return this.christmasUpgradesUnlocked;
  }

  unlockValentinesCookies(): number {
    return this.valentinesCookiesUnlocked;
  }

  getSantaLevel(): number {
    return this.santaLevel;
  }

  getShimmerFieldWidth(): number {
    return this.shimmerFieldWidth;
  }

  unlockKrumblor(): boolean {
    this.krumblorUnlocked = true;
    return true;
  }
}
