import type { McpHttpServerDeclaration } from '@runlith/mcp/declaration';
import { McpPool } from '@runlith/mcp/McpPool';
import { Clock, Duration, Effect, type Scope } from 'effect';
import { declare, type Held } from '@runlith/held/Held';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';

export type WebSearchSessionsOptions = {
  readonly fetch?: typeof globalThis.fetch;
};

const PAUSE = Duration.minutes(5);

export class WebSearchSessions {
  private readonly declared = new Map<string, McpHttpServerDeclaration>();
  private readonly pausedUntil = new Map<string, number>();
  private readonly sessions: Held<string> = declare<string>({
    name: 'agent-tools-search-sessions',
    owner: 'agent-tools',
    rank: 210,
    key: (key) => key,
    concurrency: 1,
    threshold: Duration.seconds(10),
    ceilings: {
      hold: Duration.seconds(60),
      wait: Duration.seconds(60),
      leaves: 'reconcile may have started; the next request must check the pool',
    },
    external: 'none',
  });

  private constructor(private readonly pool: McpPool) {}

  static make(options: WebSearchSessionsOptions = {}): Effect.Effect<WebSearchSessions, never, Scope.Scope> {
    return McpPool.make(options.fetch === undefined ? {} : { fetch: options.fetch }).pipe(
      Effect.map((pool) => new WebSearchSessions(pool)),
    );
  }

  reach(declaration: McpHttpServerDeclaration): Effect.Effect<McpPool, HoldStalled | HoldCut> {
    return Effect.suspend(() => {
      if (this.declared.has(declaration.name)) return Effect.succeed(this.pool);
      return this.sessions.hold(
        'sessions',
        Effect.suspend(() => {
          if (this.declared.has(declaration.name)) return Effect.succeed(this.pool);
          return this.pool.reconcile([...this.declared.values(), declaration]).pipe(
            Effect.tap(() => Effect.sync(() => this.declared.set(declaration.name, declaration))),
            Effect.as(this.pool),
          );
        }),
      );
    });
  }

  order<Name extends string>(names: readonly Name[]): Effect.Effect<readonly Name[]> {
    return Effect.map(Clock.currentTimeMillis, (now) => {
      const until = (name: Name) => this.pausedUntil.get(name) ?? 0;
      const open = names.filter((name) => until(name) <= now);
      const resting = names.filter((name) => until(name) > now).sort((a, b) => until(a) - until(b));
      return [...open, ...resting];
    });
  }

  pause(name: string): Effect.Effect<void> {
    return Effect.map(Clock.currentTimeMillis, (now) => {
      this.pausedUntil.set(name, now + Duration.toMillis(PAUSE));
    });
  }

  resume(name: string): Effect.Effect<void> {
    return Effect.sync(() => {
      this.pausedUntil.delete(name);
    });
  }
}
