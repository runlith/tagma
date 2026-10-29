import { expect } from 'bun:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Deferred, Effect, Fiber, FileSystem, Queue, Stream } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Automation } from '../contract/service/automation.js';
import { Pages } from '../contract/service/pages.js';
import { Screencast } from '../contract/service/screencast.js';
import type { PageId } from '../contract/wire/ids.js';
import type { Picked, Rendered } from '../contract/wire/pick.js';
import { browserChannels } from '../feeds.js';
import { PAGE_PAIRS as PAGE } from '../operations.js';
import { calling, refIn, Seeded } from './world.js';
import { ServedOrigins } from './sourceRoots.js';

export const REACT_COMPONENT = `function jsxDEV() { return new Error('react-stack-top-frame'); }
function SendButton() { return jsxDEV(); }
SendButton.displayName = 'SendAction';
document.getElementById('react').__reactFiber$fixture = { type: 'button', _debugOwner: { type: SendButton }, _debugStack: SendButton() };
window.stackReads = 0;
`;

export const COMPONENTS = `<!doctype html><title>Dev components</title>
  <button id="svelte" style="margin:20px;width:160px;height:50px">Svelte</button>
  <button id="react" style="margin:20px;width:160px;height:50px">React</button>
  <button id="vue" style="margin:20px;width:160px;height:50px">Vue</button>
  <script>
    document.getElementById('svelte').__svelte_meta = { parent: null, loc: { file: 'src/Send.svelte', line: 12, column: 2 } };
    const vue = { type: { __name: 'SendVue', __file: 'src/Missing.vue' }, ctx: {} };
    Object.defineProperty(vue.ctx, '_', { configurable: true, get: () => vue });
    document.getElementById('vue').__vueParentComponent = vue;
  </script><script src="/src/Send.tsx"></script><iframe src="FRAME_ORIGIN/pick-component-frame" style="display:block;width:300px;height:100px;border:0"></iframe>`;

export const FRAME_COMPONENT = `<!doctype html><button>Frame source</button><script>document.querySelector('button').__svelte_meta = { parent: null, loc: { file: 'src/Send.svelte', line: 7, column: 0 } };</script>`;

