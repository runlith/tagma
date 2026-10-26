import { Effect } from 'effect';
import type { HarnessName } from '../threads/contract/wire/harness/names.js';
import { externalRolloutPart } from './rollout.js';
import { Harness, type HarnessServes } from '../threads/contract/service/harness.js';
import { harnessAdapter, servingProvider } from './contract/service/table.js';
import { acpKernel } from './birth/seat.js';
import { harnessFacet } from '../threads/contract/wire/harness/types.js';
import { wireHarness } from '../threads/voice/rowDetail.js';
import { type AskedModel, askedModelOf } from './birth/selection.js';
import { harnessMove } from './sessions/model.js';
import type { SessionBirths } from './contract/service/births.js';
import type { HarnessSessionStore } from './store/sessions.js';
import type { ProtocolSessions } from './contract/service/protocol.js';
import type { TerminalHistory } from './terminal/history.js';
import type { SessionMetadata } from './metadata/harnessMetadata.js';
import type { ProviderRegistry } from '../providers/contract/service/registry.js';

const servedBy = (name: HarnessName, asked: AskedModel): { readonly serves?: HarnessServes } => {
  const provider = servingProvider(name, 'acp');
  const profile = harnessAdapter(name).acp;
  return provider === null || profile?.hosts == null
    ? {}
    : {
        serves: {
          provider,
          seat: (to, agent) =>
            Effect.map(asked(to), (model) => ({
              facet: harnessFacet(name),
              kernel: acpKernel(name, agent, model, to.switches, to.account),
            })),
        },
      };
};

export function externalHarness(
  name: HarnessName,
  births: SessionBirths,
  protocol: ProtocolSessions,
  terminal: TerminalHistory,
  spent: (name: HarnessName, spawnRootId: string, principal: string) => ReturnType<Harness['Service']['spent']>,
  store: HarnessSessionStore,
  retract: Harness['Service']['retract'],
  metadata: SessionMetadata['Service'],
  oneShot: Harness['Service']['oneShot'],
  providers: ProviderRegistry['Service'],
): Harness['Service'] {
  const provider = servingProvider(name, 'acp') ?? undefined;
  const asked: AskedModel = (to) => Effect.flatMap(providers.catalog, ({ models }) => askedModelOf(models, name, to, 'acp'));
  return Harness.of({
    born: (request, within) => births.create(request, within),
    recover: () => Effect.void,
    birthWrites: protocol.writes,
    seat: (source, unit) =>
      Effect.flatMap(store.binding(source, unit), (binding) =>
        binding?.adapter === 'terminal' ? terminal.seat(source, unit) : protocol.seat(source, unit),
      ),
    retract,
    folded: () => Effect.void,
    record: externalRolloutPart,
    row: (threadId) =>
      Effect.flatMap(store.read(threadId), (facet) =>
        facet === null ? Effect.succeed(null) : Effect.map(store.road(threadId), (road) => wireHarness(facet, road)),
      ),
    models: asked,
    move: harnessMove(name, store, asked),
    release: (threadId, unit) => protocol.release(threadId, unit),
    spent: (spawnRootId, principal) => spent(name, spawnRootId, principal),
    spawn: (input) => births.born(input),
    transportAt: (projectId, preferred) => births.transportAt(name, projectId, preferred),
    ...servedBy(name, asked),
    readerWords: (threadId) => metadata.readerWords(threadId),
    provider,
    oneShot,
  });
}
