import { SHIPS, SHIP_ORDER, type ShipId } from '../core/ships';
import { POWERS, POWER_ORDER } from '../core/powerups';
import { ARROW, esc, frame } from './html';

/** The hangar: pick one of the four ships. Each card has a live 3D view (canvas). */
export function hangarScreen(current: ShipId): string {
  const bar = (label: string, v: number) =>
    `<div class="sh-stat"><span>${label}</span><span class="sh-bar" style="--v:${v.toFixed(2)}"><i></i></span></div>`;
  const cards = SHIP_ORDER.map((id) => {
    const s = SHIPS[id];
    const on = id === current;
    return `<article class="ship-card${on ? ' on' : ''}">
      <canvas class="sh-view" data-ship="${id}" width="480" height="300" aria-hidden="true"></canvas>
      <div class="sh-body">
        <p class="sh-model">${esc(s.model)} · ${esc(s.role)}</p>
        <h3 class="sh-name">${esc(s.name)}</h3>
        ${bar('Speed', s.stats.speed)}${bar('Agility', s.stats.agility)}${bar('Armor', s.stats.armor)}${bar('Firepower', s.stats.firepower)}
        <p class="sh-special"><kbd>C</kbd> <strong>${esc(s.special.name)}</strong> ${esc(s.special.text)} <span class="sh-cool">Recharges in ${Math.round(s.special.cooldown / 60)} s.</span></p>
        <p class="sh-trait">${esc(s.trait)}</p>
        <button class="btn sh-pick" data-act="pick-ship" data-val="${id}" aria-pressed="${on}">${on ? 'Selected' : `Fly the ${esc(s.name)}`}</button>
      </div>
    </article>`;
  }).join('');
  const powers = POWER_ORDER.map((p) => {
    const spec = POWERS[p];
    const col = `#${spec.color.toString(16).padStart(6, '0')}`;
    return `<li><span class="pw-dot" style="--pc:${col}"></span><strong>${esc(spec.name)}</strong> ${esc(spec.text)}</li>`;
  }).join('');
  return frame(
    `<p class="m-kicker">Hangar</p>
    <h2 class="m-title">Choose your ship</h2>
    <div class="ship-grid">${cards}</div>
    <h3 class="m-sub">Bonus rings</h3>
    <p class="m-text">Fly through a ring for boost and the bonus it shows. The colour tells you which one.</p>
    <ul class="pw-list">${powers}</ul>
    <div class="m-list"><button class="mi" data-act="back">Back ${ARROW}</button></div>`,
  );
}
