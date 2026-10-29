import { canScroll, type ScrollState, wheelCrossesOut, wheelDistance } from '@runlith/virtual-list/scrollFollow';
import { FollowingViewport, type Hold, type ScrollOutcome } from '@runlith/virtual-list/FollowingViewport.svelte';
import { tick } from 'svelte';
import type { FeedMemory } from './FeedMemory';
import { inView, type ReadingView, readingLine, transcriptCursorMessageId } from './transcriptCursor';
import { TRANSCRIPT_END_THRESHOLD_PX, TranscriptVirtualizer } from './TranscriptVirtualizer.svelte';
import { messageOffsetTarget } from './transcriptMessageNavigation';

const HEAD_REACH_VIEWPORTS = 3;
const WHEEL_PAUSE_MS = 300;
const SCROLL_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

type Page = () => Promise<boolean> | null;

export class TranscriptViewport {
  private cursorId = $state<string | undefined>();
  private pinnedId = $state<string | undefined>();
  private shortId = $state<string | undefined>();
  private endGap = 0;
  private messages = $state<() => readonly { readonly id: string }[]>(() => []);
  private head: Page | undefined;
  private fill: Page | undefined;
  private clearance = 0;
  private paging = false;
  private refused = false;
  private request = 0;
  private wheelAt = Number.NEGATIVE_INFINITY;
  private readerMoved = false;
  private inputRoot: HTMLElement | undefined;
  private pressing = false;
  private touchY: number | undefined;
  private previousEntryCount = 0;
  private previousActiveRunId: string | null | undefined;
  private previousWorking = false;
  private threadKey: string | null = null;
  readonly window: TranscriptVirtualizer;
  private readonly followingViewport = new FollowingViewport({
    autoFollows: () => true,
    toTail: () => this.window.toEnd(),
    bottomThreshold: TRANSCRIPT_END_THRESHOLD_PX,
    overflowAnchor: 'none',
    listens: false,
    movedByReader: () => this.readerMoved,
    onScroll: (outcome) => this.readScroll(outcome),
    onMeasure: (root) => {
      this.readPosition();
      this.askForOlder(root);
    },
    onAnchor: (anchored) => this.window.keepEnd(anchored),
  });

  constructor(memory: FeedMemory) {
    this.window = new TranscriptVirtualizer(memory, (reader) => this.scrolled(reader));
  }

  openThread(key: string | null): void {
    if (key === this.threadKey) return;
    this.threadKey = key;
    this.window.openThread(key);
    this.cursorId = undefined;
    this.pinnedId = undefined;
    this.shortId = undefined;
    this.endGap = 0;
    this.paging = false;
    this.refused = false;
    this.request += 1;
    this.touchY = undefined;
    this.previousEntryCount = 0;
    this.previousActiveRunId = undefined;
    this.previousWorking = false;
    this.followingViewport.follow();
  }

  get viewport(): HTMLElement | undefined {
    return this.followingViewport.viewport;
  }

  get following(): boolean {
    return this.followingViewport.following;
  }

  get anchored(): boolean {
    return this.followingViewport.anchored;
  }

  get state(): ScrollState {
    return this.followingViewport.state;
  }

  attach(root: HTMLElement | undefined): void {
    this.followingViewport.attach(root);
    if (root === this.inputRoot) return;
    this.releaseInput();
    this.inputRoot = root;
    if (!root) return;
    root.addEventListener('wheel', this.onWheel, { passive: true });
    root.addEventListener('touchstart', this.onTouchStart, { passive: true });
    root.addEventListener('touchmove', this.onTouchMove, { passive: true });
    root.addEventListener('touchend', this.onTouchEnd, { passive: true });
    root.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
    root.addEventListener('pointerdown', this.onPointer, { passive: true });
    root.addEventListener('keydown', this.onKeyDown, { passive: true });
  }

  syncAnchor(): void {
    this.followingViewport.syncAnchor();
  }

  syncWorking(working: boolean): void {
    if (working === this.previousWorking) return;
    this.previousWorking = working;
    if (working && this.following) this.scrollToBottom(true);
  }

  scrollToBottom(force: boolean): void {
    this.followingViewport.scrollToBottom(force);
  }

