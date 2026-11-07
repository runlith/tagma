import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import type { HookCall, HookPoint, HookSession } from '@runlith/tagma/plugin/protocol';
import { Context, Data, type Effect, type Scope, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { SettableScope } from '../../../platform/contract/wire/setting.js';
import type { SettingLandRefusal } from '../../../settings/contract/service/values.js';
import type { PluginConsented } from '../wire/consent.js';
import type { PluginSwitchScope } from '../wire/operations.js';
import type {
  PluginComponentKind,
  PluginDeclared,
  PluginFault,
  PluginOrigin,
  PluginPreview,
  PluginProcessRow,
  PluginProviders,
  PluginRow,
  PluginSource,
} from '../wire/rows.js';
import type { PluginInstall } from '../wire/settings.js';
import type { PluginHookAnswer, PluginPackage, PluginPlace, PluginProcess, PluginRefused, PluginUnreadable } from './format.js';

export class PluginPlaces extends Context.Service<PluginPlaces, { readonly home: string }>()('tagma/plugins/PluginPlaces') {}

export class PluginDigests extends Context.Service<
  PluginDigests,
  { digest(root: string, paths: readonly string[]): Effect.Effect<string | null, PluginUnreadable> }
>()('tagma/plugins/PluginDigests') {}

export class PluginFaults extends Context.Service<
  PluginFaults,
  {
    put(plugin: string, point: string, fault: Omit<PluginFault, 'point'>): void;
    clear(plugin: string, point: string): void;
    replace(point: string, faults: ReadonlyMap<string, Omit<PluginFault, 'point'>>): void;
  }
>()('tagma/plugins/PluginFaults') {}

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

export type PluginDescribed = {
  readonly title: string | null;
  readonly description: string | null;
  readonly brings: readonly PluginComponentKind[];
};

export type PluginListRefusal = 'unknown-project' | 'secret-store-failed';
export type PluginPrepareRefusal =
  | PluginListRefusal
  | 'plugin-source-unreadable'
  | 'plugin-clone-failed'
  | 'plugin-package-unreachable'
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
export type PluginChangeRefusal =
  | Exclude<PluginInstallRefusal, 'plugin-id-taken' | 'plugin-pin-unreachable' | 'plugin-preview-expired'>
  | 'plugin-builtin';

export type PluginFailure<Code extends string> = StoreFailure | GateRefusal<Code>;

export class Plugins extends Context.Service<
  Plugins,
  {
    ids(): Effect.Effect<readonly string[], StoreFailure>;
    installs(): Effect.Effect<readonly PluginInstall[], StoreFailure>;
    rows(projectId: number, ids: readonly string[]): Effect.Effect<readonly PluginRow[], PluginFailure<PluginListRefusal>>;
    describe(input: { readonly root: string; readonly declared: PluginDeclared | null }): Effect.Effect<PluginDescribed | null>;
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
      readonly scope: SettableScope;
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
      readonly scope: PluginSwitchScope;
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
  readonly at: HookPoint;
  readonly label: string;
  readonly matches: (call: HookCall) => boolean;
  readonly run: (call: HookCall, session: HookSession) => Effect.Effect<PluginHookAnswer>;
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
  readonly process: PluginProcess | null;
  readonly providers: PluginPackage['providers'];
  readonly contributes: Readonly<Record<string, unknown>>;
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
    hooks(projectId: number): Effect.Effect<readonly LoadedHook[], PluginsUnreadable>;
    held(projectId: number): Effect.Effect<() => readonly string[], PluginsUnreadable>;
    readonly changes: Stream.Stream<number | null>;
  }
>()('tagma/plugins/EnabledPlugins') {}

type PluginHosted = {
  readonly id: string;
  readonly title: string;
  readonly root: string;
  readonly data: string;
  readonly digest: string;
  readonly processDigest: string | null;
  readonly process: PluginProcess | null;
  readonly contributes: Readonly<Record<string, unknown>>;
  readonly options: Readonly<Record<string, string>>;
  readonly redact: readonly string[];
};

export type PluginHostedRoot = { readonly root: string; readonly projects: readonly number[] };

export class PluginUnhosted extends Data.TaggedError('PluginUnhosted')<{ readonly id: string }> {
  override get message(): string {
    return `${this.id} runs no process and contributes nothing to Tagma`;
  }
}

export class HostedPlugins extends Context.Service<
  HostedPlugins,
  {
    roots(): Effect.Effect<ReadonlyMap<string, PluginHostedRoot>, PluginsUnreadable>;
    root(id: string): Effect.Effect<PluginHostedRoot | null, PluginsUnreadable>;
    read(id: string): Effect.Effect<PluginHosted, PluginUnhosted | PluginRefused | PluginUnreadable | PluginsUnreadable>;
    readonly changes: Stream.Stream<string>;
  }
>()('tagma/plugins/HostedPlugins') {}

export type PluginProcessControl = {
  readonly reading: (id: string) => PluginProcessRow | undefined;
  readonly stopped: (id: string) => Effect.Effect<void>;
};

export class PluginProcesses extends Context.Service<
  PluginProcesses,
  {
    register(control: PluginProcessControl): Effect.Effect<() => void>;
  }
>()('tagma/plugins/PluginProcesses') {}

export type BuiltinPlugin = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly providers: PluginProviders;
};

export class BuiltinPlugins extends Context.Service<BuiltinPlugins, readonly BuiltinPlugin[]>()('tagma/plugins/BuiltinPlugins') {}

export type ProviderPart = {
  readonly id: string;
  readonly title: string;
  readonly version: string | null;
  readonly builtin: boolean;
  readonly directory: string | null;
  readonly providers: PluginProviders;
  readonly off: boolean;
};

export class ProviderParts extends Context.Service<
  ProviderParts,
  {
    current(): readonly ProviderPart[];
    readonly changes: Stream.Stream<readonly ProviderPart[]>;
  }
>()('tagma/plugins/ProviderParts') {}

export type RevisionHolder = { readonly standing: () => ReadonlySet<string> };

export class RevisionRecords extends Context.Service<
  RevisionRecords,
  { readonly recorded: Effect.Effect<ReadonlySet<string>, StoreFailure> }
>()('tagma/plugins/RevisionRecords') {}

export class PluginRevisions extends Context.Service<
  PluginRevisions,
  {
    hold(directory: string | null, recorded?: boolean): Effect.Effect<boolean, never, Scope.Scope>;
    register(holder: RevisionHolder): Effect.Effect<void, never, Scope.Scope>;
    readonly released: Effect.Effect<void>;
  }
>()('tagma/plugins/PluginRevisions') {}
