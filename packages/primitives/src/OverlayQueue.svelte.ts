import { untrack } from 'svelte';

import { Clock } from '@runlith/layer/clock';
import type { Fact } from '@runlith/layer/condition';
import type { Scope } from '@runlith/layer/Scope';

import { createOverlaySignals, type OverlaySignals } from './overlay-signals.js';
import { relate, type OverlayMatcher, type OverlaySpec } from './overlay-policy.js';
import { EMPTY_PLAN_HISTORY, plan, type PlanEntry, type PlanHistory, type OverlayState } from './overlay-plan.js';
import type { OverlayHandle } from './types.js';

export type Materialized = {
  readonly close: (result?: unknown) => void;
  readonly presented: Promise<void>;
  readonly closed: Promise<unknown>;
  readonly update?: (props: Record<string, unknown>) => void;
  readonly reopen?: () => boolean;
  readonly apply?: (options: Record<string, unknown>) => void;
};

export type FactReport = {
  readonly name: string;
  readonly current: boolean;
  readonly holdsUntilMs: number | undefined;
};

export type OverlayEntryReport = {
  readonly id: string;
  readonly as: string;
  readonly state: OverlayState;
  readonly arbitrated: boolean;
  readonly priority: number;
  readonly order: number;
  readonly preloading: boolean;
  readonly blockedBy: readonly FactReport[];
  readonly heldBy: readonly FactReport[];
};

export type OverlayReport = {
  readonly overlays: readonly OverlayEntryReport[];
};

export type OverlayRequest = {
  readonly spec: OverlaySpec;
  readonly prepare?: () => Promise<void>;
  readonly materialize: () => Materialized;
  readonly refresh?: (live: Materialized) => boolean;
};

type Entry = {
  spec: OverlaySpec;
  state: OverlayState;
  order: number;
  prepare?: () => Promise<void>;
  materialize: () => Materialized;
  refresh?: (live: Materialized) => boolean;
  prepared: boolean;
  preloading: boolean;
  readonly signals: OverlaySignals<unknown>;
  readonly handle: OverlayHandle;
  live?: Materialized;
  disposition?: 'dismiss' | 'suspend';
};

export class OverlayQueue {
  private readonly entries = new Map<string, Entry>();
  private revision = $state(0);
  private presence = $state(0);
  private readonly reading = new Map<Fact, boolean>();
  private readonly lastReading = new Map<Fact, boolean>();
  private history: PlanHistory = EMPTY_PLAN_HISTORY;
  private order = 0;
  private passing = false;
  private again = false;
  private sweeping = false;
  private wakeAtMs: number | undefined;
  private cancelWake: (() => void) | undefined;

  constructor(
    private readonly scope: Scope,
    private readonly onFailure?: (reason: unknown) => void,
  ) {}

  private reportFailure(reason: unknown): void {
    if (this.onFailure) {
      this.onFailure(reason);
      return;
    }
    queueMicrotask(() => {
      throw reason;
    });
  }

  observe(): void {
    void this.revision;
    for (const entry of this.entries.values()) {
      for (const fact of entry.spec.blockedBy) void fact.current;
      for (const fact of entry.spec.heldBy) void fact.current;
      for (const matchers of [entry.spec.suspends, entry.spec.yieldsTo, entry.spec.allowCoexistWith, entry.spec.disallowCoexistWith]) {
        for (const matcher of matchers as readonly OverlayMatcher[]) void matcher.when?.current;
      }
    }
  }

