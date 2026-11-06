import { textMenu } from '@runlith/llm/models/catalog';
import type { TokenStoreFault } from '@runlith/llm/oauth/storeFailure';
import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { admitted } from '../platform/contract/service/routed.js';
import type { StoreFailure } from '../platform/contract/service/store.js';
import type { OperationDeclaration } from '../platform/contract/wire/operation.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { DefaultAccounts } from './contract/service/accounts.js';
import { AdapterInstalls } from './contract/service/adapters.js';
import { ProviderCredentials } from './contract/service/credentials.js';
import { AccountQuota, CacheCurves } from './contract/service/quota.js';
import { ProviderRegistry } from './contract/service/registry.js';
import { SignIns } from './contract/service/signIns.js';
import { HarnessAccounts } from './contract/service/harness.js';
import { PROVIDER_OPERATIONS as OPS, type ProviderOperationId } from './contract/wire/operations.js';
import { credentialRefusal, isTokenFault } from './credentials/refusal.js';
import { cacheLifetimes } from './quota/cacheLifetimes.js';
import { listModels, removeInstance, saveInstance } from './adapters/instanceActs.js';
import { readAdapters, readSettings } from './adapters/reads.js';
import { ModelCatalogs } from './catalogs.js';
import { askModel, askUsage } from './askCalls.js';
import { DefaultLogins } from './accounts/defaultLogins.js';

const declared =
  <D extends OperationDeclaration>(declaration: D) =>
  <A, R>(work: Effect.Effect<A, GateRefusal | StoreFailure | TokenStoreFault, R>) =>
    admitted(declaration)(
      Effect.mapError(work, (failure): GateRefusal | StoreFailure =>
        isTokenFault(failure) ? credentialRefusal(`answer ${declaration.id}`, failure) : failure,
      ),
    );

