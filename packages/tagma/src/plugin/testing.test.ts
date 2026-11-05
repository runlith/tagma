import { expect, test } from 'bun:test';
import { z } from 'zod';
import { beforeBuild, definePlugin, Refusal, schedule, tool } from './plugin.js';
import { testPlugin } from './testing.js';

test('testPlugin runs a tick, a build step and a refusing tool through the handlers the process serves', async () => {
  const ticks: string[] = [];
  const plugin = definePlugin({
    id: 'pin',
    title: 'Pin',
    tools: {
      move: tool({
        description: 'Move the pin.',
        audience: 'agents',
        input: z.object({ to: z.string() }),
        run: async ({ to }) => {
          if (to === 'nowhere') throw new Refusal('there is nowhere to move to');
          return { moved: to };
        },
      }),
    },
    schedules: {
      check: schedule({ every: '1h', run: async (tick, ctx) => void ticks.push(`${tick.name}:${ctx.caller.kind}:${ctx.project}`) }),
    },
    beforeBuild: { pin: beforeBuild({ title: 'Pin', run: async (step) => ({ verdict: step.offer === 'head' ? 'go' : 'pending' }) }) },
  });
  const tested = testPlugin(plugin);
  expect(tested.manifest.contributes?.schedule).toEqual([{ name: 'check', everyMs: 3_600_000, tool: '__schedule_check' }]);
  expect(await tested.tick('check')).toEqual({ text: '', isError: false });
  expect(ticks).toEqual(['check:tagma:null']);
  expect(await tested.build('pin', { offer: 'head', checkout: '/c' })).toEqual({ text: '{"verdict":"go"}', isError: false });
  expect(await tested.call('move', { to: 'nowhere' })).toEqual({ text: 'there is nowhere to move to', isError: true });
  expect(await tested.call('move', { to: 'x' })).toEqual({ text: '{"moved":"x"}', isError: false, structured: { moved: 'x' } });
});
