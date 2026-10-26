import { describe, expect, it } from 'vitest';

import { Config, ConfigError } from './config.js';
import { Graph, LayerTierError, MissingRecipeError, TierMismatchError } from './Graph.js';
import { Service } from './key.js';
import { Layer } from './Layer.js';
import { Scope } from './Scope.js';
import { Visitor } from './testing.js';

function inlineRoot(build: () => void): () => void {
  build();
  return () => undefined;
}

interface Payload {
  readonly rewards?: boolean | undefined;
  readonly phoneVerification?: boolean | undefined;
  readonly missions: boolean;
  readonly minDeposit: number;
}

const Flags = Config.define<Payload>()('Flags', {
  tier: 'visitor',
  defaults: { rewards: false, phoneVerification: false },
});

class Rewards extends Service<Rewards>()('Rewards', { tier: 'visitor', eager: true }) {
  static make(): Rewards {
    return new Rewards();
  }
}

class Analytics extends Service<Analytics>()('Analytics', { tier: 'app', eager: true }) {
  static make(): Analytics {
    return new Analytics();
  }
}

const published: Payload = { missions: true, minDeposit: 3 };

function open(manifest: Layer<never, never> | ReturnType<typeof Layer.mergeAll>) {
  const graph = new Graph(manifest, { effectRoot: inlineRoot, ladder: [Visitor] });
  const app = Scope.make();
  return { graph, app, ready: graph.open(app) };
}

describe('a settings key', () => {
  it('answers for a field its source never published, and takes every field the source did', async () => {
    const { graph, app } = open(Layer.mergeAll(Config.from(Flags, () => published)));
    const { scope, ready } = graph.openRung(app, Visitor, Visitor.guest());
    await ready;

    const flags = graph.resolve(Flags, scope);
    expect(flags.rewards).toBe(false);
    expect(flags.missions).toBe(true);
    expect(flags.minDeposit).toBe(3);
    await app.close();
  });

  it('reads a brand default under the source, never over it', async () => {
    const brand = { phoneVerification: true, rewards: true } as const;
    const { graph, app } = open(Layer.mergeAll(Config.from(Flags, () => ({ ...published, rewards: false }), brand)));
    const { scope, ready } = graph.openRung(app, Visitor, Visitor.guest());
    await ready;

    const flags = graph.resolve(Flags, scope);
    expect(flags.phoneVerification).toBe(true);
    expect(flags.rewards).toBe(false);
    await app.close();
  });

  it('is frozen: a reader cannot write back into the snapshot', async () => {
    const { graph, app } = open(Layer.mergeAll(Config.from(Flags, () => published)));
    const { scope, ready } = graph.openRung(app, Visitor, Visitor.guest());
    await ready;

    const flags = graph.resolve(Flags, scope) as { missions: boolean };
    expect(() => {
      flags.missions = false;
    }).toThrow();
    await app.close();
  });

  it('refuses to stand in a manifest without a source: the owner declares, the brand provides', () => {
    // @ts-expect-error the refusal is the type's first; the app keeps its own for a caller whose types were erased
    expect(() => open(Layer.mergeAll(Flags))).toThrow(MissingRecipeError);
  });
});

describe('a settings key over a record of strings', () => {
  const Env = Config.define('Env', {
    tier: 'app',
    fields: {
      ssr: Config.boolean('PUBLIC_SSR', false),
      devtools: Config.boolean('PUBLIC_DEVTOOLS', true),
      support: Config.literals('PUBLIC_SUPPORT', ['none', 'livechat', 'qodeq'], 'qodeq'),
      retries: Config.int('PUBLIC_RETRIES', 0),
      origin: Config.string('PUBLIC_ORIGIN', ''),
    },
    from: { PUBLIC_SSR: '1', PUBLIC_DEVTOOLS: '', PUBLIC_SUPPORT: 'livechat', PUBLIC_ORIGIN: ' https://x.test ' },
  });

  it('parses what the record published and keeps the default where it is silent', () => {
    const env = Env.read();
    expect(env.ssr).toBe(true);
    expect(env.devtools).toBe(true);
    expect(env.retries).toBe(0);
    expect(env.support).toBe('livechat');
    expect(env.origin).toBe('https://x.test');
  });

  it('hands the same values to the graph and to a reader that arrives before the mount', async () => {
    const { graph, app, ready } = open(Layer.mergeAll(Env));
    await ready;
    expect(graph.resolve(Env, app)).toEqual(Env.read());
    await app.close();
  });

  it('follows a source that changes, because the container is what it reads', () => {
    const source: Record<string, string | undefined> = { PUBLIC_ORIGIN: 'https://first.test' };
    const Moving = Config.define('Moving', {
      tier: 'app',
      fields: { origin: Config.string('PUBLIC_ORIGIN', '') },
      from: source,
    });

    expect(Moving.read().origin).toBe('https://first.test');
    source.PUBLIC_ORIGIN = 'https://second.test';
    expect(Moving.read().origin).toBe('https://second.test');
  });

  it('reads past the graph: a substituted key answers `use`, never `read`', async () => {
    const substituted = Env.of({ ssr: false, support: 'none' });
    const { graph, app, ready } = open(Layer.mergeAll(Layer.of(Env, substituted)));
    await ready;

    expect(graph.resolve(Env, app).ssr).toBe(false);
    expect(Env.read().ssr).toBe(true);
    await app.close();
  });

  it('names the field when a published value cannot be read at all', () => {
    const Broken = Config.define('Broken', {
      tier: 'app',
      fields: { ssr: Config.boolean('PUBLIC_SSR', false) },
      from: { PUBLIC_SSR: 'maybe' },
    });
    expect(() => Broken.read()).toThrow(ConfigError);
    expect(() => Broken.read()).toThrow('PUBLIC_SSR');
  });
});

describe('a layer behind a settings field', () => {
  it('is decided when the session opens, not when the tab does', async () => {
    const { graph, app, ready } = open(
      Layer.mergeAll(
        Config.from(Flags, () => ({ ...published, rewards: true })),
        Layer.when(Flags, (flags) => flags.rewards, Rewards),
      ),
    );
    await ready;
    expect(() => graph.resolve(Flags, app)).toThrow(TierMismatchError);

    const { scope, ready: session } = graph.openRung(app, Visitor, Visitor.guest());
    await session;
    expect(graph.resolve(Rewards, scope)).toBeInstanceOf(Rewards);
    await app.close();
  });

  it('leaves the feature out of the graph while the field is off', async () => {
    const { graph, app } = open(
      Layer.mergeAll(
        Config.from(Flags, () => published),
        Layer.when(Flags, (flags) => flags.rewards, Rewards),
      ),
    );
    const { scope, ready } = graph.openRung(app, Visitor, Visitor.guest());
    await ready;

    expect(graph.has(Rewards, scope)).toBe(false);
    await app.close();
  });

  it('refuses a key that would outlive the field that admitted it', async () => {
    const { graph, app } = open(
      Layer.mergeAll(
        Config.from(Flags, () => ({ ...published, rewards: true })),
        Layer.when(Flags, (flags) => flags.rewards, Analytics),
      ),
    );
    await expect(
      (async () => {
        const { ready } = graph.openRung(app, Visitor, Visitor.guest());
        await ready;
      })(),
    ).rejects.toThrow(LayerTierError);
    await app.close();
  });
});
