import { Effect, Layer } from 'effect';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type FrozenState, type Served } from '../contract/wire/builds.js';
import { DESKTOP, type Installation, SURFACE } from '../contract/wire/manifest.js';
import { FrozenBuilds } from '../contract/service/builds.js';
import { surfacePlaceholderPage } from './placeholder.js';

const PLACEHOLDER = 'placeholder';

export const surfaceRoot = (dataPath: string, standing: Installation | undefined): string =>
  standing === undefined ? join(dataPath, PLACEHOLDER) : join(standing.root, SURFACE);

export const frozenBuildsLayer = (options: { dataPath: string; standing?: Installation }): Layer.Layer<FrozenBuilds> =>
  Layer.effect(FrozenBuilds, make(options));

const make = Effect.fn('FrozenBuilds.make')(function* (options: { dataPath: string; standing?: Installation }) {
  const frozen = stand(options.dataPath, options.standing);
  return { state: Effect.succeed(frozen) } satisfies FrozenBuilds['Service'];
});

export function stand(dataPath: string, standing: Installation | undefined): FrozenState {
  if (standing === undefined) {
    standPlaceholder(join(dataPath, PLACEHOLDER));
    return { surface: { served: null }, host: { served: null } };
  }
  const part = (place: string): Served => ({ build: standing.manifest.identity.build, root: join(standing.root, place) });
  return { surface: { served: part(SURFACE) }, host: { served: part(DESKTOP) } };
}

function standPlaceholder(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'index.html'), surfacePlaceholderPage());
}