  resume(): void {
    this.clearPinned();
    this.shortId = undefined;
    this.endGap = 0;
    this.followingViewport.resume();
    this.window.toEnd();
    this.readPosition();
  }

  pause(): void {
    this.followingViewport.pause();
  }

  scrollBy(delta: number): void {
    if (!this.inputRoot || delta === 0) return;
    this.heard(delta, false);
    this.window.scrollBy(delta);
  }

  resized(): void {
    this.followingViewport.resized();
  }

  syncSelection(selection: Selection | null, content: HTMLElement): void {
    this.followingViewport.syncSelection(selection, content);
  }

  useMessages(read: () => readonly { readonly id: string }[]): void {
    this.messages = read;
  }

  useHead(page: Page): void {
    this.head = page;
  }

  useFill(page: Page): void {
    this.fill = page;
  }

  select(id: string, behavior: ScrollBehavior = 'smooth'): void {
    const root = this.followingViewport.viewport;
    if (!root || !this.window.holds(id)) return;
    this.shortId = undefined;
    this.pin(id);
    this.followingViewport.pause();
    this.window.scrollToRow(id, behavior);
    this.followingViewport.scheduleState(root);
  }

  navigate(offset: number, ids: readonly string[]): void {
    const target = messageOffsetTarget({ currentId: this.currentMessageId, ids, offset });
    if (target.kind === 'none') return;
    if (target.kind === 'latest') {
      this.resume();
      return;
    }
    this.select(target.id, 'auto');
  }

  get currentMessageId(): string | undefined {
    return this.pinnedId ?? this.shortId ?? (this.following ? this.messages().at(-1)?.id : this.cursorId);
  }

  syncClearance(clearance: number): void {
    if (clearance === this.clearance) return;
    this.clearance = clearance;
    const root = this.viewport;
    if (root) this.followingViewport.scheduleState(root);
  }

  async contentChanged(entryCount: number, activeRunId: string | null | undefined): Promise<void> {
    await tick();
    if (!this.followingViewport.viewport) return;
    const entriesChanged = entryCount !== this.previousEntryCount;
    const runChanged = activeRunId && activeRunId !== this.previousActiveRunId;
    this.previousEntryCount = entryCount;
    this.previousActiveRunId = activeRunId;
    if ((runChanged || entriesChanged) && this.following) this.clearPinned();
  }

  dispose(): void {
    this.releaseInput();
    this.unwatchPress();
    this.inputRoot = undefined;
    this.window.dispose();
    this.followingViewport.dispose();
  }

