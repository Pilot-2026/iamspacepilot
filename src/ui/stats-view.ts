import { LEVELS } from '../core/levels';
import type { LevelId } from '../core/types';
import type { Stats } from '../net/stats';
import { esc } from './html';

/**
 * The statistics screen: the number of visits so far, big, on top; then the
 * visits per day and where, how and what people played.
 */

const nf = new Intl.NumberFormat('en-US');
let regions: Intl.DisplayNames | null = null;
try {
  regions = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  regions = null;
}

function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX') return '🌐';
  return String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0)));
}

function country(code: string): string {
  if (code === 'XX') return 'Unknown';
  try {
    return regions?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Biggest first, at most n rows, the rest summed up as "Other". */
function ranked(map: Record<string, number>, n: number): [string, number][] {
  const rows = Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (rows.length <= n) return rows;
  const rest = rows.slice(n - 1).reduce((s, [, v]) => s + v, 0);
  return [...rows.slice(0, n - 1), ['__other', rest]];
}

/** A list with a bar per row, the value and its share written out. */
function bars(title: string, map: Record<string, number>, label: (key: string) => string, n = 10): string {
  const rows = ranked(map, n);
  if (!rows.length) return `<h3 class="st-h">${title}</h3><p class="m-hint">No data yet.</p>`;
  const total = Object.values(map).reduce((s, v) => s + v, 0) || 1;
  const max = rows[0][1] || 1;
  return `<h3 class="st-h">${title}</h3>
  <ul class="st-bars">${rows
    .map(([k, v]) => {
      const name = k === '__other' ? 'Other' : label(k);
      const pct = Math.round((v / total) * 100);
      return `<li title="${esc(name)}: ${nf.format(v)} (${pct}%)"><span class="st-name">${name}</span><span class="st-track"><i style="width:${Math.max(1.5, (v / max) * 100)}%"></i></span><span class="st-val">${nf.format(v)} <small>${pct}%</small></span></li>`;
    })
    .join('')}</ul>`;
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Visits per day as columns (oldest left), one value per column on hover. */
function dayChart(days: Stats['days']): string {
  const list = [...days].reverse().slice(-30);
  if (!list.length) return '<p class="m-hint">No visits counted yet.</p>';
  const max = Math.max(1, ...list.map((d) => d.visits));
  const cols = list
    .map(
      (d) =>
        `<li tabindex="0" title="${dayLabel(d.day)}: ${nf.format(d.visits)} visits, ${nf.format(d.flights)} flights"><i style="height:${Math.max(2, (d.visits / max) * 100)}%"></i><span class="st-tip">${dayLabel(d.day)}<br><b>${nf.format(d.visits)}</b> visits</span></li>`,
    )
    .join('');
  return `<div class="st-chart" role="img" aria-label="Visits per day, ${list.length} days, most ${nf.format(max)}">
    <span class="st-max">${nf.format(max)}</span>
    <ol class="st-cols">${cols}</ol>
    <div class="st-axis"><span>${dayLabel(list[0].day)}</span><span>${dayLabel(list[list.length - 1].day)}</span></div>
  </div>`;
}

/** The table view of the last days. */
function dayTable(days: Stats['days']): string {
  const rows = days
    .slice(0, 14)
    .map((d) => `<tr><td>${dayLabel(d.day)}</td><td class="num">${nf.format(d.visits)}</td><td class="num">${nf.format(d.flights)}</td></tr>`)
    .join('');
  return `<details class="st-details"><summary>Show the last 14 days as a table</summary><div class="keys-wrap"><table class="keys"><thead><tr><th>Day</th><th>Visits</th><th>Flights</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

const city = (k: string) => {
  const m = /^(.*)_([A-Z]{2})$/.exec(k);
  return m ? `${esc(m[1].replace(/_/g, ' '))} <small>${flag(m[2])} ${m[2]}</small>` : esc(k.replace(/_/g, ' '));
};
const source = (k: string) => (k === 'direct' ? 'Direct / bookmark / app' : esc(k.replace(/_/g, '.')));
const level = (k: string) => {
  const L = LEVELS[k.replace(/_/g, '-') as LevelId];
  return L ? `${L.index} · ${esc(L.name)}` : esc(k);
};
const device = (k: string) => ({ mobile: 'Phone', tablet: 'Tablet', desktop: 'Computer' })[k] ?? esc(k);

export function statsHtml(s: Stats): string {
  const today = s.days[0];
  const last7 = s.days.slice(0, 7).reduce((n, d) => n + d.visits, 0);
  const since = s.since ? new Date(`${s.since}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return `<div class="st-hero"><b>${nf.format(s.total)}</b><span>visits so far</span></div>
  <p class="st-sub">${since ? `Since ${since} · ` : ''}${nf.format(s.flights)} flights · ${today ? `${nf.format(today.visits)} today · ` : ''}${nf.format(last7)} in the last 7 days</p>
  <h3 class="st-h">Visits per day <small>last 30 days</small></h3>
  ${dayChart(s.days)}
  ${dayTable(s.days)}
  <div class="st-grid">
    <section>${bars('Countries <small>all time</small>', s.all.countries, (k) => `${flag(k)} ${esc(country(k))}`, 12)}</section>
    <section>${bars('Cities <small>last 30 days</small>', s.recent.cities, city, 12)}</section>
    <section>${bars('Devices <small>all time</small>', s.all.devices, device, 3)}</section>
    <section>${bars('Came from <small>last 30 days</small>', s.recent.sources, source, 8)}</section>
    <section>${bars('Flights by level <small>all time</small>', s.all.levels, level, 10)}</section>
    <section>${bars('Solo or online <small>all time</small>', s.all.modes, (k) => (k === 'online' ? 'Online' : 'Solo'), 2)}</section>
  </div>
  <p class="m-hint">Anonymous: only totals are counted, no addresses and nothing that points to a person. Country and city come from the connection and are never stored with anything else.</p>`;
}
