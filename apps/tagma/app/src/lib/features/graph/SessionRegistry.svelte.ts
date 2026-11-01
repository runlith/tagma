import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { GraphFeed } from './Feed.js';
import { SessionsRepo } from './SessionsRepo.js';

export type SessionHandle = { id: number; harness: string; key: string };

export class SessionRegistry extends Service<SessionRegistry>()('SessionRegistry', { tier: 'graph', eager: true }) {
  static *make() {
    return new SessionRegistry(yield* SessionsRepo, yield* GraphFeed, yield* Scope, yield* Failure);
  }

  private byId = $state(new Map<number, SessionHandle>());

  constructor(
    private readonly repo: SessionsRepo,
    feed: GraphFeed,
    scope: Scope,
    private readonly failure: Failure,
  ) {
    super();
    scope.defer(
      feed.frames((frame) => {
        if (frame.type === 'change') this.merge(frame.sessions);
        else void this.read(true);
      }),
    );
    void this.read();
  }

  private async read(refresh = false): Promise<void> {
    try {
      if (refresh) await this.repo.list.cancel();
      this.merge((await this.repo.list.loadOrThrow(refresh ? { refresh: true } : undefined)) ?? []);
    } catch (error) {
      this.failure.report(error);
    }
  }

  merge(rows: readonly SessionHandle[]): void {
    const fresh = rows.filter((row) => !this.byId.has(row.id));
    if (fresh.length === 0) return;
    this.byId = new Map([...this.byId, ...fresh.map((row) => [row.id, row] as const)]);
  }

  writerOf(sessionId: number | null | undefined): SessionHandle | null | undefined {
    if (sessionId === null || sessionId === undefined) return null;
    return this.byId.get(sessionId);
  }
}
