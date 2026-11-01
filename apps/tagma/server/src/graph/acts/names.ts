import { Effect } from 'effect';
import { eq, inArray } from 'drizzle-orm';
import { blockAddress, blockIdentity, blockName, distinctTails } from '../contract/wire/references.js';
import { SPOKEN_LENGTH } from '../../platform/contract/wire/ids.js';
import type { GraphStore } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { block, spokenTail } from '../store/tables.js';
import { BlockNames } from '../contract/service/acts.js';
import type { GraphUnits } from '../../platform/contract/service/units.js';
import { readsOf } from './reads.js';
import { rowsPerStatement } from '../../platform/store/binds.js';

export function blockNames(db: GraphStore['Service']['db'], units: GraphUnits['Service']): BlockNames['Service'] {
  const reads = readsOf(units);
  const identitiesOf: BlockNames['Service']['identitiesOf'] = reads(
    Effect.fn('Act.identitiesOf')(function* (ids: readonly number[]) {
      const wanted = [...new Set(ids)];
      if (wanted.length === 0) return new Map<number, string>();
      const identities = new Map<number, string>();
      const room = rowsPerStatement(1);
      for (let at = 0; at < wanted.length; at += room) {
        const rows = yield* db
          .select({ id: block.id, uuid: block.uuid })
          .from(block)
          .where(inArray(block.id, wanted.slice(at, at + room)));
        for (const row of rows) identities.set(row.id, blockIdentity(row.uuid));
      }
      return identities;
    }),
  );
  const namesOf: BlockNames['Service']['namesOf'] = (ids) =>
    Effect.map(identitiesOf(ids), (identities) => new Map([...identities].map(([id, identity]) => [id, blockName(identity)])));

  const hitsOfName = reads(
    Effect.fn('Act.candidatesOfName')(function* (name: string) {
      const address = blockAddress(name);
      const needle = address.name.toLowerCase().replaceAll('-', '');
      if (needle.length < SPOKEN_LENGTH || !/^[0-9a-f]+$/.test(needle) || Number.isNaN(address.projectId)) {
        return yield* new GateRefusal('bad-name', `"${name}" is not a block name`, [
          `a block is named by ${SPOKEN_LENGTH} hex characters or more — the tail of its identity`,
          'search_blocks — find the block by its words and read its name',
        ]);
      }
      const rows = yield* db
        .select({ id: block.id, uuid: block.uuid, projectId: block.projectId })
        .from(block)
        .where(eq(spokenTail, needle.slice(-SPOKEN_LENGTH)));
      return rows
        .filter(
          (row) => (address.projectId === null || row.projectId === address.projectId) && row.uuid.replaceAll('-', '').endsWith(needle),
        )
        .map((row) => ({ id: row.id, uuid: row.uuid }));
    }),
  );

  return BlockNames.of({
    candidatesOfName: hitsOfName,

    idOfName: reads(
      Effect.fn('Act.idOfName')(function* (name: string) {
        const hits = yield* hitsOfName(name);
        const only = hits[0];
        if (only === undefined) {
          return yield* new GateRefusal('not-found', `no block is named ${name}`, ['search_blocks — find it by what it says']);
        }
        if (hits.length > 1) {
          return yield* new GateRefusal('ambiguous-name', `${name} names ${hits.length} blocks`, [
            'write more of the name — the tail is what tells them apart',
            ...distinctTails(hits.map((row) => row.uuid)),
          ]);
        }
        return only.id;
      }),
    ),

    idsOfNames: reads(
      Effect.fn('Act.idsOfNames')(function* (names: readonly string[]) {
        const needles = [...new Set(names.map((name) => name.toLowerCase().replaceAll('-', '')))].filter((needle) =>
          /^[0-9a-f]+$/.test(needle),
        );
        if (needles.length === 0) return new Map<string, number>();
        const tails = [...new Set(needles.map((needle) => needle.slice(-SPOKEN_LENGTH)))];
        const byTail = new Map<string, { readonly id: number; readonly identity: string }[]>();
        const room = rowsPerStatement(1);
        for (let at = 0; at < tails.length; at += room) {
          const rows = yield* db
            .select({ id: block.id, uuid: block.uuid })
            .from(block)
            .where(inArray(spokenTail, tails.slice(at, at + room)));
          for (const row of rows) {
            const identity = row.uuid.replaceAll('-', '');
            const tail = identity.slice(-SPOKEN_LENGTH);
            const held = byTail.get(tail) ?? [];
            held.push({ id: row.id, identity });
            byTail.set(tail, held);
          }
        }
        const out = new Map<string, number>();
        for (const needle of needles) {
          const hits = (byTail.get(needle.slice(-SPOKEN_LENGTH)) ?? []).filter((row) => row.identity.endsWith(needle));
          if (hits.length === 1 && hits[0] !== undefined) out.set(needle, hits[0].id);
        }
        return out;
      }),
    ),

    nameOf: Effect.fn('Act.nameOf')(function* (id: number) {
      const name = (yield* namesOf([id])).get(id);
      if (name === undefined) return yield* Effect.die(`no block ${id} to name`);
      return name;
    }),

    namesOf,
    identitiesOf,

    uuidOf: reads(
      Effect.fn('Act.uuidOf')(function* (id: number) {
        const row = yield* db.select({ uuid: block.uuid }).from(block).where(eq(block.id, id)).get();
        return row?.uuid ?? null;
      }),
    ),
  });
}
