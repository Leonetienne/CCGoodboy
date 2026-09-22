// Cookie Clicker's own global `Game` object ships no types. It is wrapped by
// game/game-adapter.ts, which is the only file allowed to touch it directly.
declare global {
  interface Window {
    Game?: any;
  }
}

export {};
