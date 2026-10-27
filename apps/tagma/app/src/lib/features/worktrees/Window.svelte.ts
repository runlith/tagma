import type { WorktreeRow, WorktreeWindow as Range } from '@tagma/server/worktrees/contract/wire/rows';
import type { Failure } from '@runlith/layer/Failure';
import type { Attachment } from 'svelte/attachments';
import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { LiveConnection } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';
import type { Worktrees } from './BoardState.svelte.js';

type Held = { readonly unsubscribe: () => void };

export class WorktreeWindow {
  private rows = $state.raw<ReadonlyMap<string, WorktreeRow>>(new Map());
  private readonly visible = new SvelteMap<HTMLElement, string>();
  private readonly elements = new Map<HTMLElement, string>();
  private readonly attachments = new Map<string, Attachment<HTMLElement>>();
  private readonly held = new Map<string, Held>();
  private observer: IntersectionObserver | null = null;
  unread = $state<string | null>(null);

  constructor(
    private readonly places: Worktrees,
    private readonly live: LiveConnection,
    private readonly failure: Failure,
  ) {
    $effect(() => {
      const indices = [...new Set(this.visible.values())]
        .flatMap((rootId) => {
          const place = this.places.byRoot(rootId);
          return place === null ? [] : [place.index];
        })
        .sort((left, right) => left - right);
      untrack(() => this.follow(indices));
    });
    $effect(() => () => this.close());
  }

  rowOf(rootId: string): WorktreeRow | null {
    return this.rows.get(rootId) ?? null;
  }

  observe(rootId: string): Attachment<HTMLElement> {
    const held = this.attachments.get(rootId);
    if (held !== undefined) return held;
    const attach: Attachment<HTMLElement> = (element) => {
      this.observer ??= new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const root = this.elements.get(target);
          if (root === undefined) continue;
          if (entry.isIntersecting) this.visible.set(target, root);
          else this.visible.delete(target);
        }
      });
      this.elements.set(element, rootId);
      this.observer.observe(element);
      return () => {
        this.observer?.unobserve(element);
        this.elements.delete(element);
        this.visible.delete(element);
        if (![...this.elements.values()].includes(rootId)) this.attachments.delete(rootId);
      };
    };
    this.attachments.set(rootId, attach);
    return attach;
  }

  private follow(indices: readonly number[]): void {
    const ranges: Range[] = [];
    for (const index of indices) {
      const last = ranges.at(-1);
      if (last !== undefined && last.start + last.limit === index) ranges[ranges.length - 1] = { start: last.start, limit: last.limit + 1 };
      else ranges.push({ start: index, limit: 1 });
    }
    const wanted = new Set(ranges.map((range) => `${range.start}:${range.limit}`));
    for (const [key, held] of this.held) {
      if (wanted.has(key)) continue;
      held.unsubscribe();
      this.held.delete(key);
    }
    this.rows = new Map([...this.rows].filter(([rootId]) => this.places.byRoot(rootId) !== null));
    for (const range of ranges) {
      const key = `${range.start}:${range.limit}`;
      if (this.held.has(key)) continue;
      let active = true;
      const held = this.live.hold(
        (client) => client['worktrees.subscribe']({ projectId: this.places.aim.projectId, ...range }),
        (frame) => {
          if (!active) return;
          const visible = new Set(this.visible.values());
          if (frame.kind === 'list') {
            const next = new Map(this.rows);
            for (const row of frame.rows) if (visible.has(row.rootId)) next.set(row.rootId, row);
            this.rows = next;
          } else if (frame.kind === 'row' && visible.has(frame.row.rootId)) this.rows = new Map(this.rows).set(frame.row.rootId, frame.row);
          else return;
          this.unread = null;
        },
        (reason) => {
          if (!active || reason.kind !== 'subscription') return;
          if (reason.code === undefined) this.failure.report(new Error(reason.message));
          this.unread = refusalOf({ code: reason.code ?? 'http', reason: reason.message, unblock: reason.unblock ?? [] }).reason;
        },
      );
      this.held.set(key, {
        unsubscribe: () => {
          active = false;
          held.unsubscribe();
        },
      });
    }
  }

  private close(): void {
    this.observer?.disconnect();
    for (const held of this.held.values()) held.unsubscribe();
    this.held.clear();
    this.elements.clear();
    this.attachments.clear();
  }
}
