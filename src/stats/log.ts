import { nowSec } from '../core/constants';
import type { LogEntry, PersistedData } from '../core/persisted-data';

export type LogListener = (entry: LogEntry) => void;

/** Appends to the persisted action log and notifies subscribers. The original bot's logAction
 * reached directly into the UI (rendering the log table when open); here the UI subscribes
 * instead of being called into. */
export class LogStore {
  private listeners: LogListener[] = [];

  constructor(private readonly data: PersistedData) {}

  log(action: string, meta: string, extra?: Record<string, unknown>): void {
    const entry: LogEntry = {
      action: String(action || ''),
      meta: String(meta || ''),
      ts: nowSec(),
    };

    if (extra && typeof extra === 'object') {
      entry.extra = extra;
    }

    this.data.appendLog(entry);

    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  onLog(listener: LogListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
