// @vitest-environment jsdom
import { keptChords, OWNED } from '@tagma/desktop/kept';
import { chordId, type HostChord, hostChordOf } from '@tagma/server/platform/contract/wire/chord';
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { Platform } from '@runlith/layer/Platform';
import { Router } from '@runlith/layer/Router';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { makePlatform, makeRouter } from '@runlith/layer/testing';
import { afterEach, expect, test } from 'vitest';
import { resolveKeys } from '$lib/app/keys/resolve.js';
import { browserKept } from '$lib/features/shortcuts/kept.svelte.js';
import { type Action, Actions, keyedOf } from '$lib/features/workspace/action.js';
import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
import { FileSaver } from '$lib/shared/FileSaver.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { TEST_ORIGIN } from '$lib/wire/testing.js';
import { appLayers, LADDER } from './composition.js';

let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

const composed = (): readonly Action[] => {
  const graph = mountApp(
    appLayers(undefined),
    Layer.mergeAll(
      Layer.of(Platform, makePlatform()),
      Layer.of(Router, makeRouter()),
      Host.tab(),
      ServerOrigin.of(TEST_ORIGIN),
      Layer.of(ExternalLinks, { open: () => undefined }),
      Layer.of(FileSaver, { save: () => undefined }),
    ) as never,
    { ladder: LADDER, data: 'lazy' },
  );
  unmount = () => graph.unmount();
  return graph.get(Actions).items.flatMap(({ actions }) => (typeof actions === 'function' ? actions() : actions));
};

const parsed = (texts: readonly string[], mac: boolean): readonly HostChord[] => texts.flatMap((text) => hostChordOf(text, mac) ?? []);

test("no two of Tagma's own defaults hold one chord on any host, measured against the chords that host keeps", () => {
  const actions = [...composed(), ...OWNED.map((owned): Action => ({ id: owned.id, title: owned.title, keys: owned.keys, tabKeys: [] }))];
  const hosts = [
    { host: new Host('desktop', 'macos'), kept: parsed(keptChords('darwin'), true) },
    { host: new Host('desktop', 'linux'), kept: parsed(keptChords('linux'), false) },
    { host: new Host('desktop', 'windows'), kept: parsed(keptChords('win32'), false) },
    ...(['macos', 'linux', 'windows'] as const).map((os) => {
      const host = new Host('tab', os);
      return { host, kept: browserKept(host).kept };
    }),
  ];
  const doubles = hosts.flatMap(({ host, kept }) =>
    resolveKeys(keyedOf(actions, host), {}, kept).displaced.map(
      (one) =>
        `${host.kind} ${host.os}: ${one.action} ${chordId(one.chord)} held by ${one.by.kind === 'shell' ? 'the shell' : one.by.action}`,
    ),
  );
  expect(actions.length).toBeGreaterThan(20);
  expect(doubles).toEqual([]);
});
