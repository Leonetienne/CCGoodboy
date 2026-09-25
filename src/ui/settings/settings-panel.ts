import type { PersistedData } from '../../core/persisted-data';
import type { RuntimeState } from '../../core/runtime-state';
import type { KeepAliveController } from '../../input/keep-alive';
import { normalizeSetting } from './normalize-setting';

/** Updates the live percentage readout next to a range-type setting input, if the markup has
 * one (`.ccsb-setting-range-val[data-for=key]`). Purely cosmetic — does not touch config. */
export function updateRangeReadout(panel: ParentNode, key: string, value: number): void {
  const val = panel.querySelector(`.ccsb-setting-range-val[data-for="${key}"]`);

  if (val) {
    val.textContent = `${Math.round(value * 100)}%`;
  }
}

/** Staged settings commit: validate/clamp every field, apply to data.config, store immediately,
 * and notify listeners (the panel redraws its charts if the graphs window happens to be open,
 * via onSaved). */
export class SettingsPanel {
  private saveStatusTimer = 0;

  constructor(
    private readonly panel: HTMLElement,
    private readonly data: PersistedData,
    private readonly runtime: RuntimeState,
    private readonly keepAlive: KeepAliveController,
    private readonly onSaved: () => void,
  ) {}

  /** Marks the settings as (not) saved: glowing Save button + 'unsaved changes' text. */
  setDirty(dirty: boolean): void {
    const btn = document.getElementById('ccsb-save-settings');
    const status = document.getElementById('ccsb-save-status');

    if (!btn || !status) return;

    clearTimeout(this.saveStatusTimer);

    btn.classList.toggle('dirty', !!dirty);
    status.textContent = dirty ? 'unsaved changes ^w^' : '';
  }

  save(): void {
    if (!this.panel) return;

    for (const input of Array.from(this.panel.querySelectorAll<HTMLInputElement>('[data-setting]'))) {
      const key = input.dataset.setting!;
      const value = normalizeSetting(key, input.value);

      (this.data.config as unknown as Record<string, number>)[key] = value;
      input.value = String(value);

      if (input.type === 'range') {
        updateRangeReadout(this.panel, key, value);
      }
    }

    this.data.config.visuals = (document.getElementById('ccsb-visuals') as HTMLInputElement).checked;
    this.data.config.idleWander = (document.getElementById('ccsb-idle-wander') as HTMLInputElement).checked;
    this.data.config.showBuyValue = (document.getElementById('ccsb-buyvalue') as HTMLInputElement).checked;
    this.data.config.showAscendOverlay = (document.getElementById('ccsb-ascend-overlay') as HTMLInputElement).checked;
    this.data.config.keepAlive = (document.getElementById('ccsb-keepalive') as HTMLInputElement).checked;
    this.data.config.grimoireFthof = (document.getElementById('ccsb-grimoire-fthof') as HTMLInputElement).checked;
    this.data.config.spendLumps = (document.getElementById('ccsb-spend-lumps') as HTMLInputElement).checked;
    this.data.config.stockMarket = (document.getElementById('ccsb-stock-market') as HTMLInputElement).checked;

    this.keepAlive.init();

    this.data.config.autoDryRun = (document.getElementById('ccsb-auto-dry') as HTMLInputElement).checked;
    this.data.config.autoHammer = (document.getElementById('ccsb-auto-hammer') as HTMLInputElement).checked;
    this.data.config.autoGrandmapocalypse = (document.getElementById('ccsb-auto-grandmapocalypse') as HTMLInputElement).checked;
    this.data.config.autoPopWrinklers = (document.getElementById('ccsb-auto-pop-wrinklers') as HTMLInputElement).checked;
    this.runtime.wrinklerNextEvalAt = 0;
    this.data.config.autoKrumblor = (document.getElementById('ccsb-auto-krumblor') as HTMLInputElement).checked;
    this.data.config.autoAscend = (document.getElementById('ccsb-auto-ascend') as HTMLInputElement).checked;

    this.runtime.autoNextEvalAt = 0;

    // Explicit save: write to storage right now.
    this.data.saveNow();
    this.setDirty(false);

    const status = document.getElementById('ccsb-save-status');

    if (status) {
      status.textContent = 'saved :3';

      this.saveStatusTimer = window.setTimeout(() => {
        status.textContent = '';
      }, 2500);
    }

    this.onSaved();
  }
}
