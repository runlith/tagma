import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { makeWalks } from '../../../change-record/lines/walks.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { CommandChanges } from '../../../change-record/contract/service/commands.js';
import { PreparedChanges } from '../../../change-record/contract/service/prepared.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { WorkingOrigins } from '../../../workspace/contract/service/places.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { Tags } from '../../../graph/contract/service/vocabulary.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { sharedPrepared } from '../../preparedChanges.js';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { claimPreparedInstance, preparedBase } from '../../../change-record/testing/doubles.js';
import { steppedOver } from '../stepsFixture.js';
import { Git } from '@runlith/git/Git';
import { lineWrites } from '../../lineWrites.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { LandingGit } from '../../../landing/contract/service/servedGit.js';
import { ServingGit } from '../../../executions/contract/service/git.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { git, makeThreadDoors, type Doors } from '../threadDoors.js';
import { unthreadedCaller } from '../callers.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { Holdings } from '../../../change-record/contract/service/holdings.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { seedRepository } from './native.js';

const BASE = Array.from({ length: 12 }, (_, at) => `export const n${at} = ${at};`).join('\n') + '\n';
const INSPECTION = 'forward';
const INSPECTIONS = {
  [INSPECTION]: { builtin: 'reexports', params: { base: '', allows: [], files: { extensions: ['.ts'], exclude: [] } } },
};
const MARKED = 'marked';
const MARKING = `export default {
  marked: async ({ tree }) => ({
    tree: {
      findings: (await Promise.all(tree.paths.map(async (path) => ((await tree.read(path)) ?? '').split('\\n').flatMap((line, at) =>
        line.startsWith('export *') ? [{ fingerprint: path + ' × forward', path, line: at + 1, message: 'forwarded' }] : [])))).flat(),
    },
  }),
};
`;
type ProjectCheckout = { readonly id: number; readonly root: string };

