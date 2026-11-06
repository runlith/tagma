import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { writePlugin } from '../../../plugin-formats/tagma/testing/folder.js';
import { makeDoorWorld } from '../doorFixture.js';

const tool = (name: string, audience: string) => ({ name, audience, description: name, inputSchema: { type: 'object' } });
const views = [{ id: 'board', entry: 'ui/board.html' }];

const REFUSED: readonly { readonly contributes: Readonly<Record<string, unknown>>; readonly reason: string }[] = [
  {
    contributes: { views, tools: [tool('show', 'agents')], results: [{ tool: 'show', view: 'nowhere' }] },
    reason: 'contributes.results: names the view nowhere',
  },
  {
    contributes: { views, tools: [tool('show', 'view')], results: [{ tool: 'show', view: 'board' }] },
    reason: 'contributes.results: no agent calls show',
  },
  { contributes: { views, surfaces: [{ view: 'nowhere', title: 'Nowhere' }] }, reason: 'contributes.surfaces: names the view nowhere' },
  { contributes: { views, panes: [{ view: 'nowhere', title: 'Nowhere' }] }, reason: 'contributes.panes: names the view nowhere' },
  { contributes: { views, launchers: [{ view: 'nowhere', title: 'Nowhere' }] }, reason: 'contributes.launchers: names the view nowhere' },
  { contributes: { views, pins: [{ view: 'nowhere' }] }, reason: 'contributes.pins: names the view nowhere' },
  { contributes: { tools: [], on: { ended: 'gone' } }, reason: 'contributes.on: contributes.tools names no tool gone' },
  {
    contributes: { tools: [tool('beat', 'agents')], schedule: [{ name: 'beat', everyMs: 60_000, tool: 'beat' }] },
    reason: 'contributes.schedule: the tool beat is offered to agents',
  },
  {
    contributes: { beforeBuild: [{ tool: 'step', title: 'Step' }] },
    reason: 'contributes.beforeBuild: contributes.tools names no tool step',
  },
  {
    contributes: { tools: [tool('answer', 'own')], notify: { tool: 'answer' } },
    reason: 'contributes.notify: the tool answer is offered to own',
  },
  { contributes: { tools: [tool('x'.repeat(60), 'agents')] }, reason: `contributes.tools: ${'x'.repeat(60)} named under` },
];

it.live('a manifest whose points do not agree with each other refuses its install with the point and the reason', () =>
  Effect.gen(function* () {
    const world = yield* makeDoorWorld();
    const scope = `project=${yield* world.stealthProject()}`;
    const installed: string[] = [];
    yield* Effect.addFinalizer(() =>
      Effect.forEach(installed, (id) => world.op('uninstall_plugin', { id }, scope), { discard: true }).pipe(Effect.orDie),
    );
    for (const [at, { contributes, reason }] of REFUSED.entries()) {
      const root = yield* world.directory(`checked-${at}`);
      const id = `checked-${at}`;
      yield* Effect.promise(() => writePlugin(root, { id, contributes }));
      const answer = yield* world.op('install_plugin', { source: root }, scope);
      if (answer.status === 200) installed.push(id);
      expect(answer.body).toMatchObject({ code: 'plugin-refused', reason: expect.stringContaining(reason) });
    }
  }),
);
