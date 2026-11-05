import { Recorder, scroller } from './recorder';
import type { Point } from './port';
import type { ObservedEntries, Scrollbar } from './recording';
import type { DisclosurePosition } from './scenario';

const RESTING_FRAMES = 30;
const SETTLED_FRAMES = 3;

export type PagingMargin = (root: HTMLElement, head: number) => number;

export class PageActions {
  private target: string | null = null;
  private pageHead: string | null = null;
  private pageRequests: Promise<number> | null = null;
  private landedHead: string | null = null;
  private approachedHead: string | null = null;
  constructor(
    private readonly recorder: () => Recorder,
    private readonly entries: ObservedEntries,
    private readonly margin: PagingMargin,
  ) {}

  head(): string | null {
    return (
      document
        .querySelector('[role="navigation"] button')
        ?.getAttribute('aria-label')
        ?.match(/^Message \d+/)?.[0] ?? null
    );
  }

  start(requested: () => Promise<number>): void {
    if (this.approachedHead !== null && this.head() !== this.approachedHead) throw new Error('The older page landed before input');
    this.pageHead = this.head();
    this.landedHead = null;
    this.pageRequests = requested();
  }

  baseline(): string | null {
    return this.pageHead;
  }

  input(): void {
    if (this.approachedHead !== null && this.head() !== this.approachedHead) throw new Error('The older page landed before input');
    this.approachedHead = null;
  }

  async approach(distance: number, requested: () => Promise<number>): Promise<void> {
    const root = scroller();
    const before = this.head();
    if (before === null) throw new Error('The rail shows no first message before positioning');
    const asked = await requested();
    const rows = () => [...root.querySelectorAll<HTMLElement>('[data-timeline-key]')].map((row) => row.parentElement!);
    const head = () => {
      const list = root.querySelector<HTMLElement>('[data-timeline-key]')?.parentElement?.parentElement;
      if (list === null || list === undefined) throw new Error('The thread mounted no timeline before positioning');
      const start = list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      return root.scrollTop - start;
    };
    const describe = () =>
      `head ${head()} at paging margin ${this.margin(root, head())} for a ${distance} px gesture, scrollTop ${root.scrollTop} of ${root.scrollHeight}, first tile ${this.head()}`;
    const reading = () => {
      const top = root.getBoundingClientRect().top;
      const row = rows().find((one) => one.getBoundingClientRect().bottom > top);
      if (row === undefined) throw new Error(`No row is rendered at the reading edge: ${describe()}`);
      return { key: row.firstElementChild!.getAttribute('data-timeline-key')!, top: row.getBoundingClientRect().top - top };
    };
    const layout = () =>
      `${root.scrollTop}:${root.scrollHeight}:${rows()
        .map((row) => `${row.firstElementChild?.getAttribute('data-timeline-key')}=${row.getBoundingClientRect().height}`)
        .join(',')}`;
    const settled = async () => {
      let last = layout();
      for (let still = 0; still < SETTLED_FRAMES;) {
        await this.recorder().frames(1);
        const now = layout();
        still = now === last ? still + 1 : 0;
        last = now;
      }
    };
    await settled();
    const steps: string[] = [];
    for (;;) {
      const offset = this.margin(root, head());
      if (this.head() !== before || (await requested()) !== asked)
        throw new Error(`Positioning requested an older page before input: ${describe()}; steps ${steps.join(' ')}`);
      if (offset >= distance / 4 && offset <= (distance * 3) / 4) {
        this.approachedHead = before;
        return;
      }
      if (offset < distance / 4)
        throw new Error(`Positioning passed the paging margin before input: ${describe()}; steps ${steps.join(' ')}`);
      const above = root.getBoundingClientRect().top - Math.min(...rows().map((row) => row.getBoundingClientRect().top));
      if (!(above > 0)) throw new Error(`No measured rows are rendered above the reader to step through: ${describe()}`);
      const step = Math.min(above, (offset - distance / 2) / 2);
      const anchor = reading();
      steps.push(`${Math.round(offset)}-${Math.round(step)}`);
      await this.position(root.scrollTop - step);
      await settled();
      const moved = rows().find((one) => one.firstElementChild?.getAttribute('data-timeline-key') === anchor.key);
      const travelled = moved === undefined ? null : moved.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.top;
      if (travelled === null || travelled < 0.5)
        throw new Error(
          `Positioning moved no content past the reading edge (${anchor.key} travelled ${travelled}): ${describe()}; steps ${steps.join(' ')}`,
        );
    }
  }

