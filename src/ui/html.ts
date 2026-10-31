/** Small HTML helpers shared by the menu screens. */

export const ARROW =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';

export const ART = `
<div class="m-art" aria-hidden="true">
  <svg viewBox="0 0 600 800" preserveAspectRatio="xMidYMid meet">
    <path class="flow" pathLength="1000" d="M-20 700 C140 640 120 460 260 430 S520 470 470 300 S300 120 560 70"/>
    <path class="flow thin" pathLength="1000" d="M-20 744 C160 690 150 500 290 470 S560 500 500 330 S330 150 600 100"/>
    <polygon class="flow-head" points="573.7,67.4 551.9,80.7 548.5,63.1"/>
  </svg>
</div>`;

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${n % 10 > 3 ? 'th' : s}`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function wordmark(tag = 'h1'): string {
  return `<${tag} class="wordmark" aria-label="iamSpacePilot"><span class="w1">iam</span><span class="w2">Space</span><span class="w3">Pilot</span></${tag}>`;
}

/** One menu screen: content column on the left, light trail art on the right. */
export function frame(inner: string, foot = ''): string {
  return `<section class="m-screen"><div class="m-col">${inner}${foot ? `<div class="m-foot">${foot}</div>` : ''}</div>${ART}</section>`;
}
