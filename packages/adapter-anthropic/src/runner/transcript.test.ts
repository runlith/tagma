import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { HostedMessage } from '@runlith/hosted-runner/wire/messages';
import type { ClaudeSdk } from './channel.js';
import { seed, transcriptOf } from './transcript.js';

const sdk: ClaudeSdk = {
  open: () => Effect.die('seeding opens no query'),
  transcript: async () => [],
};

it.effect('a history is carried as text when the version of Claude Code is unknown, since a session file needs one', () =>
  Effect.gen(function* () {
    const history: HostedMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'the code is 111' }] }];
    const told: string[] = [];
    const seeded = yield* seed(
      sdk,
      history,
      { id: crypto.randomUUID(), cwd: '/work', version: null, model: null },
      (line) => void told.push(line),
    );
    expect(told).toHaveLength(1);
    expect(seeded).toMatchObject({ _tag: 'Recap', recap: expect.arrayContaining([{ type: 'text', text: 'the code is 111' }]) });
  }),
);

test('a session built from the journal calls each tool by the name Claude Code knows it by', () => {
  const call = (id: string, name: string) => ({ type: 'call' as const, id, name, input: {} });
  const history: HostedMessage[] = [
    { role: 'assistant', content: [call('t1', 'read'), call('t2', 'webfetch'), call('t3', 'mcp__github__search')] },
  ];
  const [assistant] = transcriptOf(history, { id: crypto.randomUUID(), cwd: '/work', version: '2.1.296', model: null }, 0);
  const named = ((assistant!.message as { content: { name: string }[] }).content ?? []).map((part) => part.name);
  expect(named).toEqual(['mcp__tagma__read', 'WebFetch', 'mcp__github__search']);
});
