import type { ThreadTypesPage } from '@tagma/server/threads/contract/wire/birth';
import { Scope } from '@runlith/layer/Scope';
import { expect, test, vi } from 'vitest';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { AgentTypes } from './AgentTypes.svelte.js';

const page = (id: string): ThreadTypesPage => ({
  types: [{ id, name: id, description: '', baseAgentId: 'tagma' }],
  rejected: [],
  default: 'tagma',
  modes: [],
});

test('a library save refresh supersedes an older catalog read and later reads are not cached forever', async () => {
  const scope = Scope.make();
  const stale = Promise.withResolvers<ThreadTypesPage>();
  const fresh = Promise.withResolvers<ThreadTypesPage>();
  const read = vi.fn<() => Promise<ThreadTypesPage>>().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
  const types = new AgentTypes({ types: { run: read } } as never, 1, new Notices(scope), scope);

  const first = types.read();
  const afterSave = types.read(true);
  fresh.resolve(page('new-agent'));
  await afterSave;
  stale.resolve(page('old-agent'));
  await first;
  expect(types.rows).toEqual(page('new-agent').types);

  read.mockResolvedValueOnce(page('later-agent'));
  await types.read();
  expect(types.rows).toEqual(page('later-agent').types);
  await scope.close();
});
