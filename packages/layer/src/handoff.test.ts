import { describe, expect, it } from 'vitest';

import { App, MountedApp } from './App.js';
import { Failure } from './Failure.js';
import { Handoff } from './Handoff.js';
import { Service } from './key.js';
import { Layer } from './Layer.js';
import { ScopeAbort } from './Scope.js';
import { Visitor, type VisitorInput } from './testing.js';

function inlineRoot(build: () => void): () => void {
  build();
  return () => undefined;
}

class Account extends Service<Account>()('Handoff.Account', { tier: 'user' }) {
  static make(): Account {
    return new Account();
  }
}

describe('Handoff.ready on a rung', () => {
  it('answers the scope standing without another handoff, and waits for the world to start', async () => {
    const input = Visitor.user('one');
    const app = new MountedApp(
      App.define(
        Layer.mergeAll(
          Account,
          Visitor.of(() => input),
        ),
        { ladder: [Visitor] },
      ),
      Layer.mergeAll(),
      {
        effectRoot: inlineRoot,
        start: 'mount',
      },
    );
    const handoff = app.resolve(Handoff);
    let ready = false;
    const pending = handoff.ready(Visitor, input).then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    app.start();
    await pending;
    const account = app.resolve(Account);
    await handoff.ready(Visitor, input);
    expect(app.resolve(Account)).toBe(account);
    await app.close();
    await expect(handoff.ready(Visitor, input)).rejects.toBeInstanceOf(ScopeAbort);
  });

  it('waits for both the new scope’s chunk and the old scope’s retirement, through concurrent adopts', async () => {
    let input: VisitorInput = Visitor.guest();
    let releaseChunk: () => void = () => undefined;
    const chunk = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    let releaseRetirement: () => void = () => undefined;
    const retirement = new Promise<void>((resolve) => {
      releaseRetirement = resolve;
    });
    let reportBuilt: () => void = () => undefined;
    const built = new Promise<void>((resolve) => {
      reportBuilt = resolve;
    });
    const account = Layer.provide(Account, () => {
      const instance = new Account();
      reportBuilt();
      return instance;
    });
    const app = new MountedApp(
      App.define(
        Layer.mergeAll(
          Visitor.of(() => input),
          Layer.when(Visitor.present('user'), async () => {
            await chunk;
            return { default: Layer.mergeAll(account) };
          }),
        ),
        { ladder: [Visitor] },
      ),
      Layer.mergeAll(),
      { effectRoot: inlineRoot, start: 'open' },
    );
    const guest = app.scopeOf('visitor');
    guest.defer(() => retirement);
    const handoff = app.resolve(Handoff);
    await handoff.ready(Visitor, input);
    input = Visitor.user('one');
    let ready = false;
    const pending = handoff.ready(Visitor, input).then(() => {
      ready = true;
    });
    const adopting = app.adopt();
    const adoptingAgain = app.adopt();
    releaseChunk();
    await built;
    expect(ready).toBe(false);
    releaseRetirement();
    await Promise.all([adopting, adoptingAgain, pending]);
    expect(guest.closed).toBe(true);
    expect(app.resolve(Account)).toBeInstanceOf(Account);
    await app.close();
  });

  it('rejects a scope whose start failed instead of calling it ready', async () => {
    const error = new Error('chunk failed');
    const input = Visitor.user('one');
    const app = new MountedApp(
      App.define(
        Layer.mergeAll(
          Visitor.of(() => input),
          Layer.when(Visitor.present('user'), async () => {
            throw error;
          }),
        ),
        { ladder: [Visitor] },
      ),
      Failure.of(() => undefined),
      { effectRoot: inlineRoot, start: 'open' },
    );
    await expect(app.resolve(Handoff).ready(Visitor, input)).rejects.toBe(error);
    await app.close();
  });

  it('rejects an input its source replaced while the scope was still starting', async () => {
    let input: VisitorInput = Visitor.user('one');
    const app = new MountedApp(
      App.define(
        Layer.mergeAll(
          Visitor.of(() => input),
          Layer.when(Visitor.present('user'), () => new Promise<never>(() => undefined)),
        ),
        { ladder: [Visitor] },
      ),
      Layer.mergeAll(),
      { effectRoot: inlineRoot, start: 'open' },
    );
    const handoff = app.resolve(Handoff);
    const pending = handoff.ready(Visitor, input);
    const refused = expect(pending).rejects.toBeInstanceOf(ScopeAbort);
    input = Visitor.guest();
    await app.adopt();
    await refused;
    await expect(handoff.ready(Visitor, Visitor.user('one'))).rejects.toThrow('not published');
    await handoff.ready(Visitor, input);
    await app.close();
  });
});
