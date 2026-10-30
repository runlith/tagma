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
import { transportOf, type HarnessTransportOffer } from '../contract/service/table.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { HarnessAdapters } from '../contract/service/adapters.js';
import { InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { askedModelOf, launchedModel } from './selection.js';
import { SessionBirthWriting } from '../../threads/contract/service/sessionBirths.js';
import type { SessionBirths } from '../contract/service/births.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';

const programMissing = (adapter: HarnessAdapter) =>
  new GateRefusal('harness-not-installed', `${adapter.label} is not installed on this machine: no ${adapter.binary} program was found.`, [
    adapter.install ?? `install ${adapter.binary}`,
    'choose a harness this machine has',
  ]);

export const makeSessionBirths = Effect.gen(function* () {
  const rows = yield* SessionBirthWriting;
  const records = yield* ThreadRecords;
  const settings = yield* Settings;
  const providers = yield* ProviderRegistry;
  const adapters = yield* HarnessAdapters;
  const installs = yield* InstalledHarnesses;
  const files = yield* FileSystem.FileSystem;
  const installed = Effect.fnUntraced(function* (adapter: HarnessAdapter, offer: HarnessTransportOffer) {
    if (offer.transport === 'acp' && offer.profile.hosts !== null) return;
    if ((yield* installs.program(adapter.harness, 'harness')) === null) return yield* programMissing(adapter);
  });
  const births: SessionBirths = {
    create: (input, commit) => rows.create(input, commit),
    adopt: Effect.fnUntraced(function* (input) {
      const adapter = yield* adapters.row(input.harness);
      const offer = yield* transportOf(adapter, 'terminal');
      return yield* rows.adopt({
        ...input,
        label: adapter.label,
        seat: birthSeat(adapter, offer, undefined, {}),
      });
    }),
    transportAt: Effect.fnUntraced(function* (adapter, projectId, preferred) {
      const offer = yield* birthTransport(settings, adapter, projectId);
      yield* installed(adapter, offer);
      const profile = yield* birthProfile(settings, adapter, projectId, offer);
      yield* homeSetUp(files, adapter, profile);
      const { models } = yield* providers.catalog;
      return birthSeat(adapter, offer, launchedModel(models, adapter, undefined, preferred, offer.transport), profile);
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
      const adapter = yield* adapters.row(name);
      const chosen = yield* birthTransport(settings, adapter, projectId);
      if ('fork' in request.seed) {
        return yield* new GateRefusal(
          'harness-contract',
          'An interactive external harness owns its context, so no fork of this conversation can be copied into it.',
          ['start it without fork'],
        );
      }
      yield* installed(adapter, chosen);
      const { models } = yield* providers.catalog;
      const asked = yield* askedModelOf(
        models,
        adapter,
        input.model !== null && 'asked' in input.model ? input.model.asked : undefined,
        chosen.transport,
      );
      const profile = yield* birthProfile(settings, adapter, projectId, chosen);
      yield* homeSetUp(files, adapter, profile);
      const seat = birthSeat(adapter, chosen, launchedModel(models, adapter, asked, null, chosen.transport), profile);
      return yield* rows.spawned(input, seat, place);
    }),
  };
  return births;
});
