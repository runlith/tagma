import type { AccountKey } from '@runlith/llm/models/authStatus';
import type { SignInMethod } from '@runlith/llm/oauth/vendor';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InstanceOf } from '@runlith/layer/key';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

export const AccountsRepo = Repo.define(
  'accounts',
  ({ single, mutation }) => ({
    status: single({
      loader: async ({ signal }, door) => (await door.perform('read_sign_in', {}, {}, { signal })).providers,
    }),

    begin: mutation({
      mutator: async (input: { provider: string; projectId?: number; account?: string; method?: SignInMethod }, { signal }, door) =>
        (await door.perform('begin_sign_in', input, {}, { signal })).flow,
    }),

    observe: mutation({
      mutator: async (_: void, { signal }, door) => (await door.perform('observe_logins', {}, {}, { signal })).status,
    }),

    cancel: mutation({
      mutator: async (input: { provider: string; account: AccountKey; execution: ExecutionRef }, { signal }, door) =>
        await door.perform('cancel_cli_sign_in', input, {}, { signal }),
    }),

    complete: mutation({
      mutator: async (input: { provider: string; account?: string; code?: string }, { signal }, door) => {
        const answer = await door.perform('complete_sign_in', input, {}, { signal });
        return answer.status === 'pending' ? { pending: true as const, message: answer.message } : answer.account;
      },
    }),

    remove: mutation({
      mutator: async (input: { provider: string; account: AccountKey }, { signal }, door) =>
        (await door.perform('remove_account', input, {}, { signal })).removed,
    }),

    relabel: mutation({
      mutator: async (input: { provider: string; account: AccountKey; label: string }, { signal }, door) =>
        (await door.perform('rename_account', input, {}, { signal })).account,
    }),

    selectMode: mutation({
      mutator: async (input: { section: string; mode: string }, { signal }, door) =>
        (await door.perform('select_account_mode', input, {}, { signal })).catalog,
    }),

    saveConsoleKey: mutation({
      mutator: async (input: { provider: string; key: string; replaces?: string }, { signal }, door) =>
        (await door.perform('save_console_key', input, {}, { signal })).key,
    }),

    removeConsoleKey: mutation({
      mutator: async (input: { provider: string; account: string }, { signal }, door) =>
        (await door.perform('remove_console_key', input, {}, { signal })).key,
    }),

    saveInstance: mutation({
      mutator: async (input: { adapter: string; id?: string; revision?: string; values?: Record<string, unknown> }, { signal }, door) =>
        await door.perform('save_adapter_instance', input, {}, { signal }),
    }),

    removeInstance: mutation({
      mutator: async (input: { adapter: string; id: string }, { signal }, door) =>
        (await door.perform('remove_adapter_instance', input, {}, { signal })).id,
    }),

    discoverModels: mutation({
      mutator: async (input: { adapter: string; values: Record<string, unknown>; id?: string; revision?: string }, { signal }, door) =>
        (await door.perform('discover_adapter_models', input, {}, { signal })).rows,
    }),

    cacheLifetime: single({
      loader: async ({ signal }, door) => (await door.perform('read_cache_lifetimes', {}, {}, { signal })).lifetimes,
    }),

    refreshModels: mutation({
      mutator: async (input: { provider: string }, { signal }, door) =>
        (await door.perform('refresh_model_catalog', input, {}, { signal })).catalog,
    }),

    refresh: mutation({
      mutator: async (input: { provider?: string; account?: AccountKey }, { signal }, door) =>
        (await door.perform('refresh_accounts', input, {}, { signal })).accounts,
    }),

    consoleKeys: single({
      loader: async ({ signal }, door) => (await door.perform('list_console_keys', {}, {}, { signal })).providers,
    }),

    useByDefault: mutation({
      mutator: async (input: { provider: string; account: AccountKey }, { signal }, door) =>
        (await door.perform('set_default_account', input, {}, { signal })).accounts,
    }),
  }),
  { tier: 'app', door: Door },
);

export type AccountsRepo = InstanceOf<typeof AccountsRepo>;
