import { describe, expect, it, vi } from 'vitest';

import { Graph, type GraphOptions } from './Graph.js';
import { Service } from './key.js';
import { Layer } from './Layer.js';
import { Process } from './process.js';
import { Scope } from './Scope.js';

class Clockwork extends Service<Clockwork>()('Clockwork', { tier: 'app' }) {
  static make(): Clockwork {
    return new Clockwork();
  }
}

type CountdownArgs = { seconds: number; log?: string[] };

class Countdown extends Process<Countdown, CountdownArgs>()('Countdown') {
  static override *make(args: CountdownArgs) {
    const scope = yield* Scope;
    return new Countdown(yield* Clockwork, scope, args);
  }

  readonly seconds: number;

  constructor(
    readonly clockwork: Clockwork,
    readonly scope: Scope,
    args: CountdownArgs,
  ) {
    super();
    this.seconds = args.seconds;
    scope.defer(() => {
      args.log?.push('finalizer');
    });
  }
}

class Makeless extends Process<Makeless>()('Makeless') {}

const inline: GraphOptions['effectRoot'] = (build) => {
  build();
  return () => undefined;
};

function open(effectRoot: GraphOptions['effectRoot'] = inline) {
  const graph = new Graph(Layer.mergeAll(Clockwork), { effectRoot });
  const app = Scope.make();
  void graph.open(app);
  return { graph, app };
}

describe('Process', () => {
  it('start builds through make: services from the scope’s graph, args from the owner, Scope its own lifetime inside it', () => {
    const { app } = open();
    const scope = app.child('countdown');

    const countdown = Countdown.start(scope, { seconds: 30 });

    expect(countdown.clockwork).toBe(app.instances.get(Clockwork));
    expect(countdown.scope.parent).toBe(scope);
    expect(countdown.scope.name).toBe('Countdown');
    expect(countdown.seconds).toBe(30);
  });

  it('a make that fails closes what it deferred at once and leaves nothing in the scope handed in', () => {
    const { app } = open();
    const scope = app.child('failing');
    const disposed: string[] = [];
    class HalfStarted extends Process<HalfStarted>()('HalfStarted') {
      static override *make() {
        const own = yield* Scope;
        own.defer(() => void disposed.push('disposed'));
        throw new Error('make failed after defer');
      }
    }

    const held = scope.finalizers.length;

    expect(() => HalfStarted.start(scope)).toThrow('make failed after defer');
    expect(disposed).toEqual(['disposed']);
    expect(scope.finalizers).toHaveLength(held);
  });

  it('two starts are two instances, and neither is filed under a key', () => {
    const { app } = open();
    const first = Countdown.start(app.child('one'), { seconds: 1 });
    const second = Countdown.start(app.child('two'), { seconds: 2 });

    expect(first).not.toBe(second);
    expect([...app.instances.keys()]).toEqual([Clockwork]);
  });

  it("a scope with no tier hosts nothing: the service is the owner scope's one, never built again below it", () => {
    const { app } = open();
    const scope = app.child('countdown');

    const countdown = Countdown.start(scope, { seconds: 1 });

    expect(scope.instances.size).toBe(0);
    expect(countdown.clockwork).toBe(Countdown.start(app.child('other'), { seconds: 1 }).clockwork);
  });

  it('closing the scope ends the process: the effect root first, then what the constructor deferred', async () => {
    const order: string[] = [];
    const { app } = open((build) => {
      build();
      return () => {
        order.push('root');
      };
    });
    const scope = app.child('countdown');
    Countdown.start(scope, { seconds: 1, log: order });

    await scope.close();

    expect(order).toEqual(['root', 'finalizer']);
  });

  it('a process of a rung refuses a scope under no scope of that rung', () => {
    const { app } = open();
    class Greeting extends Process<Greeting>()('Greeting', { tier: 'visitor' }) {
      static override make(): Greeting {
        return new Greeting();
      }
    }
    expect(() => Greeting.start(app.child('hall'))).toThrow(/Process "Greeting" stands at the visitor tier/);
  });

  it('a scope no graph opened refuses by name', () => {
    expect(() => Countdown.start(Scope.make('loose'), { seconds: 1 })).toThrow(/Process "Countdown" needs a scope the graph opened/);
  });

  it('a closed scope refuses; a process with no make refuses by name; a failing make tears its root down', () => {
    const { app } = open();
    const closed = app.child('closed');
    void closed.close();
    expect(() => Countdown.start(closed, { seconds: 1 })).toThrow(/closed/);

    expect(() => Makeless.start(app.child('makeless'))).toThrow(/Process "Makeless" declares no static make\(\)/);

    const teardown = vi.fn();
    const failing = new Graph(Layer.mergeAll(), {
      effectRoot: (build) => {
        build();
        return teardown;
      },
    });
    const root = Scope.make();
    void failing.open(root);
    expect(() => Countdown.start(root.child('no-clockwork'), { seconds: 1 })).toThrow(/Clockwork/);
    expect(teardown).toHaveBeenCalledTimes(1);
  });
});
