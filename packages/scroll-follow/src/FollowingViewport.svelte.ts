import {
  type AutoMark,
  applyOverflowAnchor,
  bottomDistance,
  BOTTOM_THRESHOLD,
  canScroll,
  createAutoMark,
  isAtBottom,
  isAutoMark,
  type OverflowAnchoring,
  readScrollState,
  type ScrollMetrics,
  type ScrollState,
  selectionInside,
} from './scrollFollow';

const AUTO_SCROLL_CLAIM_MS = 1_500;

export type ScrollOutcome = 'no-overflow' | 'at-bottom' | 'auto' | 'reader-moved';

export type Hold = 'press' | 'selection';

export type FollowingViewportOptions = {
  autoFollows(): boolean;
  bottomThreshold?: number;
  overflowAnchor?: OverflowAnchoring;
  movedByReader?(): boolean;
  onScroll?(outcome: ScrollOutcome): void;
  onMeasure?(root: HTMLElement): void;
};

export class FollowingViewport {
  private root = $state<HTMLElement | undefined>();
  private isFollowing = $state(true);
  private scrollState = $state<ScrollState>({ bottom: true, jump: false, overflow: false });
  private autoMark: AutoMark | undefined;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private stateFrame: number | undefined;
  private stateTarget: HTMLElement | undefined;
  private scrollFrame: number | undefined;
  private scrollForced = false;
  private readonly holds = new Set<Hold>();
  private previousTop = 0;
  private readerDirection = 0;
  private readonly autoFollows: () => boolean;
  private readonly bottomThreshold: number;
  private readonly overflowAnchor: OverflowAnchoring;
  private readonly movedByReader: () => boolean;
  private readonly report: ((outcome: ScrollOutcome) => void) | undefined;
  private readonly onMeasure: ((root: HTMLElement) => void) | undefined;
  private readonly onScroll = () => {
    const outcome = this.handleScroll();
    this.report?.(outcome);
  };
  private listening: HTMLElement | undefined;

  constructor(options: FollowingViewportOptions) {
    this.autoFollows = options.autoFollows;
    this.bottomThreshold = options.bottomThreshold ?? BOTTOM_THRESHOLD;
    this.overflowAnchor = options.overflowAnchor ?? 'dynamic';
    this.movedByReader = options.movedByReader ?? (() => true);
    this.report = options.onScroll;
    this.onMeasure = options.onMeasure;
  }

  get viewport(): HTMLElement | undefined {
    return this.root;
  }

  get following(): boolean {
    return this.isFollowing;
  }

  get state(): ScrollState {
    return this.scrollState;
  }

  get held(): boolean {
    return this.holds.size > 0;
  }

  attach(root: HTMLElement | undefined): void {
    this.root = root;
    if (root === this.listening) return;
    this.cancelScroll();
    this.previousTop = root?.scrollTop ?? 0;
    this.readerDirection = 0;
    this.listening?.removeEventListener('scroll', this.onScroll);
    this.listening = root;
    root?.addEventListener('scroll', this.onScroll, { passive: true });
  }

  syncAnchor(): void {
    const root = this.root;
    if (!root) return;
    applyOverflowAnchor(root, this.overflowAnchor, !this.isFollowing);
    this.scheduleState(root);
  }

  handleScroll(): ScrollOutcome {
    const root = this.root;
    if (!root) return 'no-overflow';

    const current = this.metrics(root);
    const movedUp = current.scrollTop < this.previousTop;
    this.previousTop = current.scrollTop;
    const reader = this.holds.size > 0 || this.movedByReader();
    this.scheduleState(root);
    if (!canScroll(current)) {
      this.isFollowing = true;
      return 'no-overflow';
    }
    if (this.isFollowing && isAutoMark(this.autoMark, current)) {
      if (bottomDistance(current) >= 2) this.scrollToBottom(false);
      return 'auto';
    }
    if (bottomDistance(current) < 1) {
      this.isFollowing = true;
      return 'at-bottom';
    }
    if (reader && (this.readerDirection < 0 || movedUp)) {
      this.pause();
      return 'reader-moved';
    }
    if (isAtBottom(current, this.bottomThreshold) && (this.isFollowing || reader)) {
      this.isFollowing = true;
      return 'at-bottom';
    }
    if (!reader) return 'auto';

    this.pause();
    return 'reader-moved';
  }

