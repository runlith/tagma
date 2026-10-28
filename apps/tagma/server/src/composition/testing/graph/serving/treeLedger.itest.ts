import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { eq } from 'drizzle-orm';
import { GraphStore } from '../../../../platform/contract/service/store.js';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { Act } from '../../../../graph/contract/service/acts.js';
import { block } from '../../../../graph/store/tables.js';
import { decodeBlockFile } from '../../../../graph/tree/blockFile.js';
import { signedBy } from '../../../../invocation/testing/call.js';
import { writes } from '../../../../platform/contract/service/writes.js';
import { servingLayer, withServing } from './fixture.js';

const testActing = writes('test', []);

layer(servingLayer, { excludeTestServices: true })('tree ledger', (it) => {
  it.effect('hand edits and reversals are ingested; unreadable journal peers trigger a complete projection', () =>
    withServing(({ served, projectId }) =>
      signedBy({ harness: 'claude-code', key: 'ledger' })(
        Effect.gen(function* () {
          const blocks = yield* Blocks;
          const db = (yield* GraphStore).db;
          const fs = yield* FileSystem.FileSystem;
          const root = yield* blocks.rootBlockOf(projectId);
          const note = yield* blocks.create({
            projectId,
            parentId: root.id,
            tags: ['idea'],
            title: 'Ledger Note',
            body: 'as the act wrote it',
          });
          const held = yield* blocks.rawBlockById(note.id);
          if (held.path === null) return yield* Effect.die('the projected note has no path');
          const path = join(served.layout.treeRoot, held.path);
          const written = yield* fs.readFileString(path);
          yield* served.settled(true);
          expect((yield* blocks.rawBlockById(note.id)).body).toBe('as the act wrote it');
          yield* fs.writeFileString(path, written.replace('as the act wrote it', 'edited by a hand'));
          yield* served.settled(true);
          expect((yield* blocks.rawBlockById(note.id)).body).toBe('edited by a hand');
          yield* fs.writeFileString(path, written);
          yield* served.settled(true);
          expect((yield* blocks.rawBlockById(note.id)).body).toBe('as the act wrote it');
          const a = yield* blocks.create({ projectId, parentId: root.id, tags: ['idea'], title: 'Linked Owner', body: 'owner' });
          const shelf = yield* blocks.create({ projectId, parentId: root.id, tags: ['idea'], title: 'Linked Shelf', body: 'shelf' });
          const b = yield* blocks.create({ projectId, tags: ['idea'], title: 'Linked Peer', body: 'peer', parentId: shelf.id });
          const peer = yield* blocks.rawBlockById(b.id);
          if (peer.path === null) return yield* Effect.die('the projected peer has no path');
          const peerPath = join(served.layout.treeRoot, peer.path);
          yield* db.update(block).set({ title: 'Renamed Peer' }).where(eq(block.id, b.id));
          const act = yield* Act;
          yield* act.unit(testActing, act.record('link', a.id, { kind: 'relates', toId: a.id }));
          expect((yield* decodeBlockFile(yield* fs.readFileString(peerPath))).frontmatter.title).toBe('Linked Peer');
          yield* act.unit(testActing, act.record('link', a.id, { kind: 'relates', toId: 'not a block' }));
          const moved = yield* blocks.rawBlockById(b.id);
          if (moved.path === null) return yield* Effect.die('the reprojected peer has no path');
          expect((yield* decodeBlockFile(yield* fs.readFileString(join(served.layout.treeRoot, moved.path)))).frontmatter.title).toBe(
            'Renamed Peer',
          );
        }),
      ),
    ),
  );
});
