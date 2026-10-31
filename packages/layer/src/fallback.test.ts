import { describe, expect, it } from 'vitest';

import { DuplicateProviderError, Graph } from './Graph.js';
import { Service } from './key.js';
import { Layer, type AnyLayer } from './Layer.js';
import { Scope } from './Scope.js';

function inlineRoot(build: () => void): () => void {
  build();
  return () => undefined;
}

function open(layer: AnyLayer) {
  const graph = new Graph(layer, { effectRoot: inlineRoot });
  const app = Scope.make();
  return { graph, app, ready: graph.open(app) };
}

interface PaceShape {
  readonly beat: number;
}

class SteadyPace implements PaceShape {
  readonly beat = 60;
}

class Pace extends Service<PaceShape>()('Fallback.Pace', { tier: 'app' }) {
  static make(): PaceShape {
    return new SteadyPace();
  }
}

class Theme extends Service<{ readonly name: string }>()('Fallback.Theme', { tier: 'app' }) {}

const quick: PaceShape = { beat: 120 };

describe('Layer.fallback', () => {
  it('answers the owner’s implementation when nothing replaces it, and a plain object listed anywhere in the manifest when one does', async () => {
    const alone = open(Layer.mergeAll(Layer.fallback(Pace)) as AnyLayer);
    await alone.ready;
    expect(alone.graph.resolve(Pace, alone.app)).toBeInstanceOf(SteadyPace);

    const replaced = open(Layer.mergeAll(Layer.of(Pace, quick), Layer.fallback(Pace)) as AnyLayer);
    await replaced.ready;
    expect(replaced.graph.resolve(Pace, replaced.app)).toBe(quick);
  });

  it('keeps every key not declared a port sealed, and lets one owner declare a port’s fallback once', () => {
    expect(() => open(Layer.mergeAll(Layer.of(Theme, { name: 'a' }), Layer.of(Theme, { name: 'b' })) as AnyLayer)).toThrow(
      DuplicateProviderError,
    );
    expect(() =>
      open(
        Layer.mergeAll(
          Layer.fallback(Theme, () => ({ name: 'a' })),
          Layer.fallback(Theme, () => ({ name: 'b' })),
        ) as AnyLayer,
      ),
    ).toThrow(DuplicateProviderError);
  });

  it('yields to a replacement that stands before or with it, and refuses one admitted after it under a condition or from a chunk', async () => {
    const underCondition = open(
      Layer.mergeAll(
        Layer.of(Pace, quick),
        Layer.when(() => true, Layer.fallback(Pace)),
      ) as AnyLayer,
    );
    await underCondition.ready;
    expect(underCondition.graph.resolve(Pace, underCondition.app)).toBe(quick);

    const inOneChunk = open(
      Layer.when(
        () => true,
        async () => ({ default: Layer.mergeAll(Layer.fallback(Pace), Layer.of(Pace, quick)) }),
      ) as AnyLayer,
    );
    await inOneChunk.ready;
    expect(inOneChunk.graph.resolve(Pace, inOneChunk.app)).toBe(quick);

    expect(() =>
      open(
        Layer.mergeAll(
          Layer.fallback(Pace),
          Layer.when(() => true, Layer.of(Pace, quick)),
        ) as AnyLayer,
      ),
    ).toThrow(DuplicateProviderError);
    await expect(
      open(
        Layer.mergeAll(
          Layer.fallback(Pace),
          Layer.when(
            () => true,
            async () => ({ default: Layer.of(Pace, quick) }),
          ),
        ) as AnyLayer,
      ).ready,
    ).rejects.toThrow(DuplicateProviderError);
  });
});