  scrollToBottom(force: boolean): void {
    if (force) this.isFollowing = true;
    if (!this.isFollowing) return;
    this.scrollForced ||= force;
    if (this.scrollFrame !== undefined) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = undefined;
      const forced = this.scrollForced;
      this.scrollForced = false;
      const root = this.root;
      if (!root) return;
      if (!this.isFollowing || this.holds.size > 0 || (!forced && !this.autoFollows())) return;
      if (bottomDistance(this.metrics(root)) < 2) {
        this.markAutoScroll(root);
        this.previousTop = root.scrollTop;
        this.scheduleState(root);
        return;
      }
      this.markAutoScroll(root);
      root.scrollTop = root.scrollHeight;
      this.previousTop = root.scrollTop;
      this.scheduleState(root);
    });
  }

  resume(): void {
    this.follow();
    this.scrollToBottom(true);
    if (this.root) this.scheduleState(this.root);
  }

  pause(): void {
    this.cancelScroll();
    const root = this.root;
    if (!root) return;
    if (!canScroll(this.metrics(root))) {
      this.isFollowing = true;
      return;
    }
    this.isFollowing = false;
  }

  follow(): void {
    this.cancelScroll();
    this.holds.clear();
    this.readerDirection = 0;
    this.isFollowing = true;
  }

  gesture(delta: number): void {
    this.readerDirection = Math.sign(delta);
    if (delta < 0) this.pause();
    else if (delta > 0 && this.root && isAtBottom(this.metrics(this.root), this.bottomThreshold)) this.isFollowing = true;
  }

  hold(reason: Hold): void {
    this.cancelScroll();
    this.holds.add(reason);
  }

  release(reason: Hold): void {
    if (!this.holds.delete(reason) || this.holds.size > 0) return;
    this.scrollToBottom(false);
  }

  resized(): void {
    const root = this.root;
    if (!root) return;
    if (!this.isFollowing && this.holds.size === 0) {
      const current = this.metrics(root);
      if (!canScroll(current) || bottomDistance(current) < 1) this.isFollowing = true;
    }
    this.scheduleState(root);
  }

  syncSelection(selection: Selection | null, content: HTMLElement): void {
    if (selectionInside(selection, content)) this.hold('selection');
    else this.release('selection');
  }

  scheduleState(element: HTMLElement): void {
    this.stateTarget = element;
    if (this.stateFrame !== undefined) return;
    this.stateFrame = requestAnimationFrame(() => {
      this.stateFrame = undefined;
      const target = this.stateTarget;
      this.stateTarget = undefined;
      if (!target) return;
      this.scrollState = readScrollState(this.metrics(target));
      this.onMeasure?.(target);
    });
  }

  dispose(): void {
    this.listening?.removeEventListener('scroll', this.onScroll);
    this.listening = undefined;
    this.cancelScroll();
    if (this.stateFrame !== undefined) cancelAnimationFrame(this.stateFrame);
    if (this.autoTimer) clearTimeout(this.autoTimer);
  }

  private cancelScroll(): void {
    if (this.scrollFrame !== undefined) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = undefined;
    this.scrollForced = false;
    this.autoMark = undefined;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = undefined;
  }

  private metrics(element: HTMLElement): ScrollMetrics {
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  }

  private markAutoScroll(element: HTMLElement): void {
    this.autoMark = createAutoMark(this.metrics(element));
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      this.autoMark = undefined;
      this.autoTimer = undefined;
    }, AUTO_SCROLL_CLAIM_MS);
  }
}