  get onScreen(): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.spec.arbitrated && entry.state !== 'queued') keys.add(entry.spec.id);
    }
    return keys;
  }

  showing(id: string): boolean {
    void this.presence;
    const state = this.entries.get(id)?.state;
    return state !== undefined && state !== 'queued';
  }

  report(): OverlayReport {
    const asReport = (fact: Fact): FactReport => ({
      name: fact.name,
      current: fact.current,
      holdsUntilMs: fact.holdsUntilMs,
    });

    return {
      overlays: [...this.entries.values()].map((entry) => ({
        id: entry.spec.id,
        as: entry.spec.as,
        state: entry.state,
        arbitrated: entry.spec.arbitrated,
        priority: entry.spec.priority,
        order: entry.order,
        preloading: entry.preloading,
        blockedBy: entry.spec.blockedBy.map(asReport),
        heldBy: entry.spec.heldBy.map(asReport),
      })),
    };
  }

  stateOf(id: string): OverlayState | undefined {
    void this.presence;
    return this.entries.get(id)?.state;
  }

  peekState(id: string): OverlayState | undefined {
    return this.entries.get(id)?.state;
  }

  open(request: OverlayRequest): OverlayHandle {
    return untrack(() => this.enqueue(request));
  }

  private enqueue(request: OverlayRequest): OverlayHandle {
    const existing = this.entries.get(request.spec.id);
    if (existing) return this.reopen(existing, request);

    const signals = createOverlaySignals<unknown>();
    const entry: Entry = {
      spec: request.spec,
      state: 'queued',
      order: this.nextOrder(),
      prepare: request.prepare,
      materialize: request.materialize,
      refresh: request.refresh,
      prepared: request.prepare === undefined,
      preloading: false,
      signals,
      handle: {
        presented: signals.presented,
        closed: signals.closed,
        close: (result?: unknown) => this.close(request.spec.id, result),
      },
    };

    this.entries.set(entry.spec.id, entry);
    this.revision += 1;
    this.presence += 1;
    this.outsideChanged();

    if (!entry.spec.arbitrated) {
      if (this.ready(entry)) this.raise(entry);
      return entry.handle;
    }

    this.pass();
    return entry.handle;
  }

  close(id: string, result?: unknown): void {
    untrack(() => this.end(id, result));
  }

  private endChildren(id: string): void {
    for (const child of [...this.entries.values()]) {
      if (child.spec.within === id) this.end(child.spec.id);
    }
  }

  private end(id: string, result?: unknown): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    this.endChildren(id);

    if (entry.state === 'queued' || entry.state === 'suspended') {
      this.forget(entry);
      entry.signals.end(result);
      this.pass();
      return;
    }

    entry.disposition = 'dismiss';
    if (entry.state === 'closing') return;

    this.setState(entry, 'closing');
    entry.live?.close(result);
  }

  closeAll(): void {
    untrack(() => {
      this.sweeping = true;
      try {
        for (const entry of [...this.entries.values()]) this.end(entry.spec.id);
      } finally {
        this.sweeping = false;
      }
      this.pass();
    });
  }

  pass(): void {
    untrack(() => {
      if (this.sweeping) return;
      if (this.passing) {
        this.again = true;
        return;
      }

      this.passing = true;
      try {
        do {
          this.again = false;
          this.runPlan();
        } while (this.again);
      } finally {
        this.passing = false;
      }
    });
  }

  private runPlan(): void {
    this.reading.clear();

    const snapshot: PlanEntry[] = [...this.entries.values()].map((entry) => ({
      spec: entry.spec,
      state: entry.state,
      order: entry.order,
      ready: entry.prepared,
      preloading: entry.preloading,
    }));

    const result = plan(snapshot, this.readFact, this.history, Clock.now());
    this.history = result.history;
    if (result.wakeAtMs !== undefined) this.wakeAt(result.wakeAtMs);

    for (const command of result.commands) {
      const entry = this.entries.get(command.id);
      if (!entry) continue;

      if (command.kind === 'suspend') this.suspend(entry);
      else if (command.kind === 'prepare') void this.ready(entry);
      else this.activate(entry);

      if (this.again) return;
    }
  }

  private reopen(entry: Entry, request: OverlayRequest): OverlayHandle {
    entry.spec = request.spec;
    entry.materialize = request.materialize;
    entry.refresh = request.refresh;
    entry.prepare = request.prepare;
    this.revision += 1;
    this.outsideChanged();

    this.reading.clear();

    if (entry.state === 'active') {
      if (this.raised(entry.spec.blockedBy)) {
        this.armCooldown(entry);
        this.suspend(entry);
      } else if (entry.live) {
        if (entry.refresh?.(entry.live) === false) {
          entry.live = undefined;
          this.activate(entry);
        }
      }
    } else if (this.raised(entry.spec.blockedBy)) {
      this.armCooldown(entry);
    }

    if (entry.state === 'closing' && entry.disposition === 'dismiss') entry.disposition = 'suspend';

    this.pass();
    return entry.handle;
  }

  private ready(entry: Entry): boolean {
    if (entry.prepared) return true;
    if (entry.preloading) return false;

    entry.preloading = true;
    let started: Promise<void>;
    try {
      started = entry.prepare?.() ?? Promise.resolve();
    } catch (error) {
      entry.preloading = false;
      this.fail(entry, error);
      return false;
    }

    void started.then(
      () => {
        entry.preloading = false;
        entry.prepared = true;
        this.advance(entry);
      },
      (error: unknown) => {
        entry.preloading = false;
        this.fail(entry, error);
      },
    );

    return false;
  }

  private advance(entry: Entry): void {
    if (entry.spec.arbitrated) {
      this.pass();
      return;
    }

    if (this.entries.get(entry.spec.id) === entry && entry.state === 'queued') this.raise(entry);
  }

  private raise(entry: Entry): void {
    this.reading.clear();
    for (const occupant of this.entries.values()) {
      if (occupant === entry || occupant.state !== 'active' || !occupant.spec.arbitrated) continue;
      if (relate(entry.spec, occupant.spec, this.readFact) === 'coexist') continue;
      this.suspend(occupant);
    }

    this.activate(entry);
  }

  private activate(entry: Entry): void {
    this.setState(entry, 'active');
    entry.disposition = undefined;

    const live = entry.materialize();
    entry.live = live;

    void live.presented.then(
      () => {
        if (entry.live === live) entry.signals.present();
      },
      () => undefined,
    );

    void live.closed.then((result) => this.finish(entry, live, result));
  }

  private finish(entry: Entry, live: Materialized, result: unknown): void {
    if (this.entries.get(entry.spec.id) !== entry) return;
    if (entry.live !== live) return;
    entry.live = undefined;

    if (entry.disposition === 'suspend') {
      entry.disposition = undefined;
      if (!entry.spec.arbitrated) {
        this.setState(entry, 'queued');
        this.advance(entry);
        this.pass();
        return;
      }

      this.setState(entry, 'suspended');
      this.pass();
      return;
    }

    this.forget(entry);
    entry.signals.end(result);
    this.pass();
  }

  private fail(entry: Entry, reason: unknown): void {
    this.forget(entry);
    entry.signals.fail(reason);
    this.reportFailure(reason);
    this.pass();
  }

  private suspend(entry: Entry): void {
    this.endChildren(entry.spec.id);

    entry.disposition = 'suspend';
    if (entry.state === 'closing') return;

    if (entry.state !== 'active') {
      this.setState(entry, 'suspended');
      return;
    }

    this.setState(entry, 'closing');
    entry.live?.close();
  }

  private forget(entry: Entry): void {
    if (this.entries.get(entry.spec.id) !== entry) return;
    this.entries.delete(entry.spec.id);
    this.revision += 1;
    this.presence += 1;
    this.outsideChanged();
    if (this.history.promotingId === entry.spec.id) {
      this.history = { ...this.history, promotingId: undefined };
    }
  }

  private outsideChanged(): void {
    if (this.history.steppedAside.size === 0) return;
    this.history = { ...this.history, steppedAside: new Set() };
  }

  private raised(facts: readonly Fact[]): boolean {
    return facts.some((fact) => this.readFact(fact));
  }

  private readonly readFact = (fact: Fact): boolean => {
    const seen = this.reading.get(fact);
    if (seen !== undefined) return seen;

    const value = fact.current;
    this.reading.set(fact, value);
    if (this.lastReading.get(fact) !== value) {
      if (this.lastReading.has(fact)) this.outsideChanged();
      this.lastReading.set(fact, value);
    }

    const holdsUntilMs = fact.holdsUntilMs;
    if (holdsUntilMs !== undefined) this.wakeAt(holdsUntilMs);

    return value;
  };

  private armCooldown(entry: Entry): void {
    if (entry.spec.unblockDelayMs <= 0) return;
    const cooling = new Map(this.history.cooling);
    cooling.set(entry.spec.id, { readyAtMs: undefined });
    this.history = { ...this.history, cooling };
  }

  private wakeAt(timestampMs: number): void {
    if (this.wakeAtMs !== undefined && this.wakeAtMs <= timestampMs) return;
    if (this.scope.closed) return;

    this.cancelWake?.();
    this.wakeAtMs = timestampMs;
    this.cancelWake = Clock.after(this.scope, Math.max(0, timestampMs - Clock.now()), () => {
      this.wakeAtMs = undefined;
      this.cancelWake = undefined;
      this.pass();
    });
  }

  private setState(entry: Entry, state: OverlayState): void {
    if (entry.state === state) return;
    entry.state = state;
    this.presence += 1;
  }

  private nextOrder(): number {
    this.order += 1;
    return this.order;
  }
}
