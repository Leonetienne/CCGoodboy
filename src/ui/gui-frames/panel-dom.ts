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
}

/** Creates the (not yet attached) main HUD panel element. */
export function createPanelElement(version: string): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'ccsb-panel';
  panel.innerHTML = panelBodyHtml(version);
  return panel;
}
