const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const AUTOFOCUS_PREFERRED_SELECTOR = [
  'input:not([type="hidden"]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[contenteditable="true"]',
].join(',');

const AUTOFOCUS_IGNORE_SELECTOR = ['[data-slot="dialog-close"]', '[data-runlith-autofocus-ignore]'].join(',');

const AUTOFOCUS_SELECTOR = '[data-runlith-autofocus]';

export const AUTOFOCUS_MARK = 'data-dialog-autofocus';

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates.filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;

    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;

    return true;
  });
}

export function focusSafely(element: HTMLElement): void {
  try {
    element.focus({ preventScroll: true });
    return;
  } catch {}

  try {
    element.focus();
  } catch {}
}

export const namedFocusIn = (container: HTMLElement): HTMLElement | null => container.querySelector<HTMLElement>(AUTOFOCUS_SELECTOR);

export function focusInitialIn(container: HTMLElement): boolean {
  const named = namedFocusIn(container);
  if (named) {
    focusAndMark(named);
    return true;
  }

  const focusables = getFocusableElements(container).filter((el) => !el.matches(AUTOFOCUS_IGNORE_SELECTOR));

  const preferred = focusables.find((el) => el.matches(AUTOFOCUS_PREFERRED_SELECTOR));
  if (preferred) {
    focusAndMark(preferred);
    return true;
  }

  const first = focusables[0];
  if (!first) return false;

  focusAndMark(first);
  return true;
}

function focusAndMark(element: HTMLElement): void {
  focusSafely(element);
  element.setAttribute(AUTOFOCUS_MARK, '');
  element.addEventListener('focusout', () => element.removeAttribute(AUTOFOCUS_MARK), { once: true });
}

export function cycleTab(event: KeyboardEvent, regions: readonly HTMLElement[]): void {
  const home = regions.find((region) => region.hasAttribute('tabindex')) ?? regions[0];
  if (event.key !== 'Tab' || event.defaultPrevented || home === undefined) return;

  const stops = regions.flatMap((region) => getFocusableElements(region).map((element) => ({ element, region })));
  if (stops.length === 0) {
    event.preventDefault();
    focusSafely(home);
    return;
  }

  const active = document.activeElement;
  const at = stops.findIndex((stop) => stop.element === active);
  const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === -1 || at === stops.length - 1 ? 0 : at + 1;
  const wraps = event.shiftKey ? at <= 0 : at === -1 || at === stops.length - 1;
  if (!wraps && stops[next]!.region === stops[at]!.region) return;

  event.preventDefault();
  focusSafely(stops[next]!.element);
}
