import { availableParallelism, totalmem } from 'node:os';
import type { SpawnedChild } from './connection.js';
import type { SqliteAsk, SqliteReply, SqliteRequest, SqliteSaid } from './channel.js';
import { ReaderLanes } from './ReaderLanes.js';
import { Checkpoints } from './Checkpoints.js';
import { prepareEngine } from './engine.js';
import { childHosting } from './children.js';
import type { Host, Hosting } from './hosting.js';

const WORKER_BYTES = 64 * 1024 * 1024;
const EXIT_DEADLINE_MS = 2000;

export const machineReaders = (): number =>
  Math.max(2, Math.min(Math.max(1, availableParallelism() - 1), Math.floor(totalmem() / 32 / WORKER_BYTES)));

type Loss = { readonly announce: () => void; readonly wake: () => void };

type Channel = {
  readonly receive: (said: SqliteSaid) => void;
  readonly lost: (reason: string) => Loss;
};

type Child = {
  readonly process: Host;
  readonly channels: Map<number, Channel>;
  readonly birth: SpawnedChild;
  slot: number;
  release: (() => void) | undefined;
  closing: boolean;
  failure: string | undefined;
};

export type ProcessChannel = {
  readonly pid: number;
  readonly send: (ask: SqliteAsk) => void;
  readonly release: () => Promise<void>;
  readonly retire: () => Promise<void>;
  readonly kill: (reason: string) => Promise<void>;
};

export type IdleChildren = 'stop' | 'keep';

export class ProcessPool {
  readonly readers: ReaderLanes;
  private readonly children = new Map<number, Child>();
  private readonly checkpoints = new Checkpoints(this, () => this.idle === 'keep');
  private readonly prepared: Record<'writer' | 'checkpoint', Child[]> = { writer: [], checkpoint: [] };
  private next = 0;

  constructor(
    ceiling = machineReaders(),
    private idle: IdleChildren = 'stop',
    private readonly adopt?: (pid: number) => () => void,
    private readonly hosting: Hosting = childHosting,
  ) {
    this.readers = new ReaderLanes(ceiling);
  }

  async close(): Promise<void> {
    this.idle = 'stop';
    await this.closePrepared();
    await this.checkpoints.close();
    const idle = [...this.children.values()].filter((child) => child.channels.size === 0 && !child.closing);
    for (const child of idle) {
      child.closing = true;
      this.children.delete(child.slot);
      child.process.kill();
    }
    await Promise.all(idle.map((child) => this.exited(child)));
  }

  connect(
    lane: number | undefined,
    receive: (said: SqliteSaid) => void,
    lost: (reason: string) => Loss,
    onSpawned: ((spawned: SpawnedChild) => () => void) | undefined,
    purpose: 'writer' | 'checkpoint' = 'writer',
  ): ProcessChannel {
    const id = ++this.next;
    const slot = lane === undefined ? -id : lane;
    let ready = lane === undefined ? this.prepared[purpose].shift() : undefined;
    while (ready?.failure !== undefined) {
      this.children.delete(ready.slot);
      ready = this.prepared[purpose].shift();
    }
    if (ready !== undefined) {
      this.children.delete(ready.slot);
      ready.slot = slot;
      this.children.set(slot, ready);
      this.register(ready, onSpawned);
    }
    const child = ready ?? this.children.get(slot) ?? this.spawn(slot, onSpawned);
    child.channels.set(id, { receive, lost });
    return {
      pid: child.process.pid,
      send: (ask) => {
        if (this.children.get(slot) !== child || !child.channels.has(id)) throw new Error('the sqlite channel is closed');
        if (ask._tag === 'Open' && !ask.config.readonly && !ask.config.disableWAL && ask.config.filename !== ':memory:') {
          this.checkpoints.add(id, ask.config.filename, ask.config.durable, lost, onSpawned);
        }
        child.process.send({ connection: id, ask } satisfies SqliteRequest);
      },
      release: async () => {
        await this.checkpoints.drop(id);
        child.channels.delete(id);
        if (child.channels.size > 0 || child.closing || (lane !== undefined && this.idle === 'keep')) return;
        if (lane === undefined && purpose === 'writer' && this.idle === 'keep' && child.failure === undefined) {
          this.unregister(child);
          this.prepared.writer.push(child);
          return;
        }
        child.closing = true;
        if (this.children.get(slot) === child) this.children.delete(slot);
        child.process.kill();
        await this.exited(child);
      },
      retire: async () => {
        await this.checkpoints.drop(id);
        if (child.channels.has(id) && child.channels.size > 1) {
          try {
            child.process.send({ connection: id, ask: { _tag: 'Close', id: 0 } } satisfies SqliteRequest);
          } finally {
            child.channels.delete(id);
          }
          return;
        }
        child.channels.delete(id);
        if (child.channels.size > 0) return;
        if (!child.closing) {
          child.closing = true;
          if (this.children.get(slot) === child) this.children.delete(slot);
          child.process.kill('SIGKILL');
        }
        await this.exited(child);
      },
      kill: async (reason) => {
        child.channels.delete(id);
        if (!child.closing) {
          child.closing = true;
          if (this.children.get(slot) === child) this.children.delete(slot);
          const losses = Array.from(child.channels.values(), (channel) => channel.lost(reason));
          child.channels.clear();
          child.process.kill('SIGKILL');
          for (const loss of losses) loss.announce();
          for (const loss of losses) loss.wake();
        }
        await this.checkpoints.drop(id);
        await this.exited(child);
      },
    };
  }