const makePlace = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const files = yield* FileSystem.FileSystem;
  let home: ProjectCheckout;
  let target: ProjectCheckout;
  let actor: Doors;
  let peer: Doors;
  let rule: string;
  let ruleRevision: string;
  let task: string;
  let sequence = 0;
  let producer: PreparedChanges['Service'];

  const out = Effect.fnUntraced(function* (root: string, args: readonly string[]) {
    const ran = yield* spawnedEffect(['git', ...args], { cwd: root });
    if (ran.exitCode !== 0) return yield* Effect.die(new Error(new TextDecoder().decode(ran.stderr)));
    return new TextDecoder().decode(ran.stdout).trim();
  });
  const op = (id: string, input: unknown, project = target.id, by?: Doors, cwd?: string) =>
    world.op(
      id,
      input,
      `project=${project}${cwd === undefined ? '' : `&cwd=${encodeURIComponent(cwd)}`}`,
      by === undefined ? undefined : { [GRANT_HEADER]: by.grant },
    );
  const native = Effect.fnUntraced(function* (id: string, input: unknown, by = actor) {
    const tool: Tool = by.native[id]!;
    const call = { caller: unthreadedCaller, toolCallId: `landing-place-${++sequence}`, messages: [] };
    const prepare = toolPrepare(tool);
    const prepared = prepare === null ? undefined : yield* prepare(input, call);
    const answer = yield* toolExecute(tool)!(input, { ...call, prepared: prepared?.prepared });
    return typeof answer === 'object' && answer !== null && 'display' in answer && 'value' in answer ? answer.value : answer;
  });
  const catalogAt = Effect.fnUntraced(function* (by: Doors, homeId: number, project: number, root: string, principalId: string) {
    const origin = yield* Context.get(world.runtime.workspace, WorkingOrigins).of({ projectId: homeId, threadId: by.threadId }, root);
    const served = yield* world.runtime.pool.resolve({ projectId: project, cwd: root });
    const vocabulary = yield* Context.get(served.context, Tags).of(project);
    return yield* fixtureNativeCatalog(
      {
        caller: {
          actor: { kind: 'thread', threadId: by.threadId, projectId: homeId, principalId, session: { harness: 'tagma', key: by.threadId } },
          files: null,
        },
        place: { root, origin },
        world: 'checkout',
        project: { id: project, name: 'test' },
        vocabulary: () => vocabulary,
        identity: testSessionIdentity,
        served,
        owners: Context.add(
          Context.mergeAll(world.routed, world.runtime.owners, world.runtime.workspace, world.runtime.enforcement),
          PreparedChanges,
          producer,
        ).pipe(Context.add(LandingGit, Context.get(world.runtime.owners, ServingGit))),
      },
      ['submit_work', 'check_rules'],
    );
  });
  const born = Effect.fnUntraced(function* (project: number) {
    const made = yield* op('create_thread', { approvalMode: 'bypass' }, project);
    expect(made.status).toBe(200);
    const {
      snapshot: { thread },
    } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(made.body);
    const doors = yield* makeThreadDoors(world, project, ['submit_work']).doorsFor(thread.id, thread.ownerId);
    const row = project === home.id ? home : target;
    return { principal: thread.ownerId, doors: { ...doors, native: yield* catalogAt(doors, project, project, row.root, thread.ownerId) } };
  });
  const write = Effect.fnUntraced(function* (root: string, text: string, by = actor, projectId = by === peer ? target.id : home.id) {
    const path = join(root, 'shared.ts');
    const before = yield* files.readFileString(path);
    const work = { projectId, threadId: by.threadId };
    const record = Context.get(world.runtime.owners, ChangeRecord);
    expect(
      yield* record.land(
        { work },
        [
          {
            path,
            origin: 'edit',
            before: contentDigest(before),
            after: contentDigest(text),
            beforeText: before,
            afterText: text,
            hunk: workspaceChangeHunk(before, text),
            at: new Date(yield* Clock.currentTimeMillis),
          },
        ],
        lineWrites.replace({ root, path: 'shared.ts', before, after: text }, Effect.succeed(true)),
      ),
    ).toEqual({ _tag: 'written', kept: true });
  });
  const held = Effect.fnUntraced(function* (root: string) {
    const place = yield* Context.get(world.runtime.workspace, CheckoutPaths).placeAcross(root);
    if (place === null) return yield* Effect.die(new Error('the checkout is absent'));
    const holdings = Context.get(world.runtime.owners, Holdings);
    yield* holdings.settled(RootId.make(place.checkout));
    return yield* holdings.read(RootId.make(place.checkout));
  });
  const nameOf = (answer: unknown) => (answer as { block: { name: string } }).block.name;

  const store = Context.get(world.runtime.graph, MachineStore);
  const instance = yield* Effect.acquireRelease(claimPreparedInstance(preparedBase(store)), (instance) => instance.release);
  const stepped = yield* Effect.provideService(steppedOver(store), Git, Context.get(world.runtime.graph, Git));
  producer = sharedPrepared(
    instance.dir,
    makeLandingHolds(),
    Context.get(world.runtime.owners, CommandChanges),
    Context.get(world.runtime.owners, Holdings),
    yield* Effect.acquireRelease(Effect.sync(makeWalks), (owned) => owned.close),
    stepped.shape,
  ).changes;
  const project = Effect.fnUntraced(function* (name: string) {
    const root = yield* files.realPath(yield* world.directory(name));
    yield* seedRepository(root);
    yield* git(root, 'config', 'user.name', 'suite');
    yield* git(root, 'config', 'user.email', 'suite@tagma');
    yield* files.writeFileString(join(root, 'shared.ts'), BASE);
    yield* files.writeFileString(join(root, 'tagma.config.ts'), `export default ${JSON.stringify({ inspections: INSPECTIONS })};\n`);
    yield* git(root, 'add', 'shared.ts', 'tagma.config.ts');
    yield* git(root, 'commit', '-q', '-m', `base ${name}`);
    const created = yield* world.op('add_project', {
      name: world.uniqueName(),
      rootPath: root,
      storage: name === 'target' ? 'team' : 'stealth',
    });
    expect(created).toMatchObject({ status: 200 });
    const id = (created.body as { project: { id: number } }).project.id;
    expect(yield* world.op('write_setting', { key: 'graph.commit', value: 'manual' }, `project=${id}`)).toMatchObject({ status: 200 });
    return { id, root };
  });
  home = yield* project('home');
  target = yield* project('target');
  const first = yield* born(home.id);
  actor = first.doors;
  const actorPrincipal = first.principal;
  peer = (yield* born(target.id)).doors;
  rule = nameOf((yield* op('create_block', { tags: ['rule'], title: 'Do not forward modules' })).body);
  const enforced = yield* op('enforce_rule', {
    blockId: rule,
    base: null,
    strictness: 'gate',
    inspection: INSPECTION,
    on: [{ op: 'submit_work', phase: 'before' }],
  });
  expect(enforced.status).toBe(200);
  ruleRevision = (enforced.body as { revision: string }).revision;
  const spec = nameOf((yield* op('create_block', { tags: ['spec'], title: 'Target work' })).body);
  task = nameOf(
    (yield* op('create_block', { tags: ['task'], title: 'Target task', edges: [{ kind: 'implements', to: spec }], parentId: spec })).body,
  );
  const reading = yield* op('read_block', { blockIds: [task] }, target.id, actor);
  if (reading.status !== 200) {
    expect(reading).toMatchObject({ status: 409, body: { code: 'instructions-unread' } });
    expect((yield* op('read_block', { blockIds: [task] }, target.id, actor)).status).toBe(200);
  }
  expect(yield* op('claim_block', { blockId: task }, target.id, actor)).toMatchObject({ status: 200 });
  const homeSpec = nameOf((yield* op('create_block', { tags: ['spec'], title: 'Home work' }, home.id)).body);
  const homeTask = nameOf(
    (yield* op(
      'create_block',
      { tags: ['task'], title: 'Home task', edges: [{ kind: 'implements', to: homeSpec }], parentId: homeSpec },
      home.id,
    )).body,
  );
  expect((yield* op('claim_block', { blockId: homeTask }, home.id, actor)).status).toBe(200);
  yield* files.writeFileString(
    join(target.root, 'tagma.config.ts'),
    `export default ${JSON.stringify({
      inspections: { ...INSPECTIONS, [MARKED]: { program: 'tools/marked.js', name: MARKED, concern: 'code', params: {} } },
      format: { shell: { run: ['sh', 'format.sh'], files: ['*.ts'] } },
    })};\n`,
  );
  yield* files.makeDirectory(join(target.root, 'tools'));
  yield* files.writeFileString(join(target.root, 'tools', 'marked.js'), MARKING);
  yield* files.writeFileString(
    join(target.root, 'format.sh'),
    'for file in "$@"; do sed "s/[[:space:]]*$//" "$file" > "$file.next" && mv "$file.next" "$file"; done\n',
  );
  yield* git(target.root, 'add', '-A');
  yield* git(target.root, 'commit', '-q', '-m', 'target law and steps');
  return {
    world,
    files,
    home,
    target,
    actor,
    peer,
    rule,
    ruleRevision,
    task,
    actorPrincipal,
    op,
    native,
    catalogAt,
    nameOf,
    write,
    held,
    out,
  };
});
class PlaceFixture extends Context.Service<PlaceFixture, Effect.Success<typeof makePlace>>()('testing/PlaceFixture') {}

