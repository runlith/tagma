import { expect, test } from 'bun:test';
import { type ViewIdentity, viewFrameName, viewOfFrameName } from './viewName.js';

test('a view frame name carries its identity back whatever characters it holds, and a foreign or malformed name is no view', () => {
  const views: ViewIdentity[] = [
    { _tag: 'AppView', project: 12, app: 'notes', view: 'board:main/1' },
    { _tag: 'McpView', server: 'my "server": v2' },
  ];
  for (const view of views) expect(viewOfFrameName(viewFrameName(view))).toEqual(view);
  for (const name of [
    '',
    'sidebar',
    'tagma-view:',
    'tagma-view:{"_tag":"AppView","project":0,"app":"a","view":"b"}',
    'tagma-view:{"_tag":"Page"}',
  ])
    expect(viewOfFrameName(name)).toBeUndefined();
});
