import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Context, Data, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { SettingLandRefusal } from '../../../settings/contract/service/values.js';
import type { PluginConsented } from '../wire/consent.js';
import type { PluginDeclared, PluginHookPoint, PluginOrigin, PluginPreview, PluginRow, PluginSource } from '../wire/rows.js';
import type { PluginInstall } from '../wire/settings.js';
import type { PluginHookAnswer, PluginHookCall, PluginHookSession, PluginPackage, PluginPlace, PluginUnreadable } from './format.js';

export class PluginPlaces extends Context.Service<PluginPlaces, { readonly home: string }>()('tagma/plugins/PluginPlaces') {}

export type PluginResolved = {
  readonly source: PluginSource;
  readonly origin: PluginOrigin;
  readonly declared: PluginDeclared | null;
};

export type PluginPrepared = PluginConsented & {
  readonly token: string;
  readonly format: string;
  readonly source: PluginSource;
  readonly origin: PluginOrigin | null;
  readonly declared: PluginDeclared | null;
  readonly root: string;
  readonly stage: string | null;
  readonly package: PluginPackage;
  readonly preview: PluginPreview;
};

export type PluginListRefusal = 'unknown-project' | 'secret-store-failed';
export type PluginPrepareRefusal =
  | PluginListRefusal
  | 'plugin-source-unreadable'
  | 'plugin-clone-failed'
  | 'plugin-pin-unreachable'
  | 'plugin-refused'
  | 'plugin-names-collide'
  | 'plugin-id-taken';
export type PluginInstallRefusal =
  | PluginPrepareRefusal
  | 'plugin-not-installed'
  | 'plugin-preview-expired'
  | SettingLandRefusal
  | 'setting-scope'
  | 'setting-value';
export type PluginChangeRefusal = Exclude<PluginInstallRefusal, 'plugin-id-taken' | 'plugin-pin-unreachable' | 'plugin-preview-expired'>;

export type PluginFailure<Code extends string> = StoreFailure | GateRefusal<Code>;

export class Plugins extends Context.Service<
  Plugins,
  {
    ids(): Effect.Effect<readonly string[], StoreFailure>;
    installs(): Effect.Effect<readonly PluginInstall[], StoreFailure>;
    rows(projectId: number, ids: readonly string[]): Effect.Effect<readonly PluginRow[], PluginFailure<PluginListRefusal>>;
    prepare(input: {
      readonly projectId: number;
      readonly source: string | PluginResolved;
    }): Effect.Effect<PluginPrepared, PluginFailure<PluginPrepareRefusal>>;
    held(input: {
      readonly projectId: number;
      readonly token: string;
    }): Effect.Effect<PluginPrepared, PluginFailure<PluginPrepareRefusal | 'plugin-preview-expired'>>;
    install(input: {
      readonly projectId: number;
      readonly prepared: PluginPrepared;
      readonly enabled: boolean;
    }): Effect.Effect<PluginRow, PluginFailure<PluginInstallRefusal>>;
    update(input: {
      readonly projectId: number;
      readonly prepared: PluginPrepared;
    }): Effect.Effect<PluginRow, PluginFailure<PluginInstallRefusal>>;
    installed(input: {
      readonly projectId: number;
      readonly id: string;
    }): Effect.Effect<PluginConsented, PluginFailure<PluginChangeRefusal>>;
    enable(input: {
      readonly projectId: number;
      readonly id: string;
      readonly enabled: boolean;
    }): Effect.Effect<PluginRow, PluginFailure<PluginChangeRefusal>>;
    uninstall(input: { readonly projectId: number; readonly id: string }): Effect.Effect<PluginRow, PluginFailure<PluginChangeRefusal>>;
  }
>()('tagma/plugins/Plugins') {}

export type LoadedSkill = {
  readonly name: string;
  readonly directory: string;
  readonly file: string;
  readonly root: string;
  readonly render: (text: string) => string;
};

export type LoadedCommand = {
  readonly name: string;
  readonly description: string;
  readonly body: Effect.Effect<string, PluginUnreadable>;
};

export type LoadedAgent = {
  readonly name: string;
  readonly file: string;
  readonly description: string;
  readonly prompt: Effect.Effect<string, PluginUnreadable>;
  readonly tools: readonly string[] | null;
};

export type LoadedHook = {
  readonly point: PluginHookPoint;
  readonly label: string;
  readonly matches: (call: PluginHookCall) => boolean;
  readonly run: (call: PluginHookCall, session: PluginHookSession) => Effect.Effect<PluginHookAnswer>;
};

export type PluginLoaded = {
  readonly id: string;
  readonly revision: string;
  readonly title: string;
  readonly place: PluginPlace;
  readonly redact: readonly string[];
  readonly skills: readonly LoadedSkill[];
  readonly commands: readonly LoadedCommand[];
  readonly agents: readonly LoadedAgent[];
  readonly servers: readonly McpServerDeclaration[];
  readonly hooks: readonly LoadedHook[];
};

export class PluginsUnreadable extends Data.TaggedError('PluginsUnreadable')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export class EnabledPlugins extends Context.Service<
  EnabledPlugins,
  {
    of(projectId: number): Effect.Effect<readonly PluginLoaded[], PluginsUnreadable>;
    readonly changes: Stream.Stream<number | null>;
  }
>()('tagma/plugins/EnabledPlugins') {}
