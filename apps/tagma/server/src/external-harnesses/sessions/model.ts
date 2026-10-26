import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadModelSelection } from '@runlith/agent/thread/record';
import type { Harness, HarnessMoveTo } from '../../threads/contract/service/harness.js';
import type { HarnessAskedModel } from '../../threads/contract/wire/harness/askedModel.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { servedSelection } from '../../threads/contract/wire/harness/seat.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { AskedModel } from '../birth/selection.js';
import { harnessAdapter, servingProvider } from '../contract/service/table.js';
import type { HarnessSessionStore } from '../store/sessions.js';

export const harnessServed = (facet: ExternalSession, asked: HarnessAskedModel | undefined): ThreadModelSelection | null => {
  const provider = servingProvider(facet.name, 'acp');
  return provider === null ? null : servedSelection(provider, asked, facet);
};

export function harnessMove(
  name: HarnessName,
  store: HarnessSessionStore,
  askedModel: AskedModel,
): NonNullable<Harness['Service']['move']> {
  const adapter = harnessAdapter(name);
  return Effect.fnUntraced(function* (threadId: string, to: HarnessMoveTo) {
    const facet = yield* store.read(threadId);
    const provider = servingProvider(name, 'acp');
    if (facet === null || (yield* store.binding(threadId))?.adapter !== 'acp' || provider === null || to.provider !== provider) {
      return yield* new GateRefusal(
        'model-pinned',
        `${adapter.label} runs here on the ${provider ?? 'CLI'} row; another provider is another agent.`,
        [`choose a model of the ${provider ?? 'CLI'} row`, 'start a new agent on the model you need, with this one’s report as its brief'],
      );
    }
    const asked = yield* askedModel(to);
    const from = servedSelection(provider, yield* store.asked(threadId), facet);
    yield* store.choose(threadId, asked, to.switches, to.account);
    return { from, to: { provider: to.provider, model: to.model, reasoning: to.reasoning } };
  });
}
