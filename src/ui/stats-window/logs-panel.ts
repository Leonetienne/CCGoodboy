import { VERSION } from '../../core/constants';
import type { LogEntry, PersistedData } from '../../core/persisted-data';
import { escapeHtml } from '../format';

function logsBodyHtml(): string {
  return `
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
}

/** Triggers a browser download of a text file (Blob + temporary link). */
function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
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

/** The action-log browser window: filter, JSON/CSV export, and the log table. */
export class LogsPanel {
  readonly element: HTMLDivElement;

  constructor(private readonly data: PersistedData) {
    this.element = document.createElement('div');
    this.element.id = 'ccsb-logs';
    this.element.innerHTML = logsBodyHtml();
  }

  /** Shows/hides the log window (renders the table on open). */
  toggle(): void {
    const showing = this.element.style.display === 'block';
    this.element.style.display = showing ? 'none' : 'block';

    if (!showing) {
      this.render();
    }
  }

  /** Logs matching the current filter box (all logs if empty). */
  private logsForExport(): LogEntry[] {
    const input = document.getElementById('ccsb-log-filter') as HTMLInputElement | null;
    const filter = ((input && input.value) || '').trim().toLowerCase();

    if (!filter) {
      return this.data.logs.slice();
    }

    return this.data.logs.filter((e) => `${e.action} ${e.meta} ${e.extra ? JSON.stringify(e.extra) : ''}`.toLowerCase().includes(filter));
  }

  /** Exports the (filtered) logs as JSON ({exportedAt, version, count, logs[]}) or CSV
   * (time,ts,action,meta,extra; UTF-8 BOM for Excel). */
  export(format: 'json' | 'csv'): void {
    const logs = this.logsForExport();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const iso = (e: LogEntry) => new Date(e.ts * 1000).toISOString();

    if (format === 'csv') {
      const esc = (v: unknown) => {
        const t = String(v == null ? '' : v);
        return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      };

      const rows = ['time,ts,action,meta,extra'].concat(
        logs.map((e) => [iso(e), e.ts, e.action, e.meta, e.extra ? JSON.stringify(e.extra) : ''].map(esc).join(',')),
      );

      // BOM so Excel reads UTF-8 correctly.
      downloadTextFile(`cc-smartbot-logs-${stamp}.csv`, '﻿' + rows.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
    } else {
      downloadTextFile(
        `cc-smartbot-logs-${stamp}.json`,
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            version: VERSION,
            count: logs.length,
            logs: logs.map((e) => Object.assign({ time: iso(e) }, e)),
          },
          null,
          2,
        ),
        'application/json',
      );
    }
  }

  /** Fills the log table (newest first, filtered by the search box, at most 2000 rows). */
  render(): void {
    const tbody = this.element.querySelector('tbody');
    if (!tbody) return;

    const input = document.getElementById('ccsb-log-filter') as HTMLInputElement | null;
    const filter = ((input && input.value) || '').trim().toLowerCase();

    const rows: string[] = [];

    for (let i = this.data.logs.length - 1; i >= 0 && rows.length < 2000; i--) {
      const e = this.data.logs[i]!;
      const hay = `${e.action} ${e.meta} ${e.extra ? JSON.stringify(e.extra) : ''}`.toLowerCase();

      if (filter && !hay.includes(filter)) {
        continue;
      }

      const d = new Date(e.ts * 1000);

      rows.push(
        `<tr>` +
          `<td>${escapeHtml(d.toLocaleString())}</td>` +
          `<td>${escapeHtml(e.action)}</td>` +
          `<td>${escapeHtml(e.meta)}</td>` +
          `<td>${escapeHtml(e.extra ? JSON.stringify(e.extra) : '')}</td>` +
          `</tr>`,
      );
    }

    tbody.innerHTML = rows.join('') || '<tr><td colspan="4" style="color:#c9a6e6">Nothing matches yet :3</td></tr>';
  }
}
