/** The bot's own voice in the browser console (CON-1..3): happy lines, "I wanted to ... but"
 * lines and errors, all in the same cute style. Kept apart from the persisted action log
 * (LogStore) so it can be sprinkled anywhere without new constructor dependencies. */

/** Per wish, the reason code last complained about (CON-2). */
const lastWhy = new Map<string, string>();

/** A happy line (CON-1). */
export function sayYay(msg: string): void {
  console.log(msg);
}

/** A one-off "wanted to, but couldn't" line, for events that happen at most every few
 * seconds (a click that did nothing, a paused module, ...). */
export function sayCant(msg: string): void {
  console.log(msg);
}

/** A "wanted to, but couldn't" line for a CONDITION the scheduler re-checks every tick
 * (CON-2): said once when `why` (a stable reason code) appears or changes, then silent while
 * it stays the same; `why = null` (the wish is gone or fulfilled) re-arms it. */
export function sayCantWhile(wish: string, why: string | null, msg = ''): void {
  if (why == null) {
    lastWhy.delete(wish);
    return;
  }

  if (lastWhy.get(wish) === why) return;

  lastWhy.set(wish, why);
  console.log(msg);
}

/** Something went wrong (CON-3): console.error, with the error object when there is one. */
export function sayOops(msg: string, err?: unknown): void {
  if (err === undefined) {
    console.error(msg);
  } else {
    console.error(msg, err);
  }
}

/** The message of an unknown thrown value. */
export function errText(e: unknown): string {
  return String(e && (e as Error).message ? (e as Error).message : e);
}

/** Forgets every remembered wish (tests). */
export function resetConsoleVoice(): void {
  lastWhy.clear();
}
