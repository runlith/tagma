import type { ProcessChannel, ProcessPool } from './ProcessPool.js';
import type { SpawnedChild } from './connection.js';
import { thrownShapeOf, type SqliteSaid, type ThrownShape } from './channel.js';

type Loss = { readonly announce: () => void; readonly wake: () => void };
type Owner = { readonly filename: string; readonly durable: boolean; readonly lost: (reason: string) => Loss };

const RETRY_MS = 1000;
const PROBE = 'The WAL probe PRAGMA wal_checkpoint(NOOP) after a write';
const PASS = 'The WAL checkpoint pass PRAGMA wal_checkpoint(PASSIVE)';

export class Checkpoints {
  private readonly owners = new Map<number, Owner>();
  private readonly files = new Map<string, Set<number>>();
  private readonly waiting = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private driver: ProcessChannel | undefined;
  private running: { readonly filename: string; readonly id: number; readonly ended: PromiseWithResolvers<void> } | undefined;
  private next = 0;

  constructor(
    private readonly processes: ProcessPool,
    private readonly keeping: () => boolean = () => false,
  ) {}

  add(
    id: number,
    filename: string,
    durable: boolean,
    lost: Owner['lost'],
    onSpawned: ((spawned: SpawnedChild) => () => void) | undefined,
  ): void {
    this.owners.set(id, { filename, durable, lost });
    const ids = this.files.get(filename) ?? new Set<number>();
    ids.add(id);
    this.files.set(filename, ids);
    if (this.driver === undefined) {
      const driver: ProcessChannel = this.processes.connect(
        undefined,
        (said) => this.receive(said),
        (reason) => ({
          announce: () => {
            if (this.driver === driver) {
              this.driver = undefined;
              this.running?.ended.resolve();
              this.running = undefined;
            }
            this.fail(reason);
          },
          wake: () => undefined,
        }),
        onSpawned,
        'checkpoint',
      );
      this.driver = driver;
    }
    this.driver.send({ _tag: 'Maintain', id: 0 });
  }

  async close(): Promise<void> {
    if (this.owners.size > 0) return;
    const driver = this.driver;
    this.driver = undefined;
    await driver?.retire();
  }

  async drop(id: number): Promise<void> {
    const owner = this.owners.get(id);
    this.owners.delete(id);
    if (owner !== undefined) {
      const ids = this.files.get(owner.filename);
      ids?.delete(id);
      if (ids?.size === 0) {
        this.files.delete(owner.filename);
        this.waiting.delete(owner.filename);
        clearTimeout(this.timers.get(owner.filename));
        this.timers.delete(owner.filename);
        const pass = this.running;
        if (pass?.filename === owner.filename) await pass.ended.promise;
      }
    }
    if (this.owners.size > 0) return;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.waiting.clear();
    if (this.keeping()) return;
    await this.close();
  }

  changed(filename: string): void {
    if (!this.has(filename) || this.timers.has(filename)) return;
    this.waiting.add(filename);
    this.drive();
  }

  failed(filename: string, thrown: ThrownShape): void {
    this.refused(filename, PROBE, thrown);
  }

  private refused(filename: string, act: string, thrown: ThrownShape): void {
    const code = thrown.errno === undefined ? thrown.code : thrown.errno & 0xff;
    if (code === 5 || code === 6 || code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
      this.defer(filename);
      return;
    }
    const errno = thrown.errno === undefined ? '' : ` (errno ${thrown.errno})`;
    const reason = `${act} failed with ${thrown.code ?? 'no SQLite code'}${errno}: ${thrown.message}`;
    const losses = [...(this.files.get(filename) ?? [])].map((id) => this.owners.get(id)!.lost(reason));
    for (const loss of losses) loss.announce();
    for (const loss of losses) loss.wake();
  }

  private has(filename: string): boolean {
    return this.files.has(filename);
  }

  private fail(reason: string): void {
    const losses = [...this.owners.values()].map((owner) => owner.lost(`The WAL checkpoint process was lost: ${reason}`));
    for (const loss of losses) loss.announce();
    for (const loss of losses) loss.wake();
  }

  private drive(): void {
    if (this.running !== undefined || this.driver === undefined) return;
    const filename = this.waiting.values().next().value;
    if (filename === undefined) return;
    this.waiting.delete(filename);
    if (!this.has(filename)) return this.drive();
    const id = ++this.next;
    const pass = { filename, id, ended: Promise.withResolvers<void>() };
    this.running = pass;
    const durable = [...this.files.get(filename)!].some((owner) => this.owners.get(owner)!.durable);
    try {
      this.driver.send({ _tag: 'Checkpoint', id, filename, durable });
    } catch (cause) {
      this.running = undefined;
      pass.ended.resolve();
      this.refused(filename, 'Sending the WAL checkpoint pass', thrownShapeOf(cause));
    }
  }

  private receive(said: SqliteSaid): void {
    if (said._tag === 'Maintaining') return;
    if (this.running === undefined || said.id !== this.running.id) return;
    const { filename, ended } = this.running;
    this.running = undefined;
    ended.resolve();
    if (said._tag === 'Failed') this.refused(filename, PASS, said.thrown);
    else if (said._tag !== 'Checkpointed') this.refused(filename, PASS, thrownShapeOf(new Error(`it answered ${said._tag}`)));
    else if (said.log > said.copied) this.defer(filename);
    this.drive();
  }

  private defer(filename: string): void {
    if (!this.has(filename) || this.timers.has(filename)) return;
    this.waiting.delete(filename);
    this.timers.set(
      filename,
      setTimeout(() => {
        this.timers.delete(filename);
        this.changed(filename);
      }, RETRY_MS),
    );
  }
}
