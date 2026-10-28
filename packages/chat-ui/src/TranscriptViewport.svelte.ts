import { canScroll, type ScrollState, wheelCrossesOut, wheelDistance } from '@runlith/scroll-follow/scrollFollow';
import { FollowingViewport, type Hold, type ScrollOutcome } from '@runlith/scroll-follow/FollowingViewport.svelte';
import { tick } from 'svelte';
import type { FeedMemory } from './FeedMemory';
import { inView, type ReadingView, readingLine, transcriptCursorMessageId } from './transcriptCursor';
import { TRANSCRIPT_END_THRESHOLD_PX, TranscriptVirtualizer } from './TranscriptVirtualizer.svelte';
import { messageOffsetTarget } from './transcriptMessageNavigation';

const HEAD_REACH_PX = 200;
const GESTURE_WINDOW_MS = 250;
const SCROLL_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export class TranscriptViewport {
  private cursorId = $state<string | undefined>();
  private pinnedId = $state<string | undefined>();
  private shortId = $state<string | undefined>();
  private endGap = 0;
  private messages: () => readonly { readonly id: string }[] = () => [];
  private head: (() => boolean) | undefined;
  private fill: (() => boolean) | undefined;
  private scrolled: (() => void) | undefined;
  private gestured: (() => void) | undefined;
  private landed: ((entryId: string) => void) | undefined;
  private clearance = 0;
  private gestureAt = Number.NEGATIVE_INFINITY;
  private inputAt = Number.NEGATIVE_INFINITY;
  private historyRequested = false;
  private historyDirection = 0;
  private gestureRoot: HTMLElement | undefined;
  private pressing = false;
  private previousEntryCount = 0;
  private previousActiveRunId: string | null | undefined;
  private previousWorking = false;
  private threadKey: string | null = null;
  readonly window: TranscriptVirtualizer;
  private readonly followingViewport = new FollowingViewport({
    autoFollows: () => true,
    bottomThreshold: TRANSCRIPT_END_THRESHOLD_PX,
    overflowAnchor: 'none',
    movedByReader: () => this.gesturing,
    onScroll: (outcome) => this.readScroll(outcome),
    onMeasure: (root) => {
      this.readPosition(root);
      this.scrolled?.();
      this.askForOlder(root);
    },
  });

  constructor(memory: FeedMemory) {
    this.window = new TranscriptVirtualizer(memory, { gesturing: () => this.gesturing });
  }

  openThread(key: string | null): void {
    if (key === this.threadKey) return;
    this.threadKey = key;
    this.window.openThread(key);
    this.cursorId = undefined;
    this.pinnedId = undefined;
    this.shortId = undefined;
    this.endGap = 0;
    this.gestureAt = Number.NEGATIVE_INFINITY;
    this.inputAt = Number.NEGATIVE_INFINITY;
    this.historyRequested = false;
    this.historyDirection = 0;
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
    return this.followingViewport.following && !this.followingViewport.held;
  }

  get state(): ScrollState {
    return this.followingViewport.state;
  }

  get gesturing(): boolean {
    return Date.now() - this.gestureAt < GESTURE_WINDOW_MS;
  }

  attach(root: HTMLElement | undefined): void {
    this.followingViewport.attach(root);
    if (root === this.gestureRoot) return;
    this.releaseGestures();
    this.gestureRoot = root;
    if (!root) return;
    root.addEventListener('wheel', this.onWheel, { passive: true });
    root.addEventListener('touchstart', this.onTouchStart, { passive: true });
    root.addEventListener('touchmove', this.onTouchMove, { passive: true });
    root.addEventListener('touchend', this.onTouchEnd, { passive: true });
    root.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
    root.addEventListener('pointerdown', this.onPointer, { passive: true });
    root.addEventListener('pointermove', this.onPointer, { passive: true });
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
    if (this.anchored) this.window.anchorEnd();
  }

  resume(): void {
    this.clearPinned();
    this.shortId = undefined;
    this.endGap = 0;
    this.cursorId = undefined;
    this.followingViewport.resume();
    this.window.anchorEnd();
  }

  pause(): void {
    this.followingViewport.pause();
  }

  scrollBy(delta: number, starts?: boolean): void {
    const root = this.viewport;
    if (!root || delta === 0) return;
    this.markGesture(root, delta, starts);
    root.scrollTop += delta;
  }

  resized(): void {
    this.followingViewport.resized();
  }

  syncSelection(selection: Selection | null, content: HTMLElement): void {
    const held = this.followingViewport.held;
    this.followingViewport.syncSelection(selection, content);
    if (held && !this.followingViewport.held) this.scrollToBottom(false);
  }

  useMessages(read: () => readonly { readonly id: string }[]): void {
    this.messages = read;
  }

  useHead(reach: () => boolean): void {
    this.head = reach;
  }

  useFill(fill: () => boolean): void {
    this.fill = fill;
  }

  private askForOlder(root: HTMLElement): void {
    if (this.historyRequested || this.historyDirection > 0) return;
    const metrics = { clientHeight: root.clientHeight, scrollHeight: root.scrollHeight, scrollTop: root.scrollTop };
    if (this.following) {
      if (!canScroll(metrics)) this.historyRequested = this.fill?.() ?? false;
      return;
    }
    if (this.gesturing && metrics.scrollTop < HEAD_REACH_PX) this.historyRequested = this.head?.() ?? false;
  }

  useScrolled(read: () => void): void {
    this.scrolled = read;
  }

  useGesture(moved: () => void): void {
    this.gestured = moved;
  }

  useContent(landed: (entryId: string) => void): void {
    this.landed = landed;
  }

  contentRendered(entryId: string): void {
    this.landed?.(entryId);
  }

  select(id: string, behavior: ScrollBehavior = 'smooth'): void {
    const root = this.followingViewport.viewport;
    if (!root || !this.window.holds(id)) return;
    this.gestureAt = Number.NEGATIVE_INFINITY;
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
    return this.pinnedId ?? this.shortId ?? this.cursorId;
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
    if ((runChanged || entriesChanged) && this.following) {
      this.clearPinned();
      this.scrollToBottom(true);
      return;
    }
    if (this.following) this.followingViewport.scrollToBottom(false);
  }

  dispose(): void {
    this.releaseGestures();
    this.unwatchPress();
    this.gestureRoot = undefined;
    this.window.dispose();
    this.followingViewport.dispose();
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey || event.defaultPrevented) return;
    const root = this.gestureRoot;
    if (!root) return;
    const delta = wheelDistance({ deltaY: event.deltaY, deltaMode: event.deltaMode, rootHeight: root.clientHeight });
    if (delta === 0) return;
    this.markGesture(event.target, delta);
  };

  private touchY: number | undefined;

  private readonly onTouchStart = (event: TouchEvent): void => {
    this.touchY = event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
    if (this.touchY !== undefined) this.inputAt = Number.NEGATIVE_INFINITY;
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    const y = event.touches[0]?.clientY;
    const previous = this.touchY;
    this.touchY = y;
    if (y === undefined || previous === undefined) return;
    const delta = previous - y;
    if (delta === 0) return;
    this.markGesture(event.target, delta, this.inputAt === Number.NEGATIVE_INFINITY);
  };

  private readonly onTouchEnd = (): void => {
    this.touchY = undefined;
  };

  private readonly onPointer = (event: PointerEvent): void => {
    if (event.target !== this.gestureRoot || event.buttons !== 1) return;
    if (event.type === 'pointerdown') this.press();
    this.markGesture(event.target, 0, event.type === 'pointerdown');
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
    if (!this.followingViewport.held) this.scrollToBottom(false);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!SCROLL_KEYS.has(event.key)) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, button'))) return;
    const upward = event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home' || (event.key === ' ' && event.shiftKey);
    this.markGesture(target, upward ? -1 : 1, !event.repeat);
  };

  private readScroll(outcome: ScrollOutcome): void {
    const root = this.viewport;
    if (root && (outcome === 'reader-moved' || outcome === 'at-bottom')) {
      this.endGap = Math.max(0, root.scrollHeight - root.clientHeight - root.scrollTop);
    }
    if (outcome === 'reader-moved' && this.gesturing) this.gestureAt = Date.now();
    if (outcome === 'reader-moved' || (outcome === 'at-bottom' && this.gesturing)) this.clearPinned();
  }

  private markGesture(target: EventTarget | null, delta: number, starts?: boolean): void {
    const root = this.gestureRoot;
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
    const now = Date.now();
    if (starts ?? now - this.inputAt >= GESTURE_WINDOW_MS) this.historyRequested = false;
    this.inputAt = now;
    this.gestureAt = now;
    this.historyDirection = Math.sign(delta);
    this.window.letGo();
    this.followingViewport.gesture(delta);
    if (delta > 0 && this.following) this.clearPinned();
    this.gestured?.();
    this.followingViewport.scheduleState(root);
  }

  private releaseGestures(): void {
    const root = this.gestureRoot;
    if (!root) return;
    root.removeEventListener('wheel', this.onWheel);
    root.removeEventListener('touchstart', this.onTouchStart);
    root.removeEventListener('touchmove', this.onTouchMove);
    root.removeEventListener('touchend', this.onTouchEnd);
    root.removeEventListener('touchcancel', this.onTouchEnd);
    root.removeEventListener('pointerdown', this.onPointer);
    root.removeEventListener('pointermove', this.onPointer);
    root.removeEventListener('keydown', this.onKeyDown);
  }

  private pin(id: string): void {
    this.pinnedId = id;
    this.cursorId = id;
  }

  private clearPinned(): void {
    this.pinnedId = undefined;
  }

  private readPosition(root: HTMLElement): void {
    if (this.following) this.endGap = 0;
    const view: ReadingView = {
      scrollTop: root.scrollTop,
      clientHeight: root.clientHeight,
      clearance: this.clearance,
      endGap: this.endGap,
    };
    this.readShort(root, view);
    const row = this.window.rowAt(readingLine(view));
    this.cursorId =
      row === undefined ? undefined : transcriptCursorMessageId({ messages: this.messages(), rowOf: (id) => this.window.rowOf(id), row });
  }

  private readShort(root: HTMLElement, view: ReadingView): void {
    const pinned = this.pinnedId;
    if (pinned !== undefined) {
      const span = this.window.rowSpan(pinned);
      this.shortId = span !== undefined && span.landing > root.scrollHeight - root.clientHeight + 1 ? pinned : undefined;
      return;
    }
    const short = this.shortId;
    if (short === undefined) return;
    const span = this.window.rowSpan(short);
    if (span === undefined || !inView(view, span)) this.shortId = undefined;
  }
}
