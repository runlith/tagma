import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { batchSchema } from '../../graph/contract/wire/batch.js';
import { OPERATION_IDS, OPERATIONS } from '../catalog.js';
import { blockQuerySchema } from '../../graph/contract/wire/query.js';
import { edgeSchema } from '../../graph/contract/wire/rows.js';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,128}$/;

it.effect('every operation id is a name a provider accepts as a tool', () =>
  Effect.sync(() => {
    expect(OPERATION_IDS.filter((id) => !TOOL_NAME.test(id))).toEqual([]);
  }),
);

it.effect('project-declared edge names cross operation, batch, query and read schemas', () =>
  Effect.sync(() => {
    const fromId = 'aaaaaaaa';
    const toId = 'bbbbbbbb';
    const kind = 'reviews';
    const succeeds = (result: { readonly _tag: string }) => result._tag === 'Success';

    expect(succeeds(Schema.decodeUnknownResult(OPERATIONS.link_blocks.params)({ fromId, kind, toId }))).toBe(true);
    expect(succeeds(Schema.decodeUnknownResult(OPERATIONS.unlink_blocks.params)({ fromId, kind, toId }))).toBe(true);
    expect(succeeds(Schema.decodeUnknownResult(batchSchema)({ ops: [{ op: 'link', fromId, kind, toId }] }))).toBe(true);
    expect(succeeds(Schema.decodeUnknownResult(batchSchema)({ ops: [{ op: 'unlink', fromId, kind, toId }] }))).toBe(true);
    expect(
      succeeds(Schema.decodeUnknownResult(blockQuerySchema)({ edge: { kind, to: toId }, sort: { by: 'updated', order: 'desc' } })),
    ).toBe(true);
    expect(
      succeeds(
        Schema.decodeUnknownResult(edgeSchema)({
          fromName: fromId,
          toName: toId,
          kind,
          createdBySessionId: null,
          createdAt: '2026-09-19T00:00:00.000Z',
        }),
      ),
    ).toBe(true);
    expect(succeeds(Schema.decodeUnknownResult(OPERATIONS.link_blocks.params)({ fromId, kind: '', toId }))).toBe(false);
  }),
);

it.effect('a wait an agent sits through is admitted up to the longest act and refused past it', () =>
  Effect.sync(() => {
    const ref = { execution: 'exec-1', incarnation: 1 };
    const output = Schema.decodeUnknownResult(OPERATIONS.read_output.params);
    const watch = Schema.decodeUnknownResult(OPERATIONS.wait_terminal.params);
    expect(output({ ...ref, wait: LONGEST_ACT_MS / 1000 })._tag).toBe('Success');
    expect(output({ ...ref, wait: LONGEST_ACT_MS / 1000 + 1 })._tag).toBe('Failure');
    expect(watch({ ...ref, waitMs: LONGEST_ACT_MS })._tag).toBe('Success');
    expect(watch({ ...ref, waitMs: LONGEST_ACT_MS + 1 })._tag).toBe('Failure');
  }),
);
