import type { JSONRPCMessage, RequestId, Root } from '@modelcontextprotocol/sdk/types.js';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Deferred, Effect, Semaphore } from 'effect';

const covers = (place: string, path: string): boolean => {
  const rest = relative(place, path);
  return rest === '' || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`));
};

const distinct = (paths: readonly string[]): readonly string[] => [...new Set(paths.map((path) => resolve(path)))];

export class McpRoots {
  private seeded: readonly string[] = [];
  private joined: readonly string[] = [];
  private current = 0;

  get revision(): number {
    return this.current;
  }

  seed(paths: readonly string[]): boolean {
    const seeded = distinct(paths);
    const joined = this.joined.filter((path) => !seeded.some((place) => covers(place, path)));
    const changed =
      seeded.length !== this.seeded.length || seeded.some((path, at) => path !== this.seeded[at]) || joined.length !== this.joined.length;
    this.seeded = seeded;
    this.joined = joined;
    if (changed) this.current += 1;
    return changed;
  }

  join(paths: readonly string[]): boolean {
    const added = distinct(paths).filter((path) => ![...this.seeded, ...this.joined].some((place) => covers(place, path)));
    if (added.length === 0) return false;
    this.joined = [...this.joined, ...added];
    this.current += 1;
    return true;
  }

  answer(): { readonly roots: Root[] } {
    return { roots: [...this.seeded, ...this.joined].map((path) => ({ uri: pathToFileURL(path).href })) };
  }
}

export class McpRootsPeer {
  readonly syncing = Semaphore.makeUnsafe(1);
  private asks = 0;
  private reached: number;
  private served = 0;
  private readonly answering = new Map<RequestId, number>();
  private progress = Deferred.makeUnsafe<void>();
  private closed = false;

  constructor(private readonly roots: McpRoots) {
    this.reached = roots.revision;
  }

  get revision(): number {
    return this.roots.revision;
  }

  get asked(): number {
    return this.asks;
  }

  get synced(): number {
    return this.reached;
  }

  settle(revision: number): void {
    this.reached = Math.max(this.reached, revision);
  }

  heard(message: JSONRPCMessage): void {
    if ('method' in message && 'id' in message && message.method === 'roots/list') this.asks += 1;
  }

  answer(id: RequestId): { readonly roots: Root[] } {
    this.answering.set(id, this.roots.revision);
    return this.roots.answer();
  }

  sent(message: JSONRPCMessage): void {
    if (!('id' in message) || 'method' in message || message.id === undefined) return;
    const revision = this.answering.get(message.id);
    if (revision === undefined) return;
    this.answering.delete(message.id);
    if (revision <= this.served) return;
    this.served = revision;
    this.advance();
  }

  answered(revision: number): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      if (this.served >= revision) return Effect.succeed(true);
      if (this.closed) return Effect.succeed(false);
      return Effect.andThen(Deferred.await(this.progress), this.answered(revision));
    });
  }

  close(): void {
    this.closed = true;
    this.answering.clear();
    this.advance();
  }

  private advance(): void {
    const moved = this.progress;
    this.progress = Deferred.makeUnsafe<void>();
    Deferred.doneUnsafe(moved, Effect.void);
  }
}
