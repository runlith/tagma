import { expect, test } from 'bun:test';
import { type ViewIdentity, viewFrameName, viewOfFrameName } from './viewName.js';

test('a view frame name carries its identity back whatever characters it holds, and a foreign or malformed name is no view', () => {
  const views: ViewIdentity[] = [
    { _tag: 'PluginView', project: 12, plugin: 'notes', view: 'board:main/1' },
    { _tag: 'McpView', server: 'my "server": v2' },
  ];
  for (const view of views) expect(viewOfFrameName(viewFrameName(view))).toEqual(view);
  for (const name of [
    '',
    'sidebar',
    'tagma-view:',
    'tagma-view:{"_tag":"PluginView","project":0,"plugin":"a","view":"b"}',
    'tagma-view:{"_tag":"Page"}',
  ])
    expect(viewOfFrameName(name)).toBeUndefined();
});
