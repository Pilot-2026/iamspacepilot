/**
 * The title sequence: words flash up, then the letters of iamSpacePilot fly in
 * from everywhere, flicker through other letters and lock into the title.
 * The finished title stays on screen until a key, click or tap; any of them
 * also skips the sequence while it runs.
 */

const WORDS = ['FLY', 'FREE', 'I AM', 'SPACE', 'PILOT', 'LIGHT', 'WALLS', 'SKY', 'BRAVE', 'GOLD', 'SPEED', 'ORBIT', 'NEBULA', 'BOOST'];
const GLYPHS = 'IAMSPCELOTVWXYZ*#+';
/** When the title stands complete and waits for a tap. */
const HOLD = 6.4;
const touchFirst = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function playIntro(root: HTMLElement, done: () => void): void {
  const parts: [string, string][] = [
    ['w1', 'iam'],
    ['w2', 'Space'],
    ['w3', 'Pilot'],
  ];
  let letters = '';
  for (const [cls, word] of parts) {
    letters += `<span class="${cls}">${[...word].map((c) => `<span class="il" data-c="${c}">${c}</span>`).join('')}</span>`;
  }
  root.innerHTML = `<section class="intro" aria-label="iamSpacePilot">
    <div class="intro-words" aria-hidden="true"></div>
    <h1 class="wordmark intro-title" aria-label="iamSpacePilot">${letters}</h1>
    <p class="intro-tag">Fly free. Leave light behind.</p>
    <p class="intro-start">${touchFirst() ? 'Tap to start' : 'Press any key or click to start'}</p>
    <p class="intro-skip">${touchFirst() ? 'Tap to skip' : 'Press any key or click to skip'}</p>
  </section>`;
  const section = root.querySelector('.intro') as HTMLElement;
  const wordsBox = root.querySelector('.intro-words') as HTMLElement;
  const els = Array.from(root.querySelectorAll<HTMLElement>('.il'));
  const timers: number[] = [];
  const at = (s: number, fn: () => void) => timers.push(window.setTimeout(fn, s * 1000));
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let finished = false;

  // Scatter the letters.
  els.forEach((el) => {
    const dx = (Math.random() * 2 - 1) * window.innerWidth * 0.6;
    const dy = (Math.random() * 2 - 1) * window.innerHeight * 0.6;
    const rot = (Math.random() * 2 - 1) * 540;
    const sc = 0.4 + Math.random() * 2.6;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${sc})`;
    el.style.opacity = '0';
  });

  // Words flash up here and there.
  WORDS.forEach((w, i) => {
    at(0.5 + i * 0.2, () => {
      const d = document.createElement('span');
      d.className = 'intro-word';
      d.textContent = w;
      d.style.left = `${8 + Math.random() * 74}%`;
      d.style.top = `${10 + Math.random() * 72}%`;
      d.style.fontSize = `${2 + Math.random() * 6}vw`;
      wordsBox.append(d);
      window.setTimeout(() => d.remove(), 1100);
    });
  });

  // Letters appear, flicker, then fly home one after another.
  const settled = new Set<HTMLElement>();
  els.forEach((el, i) => {
    at(2.3 + i * 0.05, () => (el.style.opacity = '1'));
    at(3.3 + i * 0.1, () => {
      settled.add(el);
      el.textContent = el.dataset.c ?? '';
      el.style.transform = 'none';
      el.classList.add('home');
    });
  });
  const scramble = window.setInterval(() => {
    for (const el of els) {
      if (settled.has(el) || el.style.opacity !== '1') continue;
      el.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }
  }, 60);
  at(5.2, () => section.classList.add('tagged'));
  // The title stays; only a tap or a key goes on to the menu.
  at(HOLD, () => section.classList.add('hold'));

  const skip = (e: Event) => {
    if (e instanceof KeyboardEvent && (e.code === 'KeyM' || e.repeat)) return;
    // The music button may be pressed during the intro without skipping it.
    if (e.target instanceof Element && e.target.closest('.music-btn')) return;
    // The key that ends the intro must not also press the first menu button.
    if (e instanceof KeyboardEvent) e.preventDefault();
    finish();
  };
  function finish(): void {
    if (finished) return;
    finished = true;
    for (const t of timers) window.clearTimeout(t);
    window.clearInterval(scramble);
    for (const type of ['keydown', 'pointerup']) window.removeEventListener(type, skip, true);
    done();
  }
  // pointerup, not pointerdown: on iPhones only the end of a tap may start the sound.
  for (const type of ['keydown', 'pointerup']) window.addEventListener(type, skip, true);
  if (reduced) {
    for (const el of els) {
      el.style.transform = 'none';
      el.style.opacity = '1';
      settled.add(el);
    }
    section.classList.add('tagged', 'hold');
  }
}
