import { expect } from 'bun:test';
import { tmpdir } from 'node:os';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { toolExecute, toolPrepare, toolSettleEffect, type Tool } from '@runlith/agent/tool';
import { makeTerminalWorld } from './fixture.js';
import { fixtureNativeCatalog } from './nativeCatalog.js';
import { unthreadedCaller } from './callers.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../platform/testing/grants.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { routedContext } from '../../graph/testing/doubles.js';
import { mcpCatalog } from '../../cli/mcpTools.js';
import { OPERATIONS_CLI as operationsCli } from './composed.js';

const setup = Effect.gen(function* () {
  const world = yield* makeTerminalWorld();
  const home = yield* world.checkout();
  const target = yield* world.checkout();
  const born = yield* world.tagma(['op', 'create_thread', '--json', '--project', home.name, JSON.stringify({ approvalMode: 'bypass' })], {
    cwd: home.root,
  });
  expect(born.code).toBe(0);
  const thread = (JSON.parse(born.out) as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
  const grant = grantEnvironment(thread.id, testSessionIdentity)[GRANT_VARIABLE]!;
  const entered = yield* world.tagma(['op', 'search_blocks', '--json', '--project', target.name, '{"limit":1}'], {
    cwd: home.root,
    env: { [GRANT_VARIABLE]: grant },
  });
  expect({ code: entered.code, err: entered.err }).toEqual({ code: 0, err: '' });
  const topOf = Effect.fnUntraced(function* (project: { name: string }) {
    const roots = yield* world.tagma(['op', 'list_root_blocks', '--json', '--project', project.name], { cwd: home.root });
    return (JSON.parse(roots.out) as { blocks: { name: string }[] }).blocks[0]!.name;
  });
  const homeTop = yield* topOf(home);
  const targetTop = yield* topOf(target);
  const native = Effect.gen(function* () {
    const served = yield* world.runtime.pool.resolve({ projectId: home.id });
    const vocabulary = yield* Context.get(served.context, Tags).of(home.id);
    return yield* fixtureNativeCatalog(
      {
        caller: {
          actor: {
            kind: 'thread',
            threadId: thread.id,
            principalId: thread.ownerId,
            projectId: home.id,
            session: { harness: NATIVE_HARNESS, key: thread.id },
          },
          files: world.runtime.scratch.scope(thread.id),
        },
        place: { root: home.root, origin: null },
        world: 'checkout',
        project: { id: home.id, name: home.name },
        vocabulary: () => vocabulary,
        identity: testSessionIdentity,
        served,
        owners: Context.mergeAll(
          routedContext(world.runtime.graph, world.runtime.pool),
          world.runtime.owners,
          world.runtime.workspace,
          world.runtime.enforcement,
        ),
      },
      ['create_block', 'read_block', 'update_block', 'read_terminal', 'stop_terminal', 'read_terminal_operation'],
    );
  });
  const tools = yield* native;
  return { world, home, target, grant, tools, native, homeTop, targetTop };
});

class Placed extends Context.Service<Placed, Effect.Success<typeof setup>>()('testing/PlaceStest') {}

const http = Effect.fnUntraced(function* (operation: string, input: unknown, project?: string | number) {
  const { world, grant } = yield* Placed;
  const response = yield* Effect.promise(() =>
    fetch(`${world.url}/api/op/${operation}${project === undefined ? '' : `?project=${project}`}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [GRANT_HEADER]: grant },
      body: JSON.stringify(input),
    }),
  );
  return { status: response.status, body: yield* Effect.promise(() => response.json() as Promise<unknown>) };
});

const inTarget = Effect.fnUntraced(function* (name: string) {
  const { target } = yield* Placed;
  const first = yield* http('read_block', { blockIds: [name] }, target.id);
  const unread =
    first.status === 409 &&
    typeof first.body === 'object' &&
    first.body !== null &&
    'code' in first.body &&
    first.body.code === 'instructions-unread';
  const read = unread ? yield* http('read_block', { blockIds: [name] }, target.id) : first;
  expect(read).toMatchObject({
    status: 200,
    body: { reads: [{ name, projectId: target.id }] },
  });
});

const preparedCall = Effect.fnUntraced(function* (id: string, input: unknown, key: string) {
  const { tools } = yield* Placed;
  const call = { caller: unthreadedCaller, toolCallId: key, messages: [] };
  const prepared = yield* toolPrepare(tools[id]!)!(input, call);
  return { ...call, prepared: prepared.prepared, raised: prepared.raised ?? [] };
});

const valueOf = (value: unknown): unknown =>
  typeof value === 'object' && value !== null && 'value' in value && 'display' in value ? value.value : value;

const holdInTarget = Effect.fnUntraced(function* (key: string) {
  const { world, target } = yield* Placed;
  const started = yield* world.tagma(
    [
      'op',
      'start_terminal',
      '--json',
      '--project',
      target.name,
      JSON.stringify({ operationId: `${key}-start`, cwd: target.root, program: '/bin/sh', transport: 'pty', lifetime: 'held' }),
    ],
    { cwd: target.root },
  );
  expect({ code: started.code, err: started.err }).toEqual({ code: 0, err: '' });
  const launch = JSON.parse(started.out) as { operation: { state: { execution: { execution: string; incarnation: number } } } };
  const { execution, incarnation } = launch.operation.state.execution;
  const address = { execution, incarnation };
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const stopped = yield* world.tagma(
        [
          'op',
          'stop_terminal',
          '--yes',
          '--json',
          '--project',
          target.name,
          JSON.stringify({ ...address, operationId: `${key}-cleanup`, cause: 'explicit-stop' }),
        ],
        { cwd: target.root },
      );
      expect(stopped.code, stopped.out + stopped.err).toBe(0);
    }),
  );
  return address;
});

layer(Layer.effect(Placed, setup), { excludeTestServices: true })('place', (it) => {
  it.effect('native, CLI and MCP proxy act in the selected project while the caller keeps its home', () =>
    Effect.gen(function* () {
      const { world, home, target, grant, tools, targetTop } = yield* Placed;
      const input = { title: 'Native target', project: target.name, parentId: targetTop };
      const call = yield* preparedCall('create_block', input, 'native-target');
      const created = valueOf(yield* toolExecute(tools.create_block!)!(input, call)) as {
        block: { name: string; projectId: number };
      };
      yield* inTarget(created.block.name);

      const cli = yield* world.tagma(
        ['op', 'create_block', '--json', '--project', target.name, JSON.stringify({ title: 'CLI target', parentId: targetTop })],
        {
          cwd: home.root,
          env: { [GRANT_VARIABLE]: grant },
        },
      );
      expect({ code: cli.code, err: cli.err }).toEqual({ code: 0, err: '' });
      yield* inTarget((JSON.parse(cli.out) as { block: { name: string } }).block.name);

      const proxy = mcpCatalog(operationsCli).route('proxy', 'call_operation', {
        operation: 'create_block',
        project: target.id,
        input: { title: 'Proxy target', parentId: targetTop },
      });
      expect(proxy._tag, JSON.stringify(proxy)).toBe('Operation');
      if (proxy._tag !== 'Operation') return;
      const proxied = yield* http(proxy.name, proxy.input, proxy.project);
      expect(proxied.status).toBe(200);
      yield* inTarget((proxied.body as { block: { name: string } }).block.name);

      expect(yield* http('update_block', { blockId: created.block.name, title: 'Wrong place' }, home.id)).toMatchObject({
        status: 409,
        body: { code: 'place-mismatch' },
      });
      const mismatch = yield* Effect.result(
        toolPrepare(tools.update_block!)!(
          { blockId: created.block.name, title: 'Wrong native place', project: home.id },
          { caller: unthreadedCaller, toolCallId: 'native-mismatch' },
        ),
      );
      expect(mismatch).toMatchObject({ _tag: 'Failure', failure: { code: 'place-mismatch', unblock: expect.any(Array) } });
    }),
  );

  it.effect('a rebuilt native catalog reads the lost answer from the recorded project, even when retry input names the home', () =>
    Effect.gen(function* () {
      const { home, target, tools, native, targetTop } = yield* Placed;
      const input = { title: 'Receipt target', project: target.name, parentId: targetTop };
      const key = 'native-receipt';
      const call = yield* preparedCall('create_block', input, key);
      const created = valueOf(yield* toolExecute(tools.create_block!)!(input, call)) as {
        block: { name: string; projectId: number };
      };
      yield* inTarget(created.block.name);
      const rebuilt = yield* native;
      const readBack = toolSettleEffect(rebuilt.create_block!, {
        caller: unthreadedCaller,
        toolCallId: key,
        toolInput: { title: 'Changed retry', project: home.name },
      });
      expect(readBack).not.toBeNull();
      const settled = yield* readBack!;
      expect(settled.status).toBe('completed');
      if (settled.status !== 'completed') return yield* Effect.die(JSON.stringify(settled));
      expect(valueOf(settled.output)).toMatchObject({ status: 'ok', landed: { acts: [{ op: 'create', blockName: created.block.name }] } });
    }),
  );

  it.effect('project-selected create, batch and paged reads share the isolated target graph', () =>
    Effect.gen(function* () {
      const { home, target, targetTop } = yield* Placed;
      const created = yield* http('create_block', {
        project: target.name,
        parentId: targetTop,
        tags: ['idea'],
        title: 'Isolated selector first',
      });
      expect(created.status).toBe(200);
      const first = (created.body as { block: { name: string } }).block.name;
      const applied = yield* http('apply_batch', {
        project: target.id,
        ops: [
          { op: 'create', $id: 'second', parentId: first, tags: ['idea'], title: 'Isolated selector second' },
          { op: 'create', $id: 'third', parentId: first, tags: ['idea'], title: 'Isolated selector third' },
        ],
      });
      expect(applied.status).toBe(200);
      const ids = (applied.body as { ids: Record<string, string> }).ids;
      const names = [first, ids.second!, ids.third!];
      for (const name of names) yield* inTarget(name);
      expect(yield* http('search_blocks', { project: home.id, query: 'Isolated selector' })).toMatchObject({
        status: 200,
        body: { blocks: [], total: 0 },
      });
      const search = yield* http('search_blocks', { project: target.id, query: 'Isolated selector', limit: 2 });
      expect(search).toMatchObject({ status: 200, body: { total: 3 } });
      const page = search.body as { blocks: { name: string }[]; next: string };
      const continued = yield* http('search_blocks', { cursor: page.next });
      expect(continued).toMatchObject({ status: 200, body: { total: 3, next: null } });
      const rest = continued.body as { blocks: { name: string }[] };
      expect([...page.blocks, ...rest.blocks].map((row) => row.name).sort()).toEqual([...names].sort());
      const query = yield* http('query_blocks', { project: target.id, tags: ['idea'], sort: { by: 'created', order: 'asc' }, limit: 1 });
      expect(query).toMatchObject({ status: 200, body: { blocks: [{ name: first }], total: 3 } });
      const queryNext = yield* http('query_blocks', { project: target.id, cursor: (query.body as { next: string }).next, limit: 1 });
      expect(queryNext).toMatchObject({ status: 200, body: { blocks: [{ name: ids.second }], total: 3 } });
      expect(yield* http('query_blocks', { cursor: (queryNext.body as { next: string }).next })).toMatchObject({
        status: 200,
        body: { blocks: [{ name: ids.third }], total: 3, next: null },
      });
    }),
  );

  it.effect('a thread lists the terminals of the project it names, whichever door it calls through', () =>
    Effect.gen(function* () {
      const { world, home, target, grant } = yield* Placed;
      const address = yield* holdInTarget('listed-terminal');
      const held = {
        record: expect.objectContaining({ projectId: target.id, execution: expect.objectContaining(address) }),
      };
      const listed = (answer: { readonly terminals: readonly unknown[] }) => answer.terminals;
      const asThread = { cwd: home.root, env: { [GRANT_VARIABLE]: grant } };
      const cli = Effect.fnUntraced(function* (argv: readonly string[]) {
        const ran = yield* world.tagma(['op', 'read_terminals', '--json', ...argv], asThread);
        expect({ code: ran.code, err: ran.err }).toEqual({ code: 0, err: '' });
        return listed(JSON.parse(ran.out));
      });

      expect(yield* cli([JSON.stringify({ project: target.id })])).toContainEqual(expect.objectContaining(held));
      expect(yield* cli(['--project', target.name, '{}'])).toContainEqual(expect.objectContaining(held));
      const served = yield* http('read_terminals', {}, target.id);
      expect(served.status).toBe(200);
      expect(listed(served.body as Parameters<typeof listed>[0])).toContainEqual(expect.objectContaining(held));
      const byInput = yield* http('read_terminals', { project: target.name });
      expect(byInput.status).toBe(200);
      expect(listed(byInput.body as Parameters<typeof listed>[0])).toContainEqual(expect.objectContaining(held));

      expect(yield* cli(['{}'])).not.toContainEqual(expect.objectContaining(held));
      expect(yield* cli([JSON.stringify({ project: home.id })])).not.toContainEqual(expect.objectContaining(held));
    }),
  );

  it.effect('a terminal started from another project’s home with no project lands in the project and root holding its cwd', () =>
    Effect.gen(function* () {
      const { world, home, target, grant } = yield* Placed;
      const asThread = { cwd: home.root, env: { [GRANT_VARIABLE]: grant } };
      const start = Effect.fnUntraced(function* (key: string, cwd: string) {
        const ran = yield* world.tagma(
          [
            'op',
            'start_terminal',
            '--json',
            JSON.stringify({ operationId: key, cwd, program: '/bin/sh', transport: 'pty', lifetime: 'held' }),
          ],
          asThread,
        );
        expect({ code: ran.code, err: ran.err }).toEqual({ code: 0, err: '' });
        const { execution, incarnation } = (
          JSON.parse(ran.out) as { operation: { state: { execution: { execution: string; incarnation: number } } } }
        ).operation.state.execution;
        const address = { execution, incarnation };
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const project of [target.name, home.name]) {
              yield* world.tagma(
                [
                  'op',
                  'stop_terminal',
                  '--yes',
                  '--json',
                  '--project',
                  project,
                  JSON.stringify({ ...address, operationId: `${key}-stop`, cause: 'explicit-stop' }),
                ],
                asThread,
              );
            }
          }),
        );
        return address;
      });
      const read = Effect.fnUntraced(function* (address: { readonly execution: string; readonly incarnation: number }, project: number) {
        const ran = yield* world.tagma(['op', 'read_terminal', '--json', JSON.stringify({ ...address, project })], asThread);
        return ran.code === 0 ? (JSON.parse(ran.out) as { terminal: { projectId: number; rootId?: string } }).terminal : null;
      });

      const inTarget = yield* start('cwd-places-terminal', target.root);
      expect(yield* read(inTarget, target.id)).toMatchObject({ projectId: target.id, rootId: expect.any(String) });
      expect(yield* read(inTarget, home.id)).toBeNull();

      const outside = yield* start('cwd-outside-every-checkout', tmpdir());
      const unplaced = yield* read(outside, home.id);
      expect(unplaced).toMatchObject({ projectId: home.id });
      expect(unplaced?.rootId).toBeUndefined();
    }),
  );

  it.effect('a native thread reads and stops an execution in its recorded project without moving its home', () =>
    Effect.gen(function* () {
      const { target, tools } = yield* Placed;
      const address = yield* holdInTarget('foreign-terminal');
      const readInput = { ...address, project: target.id };
      const readCall = yield* preparedCall('read_terminal', readInput, 'foreign-terminal-read');
      expect(valueOf(yield* toolExecute(tools.read_terminal!)!(readInput, readCall))).toMatchObject({
        status: 'ok',
        terminal: { projectId: target.id, execution: address },
      });
      const stopInput = { ...readInput, operationId: 'foreign-terminal-stop', cause: 'explicit-stop' };
      const stopCall = yield* preparedCall('stop_terminal', stopInput, 'foreign-terminal-stop');
      expect(valueOf(yield* toolExecute(tools.stop_terminal!)!(stopInput, stopCall))).toMatchObject({
        status: 'ok',
        receipt: { execution: address, cause: 'explicit-stop', residual: [], unverifiable: [] },
      });
      const recovery = { project: target.id, operationId: 'foreign-terminal-stop' };
      const recoveryCall = yield* preparedCall('read_terminal_operation', recovery, 'foreign-terminal-recovery');
      expect(valueOf(yield* toolExecute(tools.read_terminal_operation!)!(recovery, recoveryCall))).toMatchObject({
        status: 'ok',
        operation: { _tag: 'Whole', state: { _tag: 'Settled' } },
      });
    }),
  );

  it.effect('a prepared key refuses a different named subject after its catalog is rebuilt', () =>
    Effect.gen(function* () {
      const { home, target, native, homeTop, targetTop } = yield* Placed;
      const local = yield* http('create_block', { title: 'Pinned local subject', parentId: homeTop }, home.id);
      const foreign = yield* http('create_block', { title: 'Pinned foreign subject', parentId: targetTop }, target.id);
      expect(local.status).toBe(200);
      expect(foreign.status).toBe(200);
      const localName = (local.body as { block: { name: string } }).block.name;
      const foreignName = (foreign.body as { block: { name: string } }).block.name;
      yield* preparedCall('update_block', { blockId: localName, title: 'Approved local change' }, 'pinned-update');
      const rebuilt = yield* native;
      const retried = yield* Effect.result(
        toolPrepare(rebuilt.update_block!)!(
          { blockId: foreignName, title: 'Redirected change' },
          { caller: unthreadedCaller, toolCallId: 'pinned-update' },
        ),
      );
      expect(retried).toMatchObject({ _tag: 'Failure', failure: { code: 'place-mismatch' } });
      expect(yield* http('read_block', { blockIds: [localName] }, home.id)).toMatchObject({
        status: 200,
        body: { reads: [{ title: 'Pinned local subject' }] },
      });
      expect(yield* http('read_block', { blockIds: [foreignName] }, target.id)).toMatchObject({
        status: 200,
        body: { reads: [{ title: 'Pinned foreign subject' }] },
      });
    }),
  );
});
