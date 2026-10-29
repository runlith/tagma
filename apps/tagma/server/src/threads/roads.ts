import type { ModelOption } from '@runlith/llm/models/catalog';
import { Effect } from 'effect';
import type { SettingKey } from '../platform/contract/wire/setting.js';
import type { HarnessId } from '../platform/contract/wire/session.js';
import { AccountCredentials } from '../providers/contract/service/access.js';
import { ProviderRegistry } from '../providers/contract/service/registry.js';
import { Settings } from '../settings/contract/service/values.js';
import { HarnessRegistry, type Harness } from './contract/service/harness.js';
import type { HarnessName } from './contract/wire/harness/names.js';
import { decisionModel, decisionReasoning, titleModel, titleReasoning } from './contract/wire/settings.js';
import type { ThreadMetadata } from './list/store.js';

export type RejectedRoad = { readonly road: string; readonly reason: string };

export type ModelRoad = {
  readonly _tag: 'Model';
  readonly option: ModelOption;
  readonly reasoning: string | null;
  readonly account: string | null;
};

export type Road =
  | ModelRoad
  | { readonly _tag: 'Cli'; readonly cli: NonNullable<Harness['Service']['oneShot']> }
  | { readonly _tag: 'Invalid' }
  | { readonly _tag: 'None' };

export type RoadChoice = { readonly name: string; readonly road: Road; readonly rejected: readonly RejectedRoad[] };

export type RoadRole = {
  readonly configured: string;
  readonly model: SettingKey<string>;
  readonly reasoning: SettingKey<string>;
  readonly answers: 'text' | 'schema';
};

export type RoadAsker = {
  readonly provider: string;
  readonly model: string | null;
  readonly account: string | null;
  readonly harness: HarnessName | null;
};

export type NamedModel = { readonly model: string; readonly reasoning: string | null };

export type RoadAsk = {
  readonly asker: RoadAsker | null;
  readonly projectId: number;
  readonly rejected: readonly RejectedRoad[];
  readonly named?: NamedModel;
};

export const askerOf = (thread: ThreadMetadata): RoadAsker => ({
  provider: thread.provider,
  model: thread.model,
  account: thread.account,
  harness: thread.harness?.name ?? null,
});

export const TITLE_ROLE: RoadRole = { configured: 'title-model', model: titleModel, reasoning: titleReasoning, answers: 'text' };

export const RECAP_ROLE: RoadRole = TITLE_ROLE;

export const DECISION_ROLE: RoadRole = {
  configured: 'decision-model',
  model: decisionModel,
  reasoning: decisionReasoning,
  answers: 'schema',
};

export type Roads = Effect.Success<typeof makeRoads>;

