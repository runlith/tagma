import { Presenter, Service } from '../../key.js';
import { Layer } from '../../Layer.js';
import { emptyRouteData, Router } from '../../Router.js';
import { Scope } from '../../Scope.js';
import { Visitor } from '../../testing.js';

export const trace: string[] = [];

export class Corner extends Service<Corner>()('Corner', { tier: 'app' }) {
  static make(): Corner {
    trace.push('corner');
    return new Corner();
  }
}

export class Balance extends Presenter<Balance>()('Balance', { tier: 'visitor' }) {
  static *make() {
    const visitor = yield* Visitor.Current;
    const scope = yield* Scope;
    const name = Visitor.keyOf(visitor);
    trace.push(`balance:${name}`);
    scope.defer(() => void trace.push(`balance-end:${name}`));
    return new Balance();
  }
}

export class Reminder extends Presenter<Reminder>()('Reminder', { tier: 'user' }) {
  static *make() {
    const visitor = yield* Visitor.Current;
    trace.push(`reminder:${visitor.id}`);
    return new Reminder();
  }
}

export function section(load: { entry?: () => Promise<void>; user?: () => Promise<void> } = {}) {
  const calls = { entry: 0, user: 0 };
  const entry = Layer.entry('section', async () => {
    calls.entry += 1;
    await load.entry?.();
    return {
      default: Layer.mergeAll(
        Corner,
        Balance,
        Layer.when(Visitor.present('user'), async () => {
          calls.user += 1;
          await load.user?.();
          return { default: Layer.mergeAll(Reminder) };
        }),
      ),
    };
  });
  return { entry, calls };
}

export function routerAt(at: { routeId: string; status: number }): Router {
  return new Router({
    url: () => new URL('http://localhost/'),
    routeId: () => at.routeId,
    params: () => ({}),
    status: () => at.status,
    data: () => emptyRouteData(),
    goto: async () => undefined,
    invalidate: async () => undefined,
    historyIndex: () => undefined,
    traverse: () => undefined,
    reload: () => undefined,
    load: () => undefined,
  });
}
