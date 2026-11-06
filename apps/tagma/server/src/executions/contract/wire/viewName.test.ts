import { expect, test } from 'bun:test';
import { type ViewIdentity, viewFrameName, viewOfFrameName } from './viewName.js';

test('a view frame name carries its identity back whatever characters it holds, and a foreign or malformed name is no view', () => {
  const view: ViewIdentity = { _tag: 'McpView', server: 'my "server": v2' };
  expect(viewOfFrameName(viewFrameName(view))).toEqual(view);
  for (const name of [
    '',
    'sidebar',
    'tagma-view:',
    'tagma-view:{"_tag":"McpView","server":""}',
    'tagma-view:{"_tag":"PluginView","project":1,"plugin":"a","view":"b"}',
    'tagma-view:{"_tag":"Page"}',
  ])
    expect(viewOfFrameName(name)).toBeUndefined();
});
