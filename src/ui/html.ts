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

/** The round logo: navy ring, white ring, red centre. */
export const ROUNDEL =
  '<svg class="roundel" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50" fill="#000088"/><circle cx="50" cy="50" r="36.3" fill="#fff"/><circle cx="50" cy="50" r="17.6" fill="#a60000"/></svg>';

export function wordmark(tag = 'h1'): string {
  return `<${tag} class="wordmark" aria-label="iamSpacePilot"><span class="w1">iam</span><span class="w2">Space</span><span class="w3">Pilot</span>${ROUNDEL}</${tag}>`;
}

const ext = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

/** The text of the red bar. */
export const RED_BAR = `You want to fly in REAL: ${ext('https://www.pilotFilm.at', 'Contact me')} 🤗 Want to make AI work for you? Reach out for my workshops and keynotes 🚀`;

/**
 * The footer that is always at the bottom edge of every menu screen: the red
 * bar, and under it the legal links, the two websites with their logos and
 * the portrait. Compact enough to fit on any screen.
 */
export function siteFooter(): string {
  return `<div class="sf-bar">${RED_BAR}</div>
<div class="sf-strip">
  <nav class="sf-legal" aria-label="Legal">${ext('https://www.pilotfilm.at/impressum', 'Impressum')}<a href="/privacy.html" target="_blank" rel="noopener">Privacy</a><a href="/datenschutz.html" target="_blank" rel="noopener" hreflang="de" lang="de">Datenschutz</a></nav>
  <div class="sf-sites">
    <a class="sf-site" href="https://www.Andreas-Schmoelzer.at" target="_blank" rel="noopener" aria-label="www.Andreas-Schmoelzer.at"><img src="/img/andreas-schmoelzer-logo.png" alt="Andreas Schmölzer, Keynote-Speaker" width="207" height="37"><span>www.Andreas-Schmoelzer.at</span></a>
    <a class="sf-site" href="https://www.pilotFilm.at" target="_blank" rel="noopener" aria-label="www.pilotFilm.at"><img src="/img/pilotfilm-logo.png" alt="pilotFilm" width="178" height="42"><span>www.pilotFilm.at</span></a>
  </div>
  <a class="sf-portrait" href="https://www.Andreas-Schmoelzer.at" target="_blank" rel="noopener"><img src="/img/andreas-schmoelzer.webp" alt="Andreas Schmölzer" width="160" height="162"></a>
</div>`;
}

/** One menu screen: content column on the left, light trail art on the right. */
export function frame(inner: string, foot = ''): string {
  return `<section class="m-screen"><div class="m-col">${inner}${foot ? `<div class="m-foot">${foot}</div>` : ''}</div>${ART}</section>`;
}
