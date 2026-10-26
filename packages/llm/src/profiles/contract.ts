import type { Effect } from 'effect';
import type { Headers } from 'effect/http';
import type { LLMError } from '../llm/schema/errors';
import type { Model, ProviderOptions } from '../llm/schema/options';
import type { QuotaFailure, QuotaObservation } from '../llm/schema/quota';
import type { ModelSwitches, ProviderDescription } from '../models/description';
import type { ModelCompactionPolicy } from './ModelCompactionPolicy';
import type { ModelRetryPolicy } from '../llm/route/ModelRetryPolicy';
import type { VendorWeb } from './vendorWeb';
import type { ImageProfile } from './images';
import type { DecisionProfile } from './decisions';

export interface ModelCredentials {
  apiKey(ownerId: string, provider: string, account?: string): Promise<string>;

  accessToken(ownerId: string, provider: string, account?: string): Promise<string>;
  recoverAccessToken?(ownerId: string, provider: string, account?: string): Promise<string>;

  credential(ownerId: string, provider: string, account?: string): Promise<unknown>;

  readonly selectedAccount?: string | undefined;
}

export type ProductIdentity = {
  readonly mcpServer: string;
  readonly client: { readonly name: string; readonly version: string };
};

export type ProfileSelection = {
  readonly ownerId: string;
  readonly runId?: string;
  readonly account?: string;
  readonly model: string;
  readonly cacheGroup?: string;
  readonly lane?: string;
  readonly credentials: ModelCredentials;
};

export type ProfileCall = {
  readonly model: string;
  readonly rung: string | null;
  readonly adaptive: boolean;
  readonly reasoningOutput: boolean;
  readonly outputTokens: number;
  readonly switches: ModelSwitches;
  readonly parallelToolCalls?: boolean;
  readonly cacheGroup?: string;
};

export type OutputReservation = {
  readonly budget: number | ((model: string) => number);
  readonly sent: boolean;
  readonly verbatim?: true;
};

export type ToolResultRetentionPolicy = {
  readonly retainAboveCharacters: number;
};

export type ModelContinuationPolicy = {
  readonly limit: number;
  readonly prompt: string;
};

export type ModelProfile = {
  readonly web?: (selection: ProfileSelection, call: ProfileCall) => Effect.Effect<VendorWeb, LLMError> | undefined;
  readonly retry?: (selection: ProfileSelection) => ModelRetryPolicy;
  readonly continuation?: ModelContinuationPolicy;
  readonly output: OutputReservation;
  readonly compaction?: ModelCompactionPolicy;
  readonly resultRetention?: ToolResultRetentionPolicy;
  model(selection: ProfileSelection): Effect.Effect<Model, LLMError>;
  options(call: ProfileCall): ProviderOptions | undefined;
};

export interface ProviderQuota {
  readonly fromHeaders: (headers: Headers.Headers, observedAt: Date) => QuotaObservation | null;
  readonly read: (credentials: ModelCredentials, ownerId: string, account?: string) => Effect.Effect<QuotaObservation, QuotaFailure>;
}

export type ProviderRegistration = ProviderDescription & {
  readonly profile: ModelProfile;
  readonly quota: ProviderQuota;
  readonly images?: ImageProfile;
  readonly decisions?: DecisionProfile;
};

export type VendorRegistrations = (product: ProductIdentity) => readonly ProviderRegistration[];
