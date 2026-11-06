import { expect, test } from 'bun:test';
import { z } from 'zod';
import { action, beforeBuild, definePlugin, hook, type PluginDefinition, Refusal, resource, schedule, tool } from './plugin.js';
import { testPlugin } from './testing.js';

test('a definition naming a field the SDK does not take is refused with the field it means', () => {
  const misspelled = {
    id: 'typo',
    title: 'Typo',
    schedule: { beat: schedule({ every: '1h', run: async () => undefined }) },
    surface: [{ view: 'board', title: 'Board' }],
  } as PluginDefinition;
  expect(() => testPlugin(misspelled)).toThrow('schedule (write schedules), surface (write surfaces)');
});

test('models.ask sends a Standard Schema as JSON Schema and answers the typed value, refusing an answer off the shape', async () => {
  const sent: unknown[] = [];
  const plugin = definePlugin({
    id: 'tutor',
    title: 'Tutor',
    tools: {
      grade: tool({
        description: 'Grade a sentence.',
        audience: 'agents',
        run: async (_input, ctx) => {
          const graded = await ctx.models.ask('Grade: Ich bin müde.', { schema: z.object({ score: z.number() }) });
          return { doubled: graded.score * 2 };
        },
      }),
      greet: tool({
        description: 'Greet.',
        audience: 'agents',
        run: async (_input, ctx) => ctx.models.ask('Say hello.', { system: 'Be brief.' }),
      }),
    },
  });
  let answer: unknown = { status: 'object', value: { score: 4 } };
  const tested = testPlugin(plugin, {
    tagma: async (operation, input) => {
      sent.push([operation, input]);
      return answer;
    },
  });
  expect(await tested.call('grade')).toEqual({ text: '{"doubled":8}', isError: false, structured: { doubled: 8 } });
  expect(sent).toEqual([
    [
      'ask_model',
      {
        prompt: 'Grade: Ich bin müde.',
        schema: { type: 'object', properties: { score: { type: 'number' } }, required: ['score'] },
      },
    ],
  ]);
  answer = { status: 'object', value: { score: 'high' } };
  const off = await tested.call('grade');
  expect(off.isError).toBe(true);
  expect(off.text).toContain('score');
  answer = { status: 'text', text: 'Hallo' };
  expect(await tested.call('greet')).toEqual({ text: 'Hallo', isError: false });
  expect(sent.at(-1)).toEqual(['ask_model', { prompt: 'Say hello.', system: 'Be brief.' }]);
});

test('testPlugin runs a tick, a build step, a refusing tool and a project-keyed resource through the handlers the process serves', async () => {
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
    resources: {
      board: resource({
        uri: 'notes://project/{project}',
        read: async ({ project }, ctx) => {
          if (Number(project) !== ctx.project) throw new Refusal('a view reads only its own project');
          return { project };
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
  expect(await tested.read('notes://project/1')).toEqual({ text: '{"project":"1"}', isError: false });
  expect(await tested.read('notes://project/2')).toEqual({ text: 'a view reads only its own project', isError: true });
});

test('an action is a tool Tagma alone calls, listed in actions with the chords the plugin proposes, and answers the operator one sentence', async () => {
  const plugin = definePlugin({
    id: 'boards',
    title: 'Boards',
    actions: {
      sync: action({ title: 'Sync boards', run: async (_input, ctx) => `Synced in project ${ctx.project}` }),
      quiet: action({ title: 'Do nothing', run: async () => undefined }),
    },
    shortcuts: [{ keys: 'Mod+Alt+S', action: 'sync', global: true }],
  });
  const tested = testPlugin(plugin);
  expect(tested.manifest.contributes?.actions).toEqual([
    { id: 'sync', title: 'Sync boards', tool: '__action_sync' },
    { id: 'quiet', title: 'Do nothing', tool: '__action_quiet' },
  ]);
  expect(tested.manifest.contributes?.shortcuts).toEqual([{ keys: 'Mod+Alt+S', action: 'sync', global: true }]);
  expect(await tested.act('sync', 7)).toEqual({ text: 'Synced in project 7', isError: false });
  expect(await tested.act('quiet')).toEqual({ text: '', isError: false });
});

test('a hook is a tool Tagma alone calls, listed in hooks with its match, and its rewrite answers the input the runner reads', async () => {
  const plugin = definePlugin({
    id: 'keeper',
    title: 'Keeper',
    hooks: {
      secrets: hook({
        at: 'beforeTool',
        match: 'read|edit',
        onFailure: 'block',
        run: async (event) =>
          String((event.input as { path?: string }).path).endsWith('.env')
            ? { deny: 'secrets stay closed' }
            : { rewrite: { path: 'README.md' }, context: `seen in ${event.cwd}` },
      }),
    },
  });
  const tested = testPlugin(plugin);
  expect(tested.manifest.contributes?.hooks).toEqual([
    { at: 'beforeTool', match: 'read|edit', tool: '__hook_secrets', onFailure: 'block' },
  ]);
  const event = { at: 'beforeTool', threadId: 't1', cwd: '/w', tool: 'read', callId: 'c1' } as const;
  expect((await tested.check('secrets', { ...event, input: { path: '.env' } })).structured).toEqual({ deny: 'secrets stay closed' });
  expect((await tested.check('secrets', { ...event, input: { path: 'a.md' } })).structured).toEqual({
    input: { path: 'README.md' },
    context: 'seen in /w',
  });
});
