/** The project's GitHub page, linked from the panel footer. */
const REPO_URL = 'https://github.com/Leonetienne/CCGoodboy';

/** The main HUD panel's inner markup. Element ids all start with 'ccsb-'. */
function panelBodyHtml(version: string): string {
  return `
<div id="ccsb-header">
    <span id="ccsb-status-dot"></span>
    <span id="ccsb-title">CC Good Boy :3</span>
    <span id="ccsb-version" title="script version">v${version}</span>
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
    <div class="ccsb-row" id="ccsb-wrinkler-row">
        <span class="ccsb-label">Wrinklers</span>
        <span class="ccsb-value" id="ccsb-wrinklers">none</span>
    </div>
    <div class="ccsb-row" id="ccsb-ascend-row">
        <span class="ccsb-label">Ascension</span>
        <span class="ccsb-value" id="ccsb-ascend">—</span>
    </div>
    <div class="ccsb-row" id="ccsb-stock-row">
        <span class="ccsb-label">Stock market</span>
        <span class="ccsb-value" id="ccsb-stock">off</span>
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
        <div class="ccsb-setting" title="An ascension must multiply the prestige CpS bonus (+1% per level) at least this much: 2 = the bonus doubles">
            <span>Ascend: minimum CpS boost (x)</span>
            <input data-setting="ascendMinBoost" type="number" min="1" max="100" step="0.1">
        </div>
        <div class="ccsb-setting" title="Only wait for a heavenly upgrade when it is a few chips short: the extra levels may be at most this share of the levels the ascension gains anyway (0.1 = 10%)">
            <span>Ascend: wait for heavenly upgrades at most (x levels gained)</span>
            <input data-setting="ascendShopWaitShare" type="number" min="0" max="1" step="0.05">
        </div>
        <div class="ccsb-setting" title="How long a stagnating run may go on so the chips pay for the next heavenly upgrade on the bot's shopping list">
            <span>Ascend: wait for heavenly upgrades up to (s)</span>
            <input data-setting="ascendShopWaitSec" type="number" min="0" max="2592000" step="3600">
        </div>
        <div class="ccsb-setting" title="How long a stagnating run may go on to reach a prestige level with enough 7s for a lucky heavenly upgrade (Lucky digit/number/payout)">
            <span>Ascend: wait for a lucky level up to (s)</span>
            <input data-setting="ascendLuckyWaitSec" type="number" min="0" max="2592000" step="3600">
        </div>
        <div class="ccsb-setting" title="Stocks may hold at most this share of your bank + stocks (valued at today's prices): 0.5 = half">
            <span>Stocks: invest at most (share of bank)</span>
            <input data-setting="stockMaxShare" type="number" min="0" max="1" step="0.05">
        </div>
        <div class="ccsb-setting ccsb-setting-range">
            <span>Frame opacity (0.1-1)</span>
            <input data-setting="frameOpacity" type="range" min="0.1" max="1" step="0.05">
            <span class="ccsb-setting-range-val" data-for="frameOpacity">95%</span>
        </div>
        <div class="ccsb-setting ccsb-setting-range">
            <span>Overlay opacity (0.1-1)</span>
            <input data-setting="overlayOpacity" type="range" min="0.1" max="1" step="0.05">
            <span class="ccsb-setting-range-val" data-for="overlayOpacity">100%</span>
        </div>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px">
            <input id="ccsb-visuals" type="checkbox">
            Pretty overlays ^w^
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="An osu!-style light show while hunting golden cookies and reindeer: approach circles, bursts, a combo counter, a rainbow trail and sweeping spotlights. Needs Pretty overlays. Flashes are rate-limited and skipped with reduced motion.">
            <input id="ccsb-hunt-fx" type="checkbox">
            Over-the-top hunting show (osu! mode) !!
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px">
            <input id="ccsb-idle-wander" type="checkbox">
            Idle playtime (paw wanders) :3
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="Shows cost/CpS payback time over every building and upgrade in the store (works with auto play off)">
            <input id="ccsb-buyvalue" type="checkbox">
            Show "how good is a buy" overlay :3
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="Shows the ascension plan on the Legacy button and boxes the heavenly upgrades on the ascension screen">
            <input id="ccsb-ascend-overlay" type="checkbox">
            Show ascension overlay ^w^
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="A practically silent AudioContext: the browser then does not throttle this tab in the background (needs one click on the page)">
            <input id="ccsb-keepalive" type="checkbox">
            Background keep-alive (silent audio) :3
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="Cast Force the Hand of Fate during CpS buffs (off: the paw leaves the Grimoire alone, and never refills mana either)">
            <input id="ccsb-grimoire-fthof" type="checkbox">
            Grimoire: cast Force the Hand of Fate ^w^
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="Lets the bot spend sugar lumps: refilling Grimoire mana during a buff combo, and (in auto play) levelling a Wizard tower to unlock the Grimoire">
            <input id="ccsb-spend-lumps" type="checkbox">
            Spend sugar lumps :3
        </label>

        <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="The paw trades on the Bank's stock market: buys goods that are cheap and turning up, sells them once they have risen and start to fall again (never at a loss), and hires stockbrokers when they pay off. With auto play it also unlocks the market (Bank level 1, one sugar lump).">
            <input id="ccsb-stock-market" type="checkbox">
            Play the stock market ^w^
        </label>

        <div id="ccsb-auto-settings">
            <div class="ccsb-auto-title">Auto play settings :3</div>
            <div class="ccsb-setting">
                <span>Auto: insignificant cost (s of CpS)</span>
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
                <span>Auto: bank reserve (s of CpS)</span>
                <input data-setting="autoReserveSec" type="number" min="0" max="1000000" step="60">
            </div>
            <div class="ccsb-setting">
                <span>Auto: wizard tower target</span>
                <input data-setting="autoWizardTowerTarget" type="number" min="0" max="500" step="1">
            </div>
            <div class="ccsb-setting">
                <span>Auto: pop a wrinkler after (x its respawn time)</span>
                <input data-setting="autoWrinklerMaturity" type="number" min="1" max="50" step="0.5">
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
            <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="Buys the grandma research up to One mind (Grandmapocalypse stage 1: wrinklers, 1 in 3 golden cookies turns wrath). Never Communal brainsweep or Elder Pact. There is no way back from stage 1 short of stage 3 + Elder Covenant.">
                <input id="ccsb-auto-grandmapocalypse" type="checkbox">
                Auto: grandmapocalypse stage 1 (wrinklers) owo
            </label>
            <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="Pops mature wrinklers when auto play needs their cookies for a purchase">
                <input id="ccsb-auto-pop-wrinklers" type="checkbox">
                Auto: pop wrinklers for purchases :3
            </label>
            <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="Buys the crumbly egg, trains Krumblor with cookies (only insignificant amounts), sacrifices 100 cursors (selling the ones above 100 first and buying them back after) and puts on the Dragon Cursor aura (switching an aura sacrifices 1 of your highest building)">
                <input id="ccsb-auto-krumblor" type="checkbox">
                Auto: train Krumblor (Dragon Cursor) ^w^
            </label>
            <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="Ascends by itself when the Ascension row says it's time: pops every wrinkler, clicks Legacy, buys the heavenly shopping list and reincarnates. There is no undo for an ascension.">
                <input id="ccsb-auto-ascend" type="checkbox">
                Auto: ascend (and buy heavenly upgrades) owo
            </label>
            <label style="display:flex;gap:6px;align-items:center;margin-top:5px" title="Right before ascending: sell every stock and spend the whole bank on buildings for their next count achievement, cheapest first. The bank is thrown away by the ascension, but achievements stay won (more milk for the kittens)">
                <input id="ccsb-ascend-dump" type="checkbox">
                Auto: spend the bank on achievements before ascending ^w^
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

    <a id="ccsb-footer" href="${REPO_URL}" target="_blank" rel="noopener noreferrer"
       title="CC Good Boy on GitHub">&copy; Leon Etienne &middot; GitHub</a>
</div>`;
}

/** Creates the (not yet attached) main HUD panel element. */
export function createPanelElement(version: string): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'ccsb-panel';
  panel.innerHTML = panelBodyHtml(version);
  return panel;
}
