import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { writePlugin } from '../../../plugin-formats/tagma/testing/folder.js';
import { makeDoorWorld } from '../doorFixture.js';

const tool = (name: string, audience: string) => ({ name, audience, description: name, inputSchema: { type: 'object' } });
const views = [{ id: 'board', entry: 'ui/Board.svelte' }];

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
  {
    contributes: { themes: { swapped: { title: 'Swapped', dark: { signals: { failure: '#a3be8c' } } } } },
    reason:
      "contributes.themes: the theme swapped, dark: signals.failure #a3be8c reads as done: its hue 131° is outside failure's 322°–31°",
  },
  ...[`oklch(0.7 ${'9'.repeat(309)} 20)`, `oklch(0.7 0.19 ${'9'.repeat(309)})`].map((failure) => ({
    contributes: { themes: { wide: { title: 'Wide', dark: { signals: { failure } } } } },
    reason: 'contributes.themes: write a colour as #rrggbb, or oklch(L C H) with L and C from 0 to 1 and H in degrees under 1000',
  })),
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

it.live('a plugin row says a view uses the camera and microphone only when a view frames a site with media', () =>
  Effect.gen(function* () {
    const world = yield* makeDoorWorld();
    const scope = `project=${yield* world.stealthProject()}`;
    const installed: string[] = [];
    yield* Effect.addFinalizer(() =>
      Effect.forEach(installed, (id) => world.op('uninstall_plugin', { id }, scope), { discard: true }).pipe(Effect.orDie),
    );
    const detailOf = Effect.fnUntraced(function* (id: string, views: readonly Readonly<Record<string, unknown>>[]) {
      const root = yield* world.directory(id);
      yield* Effect.promise(() => writePlugin(root, { id, contributes: { views } }));
      const answer = yield* world.op('install_plugin', { source: root, enabled: false }, scope);
      installed.push(id);
      const { plugin } = answer.body as {
        readonly plugin: { readonly components: readonly { readonly name: string; readonly detail?: string }[] };
      };
      return plugin.components.find((component) => component.name === 'views')?.detail;
    });
    expect(
      yield* detailOf('meeting', [
        { id: 'room', entry: 'ui/Room.svelte', media: true },
        { id: 'list', entry: 'ui/List.svelte' },
      ]),
    ).toBe('Uses camera and microphone');
    expect(yield* detailOf('plain', [{ id: 'list', entry: 'ui/List.svelte' }])).toBeUndefined();
  }),
);