export const makeRoads = Effect.gen(function* () {
  const registry = yield* HarnessRegistry;
  const settings = yield* Settings;
  const credentials = yield* AccountCredentials;
  const providers = yield* ProviderRegistry;

  const faceOf = (name: HarnessName) =>
    registry.resolve(name as HarnessId).pipe(Effect.catchTag('HarnessMissing', () => Effect.succeed<Harness['Service'] | null>(null)));

  const choose = Effect.fnUntraced(function* (role: RoadRole, ask: RoadAsk) {
    const { asker, projectId } = ask;
    const rejected: RejectedRoad[] = [...ask.rejected];
    const chosen = (name: string, road: Road): RoadChoice => ({ name, road, rejected });
    const configured = yield* settings.value(role.model, projectId);
    const effort = yield* settings.value(role.reasoning, projectId);
    const { models: catalog, wires } = yield* providers.catalog;
    const decides = role.answers === 'schema';
    const selection =
      ask.named !== undefined
        ? { road: 'named', model: ask.named.model, effort: ask.named.reasoning ?? '' }
        : configured !== ''
          ? { road: role.configured, model: configured, effort }
          : null;
    if (selection !== null) {
      const option = catalog.options.find(
        (row) => row.key === selection.model && (row.capabilities.includes('text') || (decides && row.capabilities.includes('decision'))),
      );
      const reasoning = selection.effort || option?.defaultReasoning || null;
      if (!option || (reasoning !== null && !option.reasoningOptions.some((row) => row.id === reasoning))) {
        rejected.push({ road: selection.road, reason: 'invalid-selection' });
        return chosen(selection.road, { _tag: 'Invalid' });
      }
      return chosen(selection.road, { _tag: 'Model', option, reasoning, account: null });
    }
    rejected.push({ road: role.configured, reason: 'not-configured' });
    const rung = (option: ModelOption, own: string | null) =>
      effort !== '' && option.reasoningOptions.some((row) => row.id === effort) ? effort : own;
    if (decides) {
      const built = catalog.modelsByCapability('decision');
      for (const option of built) {
        const connected = yield* Effect.exit(credentials.account(option.provider));
        if (connected._tag === 'Success')
          return chosen('decision-capable', {
            _tag: 'Model',
            option,
            reasoning: rung(option, option.defaultReasoning),
            account: connected.value,
          });
      }
      rejected.push({ road: 'decision-capable', reason: built.length === 0 ? 'not-declared' : 'account-unavailable' });
    }
    const lightOf = Effect.fnUntraced(function* (provider: string, account: string | null) {
      const light = wires.registered(provider) ? catalog.named(provider).lightTextModel : undefined;
      if (light === undefined) return 'not-declared' as const;
      const connected = yield* Effect.exit(credentials.account(provider, account ?? undefined));
      const option = catalog.modelsFor(provider, 'text').find((row) => row.id === light.model);
      if (connected._tag === 'Failure') return 'account-unavailable' as const;
      if (option === undefined) return 'model-unavailable' as const;
      return { _tag: 'Model', option, reasoning: rung(option, light.rung), account: connected.value } satisfies ModelRoad;
    });
    if (asker === null) {
      const reasons = new Set<string>();
      for (const provider of catalog.providers) {
        const light = yield* lightOf(provider.id, null);
        if (typeof light !== 'string') return chosen('provider-light', light);
        reasons.add(light);
      }
      rejected.push({ road: 'provider-light', reason: reasons.has('account-unavailable') ? 'account-unavailable' : 'not-declared' });
      rejected.push({ road: 'cli', reason: 'no-thread' }, { road: 'thread-model', reason: 'no-thread' });
      return chosen('none', { _tag: 'None' });
    }
    const cli = asker.harness === null ? null : yield* faceOf(asker.harness);
    const served = cli === null ? asker.provider : cli.provider;
    const provider = served !== undefined && catalog.registered(served) ? (catalog.named(served).family ?? served) : served;
    const light = provider === undefined ? 'not-declared' : yield* lightOf(provider, cli === null ? asker.account : null);
    if (typeof light !== 'string') return chosen('provider-light', light);
    rejected.push({ road: 'provider-light', reason: light });
    if (decides) rejected.push({ road: 'cli', reason: 'no-schema' });
    else if (cli?.oneShot !== undefined) return chosen('cli', { _tag: 'Cli', cli: cli.oneShot });
    else rejected.push({ road: 'cli', reason: 'not-declared' });
    if (cli === null) {
      const option = catalog.registered(asker.provider)
        ? catalog.modelsFor(asker.provider, 'text').find((row) => row.id === (asker.model ?? catalog.defaultTextModelId(asker.provider)))
        : undefined;
      if (option !== undefined)
        return chosen('thread-model', {
          _tag: 'Model',
          option,
          reasoning: rung(option, option.reasoningOptions[0]?.id ?? null),
          account: asker.account,
        });
      rejected.push({ road: 'thread-model', reason: 'model-unavailable' });
    } else rejected.push({ road: 'thread-model', reason: 'external-thread' });
    return chosen('none', { _tag: 'None' });
  });

  return { choose };
});