layer(Layer.effect(PlaceFixture, makePlace).pipe(Layer.provide(doorFixture()), Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('landing places', (it) => {
  it.effect('foreign landing uses its law, tasks and steps, keeps peer ownership, and splits checkouts explicitly', () =>
    Effect.gen(function* () {
      const { world, files, home, target, actor, peer, rule, ruleRevision, task, actorPrincipal, op, native, catalogAt, write, held, out } =
        yield* PlaceFixture;
      const homeHead = yield* out(home.root, ['rev-parse', 'HEAD']);
      const targetHead = yield* out(target.root, ['rev-parse', 'HEAD']);
      const bad = BASE.replace('export const n0 = 0;', "export * from './value';");
      yield* write(target.root, bad);
      const visiting = { ...actor, native: yield* catalogAt(actor, home.id, target.id, target.root, actorPrincipal) };
      expect(yield* native('check_rules', { over: 'change' }, visiting)).toMatchObject({ refuses: true, violations: [{ rule }] });
      expect(yield* native('check_rules', { over: 'change', inspection: MARKED }, visiting)).toMatchObject({
        violations: [{ file: 'shared.ts', line: 1 }],
      });
      expect(yield* native('submit_work', { subject: 'blocked foreign work' })).toMatchObject({
        status: 'refused',
        code: 'rule-violated',
        reason: expect.stringContaining(rule),
      });
      expect(yield* out(home.root, ['rev-parse', 'HEAD'])).toBe(homeHead);
      expect(yield* out(target.root, ['rev-parse', 'HEAD'])).toBe(targetHead);
      const mine = BASE.replace('export const n0 = 0;', 'export const n0 = 100;   ');
      yield* write(target.root, mine);
      yield* write(home.root, BASE.replace('export const n0 = 0;', 'export const n0 = 200;'));
      expect(yield* native('submit_work', { tasks: [task], paths: ['shared.ts'] }).pipe(Effect.flip)).toMatchObject({
        code: 'multiple-checkouts',
      });
      yield* write(home.root, BASE);
      const peerText = mine.replace('export const n5 = 5;', 'export const n5 = 500;');
      yield* write(target.root, peerText, peer);
      const both = peerText.replace('export const n10 = 10;', 'export const n10 = 1000;');
      expect(
        (yield* op('write_document', { path: 'shared.ts', text: both, base: contentDigest(peerText), write: 'operator-write' })).status,
      ).toBe(200);
      const landed = yield* native('submit_work', { subject: 'foreign work', paths: ['shared.ts'], tasks: [task] });
      expect(landed).toMatchObject({ submitted: { status: 'landed', committed: ['shared.ts'], carried: [] } });
      expect(yield* out(target.root, ['show', 'HEAD:shared.ts'])).toBe(mine.trimEnd().replace('100;   ', '100;'));
      expect(yield* files.readFileString(join(target.root, 'shared.ts'))).toBe(both.replace('100;   ', '100;'));
      expect(yield* out(target.root, ['log', '-1', '--format=%s'])).toBe(`foreign work (${task})`);
      expect(yield* out(home.root, ['rev-parse', 'HEAD'])).toBe(homeHead);
      const view = yield* held(target.root);
      const hands = view.paths.find((one) => one.path === 'shared.ts')?.verdict;
      expect(hands?.verdict === 'proven' ? hands.hands.map((hand) => hand.holder) : null).toEqual(
        expect.arrayContaining([{ kind: 'operator' }, { kind: 'thread', thread: peer.threadId }]),
      );
      expect(hands?.verdict === 'proven' ? hands.hands.length : null).toBe(2);

      const side = yield* world.directory('side');
      yield* git(target.root, 'worktree', 'add', '-q', '-b', 'side', side);
      yield* Context.get(world.runtime.workspace, Coverage).adopt(target.id, side);
      const sideLaw = yield* op(
        'enforce_rule',
        {
          blockId: rule,
          base: ruleRevision,
          strictness: 'watch',
          inspection: INSPECTION,
          on: [{ op: 'submit_work', phase: 'before' }],
        },
        target.id,
        undefined,
        side,
      );
      expect(sideLaw).toMatchObject({ status: 200 });
      yield* write(target.root, both.replace('100;   ', '101;'));
      yield* write(side, bad);
      expect(yield* native('submit_work', { paths: ['shared.ts'] }).pipe(Effect.flip)).toMatchObject({ code: 'multiple-checkouts' });
      expect(yield* native('submit_work', { project: home.id, checkout: side }).pipe(Effect.flip)).toMatchObject({
        code: 'place-mismatch',
      });
      expect(yield* native('submit_work', { checkout: side, subject: 'side work' })).toMatchObject({
        submitted: { status: 'landed', watched: [{ rule }] },
      });
      expect(yield* out(side, ['show', 'HEAD:shared.ts'])).toBe(bad.trim());
      expect(yield* out(target.root, ['show', 'HEAD:shared.ts'])).toBe(mine.trimEnd().replace('100;   ', '100;'));
      const mainText = both.replace('100;   ', '101;');
      yield* write(target.root, mainText.replace('export const n0 = 101;', "export * from './value';"));
      expect(yield* native('submit_work', { project: target.id })).toMatchObject({
        status: 'refused',
        code: 'rule-violated',
        reason: expect.stringContaining(rule),
      });
      yield* write(target.root, mainText);
      expect(
        yield* native('submit_work', { project: target.id, subject: 'taken work', taking: [peer.threadId, 'operator'] }),
      ).toMatchObject({
        submitted: { status: 'landed', committed: ['shared.ts'] },
      });
      expect((yield* held(target.root)).totals.held).toBe(0);
      expect(yield* out(home.root, ['rev-parse', 'HEAD'])).toBe(homeHead);
    }),
  );

  it.effect('the checkout graph gates new merge-resolution violations through submit_work, even when the caller holds no lines', () =>
    Effect.gen(function* () {
      const { files, target, rule, native, out } = yield* PlaceFixture;
      yield* git(target.root, 'checkout', '-qb', 'incoming');
      yield* files.writeFileString(join(target.root, 'incoming.ts'), 'export const incoming = 1;\n');
      yield* git(target.root, 'add', '--', 'incoming.ts');
      yield* git(target.root, 'commit', '-qm', 'incoming file');
      const tip = yield* out(target.root, ['rev-parse', 'HEAD']);
      yield* git(target.root, 'checkout', '-q', 'main');
      yield* files.writeFileString(join(target.root, 'local.ts'), 'export const local = 1;\n');
      yield* git(target.root, 'add', '--', 'local.ts');
      yield* git(target.root, 'commit', '-qm', 'local change');
      const head = yield* out(target.root, ['rev-parse', 'HEAD']);
      yield* git(target.root, 'merge', '--no-commit', '--no-ff', 'incoming');
      yield* files.writeFileString(join(target.root, 'incoming.ts'), "export * from './value';\n");
      yield* git(target.root, 'add', '--', 'incoming.ts');

      expect(yield* native('submit_work', { checkout: target.root, subject: 'merge incoming' })).toMatchObject({
        status: 'refused',
        code: 'rule-violated',
        reason: expect.stringContaining(rule),
      });
      expect(yield* out(target.root, ['rev-parse', 'HEAD'])).toBe(head);
      expect(yield* out(target.root, ['rev-parse', 'MERGE_HEAD'])).toBe(tip);
      yield* files.writeFileString(join(target.root, 'incoming.ts'), 'export const incoming = 1;\n');
      yield* git(target.root, 'add', '--', 'incoming.ts');
      expect(yield* native('submit_work', { checkout: target.root, subject: 'merge incoming' })).toMatchObject({
        submitted: { status: 'landed', committed: ['incoming.ts'] },
      });
      const commit = yield* out(target.root, ['rev-parse', 'HEAD']);
      expect(yield* out(target.root, ['rev-list', '--parents', '-1', 'HEAD'])).toBe(`${commit} ${head} ${tip}`);
      expect(yield* files.exists(join(target.root, '.git/MERGE_HEAD'))).toBe(false);
      expect(yield* out(target.root, ['diff', '--cached', '--name-only'])).toBe('');
    }),
  );

  it.effect(
    'a thread born in a worktree lands later main edits through HTTP, with implicit selection, project selection and parent taking',
    () =>
      Effect.gen(function* () {
        const { world, files, op, write, held, out } = yield* PlaceFixture;
        const root = yield* files.realPath(yield* world.directory('remembered'));
        yield* seedRepository(root);
        yield* files.writeFileString(join(root, 'shared.ts'), BASE);
        yield* git(root, 'add', '--', 'shared.ts');
        yield* git(root, 'commit', '-qm', 'base');
        const registered = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
        expect(registered.status).toBe(200);
        const project = { id: (registered.body as { project: { id: number } }).project.id, root };
        expect(yield* op('sync_graph', {}, project.id)).toMatchObject({ status: 200 });
        const created = yield* op('create_thread', { approvalMode: 'bypass', worktree: 'new', worktreeName: 'remembered' }, project.id);
        expect(created).toMatchObject({ status: 200 });
        const { snapshot } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(created.body);
        const parent = yield* makeThreadDoors(world, project.id, ['submit_work']).doorsFor(snapshot.thread.id, snapshot.thread.ownerId);
        const born = yield* op('create_thread', { parent: parent.threadId, task: '' }, project.id);
        expect(born).toMatchObject({ status: 200 });
        const { snapshot: childSnapshot } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(born.body);
        const child = yield* makeThreadDoors(world, project.id, ['submit_work']).doorsFor(
          childSnapshot.thread.id,
          childSnapshot.thread.ownerId,
        );
        const side = parent.root;
        expect(side).not.toBe(root);
        expect(child.root).toBe(side);
        const sideHead = yield* out(side, ['rev-parse', 'HEAD']);
        const implicit = BASE.replace('export const n0 = 0;', 'export const n0 = 100;');
        yield* write(root, implicit, child, project.id);
        yield* held(root);
        expect(yield* world.op('read_changes', { limit: 5 }, '', { [GRANT_HEADER]: child.grant })).toMatchObject({
          status: 200,
          body: { checkouts: [{ root, entries: [{ path: 'shared.ts', section: 'uncommitted' }] }] },
        });
        expect(yield* world.op('check_rules', { over: 'change', limit: 5 }, '', { [GRANT_HEADER]: child.grant })).toMatchObject({
          status: 200,
          body: { paths: ['shared.ts'] },
        });
        expect(yield* world.op('submit_work', { subject: 'main after worktree' }, '', { [GRANT_HEADER]: child.grant })).toMatchObject({
          status: 200,
          body: { submitted: { status: 'landed', committed: ['shared.ts'] } },
        });
        expect(yield* out(root, ['show', 'HEAD:shared.ts'])).toBe(implicit.trim());

        const explicit = implicit.replace('n0 = 100;', 'n0 = 101;');
        yield* write(root, explicit, child, project.id);
        expect(
          yield* world.op('check_rules', { over: 'change', checkout: root, limit: 5 }, '', { [GRANT_HEADER]: child.grant }),
        ).toMatchObject({
          status: 200,
          body: { paths: ['shared.ts'] },
        });
        expect(
          yield* op('submit_work', { subject: 'parent takes main by project', taking: [child.threadId] }, project.id, parent),
        ).toMatchObject({
          status: 200,
          body: { submitted: { status: 'landed', committed: ['shared.ts'] } },
        });
        expect(yield* out(root, ['show', 'HEAD:shared.ts'])).toBe(explicit.trim());
        expect(yield* out(side, ['rev-parse', 'HEAD'])).toBe(sideHead);
        expect((yield* held(root)).totals.held).toBe(0);
      }),
  );

  it.effect(
    'a size rule refusing the form a format command gave the change leaves that form in the working file, held by the thread, and check_rules names it',
    () =>
      Effect.gen(function* () {
        const { world, files, home, actor, actorPrincipal, op, catalogAt, nameOf, native, write, held, out } = yield* PlaceFixture;
        const root = yield* files.realPath(yield* world.directory('formed'));
        yield* seedRepository(root);
        yield* files.writeFileString(join(root, 'shared.ts'), BASE);
        yield* files.writeFileString(
          join(root, 'expand.sh'),
          'for file in "$@"; do awk \'{ gsub(/, /, ",\\n  "); print }\' "$file" > "$file.next" && mv "$file.next" "$file"; done\n',
        );
        const small = {
          base: '',
          files: { extensions: ['.ts'], exclude: [] },
          thresholds: [{ glob: '**', metric: 'non-import', lines: 14 }],
        };
        yield* files.writeFileString(
          join(root, 'tagma.config.ts'),
          `export default ${JSON.stringify({
            inspections: { small: { builtin: 'size', params: small } },
            format: { expand: { run: ['sh', 'expand.sh'], files: ['*.ts'] } },
          })};\n`,
        );
        yield* git(root, 'add', '-A');
        yield* git(root, 'commit', '-qm', 'base');
        const registered = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
        expect(registered.status).toBe(200);
        const project = { id: (registered.body as { project: { id: number } }).project.id, root };
        const rule = nameOf((yield* op('create_block', { tags: ['rule'], title: 'Small files' }, project.id)).body);
        expect(
          yield* op(
            'enforce_rule',
            { blockId: rule, base: null, strictness: 'gate', inspection: 'small', on: [{ op: 'submit_work', phase: 'before' }] },
            project.id,
          ),
        ).toMatchObject({ status: 200 });
        const visiting = { ...actor, native: yield* catalogAt(actor, home.id, project.id, root, actorPrincipal) };
        const written = `${BASE}export const all = { a: 1, b: 2, c: 3, d: 4 };\n`;
        yield* write(root, written, actor, home.id);
        const crossing = 'holds 16 lines outside its imports, over 14';
        expect(yield* native('check_rules', { over: 'change', checkout: root }, visiting)).toMatchObject({
          refuses: true,
          formed: ['shared.ts'],
          violations: [{ rule, file: 'shared.ts', message: crossing }],
        });
        expect(yield* files.readFileString(join(root, 'shared.ts'))).toBe(written);
        expect(yield* native('submit_work', { checkout: root, subject: 'grown' }, visiting)).toMatchObject({
          status: 'refused',
          code: 'rule-violated',
          reason: expect.stringContaining(crossing),
        });
        expect(yield* out(root, ['show', 'HEAD:shared.ts'])).toBe(BASE.trimEnd());
        const formed = yield* files.readFileString(join(root, 'shared.ts'));
        expect(formed).toBe(`${BASE}export const all = { a: 1,\n  b: 2,\n  c: 3,\n  d: 4 };\n`);
        const hands = (yield* held(root)).paths.find((one) => one.path === 'shared.ts')?.verdict;
        expect(hands?.verdict === 'proven' ? hands.hands.map((hand) => hand.holder) : null).toEqual([
          { kind: 'thread', thread: actor.threadId },
        ]);
        yield* write(root, BASE, actor, home.id);
        yield* held(root);
      }),
  );
});
