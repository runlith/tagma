// @vitest-environment jsdom
import type { Installed } from '@tagma/server/installation/contract/wire/next';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import InstallFailed from './InstallFailed.svelte';

const mounted: Record<string, unknown>[] = [];

afterEach(async () => {
  for (const app of mounted.splice(0)) await unmount(app);
  document.body.replaceChildren();
});

const failed = (refused?: Installed['refused']): Installed => ({
  offer: 'head',
  title: 'Latest commit',
  target: 'abc1234',
  outcome: 'failed',
  build: null,
  detail: 'bun run tagma:build ended with code 2',
  endedAt: '2026-11-01T04:00:00Z',
  log: '/data/build.log',
  since: '2026-11-01T03:59:00Z',
  tail: ['    at valueOf (/build/kit/declarations.ts:51:15)', 'refused[release-failed]: program: macro threw exception'],
  then: 'restart',
  restartRefused: null,
  refused,
});

const card = (given: Installed, openThread?: (thread: { projectId: number; threadId: string }) => void): HTMLElement => {
  const target = document.createElement('div');
  document.body.append(target);
  mounted.push(mount(InstallFailed, { target, props: { failed: given, title: 'not installed', retry: undefined, openThread } }));
  flushSync();
  return target;
};

test('a failed build shows the refusal’s reason with its unblock acts under Show all, and leaves the raw output to its log', () => {
  const shown = card(
    failed({ code: 'release-failed', reason: 'program: macro threw exception', unblock: ['commit the changes', 'build the tree'] }),
  );
  expect(shown.textContent).toContain('program: macro threw exception');
  expect(shown.textContent).not.toContain('at valueOf');
  expect(shown.querySelector('[data-install-log]')?.getAttribute('data-install-log')).toBe('/data/build.log');
  expect(shown.querySelector('[data-install-unblock]')).toBeNull();

  shown.querySelector<HTMLButtonElement>('[aria-expanded]')!.click();
  flushSync();
  expect([...shown.querySelectorAll('[data-install-unblock] li')].map((line) => line.textContent)).toEqual([
    'commit the changes',
    'build the tree',
  ]);
});

test('a failure that carries no refusal reads its own detail as the reason', () => {
  expect(card(failed()).textContent).toContain('bun run tagma:build ended with code 2');
});

test('a step that stopped the update and named a thread opens that thread', () => {
  const opened: { projectId: number; threadId: string }[] = [];
  const shown = card(
    failed({
      code: 'build-step-stopped',
      reason: 'Core pin stopped the update: the pin does not converge',
      unblock: ['update again once that is settled'],
      thread: { projectId: 42, threadId: 'thread-1' },
    }),
    (thread) => opened.push(thread),
  );
  shown.querySelector<HTMLButtonElement>('[data-install-thread]')!.click();
  expect(opened).toEqual([{ projectId: 42, threadId: 'thread-1' }]);
  expect(card(failed()).querySelector('[data-install-thread]')).toBeNull();
});