  async prepare(writers: number): Promise<void> {
    await prepareEngine();
    try {
      const pings = [...Array.from({ length: writers }, () => 'writer' as const), 'checkpoint' as const].map((purpose) => {
        const child = this.spawn(-++this.next, undefined);
        this.prepared[purpose].push(child);
        return new Promise<void>((resolve, reject) => {
          child.channels.set(0, {
            receive: (said) => {
              child.channels.delete(0);
              if (said._tag === 'Did') resolve();
              else reject(new Error(`The prepared SQLite child answered ${said._tag}.`));
            },
            lost: (reason) => ({ announce: () => reject(new Error(reason)), wake: () => undefined }),
          });
          child.process.send({ connection: 0, ask: { _tag: 'Ping', id: 0 } } satisfies SqliteRequest);
        });
      });
      await Promise.all(pings);
    } catch (cause) {
      await this.closePrepared();
      throw cause;
    }
  }

  async closePrepared(): Promise<void> {
    const idle = [...this.prepared.writer.splice(0), ...this.prepared.checkpoint.splice(0)];
    for (const child of idle) {
      const loss = child.channels.get(0)?.lost('The SQLite preparation was closed.');
      child.channels.delete(0);
      loss?.announce();
      loss?.wake();
      child.closing = true;
      if (this.children.get(child.slot) === child) this.children.delete(child.slot);
      child.process.kill('SIGKILL');
    }
    await Promise.all(idle.map((child) => this.exited(child)));
  }

  private register(child: Child, onSpawned: ((spawned: SpawnedChild) => () => void) | undefined): void {
    if (!child.process.spawned) return;
    try {
      child.release = onSpawned?.(child.birth);
    } catch (cause) {
      console.error('[sqlite] the child registration threw', cause);
    }
  }

  private async exited(child: Child): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        child.process.exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`The retired sqlite child ${child.process.pid} did not exit within ${EXIT_DEADLINE_MS} ms.`)),
            EXIT_DEADLINE_MS,
          );
        }),
      ]);
      this.unregister(child);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private unregister(child: Child): void {
    const release = child.release;
    child.release = undefined;
    try {
      release?.();
    } catch (cause) {
      console.error('[sqlite] the child registration release threw', cause);
    }
  }

  private spawn(slot: number, onSpawned: ((spawned: SpawnedChild) => () => void) | undefined): Child {
    const channels = new Map<number, Channel>();
    const ipc = (reply: SqliteReply) => {
      if (reply.said._tag === 'Changed') this.checkpoints.changed(reply.said.filename);
      else if (reply.said._tag === 'CheckpointFailed') this.checkpoints.failed(reply.said.filename, reply.said.thrown);
      else channels.get(reply.connection)?.receive(reply.said);
    };
    const onExit = (process: Host, code: number | null) => {
      if (this.children.get(child.slot) === child) this.children.delete(child.slot);
      this.unregister(child);
      disown?.();
      if (child.closing) return;
      const reason = `the sqlite process died (code ${code}, signal ${process.signalCode})`;
      child.failure = reason;
      const losses = Array.from(channels.values(), (channel) => channel.lost(reason));
      channels.clear();
      for (const loss of losses) loss.announce();
      for (const loss of losses) loss.wake();
    };
    const process = this.hosting(ipc, onExit);
    const disown = process.spawned ? this.adopt?.(process.pid) : undefined;
    const child: Child = {
      process,
      channels,
      birth: { pid: process.pid },
      slot,
      release: undefined,
      closing: false,
      failure: undefined,
    };
    this.register(child, onSpawned);
    this.children.set(slot, child);
    return child;
  }
}