export const PROVIDER_PAIRS = {
  observe_logins: pair(
    OPS.observe_logins,
    body(OPS.observe_logins, {
      execute: () =>
        Effect.as(
          Effect.flatMap(DefaultLogins, (logins) => logins.focus),
          { status: 'observed' as const },
        ),
    }),
  ),
  refresh_model_catalog: pair(
    OPS.refresh_model_catalog,
    body(OPS.refresh_model_catalog, {
      execute: Effect.fnUntraced(function* (input) {
        yield* (yield* ModelCatalogs).refresh(input.provider);
        return { status: 'refreshed' as const, catalog: (yield* (yield* ProviderRegistry).catalog).served };
      }),
    }),
  ),
  list_accounts: pair(
    OPS.list_accounts,
    body(OPS.list_accounts, {
      execute: () =>
        Effect.map(
          Effect.flatMap(AccountQuota, (quota) => quota.table()),
          (accounts) => ({ status: 'listed' as const, accounts }),
        ),
    }),
  ),
  read_cache_lifetimes: pair(
    OPS.read_cache_lifetimes,
    body(OPS.read_cache_lifetimes, {
      execute: Effect.fnUntraced(function* () {
        const readings = yield* (yield* CacheCurves).readings();
        return { status: 'read' as const, lifetimes: cacheLifetimes(yield* (yield* ProviderRegistry).catalog, readings) };
      }),
    }),
  ),
  refresh_accounts: pair(
    OPS.refresh_accounts,
    body(OPS.refresh_accounts, {
      execute: Effect.fnUntraced(function* (input) {
        const quota = yield* AccountQuota;
        const registry = yield* ProviderRegistry;
        const logins = yield* DefaultLogins;
        const source = input.provider === undefined ? undefined : registry.current().accountSource(input.provider);
        yield* Effect.forEach(
          registry
            .current()
            .harnesses.filter(
              (provider) =>
                provider.auth === 'cli' && provider.accounts?.discovery !== undefined && (source === undefined || provider.id === source),
            ),
          (provider) =>
            provider.auth === 'cli'
              ? logins.current(provider).pipe(
                  Effect.matchEffect({
                    onSuccess: () => Effect.void,
                    onFailure: (cause) =>
                      Effect.logWarning('the account refresh could not observe the CLI login', {
                        provider: provider.id,
                        reason: cause.reason,
                      }),
                  }),
                )
              : Effect.void,
          { concurrency: 3 },
        );
        yield* quota.refresh(input.provider, input.account);
        return { status: 'refreshed' as const, accounts: yield* quota.table() };
      }),
    }),
  ),
  set_default_account: pair(
    OPS.set_default_account,
    body(OPS.set_default_account, {
      execute: (input) =>
        declared(OPS.set_default_account)(
          Effect.gen(function* () {
            const defaults = yield* DefaultAccounts;
            const set = yield* defaults.saveDefaultAccount(input.provider, input.account, input.revision);
            return { status: 'set' as const, ...set, accounts: yield* (yield* AccountQuota).table() };
          }),
        ),
    }),
  ),
  read_sign_in: pair(
    OPS.read_sign_in,
    body(OPS.read_sign_in, {
      execute: () =>
        declared(OPS.read_sign_in)(
          Effect.map(
            Effect.flatMap(SignIns, (signIns) => signIns.status()),
            (providers) => ({ status: 'read' as const, providers }),
          ),
        ),
    }),
  ),
  begin_sign_in: pair(
    OPS.begin_sign_in,
    body(OPS.begin_sign_in, {
      execute: (input) =>
        declared(OPS.begin_sign_in)(
          Effect.map(
            Effect.flatMap(SignIns, (signIns) => signIns.begin(input.provider, input.projectId, input.account, input.method)),
            (flow) => ({ status: 'begun' as const, flow }),
          ),
        ),
    }),
  ),
  cancel_cli_sign_in: pair(
    OPS.cancel_cli_sign_in,
    body(OPS.cancel_cli_sign_in, {
      execute: (input) =>
        declared(OPS.cancel_cli_sign_in)(
          Effect.as(
            Effect.flatMap(HarnessAccounts, (accounts) => accounts.cancel(input.provider, input.account, input.execution)),
            { status: 'cancelled' as const },
          ),
        ),
    }),
  ),
  complete_sign_in: pair(
    OPS.complete_sign_in,
    body(OPS.complete_sign_in, {
      execute: (input) =>
        declared(OPS.complete_sign_in)(
          Effect.map(
            Effect.flatMap(SignIns, (signIns) => signIns.complete(input.provider, input.account, input.code)),
            (answered) =>
              'message' in answered
                ? { status: 'pending' as const, message: answered.message }
                : { status: 'signed' as const, account: answered },
          ),
        ),
    }),
  ),
  select_account_mode: pair(
    OPS.select_account_mode,
    body(OPS.select_account_mode, {
      execute: (input) =>
        declared(OPS.select_account_mode)(
          Effect.gen(function* () {
            const registry = yield* ProviderRegistry;
            const next = yield* registry
              .selectMode(input.section, input.mode)
              .pipe(Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : credentialRefusal('save the account mode', cause))));
            yield* (yield* AccountQuota).table();
            return { status: 'selected' as const, catalog: next.served };
          }),
        ),
    }),
  ),
  remove_account: pair(
    OPS.remove_account,
    body(OPS.remove_account, {
      execute: (input) =>
        declared(OPS.remove_account)(
          Effect.map(
            Effect.flatMap(SignIns, (signIns) => signIns.remove(input.provider, input.account)),
            (removed) => ({
              status: 'removed' as const,
              removed,
            }),
          ),
        ),
    }),
  ),
  rename_account: pair(
    OPS.rename_account,
    body(OPS.rename_account, {
      execute: (input) =>
        declared(OPS.rename_account)(
          Effect.map(
            Effect.flatMap(SignIns, (signIns) => signIns.rename(input.provider, input.account, input.label)),
            (account) => ({
              status: 'renamed' as const,
              account,
            }),
          ),
        ),
    }),
  ),
  read_provider_token: pair(
    OPS.read_provider_token,
    body(OPS.read_provider_token, {
      execute: (input) =>
        declared(OPS.read_provider_token)(
          Effect.map(
            Effect.flatMap(SignIns, (signIns) => signIns.keepCredential(input.provider, input.credential)),
            (account) => ({
              status: 'kept' as const,
              account,
            }),
          ),
        ),
    }),
  ),
  save_console_key: pair(
    OPS.save_console_key,
    body(OPS.save_console_key, {
      execute: (input) =>
        declared(OPS.save_console_key)(
          Effect.map(
            Effect.flatMap(SignIns, (signIns) => signIns.saveConsoleKey(input.provider, input.key, input.replaces)),
            (key) => ({
              status: 'saved' as const,
              key,
            }),
          ),
        ),
    }),
  ),
  list_console_keys: pair(
    OPS.list_console_keys,
    body(OPS.list_console_keys, {
      execute: () =>
        declared(OPS.list_console_keys)(
          Effect.map(
            Effect.flatMap(SignIns, (signIns) => signIns.consoleKeys()),
            (providers) => ({ status: 'listed' as const, providers }),
          ),
        ),
    }),
  ),
  remove_console_key: pair(
    OPS.remove_console_key,
    body(OPS.remove_console_key, {
      execute: (input) =>
        declared(OPS.remove_console_key)(
          Effect.map(
            Effect.flatMap(SignIns, (signIns) => signIns.removeConsoleKey(input.provider, input.account)),
            (key) => ({
              status: 'removed' as const,
              key,
            }),
          ),
        ),
    }),
  ),
  read_adapters: pair(
    OPS.read_adapters,
    body(OPS.read_adapters, {
      execute: (input) => Effect.map(readAdapters(input), (read) => ({ status: 'read' as const, ...read })),
    }),
  ),
  read_adapter_settings: pair(
    OPS.read_adapter_settings,
    body(OPS.read_adapter_settings, {
      execute: (input) => Effect.map(readSettings(input.adapter, input), (read) => ({ status: 'read' as const, ...read })),
    }),
  ),
  install_adapter: pair(
    OPS.install_adapter,
    body(OPS.install_adapter, {
      execute: (input) =>
        declared(OPS.install_adapter)(
          Effect.map(
            Effect.flatMap(AdapterInstalls, (adapters) => adapters.install(input.source)),
            (adapter) => ({ status: 'installed' as const, adapter }),
          ),
        ),
    }),
  ),
  update_adapter: pair(
    OPS.update_adapter,
    body(OPS.update_adapter, {
      execute: (input) =>
        declared(OPS.update_adapter)(
          Effect.map(
            Effect.flatMap(AdapterInstalls, (adapters) => adapters.update(input.id)),
            (adapter) => ({ status: 'updated' as const, adapter }),
          ),
        ),
    }),
  ),
  remove_adapter: pair(
    OPS.remove_adapter,
    body(OPS.remove_adapter, {
      execute: (input) =>
        declared(OPS.remove_adapter)(
          Effect.as(
            Effect.flatMap(AdapterInstalls, (adapters) => adapters.remove(input.id)),
            { status: 'removed' as const, id: input.id },
          ),
        ),
    }),
  ),
  disable_adapter: pair(
    OPS.disable_adapter,
    body(OPS.disable_adapter, {
      execute: (input) =>
        declared(OPS.disable_adapter)(
          Effect.map(
            Effect.flatMap(AdapterInstalls, (adapters) => adapters.disable(input.id)),
            (adapter) => ({ status: 'disabled' as const, adapter }),
          ),
        ),
    }),
  ),
  enable_adapter: pair(
    OPS.enable_adapter,
    body(OPS.enable_adapter, {
      execute: (input) =>
        declared(OPS.enable_adapter)(
          Effect.map(
            Effect.flatMap(AdapterInstalls, (adapters) => adapters.enable(input.id)),
            (adapter) => ({ status: 'enabled' as const, adapter }),
          ),
        ),
    }),
  ),
  save_adapter_instance: pair(
    OPS.save_adapter_instance,
    body(OPS.save_adapter_instance, {
      execute: (input) =>
        declared(OPS.save_adapter_instance)(
          Effect.map(saveInstance(input), (saved) => ({ status: 'saved' as const, id: saved.id, values: saved.values })),
        ),
    }),
  ),
  remove_adapter_instance: pair(
    OPS.remove_adapter_instance,
    body(OPS.remove_adapter_instance, {
      execute: (input) =>
        declared(OPS.remove_adapter_instance)(
          Effect.as(removeInstance(input.adapter, input.id), { status: 'removed' as const, id: input.id }),
        ),
    }),
  ),
  discover_adapter_models: pair(
    OPS.discover_adapter_models,
    body(OPS.discover_adapter_models, {
      execute: (input) =>
        declared(OPS.discover_adapter_models)(Effect.map(listModels(input), (rows) => ({ status: 'discovered' as const, rows }))),
    }),
  ),
  read_model_menu: pair(
    OPS.read_model_menu,
    body(OPS.read_model_menu, {
      execute: Effect.fnUntraced(function* () {
        const providers = textMenu((yield* ProviderRegistry).current().menu);
        return { status: 'read' as const, providers };
      }),
    }),
  ),
  ask_model: pair(
    OPS.ask_model,
    body(OPS.ask_model, {
      execute: (input, _prepared, caller) =>
        declared(OPS.ask_model)(askModel(input, caller.actor.kind === 'external' ? caller.actor.name : undefined)),
    }),
  ),
  read_ask_usage: pair(
    OPS.read_ask_usage,
    body(OPS.read_ask_usage, {
      execute: (input) =>
        declared(OPS.read_ask_usage)(Effect.map(askUsage(input.plugin), (usage) => ({ status: 'read' as const, ...usage }))),
    }),
  ),
} satisfies { readonly [K in ProviderOperationId]: OperationPair<(typeof OPS)[K]> };
