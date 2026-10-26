import { expect } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { digestOf } from '@runlith/executions/hostArtifacts';
import type { Installation } from '../contract/wire/manifest.js';
import { fixtureRoot } from '../../platform/testing/roots.js';
import { FrozenBuilds } from '../contract/service/builds.js';
import { frozenBuildsLayer } from './frozen.js';

const owned = Effect.acquireRelease(
  Effect.sync(() => {
    const path = fixtureRoot('frozen-builds', '');
    mkdirSync(path, { recursive: true });
    return path;
  }),
  (path) => Effect.sync(() => rmSync(path, { force: true, recursive: true })),
);

const digest = (of: string) => digestOf(new TextEncoder().encode(of));

const closure = (root: string, build: string): Installation => ({
  root,
  manifest: {
    version: 1,
    identity: { digest: digest(build), build },
    platform: { os: 'darwin', arch: 'arm64' },
    parts: [{ role: 'surface', path: 'surface/index.html', kind: 'file', bytes: 15, digest: digest('a page') }],
  },
});

const stood = (options: { dataPath: string; standing?: Installation }) =>
  Effect.scoped(Layer.build(frozenBuildsLayer(options)).pipe(Effect.flatMap((built) => Context.get(built, FrozenBuilds).state)));

it.live('an installation standing on this machine is what both parts come out of, named by its own build', () =>
  Effect.gen(function* () {
    const base = yield* owned;
    const data = mkdtempSync(join(base, 'data-'));
    const root = mkdtempSync(join(base, 'closure-'));

    const state = yield* stood({ dataPath: data, standing: closure(root, 'abc1234 20260202T000000000Z') });

    expect(state.surface.served?.build).toBe('abc1234 20260202T000000000Z');
    expect(state.host.served?.build).toBe('abc1234 20260202T000000000Z');
    expect(state.surface.served?.root).toBe(join(root, 'surface'));
    expect(state.host.served?.root).toBe(join(root, 'desktop'));
    expect(readdirSync(data)).toEqual([]);
  }),
);

it.live('with nothing installed the surface stands the page that says so, and the application stands nothing at all', () =>
  Effect.gen(function* () {
    const data = mkdtempSync(join(yield* owned, 'data-'));

    const state = yield* stood({ dataPath: data });

    expect(state.surface.served).toBeNull();
    expect(existsSync(join(data, 'placeholder', 'index.html'))).toBe(true);
    expect(state.host.served).toBeNull();
    expect(existsSync(join(data, 'host'))).toBe(false);
  }),
);
