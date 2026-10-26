import { Service } from '@runlith/layer/key';
import { type Placement, SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import type { TabLayouts, TabOpen } from '$lib/app/panes/TabLayouts.svelte.js';
import type { PlacesPort } from '$lib/app/panes/ThreadPlaces.js';
import { Claims, KeyedClaims } from '$lib/shared/Claims.svelte.js';
import type { PaneContent, PaneOpening } from '$lib/shared/panes/pane.js';
import type { Topic } from '$lib/shared/threads/Topics.svelte.js';
import { threadHolder } from '$lib/shared/panes/holder.js';
import type { ScreenThreads } from '../OnScreen.svelte.js';
import type { SlotWriter } from '../SlotSelection.svelte.js';
import type { ThreadSlot } from '../ThreadSlot.svelte.js';
import { type PaneThread, paneThread, threadOf, threadPaneId, THREAD_PANE } from './pane.js';

export type ThreadOpening = PaneOpening | { readonly kind: 'main' };

export type ThreadStanding = { readonly kind: 'main' } | { readonly kind: 'beside'; readonly key: string } | { readonly kind: 'free' };

export class ThreadSeats extends Service<ThreadSeats>()('ThreadSeats', { tier: 'app' }) implements ScreenThreads, PlacesPort {
  static *make() {
    return new ThreadSeats(yield* SidePanes);
  }

  private readonly mains = new Claims<ThreadSlot>();

  private readonly seats = new KeyedClaims<string, ThreadSlot>();

  private readonly topics = new Map<string, Topic>();

  constructor(private readonly panes: SidePanes) {
    super();
  }

  get page(): ThreadSlot | null {
    return this.mains.current;
  }

  seatMain(slot: ThreadSlot): () => void {
    const own = this.mains.take(slot);
    const seated = this.panes.seatMain(slot);
    return () => {
      seated();
      own();
    };
  }

  get host(): ThreadSlot | null {
    const worked = this.panes.trail.findLast((key) => this.seats.has(key));
    return (worked === undefined ? undefined : this.seats.get(worked)) ?? this.page;
  }

  get shown(): readonly ThreadSlot[] {
    const active = this.panes.layout.active;
    const beside = active === null || !this.panes.showing ? undefined : this.seats.get(active);
    return [this.page, beside ?? null].filter((host): host is ThreadSlot => host !== null);
  }

  get mainFocused(): boolean {
    const key = this.panes.focus;
    return key === null || !this.seats.has(key);
  }

  activation(host: ThreadSlot): number {
    if (host === this.page) return this.panes.activation(null);
    for (const [key, seated] of this.seats.entries()) if (seated === host) return this.panes.activation(key);
    return 0;
  }

  seat(key: string, host: ThreadSlot): () => void {
    return this.seats.take(key, host);
  }

  writerOf(key: string): SlotWriter {
    return { navigate: (thread) => this.settle(key, thread), open: (thread) => this.openFrom(key, thread) };
  }

  open(thread: PaneThread): ThreadOpening {
    const revealed = thread.threadId === null ? null : this.revealing(thread.threadId);
    return revealed ?? this.panes.open({ kind: THREAD_PANE, id: threadPaneId(thread) });
  }

  reveal(thread: string): boolean {
    return this.revealing(thread) !== null;
  }

  standing(thread: string): ThreadStanding {
    if (this.panes.main?.activeId === thread) return { kind: 'main' };
    const tab = this.panes.panes.find((pane) => threadOf(pane) === thread);
    return tab === undefined ? { kind: 'free' } : { kind: 'beside', key: tab.key };
  }

  private revealing(thread: string): ThreadOpening | null {
    const standing = this.standing(thread);
    if (standing.kind === 'free') return null;
    if (standing.kind === 'main') {
      this.panes.activate(null);
      return { kind: 'main' };
    }
    this.panes.activate(standing.key);
    return { kind: 'revealed', key: standing.key };
  }

  ask(topic: Topic): void {
    const opening = this.panes.open({ kind: THREAD_PANE, id: null });
    if (opening.kind === 'opened') this.topics.set(opening.key, topic);
  }

  take(key: string): Topic | null {
    const topic = this.topics.get(key) ?? null;
    this.topics.delete(key);
    return topic;
  }

  place(layouts: TabLayouts, thread: string, content: PaneContent): Placement {
    const shown = this.panes.layouts;
    const holder = this.panes.holder;
    const reaches = shown !== null && (shown.projectId === layouts.projectId || this.panes.kinds.find(content.kind)?.portable === true);
    return reaches && holder !== null && this.onScreen(thread) ? { layouts: shown, holder } : { layouts, holder: threadHolder(thread) };
  }

  openFor(layouts: TabLayouts, thread: string, content: PaneContent, how: TabOpen = {}): PaneOpening {
    return this.panes.openAt(this.place(layouts, thread, content), content, how);
  }

  private onScreen(thread: string): boolean {
    return this.panes.main?.activeId === thread || this.panes.panes.some((tab) => threadOf(tab) === thread);
  }

  private openFrom(key: string, thread: string): void {
    if (this.reveal(thread)) return;
    this.settle(key, thread);
    this.panes.activate(key);
  }

  private settle(key: string, thread: string | null): void {
    const pane = this.panes.panes.find((standing) => standing.key === key);
    if (pane === undefined || pane.kind !== THREAD_PANE) return;
    this.panes.point(key, threadPaneId({ home: paneThread(pane.id).home, threadId: thread }));
  }
}