  async loadOlder(requested: () => Promise<number>): Promise<boolean> {
    const before = this.pageHead;
    if (before === null || this.pageRequests === null)
      throw new Error('Start a recording with a first rail message before observing paging');
    const asked = await this.pageRequests;
    const root = scroller();
    let still = 0;
    let last = root.scrollTop;
    while (this.head() === before) {
      await this.recorder().frames(1);
      still = Math.abs(root.scrollTop - last) < 0.5 ? still + 1 : 0;
      last = root.scrollTop;
      if (still >= RESTING_FRAMES && (await requested()) <= asked && this.head() === before) {
        console.warn(
          `No older page was requested; the reader rests at scrollTop ${root.scrollTop} of ${root.scrollHeight} with clientHeight ${root.clientHeight}, first tile ${before}`,
        );
        return false;
      }
    }
    const landed = this.head();
    if (landed === null) throw new Error('The first rail message disappeared while observing paging');
    this.landedHead = landed;
    return true;
  }

  async reachOlder(): Promise<boolean> {
    const target = this.landedHead;
    if (target === null) throw new Error('Observe a landed page before reaching it');
    await this.position(0);
    const root = scroller();
    const row = [...root.querySelectorAll<HTMLElement>('[data-message-id]')].find((node) => {
      const key = node.dataset.messageId!;
      return this.entries.kind(key) === 'user' && this.entries.message(key) === target;
    });
    if (row === undefined) return false;
    row.scrollIntoView({ block: 'center' });
    await this.recorder().frames(4);
    const rect = row.getBoundingClientRect();
    const viewport = root.getBoundingClientRect();
    return (
      root.contains(row) &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > viewport.top &&
      rect.top < viewport.top + root.clientHeight &&
      rect.right > viewport.left &&
      rect.left < viewport.left + root.clientWidth
    );
  }

  point(): Point {
    const rect = scroller().getBoundingClientRect();
    return { x: rect.left + rect.width * 0.6, y: rect.top + rect.height * 0.4 };
  }

  scrollbar(): Scrollbar {
    const root = scroller();
    const rect = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    const right = rect.right - Number.parseFloat(style.borderRightWidth);
    const left = rect.left + root.clientLeft + root.clientWidth;
    const top = rect.top + root.clientTop;
    const height = root.clientHeight;
    const gutter = right - left;
    if (style.direction !== 'ltr' || gutter < 0 || height <= 0) throw new Error('The native scrollbar requires a right-side track');
    return {
      track: { top, bottom: top + height, left, right, width: gutter, height },
      x: gutter > 0 ? (left + right) / 2 : right - 1,
      gutter,
      viewport: height,
      range: root.scrollHeight - height,
      top: root.scrollTop,
    };
  }

  async position(top: number): Promise<void> {
    const root = scroller();
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
    root.scrollTop = top;
    await this.recorder().frames(4);
  }

  async positionDisclosure(side: DisclosurePosition): Promise<void> {
    const root = scroller();
    const viewport = root.getBoundingClientRect();
    const nearest = () =>
      [...root.querySelectorAll<HTMLElement>('[data-timeline-key] [aria-expanded]')]
        .map((button) => ({ button, rect: button.getBoundingClientRect() }))
        .filter((item) => item.rect.height > 0)
        .sort((a, b) => Math.abs(a.rect.top - viewport.top - 100) - Math.abs(b.rect.top - viewport.top - 100))[0];
    let anchor = nearest();
    while (anchor === undefined && root.scrollTop > 0) {
      const from = root.scrollTop;
      await this.position(Math.max(0, from - root.clientHeight));
      if (root.scrollTop >= from) throw new Error(`Searching for a disclosure, the feed did not move up from ${from}`);
      anchor = nearest();
    }
    if (anchor === undefined) throw new Error('The thread mounted no disclosure control');
    this.target = anchor.button.closest<HTMLElement>('[data-timeline-key]')!.dataset.timelineKey!;
    anchor.button.scrollIntoView({ block: 'center' });
    await this.recorder().frames(4);
    const button = this.control();
    button.dataset.standDisclosure = 'target';
    const top = side === 'above' ? 20 : side === 'below' ? 360 : 100;
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
    let error = button.getBoundingClientRect().top - root.getBoundingClientRect().top - top;
    while (Math.abs(error) > 1) {
      root.scrollTop += error;
      await this.recorder().frames(6);
      const next = this.control().getBoundingClientRect().top - root.getBoundingClientRect().top - top;
      if (Math.abs(next) >= Math.abs(error)) throw new Error(`The disclosure could not reach its ${side} position: ${next} px off`);
      error = next;
    }
  }

  disclosurePoint(): Point {
    const rect = this.control().getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  private control(): HTMLElement {
    if (this.target === null) throw new Error('Position a disclosure before toggling it');
    const control = scroller().querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(this.target)}"] [aria-expanded]`);
    if (control === null) throw new Error(`The disclosure ${this.target} unmounted before the act`);
    return control;
  }
}
