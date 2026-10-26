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

const asked: string[] = [];

const part = {
  root: Effect.succeed(TREE.get('root')!),
  children: (held: AxNode) =>
    Effect.sync(() => {
      asked.push(held.nodeId);
      return (held.childIds ?? []).map((id) => TREE.get(id)!);
    }),
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
    expect(asked).not.toContain('label');
    const cut = yield* snapshotWalk([part], 2);
    expect([cut.lines, cut.more]).toEqual([['- button "Save"', '- text "Plain words"'], true]);
  }),
);
