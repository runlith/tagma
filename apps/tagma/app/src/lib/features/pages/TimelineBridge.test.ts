import { expect, test } from 'vitest';
import type { HostMessage } from '@tagma/server/artifacts/contract/wire/timeline';
import { TimelineBridge } from './TimelineBridge.js';

const rig = () => {
  const page = {};
  const posted: HostMessage[] = [];
  const drawn: [number, string | null][] = [];
  let readied = 0;
  const bridge = new TimelineBridge(
    { source: () => page, post: (message) => posted.push(message) },
    { ready: () => (readied += 1), drawn: (k, failure) => drawn.push([k, failure]) },
  );
  const say = (data: unknown, source: object = page) => bridge.receive({ source, data });
  return { bridge, posted, drawn, say, readied: () => readied };
};

test('the host keeps one seek in flight and sends the newest wanted frame once the page drew the last', () => {
  const { bridge, posted, say } = rig();
  bridge.seek(3);
  expect(posted).toEqual([]);

  say({ type: 'tagma:ready' });
  bridge.seek(4);
  bridge.seek(5);
  expect(posted).toEqual([{ type: 'tagma:seek', k: 3 }]);

  say({ type: 'tagma:frame', k: 3 });
  say({ type: 'tagma:frame', k: 3 });
  expect(posted).toEqual([
    { type: 'tagma:seek', k: 3 },
    { type: 'tagma:seek', k: 5 },
  ]);

  say({ type: 'tagma:frame', k: 5 });
  bridge.seek(5);
  expect(posted).toHaveLength(2);
});

test('a reloaded page is greeted, and its readiness sends the wanted frame again even when it is the one shown before', () => {
  const { bridge, posted, say, readied } = rig();
  say({ type: 'tagma:ready' });
  say({ type: 'tagma:frame', k: 0 });

  bridge.hello();
  say({ type: 'tagma:frame', k: 0 });
  say({ type: 'tagma:ready' });

  expect(readied()).toBe(2);
  expect(posted).toEqual([{ type: 'tagma:seek', k: 0 }, { type: 'tagma:hello' }, { type: 'tagma:seek', k: 0 }]);
});

test('only the frame window is heard, and a frame the page failed to draw is reported with its reason', () => {
  const { bridge, posted, drawn, say } = rig();
  say({ type: 'tagma:ready' }, {});
  expect(posted).toEqual([]);

  bridge.seek(2);
  say({ type: 'tagma:ready' });
  say({ type: 'tagma:frame', k: 2 }, {});
  say({ type: 'tagma:frame', k: 'two' });
  say({ type: 'tagma:frame', k: 2, error: 'render threw' });

  expect(posted).toEqual([{ type: 'tagma:seek', k: 2 }]);
  expect(drawn).toEqual([[2, 'render threw']]);
});
