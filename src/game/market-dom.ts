/** The Bank's stock market buttons (STOCK-*), drawn by the game inside the Bank row's
 * minigame panel. Buy buttons: `#bankGood-{id}_1/_10/_100/_Max`, sell buttons:
 * `#bankGood-{id}_-1/_-10/_-100/_-All`; hiring a broker: `#bankBrokersBuy`. */

/** A trade button's suffix: a buy (1, 10, 100, Max) or a sell (-1, -10, -100, -All). */
export type MarketButton = '1' | '10' | '100' | 'Max' | '-1' | '-10' | '-100' | '-All';

export function getMarketTradeButton(goodId: number, button: MarketButton): Element | null {
  return document.getElementById(`bankGood-${goodId}_${button}`);
}

export function getMarketBrokerButton(): Element | null {
  return document.getElementById('bankBrokersBuy');
}