  private scrolled(reader: boolean): void {
    this.readerMoved = reader;
    this.followingViewport.scrolled();
    this.readPosition();
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey || event.defaultPrevented) return;
    const root = this.inputRoot;
    if (!root) return;
    const delta = wheelDistance({ deltaY: event.deltaY, deltaMode: event.deltaMode, rootHeight: root.clientHeight });
    if (delta === 0) return;
    const starts = event.timeStamp - this.wheelAt >= WHEEL_PAUSE_MS;
    this.wheelAt = event.timeStamp;
    this.input(event.target, delta, starts);
  };

  private readonly onTouchStart = (event: TouchEvent): void => {
    this.touchY = event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
    this.refused = false;
    this.window.letGo();
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    const y = event.touches[0]?.clientY;
    const previous = this.touchY;
    this.touchY = y;
    if (y === undefined || previous === undefined) return;
    const delta = previous - y;
    if (delta === 0) return;
    this.input(event.target, delta, false);
  };

  private readonly onTouchEnd = (): void => {
    this.touchY = undefined;
  };

  private readonly onPointer = (event: PointerEvent): void => {
    if (event.target !== this.inputRoot || event.buttons !== 1) return;
    this.press();
    this.input(event.target, 0, true);
  };

  private press(): void {
    this.followingViewport.hold('press');
    if (this.pressing) return;
    this.pressing = true;
    window.addEventListener('pointerup', this.onRelease, true);
    window.addEventListener('pointercancel', this.onRelease, true);
    window.addEventListener('blur', this.onRelease);
  }

  private readonly onRelease = (): void => {
    this.unwatchPress();
    this.release('press');
  };

  private unwatchPress(): void {
    if (!this.pressing) return;
    this.pressing = false;
    window.removeEventListener('pointerup', this.onRelease, true);
    window.removeEventListener('pointercancel', this.onRelease, true);
    window.removeEventListener('blur', this.onRelease);
  }

  private release(hold: Hold): void {
    this.followingViewport.release(hold);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!SCROLL_KEYS.has(event.key)) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, button'))) return;
    const upward = event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home' || (event.key === ' ' && event.shiftKey);
    this.input(target, upward ? -1 : 1, !event.repeat);
  };

  private readScroll(outcome: ScrollOutcome): void {
    if (outcome === 'reader-moved' || outcome === 'at-bottom') this.endGap = this.window.end - this.window.offset;
    if (outcome === 'reader-moved' || (outcome === 'at-bottom' && this.readerMoved)) this.clearPinned();
  }

  private input(target: EventTarget | null, delta: number, starts: boolean): void {
    const root = this.inputRoot;
    if (!root) return;
    const nested = target instanceof Element ? target.closest('[data-scrollable]') : null;
    if (nested instanceof HTMLElement && nested !== root) {
      const crosses = wheelCrossesOut({
        clientHeight: nested.clientHeight,
        scrollHeight: nested.scrollHeight,
        scrollTop: nested.scrollTop,
        delta,
      });
      if (!crosses) return;
    }
    this.window.letGo();
    this.heard(delta, starts);
  }

  private heard(delta: number, starts: boolean): void {
    if (starts) this.refused = false;
    this.followingViewport.gesture(delta);
    if (delta > 0 && this.following) this.clearPinned();
    if (this.inputRoot) this.followingViewport.scheduleState(this.inputRoot);
  }

  private askForOlder(root: HTMLElement): void {
    if (this.paging || this.refused) return;
    if (this.following) {
      if (!canScroll({ clientHeight: root.clientHeight, scrollHeight: root.scrollHeight, scrollTop: root.scrollTop }))
        this.page(this.fill, true);
      return;
    }
    if (this.window.head < HEAD_REACH_VIEWPORTS * root.clientHeight) this.page(this.head, false);
  }

  private page(request: Page | undefined, once: boolean): void {
    const asked = request?.();
    if (!asked) return;
    const token = ++this.request;
    this.paging = true;
    void asked.then(
      (loaded) => {
        if (token !== this.request) return;
        this.paging = false;
        if (!loaded || once) this.refused = true;
        const root = this.viewport;
        if (loaded && root) this.followingViewport.scheduleState(root);
      },
      () => {
        if (token !== this.request) return;
        this.paging = false;
        this.refused = true;
      },
    );
  }

  private releaseInput(): void {
    const root = this.inputRoot;
    if (!root) return;
    root.removeEventListener('wheel', this.onWheel);
    root.removeEventListener('touchstart', this.onTouchStart);
    root.removeEventListener('touchmove', this.onTouchMove);
    root.removeEventListener('touchend', this.onTouchEnd);
    root.removeEventListener('touchcancel', this.onTouchEnd);
    root.removeEventListener('pointerdown', this.onPointer);
    root.removeEventListener('keydown', this.onKeyDown);
  }

  private pin(id: string): void {
    this.pinnedId = id;
    this.cursorId = id;
  }

  private clearPinned(): void {
    this.pinnedId = undefined;
  }

  private readPosition(): void {
    const view: ReadingView = {
      scrollTop: this.window.offset,
      clientHeight: this.window.height,
      clearance: this.clearance,
      endGap: this.following ? 0 : this.endGap,
    };
    if (this.following) this.endGap = 0;
    this.readShort(view);
    if (this.following) return;
    const row = this.window.rowAt(readingLine(view));
    this.cursorId =
      row === undefined ? undefined : transcriptCursorMessageId({ messages: this.messages(), rowOf: (id) => this.window.rowOf(id), row });
  }

  private readShort(view: ReadingView): void {
    const pinned = this.pinnedId;
    if (pinned !== undefined) {
      const span = this.window.rowSpan(pinned);
      this.shortId = span !== undefined && span.landing > this.window.end + 1 ? pinned : undefined;
      return;
    }
    const short = this.shortId;
    if (short === undefined) return;
    const span = this.window.rowSpan(short);
    if (span === undefined || !inView(view, span)) this.shortId = undefined;
  }
}
