import { resolve } from 'node:path';
import { Clock, Effect } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { body, pair } from '../../platform/contract/service/body.js';
import { nativeThreadIdOf } from '../../platform/contract/wire/actor.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ChangeRecord } from '../contract/service/record.js';
import { CHANGE_WRITES as OPS } from '../contract/wire/writes.js';

export const recordReported = pair(
  OPS.record_write,
  body(OPS.record_write, {
    files: (input) => [{ kind: 'write', value: resolve(input.cwd, input.path), file: true }],
    execute: Effect.fnUntraced(function* (input, _prepared, caller) {
      const threadId = nativeThreadIdOf(caller.actor);
      if (threadId === null || caller.actor.kind !== 'thread') {
        return yield* new GateRefusal(
          'session-unproven',
          'a change row is weighed into a commit, and only a session this server can prove may be weighed',
          ["run it from that session's own shell, which carries the grant this door proves"],
        );
      }
      const projectId = caller.actor.projectId;
      const path = resolve(input.cwd, input.path);
      const before = input.before ?? '';
      const after = input.after ?? '';
      const hunk = workspaceChangeHunk(before, after);
      const places = yield* (yield* ChangeRecord)
        .report({ work: { projectId, threadId } }, [
          {
            origin: input.after === null ? 'delete' : 'write',
            path,
            at: new Date(yield* Clock.currentTimeMillis),
            before: contentDigest(before),
            after: contentDigest(after),
            beforeText: before,
            afterText: after,
            hunk,
            key: input.key,
          },
        ])
        .pipe(
          Effect.mapError(
            (refused) => new GateRefusal('record-unread', refused.message, ['report the write again once the record can be written']),
          ),
        );
      const place = places[0];
      return place === undefined ? { status: 'outside' as const, path } : { status: 'recorded' as const, path: place.path };
    }),
  }),
);
