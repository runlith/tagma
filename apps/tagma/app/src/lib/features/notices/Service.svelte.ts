import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import type { Told } from '$lib/wire/told.js';
import { Refusal } from '$lib/wire/refusal.js';
import { Offer, offeredAct, type OfferPort } from './Offer.js';

export type Notice = {
  id: number;
  kind: 'refusal' | 'offer' | 'said' | 'error' | 'undo';
  title: string;
  body: string;
  told?: Told;
  lastAt: number;
  undo?: () => void;
  lifeMs?: number;
};

export type Fault = {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  stack: string | null;
  count: number;
  firstAt: number;
  lastAt: number;
};

const FAULTS_KEPT = 20;

const recordedByServer = (error: unknown): boolean => error instanceof Refusal && error.code === 'server-fault';
const placeGone = (error: unknown): boolean => error instanceof Refusal && error.code === 'no-checkout';
const NOTICES_KEPT = 20;

export class Notices extends Service<Notices>()('Notices', { tier: 'app' }) {
  static *make() {
    return new Notices(yield* Scope, yield* Offer.optional());
  }

  list = $state<Notice[]>([]);
  faults = $state<Fault[]>([]);
  private nextId = 1;

  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly watched = new Map<number, () => void>();

  constructor(
    private readonly scope: Scope,
    private readonly offer?: OfferPort,
  ) {
    super();
    scope.defer(() => {
      for (const timer of this.timers) clearTimeout(timer);
      this.timers.clear();
    });
  }

  refusal(error: unknown): void {
    if (recordedByServer(error)) return;
    const offered = error instanceof Refusal ? offeredAct(this.offer, error.code) : undefined;
    if (error instanceof Refusal && offered !== undefined) {
      const text = error.told.text;
      this.push({ kind: 'offer', title: error.code, body: text, told: { text, note: error.told.note, act: offered, details: [] } });
      return;
    }
    if (error instanceof Refusal && (error.gate || error.words !== undefined)) {
      this.push({ kind: 'refusal', title: error.code, body: error.reason, told: error.told });
      return;
    }
    if (error instanceof Refusal) this.fault('Server error', error.reason);
    else this.fault('Request failed', error instanceof Error ? error.message : String(error));
  }

  background(error: unknown): void {
    if (recordedByServer(error) || placeGone(error)) return;
    if (error instanceof Refusal) this.fault(error.code, error.reason);
    else this.fault('Request failed', error instanceof Error ? error.message : String(error));
  }

  thrown(place: string, error: unknown): void {
    if (error instanceof Error) this.fault(place, error.message, error.stack ?? null);
    else this.fault(place, String(error));
  }

  fault(title: string, body: string, stack: string | null = null): void {
    untrack(() => {
      const at = Date.now();
      const key = `${title}\n${body}`;
      const standing = this.faults.find((fault) => fault.key === key);
      if (standing !== undefined) {
        standing.count += 1;
        standing.lastAt = at;
        standing.stack = stack ?? standing.stack;
        return;
      }
      this.faults = [{ key, title, body, stack, count: 1, firstAt: at, lastAt: at }, ...this.faults].slice(0, FAULTS_KEPT);
    });
  }

  clearFaults(): void {
    this.faults = [];
  }

  error(title: string, body: string): number {
    return this.push({ kind: 'error', title, body });
  }

  said(text: string): number {
    return this.push({ kind: 'said', title: text, body: '' });
  }

  private push(next: Omit<Notice, 'id' | 'lastAt'>): number {
    return untrack(() => {
      const at = Date.now();
      const existing = this.list.find((notice) => notice.kind === next.kind && notice.title === next.title && notice.body === next.body);
      if (existing) {
        existing.lastAt = at;
        return existing.id;
      }
      const id = this.nextId++;
      this.list.push({ id, lastAt: at, ...next });
      const kept = this.list.filter((notice) => notice.kind !== 'undo');
      if (kept.length > NOTICES_KEPT) this.dismiss(kept[0]!.id);
      return id;
    });
  }

  private static readonly UNDO_LIMIT = 3;
  private static readonly UNDO_LIFETIME_MS = 8000;

  undoable(title: string, undo: () => void, within?: Scope): void {
    const life = within ?? this.scope;
    const id = this.nextId++;
    untrack(() => {
      this.list.push({ id, kind: 'undo', title, body: '', lastAt: Date.now(), undo, lifeMs: Notices.UNDO_LIFETIME_MS });
      const undos = this.list.filter((notice) => notice.kind === 'undo');
      if (undos.length > Notices.UNDO_LIMIT) {
        const oldest = undos[0];
        if (oldest) this.dismiss(oldest.id);
      }
    });
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.dismiss(id);
    }, Notices.UNDO_LIFETIME_MS);
    this.timers.add(timer);
    const expire = () => this.dismiss(id);
    this.watched.set(id, () => life.release(expire));
    life.defer(expire);
  }

  dismiss(id: number): void {
    this.list = untrack(() => this.list.filter((notice) => notice.id !== id));
    const unwatch = this.watched.get(id);
    if (unwatch === undefined) return;
    this.watched.delete(id);
    unwatch();
  }
}
