import {
  appliedMachineLoad,
  type LoadPoint,
  type LoadRow,
  type LoadView,
  type MachineLoadFrame,
  type MachineLoadSnapshot,
  type MachineState,
} from '@tagma/server/executions/contract/wire/load';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { formatSpan } from '$lib/shared/figures.js';

export type ReadingState =
  | { readonly _tag: 'Connection'; readonly since: number }
  | { readonly _tag: 'Outdated'; readonly reason: string }
  | { readonly _tag: 'Lost'; readonly reason: string; readonly since: number };

const NO_POINTS: readonly LoadPoint[] = [];

export function silentWords(state: ReadingState, now: number): string {
  switch (state._tag) {
    case 'Connection':
      return `The connection to the server dropped ${formatSpan(now - state.since)} ago; the figures are from before it.`;
    case 'Outdated':
      return `The execution host cannot measure load and must be replaced: ${state.reason}`;
    case 'Lost':
      return `The host's load reading was lost ${formatSpan(now - state.since)} ago: ${state.reason}`;
  }
}

export class Readings extends Service<Readings>()('LoadReadings', { tier: 'app' }) {
  static *make() {
    return new Readings(yield* Live, yield* Scope);
  }

  private feed: { readonly unsubscribe: () => void } | null = null;
  private sequence: number | null = null;
  private held = $state.raw<MachineLoadSnapshot | null>(null);
  private droppedAt = $state<number | null>(null);
  private interested = false;

  readonly state: MachineState;
  readonly view: LoadView | null;
  readonly history: readonly LoadPoint[];
  readonly silent: ReadingState | null;
  readonly agents: ReadonlyMap<string, LoadRow>;

  constructor(
    private readonly live: LiveConnection,
    scope: Scope,
  ) {
    super();
    const offStatus = live.subscribeStatus((status) => {
      if (status === 'open' || status === 'paused') return;
      if (this.feed !== null) this.droppedAt ??= Date.now();
    });
    scope.defer(() => {
      offStatus();
      this.release();
    });
    this.state = $derived(this.held?.state ?? { _tag: 'Waiting' });
    this.view = $derived(this.state._tag === 'Read' ? this.state.view : null);
    this.history = $derived(this.held?.history ?? NO_POINTS);
    this.agents = $derived(
      new Map((this.view?.rows ?? []).flatMap((row) => (row.thread === undefined ? [] : [[row.thread, row] as const]))),
    );
    this.silent = $derived.by((): ReadingState | null => {
      if (this.droppedAt !== null) return { _tag: 'Connection', since: this.droppedAt };
      if (this.state._tag === 'Outdated') return { _tag: 'Outdated', reason: this.state.reason };
      if (this.state._tag === 'Lost') return { _tag: 'Lost', reason: this.state.reason, since: this.state.since };
      return null;
    });
  }

  get pressed(): 'warning' | 'critical' | null {
    const memory = this.view?.memory;
    if (memory?._tag !== 'Measured' || memory.pressure._tag !== 'Measured' || memory.pressure.level === 'normal') return null;
    return memory.pressure.level;
  }

  follow(): void {
    if (this.feed === null) this.subscribe();
  }

  release(): void {
    this.feed?.unsubscribe();
    this.feed = null;
    this.held = null;
  }

  declare(interested: boolean): void {
    this.interested = interested;
    const reader = this.held?.reader;
    if (reader === undefined) return;
    void this.live
      .call((client) => client['load.interest']({ reader, interested }))
      .catch((error: unknown) => console.warn('[tagma] the load step could not be changed:', error));
  }

  private subscribe(): void {
    this.sequence = null;
    this.feed = this.live.hold(
      (client) => client['load.machine']({}),
      (frame) => this.took(frame),
      (failure) => {
        this.held = this.held === null ? null : { ...this.held, state: { _tag: 'Lost', reason: failure.message, since: Date.now() } };
      },
    );
  }

  private took(frame: MachineLoadFrame): void {
    this.droppedAt = null;
    if (frame._tag === 'Snapshot') {
      this.held = frame.snapshot;
      if (this.interested) this.declare(true);
    } else {
      if (this.held === null || this.sequence !== frame.base) {
        this.feed?.unsubscribe();
        queueMicrotask(() => this.subscribe());
        return;
      }
      this.held = appliedMachineLoad(this.held, frame.delta);
    }
    this.sequence = frame.sequence;
  }
}
