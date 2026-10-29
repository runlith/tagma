import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { type AxNode, snapshotWalk } from './snapshot.js';

const node = (nodeId: string, role: string, name: string, childIds: readonly string[] = [], backendDOMNodeId?: number): AxNode => ({
  nodeId,
  role: { value: role },
  name: { value: name },
  childIds,
  backendDOMNodeId,
});

const TREE = new Map<string, AxNode>([
  ['root', node('root', 'RootWebArea', 'Page', ['wrap', 'more'])],
  ['wrap', node('wrap', 'generic', '', ['button', 'text'])],
  ['button', node('button', 'button', 'Save', ['label'], 7)],
  ['label', node('label', 'StaticText', 'Save', ['box'])],
  ['box', node('box', 'InlineTextBox', 'Save')],
  ['text', node('text', 'StaticText', 'Plain words')],
  ['more', node('more', 'link', 'Next', [], 9)],
]);

const part = {
  root: Effect.succeed(TREE.get('root')!),
  children: (held: AxNode) =>
    held.nodeId === 'label'
      ? Effect.die('a text node has no accessibility children to read')
      : Effect.succeed((held.childIds ?? []).map((id) => TREE.get(id)!)),
  header: null,
  renderRoot: false,
};

it.effect('the walk renders the tree in document order up to its limit, says more lies past it, and asks no children of text', () =>
  Effect.gen(function* () {
    const whole = yield* snapshotWalk([part], 10);
    expect(whole).toEqual({
      lines: ['- button "Save"', '- text "Plain words"', '- link "Next"'],
      nodes: [7, -1, 9],
      frames: [0, 0, 0],
      more: false,
    });
    const cut = yield* snapshotWalk([part], 2);
    expect([cut.lines, cut.more]).toEqual([['- button "Save"', '- text "Plain words"'], true]);
  }),
);

it.effect('a snapshot capped at a frame boundary leaves the next frame unread', () =>
  Effect.gen(function* () {
    const cut = yield* snapshotWalk([part, { ...part, root: Effect.die('the later frame is unavailable') }], 3);
    expect(cut).toEqual({
      lines: ['- button "Save"', '- text "Plain words"', '- link "Next"'],
      nodes: [7, -1, 9],
      frames: [0, 0, 0],
      more: true,
    });
  }),
);