export const componentScenario = Effect.fnUntraced(function* (input: {
  readonly page: PageId;
  readonly caller: Caller;
  readonly frameOrigin: string;
}) {
  const { page, caller } = input;
  const automation = yield* Automation;
  const project = yield* (yield* Projects).byId((yield* Seeded).id);
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(join(project.rootPath, 'src'), { recursive: true });
  yield* files.makeDirectory(join(project.rootPath, 'dev/src'), { recursive: true });
  yield* files.writeFileString(join(project.rootPath, 'src/Send.svelte'), '<button>Main</button>');
  yield* files.writeFileString(join(project.rootPath, 'dev/src/Send.svelte'), '<button>Dev</button>');
  yield* files.writeFileString(join(project.rootPath, 'dev/src/Send.tsx'), REACT_COMPONENT);
  yield* files.makeDirectory(join(project.rootPath, 'frame/src'), { recursive: true });
  yield* files.writeFileString(join(project.rootPath, 'frame/src/Send.svelte'), '<button>Frame source</button>');
  const root = yield* files.realPath(project.rootPath);
  const origins = yield* ServedOrigins;
  origins.roots.set(input.frameOrigin, join(root, 'frame'));
  yield* Effect.addFinalizer(() => Effect.sync(() => origins.roots.delete(input.frameOrigin)));
  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `document.getElementById('svelte').__svelte_meta.loc.file = ${JSON.stringify(pathToFileURL(join(root, 'dev/src/Send.svelte')).href)}; document.getElementById('vue').__vueParentComponent.type.__file = ${JSON.stringify(join(root, 'src/Missing.vue'))}`,
      },
      undefined,
      caller,
    ),
  );
  const ready = yield* Deferred.make<void>();
  const descriptions = yield* Queue.unbounded<Picked>();
  const channels = browserChannels(
    yield* Pages,
    Automation.of({
      ...automation,
      pick: (...args) => automation.pick(...args).pipe(Effect.tap(() => Deferred.succeed(ready, undefined))),
    }),
    yield* Screencast,
  );
  const picking = yield* Effect.forkChild(
    Stream.runForEach(channels['browser.pick']({ projectId: project.id, page }), (picked) => Queue.offer(descriptions, picked)),
  );
  yield* Deferred.await(ready);
  const expected: readonly Rendered[] = [
    {
      framework: 'svelte',
      name: 'Send',
      source: {
        file: join(root, 'dev/src/Send.svelte'),
        line: 12,
        column: 3,
        basis: 'element',
        resolved: true,
        checkout: join(root, 'dev'),
      },
    },
    {
      framework: 'react',
      name: 'SendAction',
      source: { file: join(root, 'dev/src/Send.tsx'), line: 2, column: 32, basis: 'stack', resolved: true, checkout: join(root, 'dev') },
    },
    {
      framework: 'vue',
      name: 'SendVue',
      source: { file: join(root, 'src/Missing.vue'), line: null, column: null, basis: 'component', resolved: false, checkout: null },
    },
  ];
  const refs = new Map<string, string>();
  for (const component of expected) {
    const position = yield* calling(
      PAGE.evaluate_in_page.body.execute(
        {
          page,
          expression: `(() => { const box = document.getElementById('${component.framework}').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`,
        },
        undefined,
        caller,
      ),
    );
    if (!('value' in position)) return yield* Effect.die(position.exception);
    const point = JSON.parse(position.value) as { readonly x: number; readonly y: number };
    yield* calling(PAGE.act_on_page.body.execute({ page, steps: [{ action: 'click', ...point }] }, undefined, caller));
    const picked = yield* Queue.take(descriptions);
    refs.set(component.framework, picked.ref);
    expect(picked.component).toEqual(component);
  }
  const snapshot = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, caller));
  yield* calling(
    PAGE.act_on_page.body.execute(
      { page, steps: [{ action: 'click', ref: refIn(snapshot.text, /button "Frame source"/) }] },
      undefined,
      caller,
    ),
  );
  expect((yield* Queue.take(descriptions)).component).toEqual({
    framework: 'svelte',
    name: 'Send',
    source: {
      file: join(root, 'frame/src/Send.svelte'),
      line: 7,
      column: 1,
      basis: 'element',
      resolved: true,
      checkout: join(root, 'frame'),
    },
  });
  const pickReact = () =>
    calling(PAGE.act_on_page.body.execute({ page, steps: [{ action: 'click', ref: refs.get('react')! }] }, undefined, caller));
  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `(() => { Error.prepareStackTrace = () => { window.stackReads += 1; return 'custom stack'; }; const element = document.getElementById('react'); element._unrelated = new Error('unrelated'); element.__reactFiber$fixture._debugStack = SendButton(); return null; })()`,
      },
      undefined,
      caller,
    ),
  );
  yield* pickReact();
  expect((yield* Queue.take(descriptions)).component).toEqual({ framework: 'react', name: 'SendAction', source: null });
  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `(() => { delete Error.prepareStackTrace; const parent = Object.create(Object.getPrototypeOf(Error)); Object.defineProperty(parent, 'prepareStackTrace', { get: () => { window.stackReads += 1; return () => 'inherited stack'; } }); Object.setPrototypeOf(Error, parent); document.getElementById('react').__reactFiber$fixture._debugStack = SendButton(); return null; })()`,
      },
      undefined,
      caller,
    ),
  );
  yield* pickReact();
  expect((yield* Queue.take(descriptions)).component).toEqual({ framework: 'react', name: 'SendAction', source: null });
  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `(() => { document.getElementById('react').__reactFiber$fixture._debugStack = { stack: 'x'.repeat(131072) }; return null; })()`,
      },
      undefined,
      caller,
    ),
  );
  yield* pickReact();
  expect((yield* Queue.take(descriptions)).component).toEqual({ framework: 'react', name: 'SendAction', source: null });
  const read = yield* calling(PAGE.evaluate_in_page.body.execute({ page, expression: 'window.stackReads' }, undefined, caller));
  expect('value' in read ? read.value : read.exception).toBe('0');
  yield* Fiber.interrupt(picking);
});
