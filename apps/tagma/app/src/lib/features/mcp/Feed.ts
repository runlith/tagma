import { Failure } from '@runlith/layer/Failure';
import { Service } from '@runlith/layer/key';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { McpRepo } from './Repo.js';

type Mcp = ReturnType<typeof McpRepo.use>;

export class McpFeed extends Service<McpFeed>()('McpFeed', { tier: 'app' }) {
  static *make() {
    return new McpFeed(yield* Live, yield* McpRepo, yield* Failure);
  }

  constructor(
    private readonly live: LiveConnection,
    private readonly repo: Mcp,
    private readonly failure: Failure,
  ) {
    super();
  }

  hold(projectId: number): () => void {
    const held = this.live.hold(
      (client) => client['mcp.servers']({ projectId }),
      (rows) => this.repo.servers.key(projectId).setCache(rows),
      (reason) => {
        if (reason.kind === 'subscription') this.failure.report(new Error(reason.message));
      },
    );
    return () => held.unsubscribe();
  }
}
