import { Failure } from '@runlith/layer/Failure';
import { Service } from '@runlith/layer/key';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { McpRepo } from './Repo.js';

type Mcp = ReturnType<typeof McpRepo.use>;

type Held = { holders: number; readonly release: () => void };

export class McpFeed extends Service<McpFeed>()('McpFeed', { tier: 'app' }) {
  static *make() {
    return new McpFeed(yield* Live, yield* McpRepo, yield* Failure);
  }

  private readonly held = new Map<number, Held>();

  constructor(
    private readonly live: LiveConnection,
    private readonly repo: Mcp,
    private readonly failure: Failure,
  ) {
    super();
  }

  hold(projectId: number): () => void {
    const standing = this.held.get(projectId) ?? this.open(projectId);
    standing.holders += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      standing.holders -= 1;
      if (standing.holders > 0 || this.held.get(projectId) !== standing) return;
      this.held.delete(projectId);
      standing.release();
    };
  }

  private open(projectId: number): Held {
    const failed = (reason: { readonly kind: string; readonly message: string }) => {
      if (reason.kind === 'subscription') this.failure.report(new Error(reason.message));
    };
    const servers = this.live.hold(
      (client) => client['mcp.servers']({ projectId }),
      (rows) => this.repo.servers.key(projectId).setCache(rows),
      failed,
    );
    const held: Held = { holders: 0, release: () => servers.unsubscribe() };
    this.held.set(projectId, held);
    return held;
  }
}
