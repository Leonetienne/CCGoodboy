/** The Farm's garden controls (GARDEN-*), drawn by the game inside the Farm row's minigame
 * panel: plot tiles `#gardenTile-{x}-{y}`, seeds `#gardenSeed-{id}`, soils
 * `#gardenSoil-{id}`. Clicking a tile harvests (or, when not mature, unearths) whatever
 * grows there, else plants the selected seed. */

export function getGardenTile(x: number, y: number): Element | null {
  return document.getElementById(`gardenTile-${x}-${y}`);
}

export function getGardenSeed(id: number): Element | null {
  return document.getElementById(`gardenSeed-${id}`);
}

export function getGardenSoil(id: number): Element | null {
  return document.getElementById(`gardenSoil-${id}`);
}
