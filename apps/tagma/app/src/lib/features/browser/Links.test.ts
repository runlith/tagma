import { openLinks } from '@tagma/server/browser/contract/wire/settings';
import { expect, test } from 'vitest';
import { besideOf } from '$lib/app/opening/beside.js';
import { testArea, testKind } from '$lib/app/panes/testing.js';
import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import type { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import type { Door } from '$lib/wire/Door.js';
import { Refusal } from '$lib/wire/refusal.js';
import { Links } from './Links.svelte.js';

function linksWith(refused: Refusal) {
  const system: string[] = [];
  const told: unknown[] = [];
  const door = {
    perform: async () => {
      throw refused;
    },
  } as unknown as Door;
  const settings = {
    catalog: { key: () => ({ data: { entries: [{ id: openLinks.id, value: true }] } }) },
    write: { data: undefined },
  } as unknown as ReturnType<typeof SettingsRepo.use>;
  const { panes } = testArea([testKind('browser')]);
  const seats = new ThreadSeats(panes);
  const links = new Links(
    door,
    besideOf(panes, seats),
    () => ({ projectId: 1 }),
    settings,
    { refusal: (error: unknown) => void told.push(error) } as unknown as Notices,
    { open: (url) => void system.push(url) },
  );
  return { links, system, told };
}

const refusal = (code: string) => new Refusal({ gate: true, code, reason: code, unblock: [] });

test('with no browser host to serve a page, a link opens in the system browser without a notice; another refusal is told', async () => {
  const away = linksWith(refusal('host-away'));
  expect(await away.links.beside('https://example.com/a')).toBe('system');
  expect(away.system).toEqual(['https://example.com/a']);
  expect(away.told).toEqual([]);

  const blocked = linksWith(refusal('page-blocked'));
  expect(await blocked.links.beside('https://example.com/b')).toBe('system');
  expect(blocked.told).toHaveLength(1);
});
