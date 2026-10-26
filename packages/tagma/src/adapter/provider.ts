import type { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import type { SettingField } from './settings';
import type { ProviderDescription } from '@runlith/llm/models/description';
import type { StoredCredential } from '@runlith/llm/oauth/credential';
import type { SubscriptionAccounts } from '@runlith/llm/oauth/vendor';
import type { ModelCredentials, ProductIdentity, ProviderQuota, ProviderRegistration } from '@runlith/llm/profiles/contract';
import type { ModelSpecs } from '@runlith/llm/models/description';

export type CatalogModels = {
  readonly models: ModelSpecs;
  readonly defaultTextModel: string;
  readonly warnings?: readonly string[];
};

export type ProviderCatalogReader = {
  read(
    credentials: ModelCredentials,
    ownerId: string,
    account?: string,
  ): Effect.Effect<CatalogModels, { readonly message: string }, HttpClient.HttpClient>;
};

export type AccountEnvironment =
  | { readonly _tag: 'Set'; readonly name: string; readonly value: string }
  | { readonly _tag: 'Unset'; readonly name: string };

export type HarnessAccountAddress = {
  readonly directory: string | null;
  readonly entries: readonly AccountEnvironment[];
};

export type CliHarnessCatalogReader = {
  read(address: HarnessAccountAddress): Effect.Effect<CatalogModels, { readonly message: string }, HttpClient.HttpClient>;
};

export type CommandExchange = { readonly input: string; readonly complete: (line: string) => boolean };

export type HarnessCommand = { readonly program: string; readonly args: readonly string[]; readonly exchange?: CommandExchange };

export type HarnessOutput = { readonly stdout: string; readonly stderr: string; readonly code: number };

export type HarnessIdentity = { readonly label: string };

export type HarnessAccountAuth = {
  readonly directory: string;
  readonly login: HarnessCommand;
  readonly status: HarnessCommand;
  readonly loggedIn: (output: HarnessOutput) => Effect.Effect<HarnessIdentity | null, { readonly message: string }>;
  readonly renew?: HarnessCommand;
};

export type BorrowedAccounts = {
  readonly provider: string;
  readonly renewOnReject?: true;
  read(directory: string | null): Effect.Effect<StoredCredential | null, { readonly message: string }>;
};

export type AccountMode = {
  readonly section: string;
  readonly title: string;
  readonly default: string;
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly signInLabel?: string;
  readonly missing?: string;
  readonly defaultPlace?: string;
};

export type WireProvider = ProviderRegistration & {
  readonly accountMode?: AccountMode;
  readonly kind: 'wire';
  readonly accounts?: SubscriptionAccounts;
  readonly borrows?: BorrowedAccounts;
  readonly icon?: string;
  readonly accountsLabel?: string;
  readonly keyHint?: string;
  readonly quotaFromReplies?: true;
  readonly catalog?: ProviderCatalogReader;
};

type HarnessDescription = ProviderDescription & {
  readonly kind: 'harness';
  readonly accountMode?: AccountMode;
  readonly icon?: string;
  readonly quota?: ProviderQuota;
  readonly keyHint?: string;
};

export type CliHarnessProvider = HarnessDescription & {
  readonly auth: 'cli';
  readonly catalog?: CliHarnessCatalogReader;
  readonly accounts?: HarnessAccountAuth;
  environment(directory: string | null): readonly AccountEnvironment[];
};

export type KeyHarnessProvider = HarnessDescription & {
  readonly auth: 'api-key';
  readonly catalog?: ProviderCatalogReader;
  readonly accounts: SubscriptionAccounts;
  environment(credential: StoredCredential): readonly AccountEnvironment[];
};

export type HarnessProvider = CliHarnessProvider | KeyHarnessProvider;

export type Provider = WireProvider | HarnessProvider;

export type SettingValue = string | number | boolean | readonly string[] | readonly SettingRow[];

export type SettingRow = { readonly [field: string]: SettingValue | undefined };

export type SettingInstance = { readonly id: string; readonly values: SettingRow; readonly revision?: string };

export type DiscoveryFailure = { readonly message: string };

export type AdapterSettings = {
  readonly title: string;
  readonly instance: string;
  readonly name: string;
  readonly fields: readonly SettingField[];
  validate?(values: SettingRow): string | null;
  discover?(values: SettingRow, secrets: SettingRow): Effect.Effect<readonly SettingRow[], DiscoveryFailure>;
};

export type HostInstance = SettingInstance & { readonly secrets: SettingRow };

export type AdapterHost = { readonly product: ProductIdentity; readonly instances: readonly HostInstance[] };

export type Adapter = ((host: AdapterHost) => readonly Provider[]) & { readonly settings?: AdapterSettings };

export const defineAdapter = (provide: (host: AdapterHost) => readonly Provider[], settings?: AdapterSettings): Adapter =>
  settings === undefined ? provide : Object.assign((host: AdapterHost) => provide(host), { settings });
