import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { SvelteMap } from 'svelte/reactivity';
import { type Refusal, refusalOf } from '$lib/wire/refusal.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { CheckoutRepo } from './Repo.js';

export type CommitLink = { readonly sha: string; readonly subject: string; readonly project: string };

export type CommitPeer = CommitLink | { readonly error: Refusal } | null;

export type CommitLookup = { readonly locate: (id: string) => Promise<CommitPeer> };

export class CommitLinks extends Service<CommitLinks>()('CommitLinks', { tier: 'graph' }) implements CommitLookup {
  static *make() {
    return new CommitLinks(yield* CheckoutRepo, yield* Workspace, yield* Scope);
  }

  private readonly peers = new SvelteMap<string, CommitPeer>();
  private readonly asked = new Map<string, Promise<CommitPeer>>();
  private readonly waiting = new Map<string, (peer: CommitPeer) => void>();
  private scheduled = false;

  constructor(
    private readonly repo: CheckoutRepo,
    private readonly workspace: Workspace,
    private readonly scope: Scope,
  ) {
    super();
    scope.defer(() => {
      for (const settle of this.waiting.values()) settle(null);
      this.waiting.clear();
    });
  }

  readonly peer = (id: string): CommitPeer | undefined => {
    if (!this.peers.has(id)) void this.locate(id);
    return this.peers.get(id);
  };

  readonly locate = (id: string): Promise<CommitPeer> => {
    const held = this.asked.get(id);
    if (held !== undefined) return held;
    const { promise, resolve } = Promise.withResolvers<CommitPeer>();
    this.asked.set(id, promise);
    if (this.scope.closed) {
      resolve(null);
      return promise;
    }
    this.waiting.set(id, resolve);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        const batch = new Map(this.waiting);
        this.waiting.clear();
        void this.resolve(batch);
      });
    }
    return promise;
  };

  private async resolve(batch: ReadonlyMap<string, (peer: CommitPeer) => void>): Promise<void> {
    const settle = (id: string, peer: CommitPeer) => {
      if (!this.scope.closed) this.peers.set(id, peer);
      batch.get(id)?.(peer);
    };
    try {
      const answer = await this.repo.located.key([...batch.keys()]).loadOrThrow();
      if (answer === undefined) {
        for (const [id, wake] of batch) {
          this.asked.delete(id);
          wake(null);
        }
        return;
      }
      const projects = new Map(
        (await this.workspace.projectsOf([...new Set(answer.commits.map((row) => row.projectId))])).map((project) => [
          project.id,
          project.name,
        ]),
      );
      const found = new Map(answer.commits.map((row) => [row.id, row]));
      for (const id of batch.keys()) {
        const row = found.get(id);
        const project = row === undefined ? undefined : projects.get(row.projectId);
        settle(id, row === undefined || project === undefined ? null : { sha: row.sha, subject: row.subject, project });
      }
    } catch (cause) {
      const failure = { error: refusalOf(cause) };
      for (const id of batch.keys()) settle(id, failure);
    }
  }
}
