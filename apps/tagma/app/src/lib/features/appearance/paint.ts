import type { ThemeMode } from '@tagma/server/appearance/contract/wire/format';

const BOOT_STYLE = 'appearance-boot';

const STILL = '*,*::before,*::after{transition:none!important}';

export type Painting = { readonly mode: ThemeMode; readonly css: string; readonly chrome: string };

export const sheetOf = (document: Document): CSSStyleSheet => {
  const sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return sheet;
};

const chromeOf = (document: Document, chrome: string): void => {
  const [first, ...rest] = document.querySelectorAll('meta[name="theme-color"]');
  for (const extra of rest) extra.remove();
  const meta = first ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  meta.removeAttribute('media');
  meta.setAttribute('content', chrome);
};

export const paintWith = (document: Document, sheet: CSSStyleSheet, painting: Painting, still: boolean): void => {
  const root = document.documentElement;
  const held = still ? document.head.appendChild(Object.assign(document.createElement('style'), { textContent: STILL })) : null;
  sheet.replaceSync(painting.css);
  document.getElementById(BOOT_STYLE)?.remove();
  root.classList.toggle('dark', painting.mode === 'dark');
  root.style.colorScheme = painting.mode;
  chromeOf(document, painting.chrome);
  if (held === null) return;
  void getComputedStyle(root).colorScheme;
  requestAnimationFrame(() => held.remove());
};
