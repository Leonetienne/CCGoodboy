const CSS = `
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
    opacity:var(--ccsb-frame-opacity, 0.95);
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

#ccsb-graphs.dragging,
#ccsb-logs.dragging,
#ccsb-debug.dragging {
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

#ccsb-more {
    display:none;
    margin-top:-3px;
}

#ccsb-more.open {
    display:flex;
}

#ccsb-hud-details {
    margin-top:2px;
}

#ccsb-hud-details .ccsb-row {
    opacity:.85;
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

.ccsb-setting-range {
    grid-template-columns:1fr 70px 34px;
}

.ccsb-setting-range input[type=range] {
    width:70px;
    accent-color:#ff8fcf;
}

.ccsb-setting-range-val {
    font-size:10px;
    text-align:right;
    color:#c9a6e6;
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

.ccsb-auto-title,
.ccsb-settings-title {
    color:#ffb3dc;
    margin-bottom:4px;
}

.ccsb-advanced {
    margin-top:8px;
}

.ccsb-advanced > summary {
    cursor:pointer;
    color:#c9a6e6;
    user-select:none;
}

.ccsb-advanced > summary:hover {
    color:#ffb3dc;
}

.ccsb-advanced[open] > summary {
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

#ccsb-footer {
    display:block;
    margin-top:8px;
    text-align:center;
    font-size:9.5px;
    color:#c9a6e6;
    opacity:.55;
    text-decoration:none;
}

#ccsb-footer:hover {
    opacity:1;
    text-decoration:underline;
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
    opacity:var(--ccsb-frame-opacity, 0.95);
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
    user-select:none;
    cursor:move;
    touch-action:none;
}

.ccsb-modal-head button {
    cursor:pointer;
}

.ccsb-modal-head input {
    cursor:text;
    user-select:text;
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

/* UPD-2: the "wanna update?" popup and its shiny rainbow button */
#ccsb-update {
    position:fixed;
    z-index:2147483647;
    left:50%;
    top:18%;
    transform:translateX(-50%);
    width:min(380px,calc(100vw - 32px));
    padding:16px 18px 14px;
    text-align:center;
    font-family:"Quicksand","Nunito","Varela Round","Segoe UI Rounded","Segoe UI","Comic Sans MS",ui-rounded,system-ui,sans-serif;
    color:#ffeaf6;
    background:linear-gradient(160deg, rgba(50,27,68,.98), rgba(30,20,54,.98));
    border:2px solid #ff9ed2;
    border-radius:20px;
    box-shadow:0 12px 50px rgba(255,120,190,.45), inset 0 0 0 1px rgba(150,215,255,.35);
    animation:ccsb-update-pop .45s cubic-bezier(.2,1.6,.4,1) both;
}

#ccsb-update * {
    box-sizing:border-box;
}

.ccsb-update-title {
    font-size:16px;
    font-weight:800;
    color:#fff;
    text-shadow:0 1px 10px rgba(255,105,180,.8);
}

.ccsb-update-text {
    margin:6px 0 14px;
    font-size:12px;
    color:#ffb3dc;
}

.ccsb-update-buttons {
    display:flex;
    gap:10px;
    align-items:center;
    justify-content:center;
    flex-wrap:wrap;
}

#ccsb-update .ccsb-btn {
    font:inherit;
    font-size:11px;
    opacity:.75;
}

#ccsb-update-go {
    position:relative;
    display:inline-block;
    overflow:hidden;
    padding:9px 20px;
    border-radius:999px;
    font-size:14px;
    font-weight:800;
    color:#fff;
    text-decoration:none;
    text-shadow:0 1px 3px rgba(60,0,60,.6);
    background:linear-gradient(90deg,#ff6fb5,#ffb86b,#fff275,#7dffb0,#72d6ff,#b48cff,#ff6fb5);
    background-size:300% 100%;
    border:2px solid #fff;
    animation:ccsb-rainbow 3s linear infinite, ccsb-glow 1.6s ease-in-out infinite, ccsb-wiggle 2.4s ease-in-out infinite;
}

#ccsb-update-go span {
    position:relative;
    z-index:1;
}

#ccsb-update-go::after {
    content:"";
    position:absolute;
    top:-50%;
    left:-60%;
    width:40%;
    height:200%;
    background:linear-gradient(90deg, transparent, rgba(255,255,255,.85), transparent);
    transform:rotate(20deg);
    animation:ccsb-shine 2.2s ease-in-out infinite;
}

#ccsb-update-go:hover {
    animation-duration:1.2s, .8s, .9s;
}

@keyframes ccsb-update-pop {
    from { opacity:0; transform:translateX(-50%) scale(.6); }
    to { opacity:1; transform:translateX(-50%) scale(1); }
}

@keyframes ccsb-rainbow {
    from { background-position:0% 50%; }
    to { background-position:300% 50%; }
}

@keyframes ccsb-glow {
    0%, 100% { box-shadow:0 0 10px rgba(255,143,207,.7), 0 0 22px rgba(150,215,255,.4); }
    50% { box-shadow:0 0 18px rgba(255,242,117,.9), 0 0 38px rgba(255,111,181,.7); }
}

@keyframes ccsb-shine {
    0% { left:-60%; }
    60%, 100% { left:130%; }
}

@keyframes ccsb-wiggle {
    0%, 80%, 100% { transform:rotate(0) scale(1); }
    85% { transform:rotate(-3deg) scale(1.06); }
    90% { transform:rotate(3deg) scale(1.06); }
    95% { transform:rotate(-2deg) scale(1.03); }
}

@media (prefers-reduced-motion: reduce) {
    #ccsb-update, #ccsb-update-go, #ccsb-update-go::after { animation:none; }
}

/* AUTO-9: a store section the paw is at, opened like the game's own :hover */
.storeSection.ccsb-store-open { height:auto !important; }
.storeSection.ccsb-store-open:before { display:block; }
`;

/** Injects the <style> element for the HUD, panels and overlay (pastel theme). */
export function injectStyles(): void {
  const style = document.createElement('style');
  style.id = 'ccsb-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** Sets the CSS variable the frames (main panel, graphs, logs, debug) read their opacity from
 * ("Frame opacity" setting). */
export function applyFrameOpacity(opacity: number): void {
  document.documentElement.style.setProperty('--ccsb-frame-opacity', String(opacity));
}
