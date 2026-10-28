import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { FileWatcher } from '../../../../platform/contract/service/watch.js';
import { shadowGateKey } from '../../../../graph/serving/permits.js';
import { runGit } from '../../../../platform/git/ownGit.js';
import { signedBy } from '../../../../invocation/testing/call.js';
import { servingLayer, withServing } from './fixture.js';
import { watchProcessLayer } from '../../fileWatcher.js';

layer(servingLayer.pipe(Layer.provideMerge(watchProcessLayer)), { excludeTestServices: true })('write through', (it) => {
  it.effect('acts answer before their held batch, preserve hand edits, and the next open carries an interrupted batch', () =>
    withServing(({ demo, pool, served: initial, projectId }) =>
      Effect.gen(function* () {
        let served = initial;
        const git = demo.graph.git;
        const fs = yield* FileSystem.FileSystem;
        const root = yield* Effect.provide(Context.get(served.context, Blocks).rootBlockOf(projectId), served.context);
        const create = (title: string) =>
          signedBy({ harness: 'claude-code', key: 'ledger' })(
            Context.get(served.context, Blocks).create({ projectId, parentId: root.id, tags: ['idea'], title, body: title }),
          ).pipe(Effect.provide(served.context));
        const fileOf = Effect.fnUntraced(function* (id: number) {
          const row = yield* Context.get(served.context, Blocks).rawBlockById(id);
          if (row.path === null) return yield* Effect.die('the projected block has no path');
          return row.path;
        });
        const head = () => runGit(git, 'head', ['-C', served.layout.treeRoot, 'rev-parse', 'HEAD']);
        const before = yield* head();
        const key = shadowGateKey(served.layout);
        if (key === null) return yield* Effect.die('the stealth graph has no repository permit');
        const made = yield* pool.gate(key).withPermit(
          Effect.gen(function* () {
            const a = yield* create('Cheap 0');
            const b = yield* create('Cheap 1');
            expect((yield* Context.get(served.context, Blocks).rawBlockById(a.id)).body).toBe('Cheap 0');
            expect((yield* Context.get(served.context, Blocks).rawBlockById(b.id)).body).toBe('Cheap 1');
            expect(yield* head()).toBe(before);
            return [a, b];
          }),
        );
        yield* pool.release(served);
        served = yield* pool.resolve({ projectId });
        const after = yield* head();
        expect(after).not.toBe(before);
        expect(yield* runGit(git, 'batches', ['-C', served.layout.treeRoot, 'rev-list', '--count', `${before}..${after}`])).toBe('1');
        for (const row of made) {
          const path = yield* fileOf(row.id);
          expect(yield* runGit(git, 'carried', ['-C', served.layout.treeRoot, 'show', `HEAD:${path}`])).toBe(
            (yield* fs.readFileString(join(served.layout.treeRoot, path))).trim(),
          );
        }
        const path = yield* fileOf(made[0]!.id);
        const file = join(served.layout.treeRoot, path);
        yield* fs.writeFileString(file, (yield* fs.readFileString(file)).replace('Cheap 0', 'Hand 0'));
        yield* served.settled(true);
        yield* create('After the hand');
        const handPath = yield* fileOf(made[0]!.id);
        const unbatched = yield* create('Unbatched');
        const pending = yield* fileOf(unbatched.id);
        yield* pool.release(served);
        yield* runGit(git, 'interrupt', ['-C', served.layout.treeRoot, 'reset', '-q', 'HEAD~1']);
        expect(yield* runGit(git, 'dirty', ['-C', served.layout.treeRoot, 'status', '--porcelain'])).toContain(pending);
        served = yield* pool.resolve({ projectId });
        yield* pool.release(served);
        expect(yield* runGit(git, 'recovered', ['-C', served.layout.treeRoot, 'show', `HEAD:${pending}`])).toContain('title: Unbatched');
        expect(yield* runGit(git, 'hand', ['-C', served.layout.treeRoot, 'show', `HEAD:${handPath}`])).toContain('Hand 0');
        expect(yield* runGit(git, 'clean', ['-C', served.layout.treeRoot, 'status', '--porcelain'])).toBe('');
      }),
    ),
  );

  it.effect('an act rereads a team tree repaired after a failed refresh', () =>
    withServing(
      ({ served, projectId }) =>
        signedBy({ harness: 'claude-code', key: 'ledger' })(
          Effect.gen(function* () {
            const blocks = yield* Blocks;
            const fs = yield* FileSystem.FileSystem;
            const root = yield* blocks.rootBlockOf(projectId);
            const note = yield* blocks.create({ projectId, parentId: root.id, tags: ['idea'], title: 'Mended Note', body: 'Mended Note' });
            const row = yield* blocks.rawBlockById(note.id);
            if (row.path === null) return yield* Effect.die('the projected block has no path');
            const path = join(served.layout.treeRoot, row.path);
            const whole = yield* fs.readFileString(path);
            yield* fs.writeFileString(path, `<<<<<<< ours\n${whole}=======\n${whole}>>>>>>> theirs\n`);
            const refused = yield* Effect.result(served.settled(true));
            expect(refused._tag).toBe('Failure');
            yield* fs.writeFileString(path, whole);
            yield* (yield* FileWatcher).settle(served.layout.treeRoot, []);
            const made = yield* blocks.create({
              projectId,
              parentId: root.id,
              tags: ['idea'],
              title: 'After the mend',
              body: 'After the mend',
            });
            expect(yield* blocks.rawBlockById(made.id)).toMatchObject({ uuid: made.uuid, body: 'After the mend' });
          }),
        ),
      'team',
    ),
  );
});
