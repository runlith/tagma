import { Effect, Schema } from 'effect';
import { ChangesAnswer } from '../../change-record/contract/wire/changes.js';
import type { BuildAttribution, BuildHolding } from '../../installation/cut/source.js';
import { failureLines } from '../../platform/cli/verb.js';
import { holderKey } from '../../workspace/contract/wire/checkout.js';
import type { ChannelDoor } from '../cli/door.js';

const decode = Schema.decodeUnknownEffect(ChangesAnswer);
const DIAGNOSTIC_PATHS = 100;

export const readBuildAttribution = (door: ChannelDoor): BuildAttribution =>
  Effect.fn('composition.buildAttribution')(function* (checkout) {
    const page = yield* door
      .ask((client) =>
        client.operations.perform({
          params: { id: 'read_changes' },
          query: { cwd: checkout },
          headers: {},
          payload: { path: checkout, limit: DIAGNOSTIC_PATHS },
        }),
      )
      .pipe(
        Effect.flatMap(decode),
        Effect.mapError((failure) => failureLines(failure).join('; ')),
      );
    return page.holdings.map(({ holding }): BuildHolding => {
      const { verdict } = holding;
      return verdict.verdict === 'proven'
        ? {
            path: holding.path,
            holders: verdict.hands.map((hand) => holderKey(hand.holder)),
            nobody: verdict.nobody.length > 0,
            unproven: null,
          }
        : {
            path: holding.path,
            holders: verdict.writers.map(holderKey),
            nobody: false,
            unproven: 'cause' in verdict.reason ? `${verdict.reason.kind}: ${verdict.reason.cause}` : verdict.reason.kind,
          };
    });
  });
