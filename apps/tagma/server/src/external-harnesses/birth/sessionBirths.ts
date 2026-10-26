import { Effect, FileSystem, Schema } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { BirthPlace } from '../../threads/contract/wire/birth.js';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import { harnessOfTypeId } from '../../threads/contract/wire/harness/types.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { Settings } from '../../settings/contract/service/values.js';
import { birthTransport } from './transport.js';
import { birthSeat } from './seat.js';
import { birthProfile, homeSetUp } from './profile.js';
import { harnessAdapter, transportOf } from '../contract/service/table.js';
import { askedModelOf, launchedModel } from './selection.js';
import { SessionBirthWriting } from '../../threads/contract/service/sessionBirths.js';
import type { SessionBirths } from '../contract/service/births.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';

export const makeSessionBirths = Effect.gen(function* () {
  const rows = yield* SessionBirthWriting;
  const records = yield* ThreadRecords;
  const settings = yield* Settings;
  const providers = yield* ProviderRegistry;
  const files = yield* FileSystem.FileSystem;
  const births: SessionBirths = {
    create: (input, commit) => rows.create(input, commit),
    adopt: Effect.fnUntraced(function* (input) {
      const offer = yield* transportOf(input.harness, 'terminal');
      return yield* rows.adopt({
        ...input,
        label: harnessAdapter(input.harness).label,
        seat: birthSeat(input.harness, offer, undefined, {}),
      });
    }),
    transportAt: Effect.fnUntraced(function* (name, projectId, preferred) {
      const offer = yield* birthTransport(settings, name, projectId);
      const profile = yield* birthProfile(settings, name, projectId, offer);
      yield* homeSetUp(files, name, profile);
      const { models } = yield* providers.catalog;
      return birthSeat(name, offer, launchedModel(models, name, undefined, preferred, offer.transport), profile);
    }),
    born: Effect.fn('SessionBirths.born')(function* (input) {
      const request = input.request;
      const typeId = request.typeId;
      const name = typeId === null ? null : harnessOfTypeId(typeId);
      const place =
        input.place === null
          ? undefined
          : yield* Schema.decodeUnknownEffect(BirthPlace)(input.place).pipe(Effect.mapError(threadCallFailed));
      const projectId = place?.projectId ?? (yield* records.projectOf(input.creatorThreadId));
      if (name === null || projectId === undefined) {
        return yield* new GateRefusal('unknown-type', `No harness ${typeId} is offered.`, ['read the session type menu']);
      }
      const chosen = yield* birthTransport(settings, name, projectId);
      if ('fork' in request.seed) {
        return yield* new GateRefusal(
          'harness-contract',
          'An interactive external harness owns its context, so no fork of this conversation can be copied into it.',
          ['start it without fork'],
        );
      }
      const { models } = yield* providers.catalog;
      const asked = yield* askedModelOf(
        models,
        name,
        input.model !== null && 'asked' in input.model ? input.model.asked : undefined,
        chosen.transport,
      );
      const profile = yield* birthProfile(settings, name, projectId, chosen);
      yield* homeSetUp(files, name, profile);
      const seat = birthSeat(name, chosen, launchedModel(models, name, asked, null, chosen.transport), profile);
      return yield* rows.spawned(input, seat, place);
    }),
  };
  return births;
});
