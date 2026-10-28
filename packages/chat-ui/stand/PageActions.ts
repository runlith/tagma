import { Recorder, scroller } from './recorder';
import type { Point } from './port';
import type { ObservedEntries, Scrollbar } from './recording';
import type { DisclosurePosition } from './scenario';

const HEAD_REACH_VIEWPORTS = 3;
const RESTING_FRAMES = 30;

export class PageActions {
  private target: string | null = null;
  private pageHead: string | null = null;
  private pageRequests: Promise<number> | null = null;
  private landedHead: string | null = null;
  private approachedHead: string | null = null;
  constructor(
    private readonly recorder: () => Recorder,
    private readonly entries: ObservedEntries,
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

  async approach(distance: number): Promise<void> {
    const root = scroller();
    const before = this.head();
    if (before === null) throw new Error('The rail shows no first message before positioning');
    const head = () => {
      const list = root.querySelector<HTMLElement>('[data-timeline-key]')?.parentElement?.parentElement;
      if (list === null || list === undefined) throw new Error('The thread mounted no timeline before positioning');
      const start = list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      return root.scrollTop - start;
    };
    const trigger = () => HEAD_REACH_VIEWPORTS * root.clientHeight;
    const describe = () =>
      `head ${head()} against trigger ${trigger()} for a ${distance} px gesture, scrollTop ${root.scrollTop} of ${root.scrollHeight}, first tile ${this.head()}`;
    let previous = Number.NaN;
    for (;;) {
      if (this.head() !== before) throw new Error(`The older page landed before the gesture could cross the paging trigger: ${describe()}`);
      const offset = head() - trigger();
      if (offset >= distance / 4 && offset <= (distance * 3) / 4) {
        this.approachedHead = before;
        return;
      }
      if (Math.abs(head() - previous) < 0.5) throw new Error(`Positioning made no progress toward the paging trigger: ${describe()}`);
      previous = head();
      await this.position(root.scrollTop - offset + distance / 2);
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
    const controls = [...root.querySelectorAll<HTMLElement>('[data-timeline-key] [aria-expanded]')].map((button) => ({
      button,
      rect: button.getBoundingClientRect(),
    }));
    const anchor = controls
      .filter((item) => item.rect.height > 0)
      .sort((a, b) => Math.abs(a.rect.top - viewport.top - 100) - Math.abs(b.rect.top - viewport.top - 100))[0];
    if (anchor === undefined) throw new Error('The thread mounted no disclosure control');
    this.target = anchor.button.closest<HTMLElement>('[data-timeline-key]')!.dataset.timelineKey!;
    anchor.button.scrollIntoView({ block: 'center' });
    await this.recorder().frames(4);
    const button = this.control();
    button.dataset.standDisclosure = 'target';
    const top = side === 'above' ? 20 : side === 'below' ? 360 : 100;
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
    root.scrollBy(0, button.getBoundingClientRect().top - root.getBoundingClientRect().top - top);
    await this.recorder().frames(6);
    this.control();
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
