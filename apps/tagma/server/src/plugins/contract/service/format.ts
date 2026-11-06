import type { HookCall, HookPoint, HookSession } from '@runlith/tagma/plugin/protocol';
import { Context, Data, type Effect, type FileSystem } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { HookAnswer } from '../wire/hooks.js';
import type { PluginManifest, PluginOptionType, PluginProviders } from '../wire/rows.js';

export type PluginClaim = 'manifest' | 'layout';

export type PluginPlace = {
  readonly root: string;
  readonly data: string;
  readonly options: Readonly<Record<string, string>>;
  readonly project: string;
};

export type PluginSkillFile = {
  readonly name: string;
  readonly directory: string;
  readonly file: string;
  readonly render: (text: string, place: PluginPlace) => string;
};

export type PluginCommandFile = {
  readonly name: string;
  readonly description: string;
  readonly body: (place: PluginPlace) => Effect.Effect<string, PluginUnreadable, FileSystem.FileSystem>;
};

export type PluginAgentFile = {
  readonly name: string;
  readonly file: string;
  readonly description: string;
  readonly prompt: (place: PluginPlace) => Effect.Effect<string, PluginUnreadable, FileSystem.FileSystem>;
  readonly tools: readonly string[] | null;
  readonly dropped: readonly string[];
};

export type PluginServerReach =
  | {
      readonly transport: 'stdio';
      readonly command: string;
      readonly args?: readonly string[];
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string>>;
    }
  | { readonly transport: 'http'; readonly url: string; readonly headers?: Readonly<Record<string, string>> };

export type PluginServer = {
  readonly name: string;
  readonly reach: (place: PluginPlace) => Effect.Effect<PluginServerReach, PluginRefused | PluginUnreadable, FileSystem.FileSystem>;
};

export type PluginHookAnswer = HookAnswer & { readonly failure?: string };

export type PluginHook = {
  readonly at: HookPoint;
  readonly label: string;
  readonly matches: (call: HookCall) => boolean;
  readonly run: (
    call: HookCall,
    session: HookSession,
    place: PluginPlace,
  ) => Effect.Effect<PluginHookAnswer, never, ChildProcessSpawner.ChildProcessSpawner>;
};

export type PluginOption = {
  readonly key: string;
  readonly type: PluginOptionType;
  readonly title: string;
  readonly description: string;
  readonly sensitive: boolean;
  readonly required: boolean;
  readonly fallback: string | null;
};

export type PluginIgnored = { readonly component: string; readonly name: string | null; readonly reason: string };

export type PluginAbout = {
  readonly author: string | null;
  readonly homepage: string | null;
  readonly repository: string | null;
  readonly license: string | null;
};

export type PluginProcess = { readonly entry: string; readonly resident: boolean };

type PluginProviderPart = PluginProviders & { readonly entry: string };

type PluginBuild = { readonly hash: string; readonly sources: readonly string[]; readonly outputs: readonly string[] };

export type PluginPackage = {
  readonly name: string;
  readonly title: string | null;
  readonly version: string | null;
  readonly description: string | null;
  readonly about: PluginAbout;
  readonly skills: readonly PluginSkillFile[];
  readonly commands: readonly PluginCommandFile[];
  readonly agents: readonly PluginAgentFile[];
  readonly servers: readonly PluginServer[];
  readonly hooks: readonly PluginHook[];
  readonly options: readonly PluginOption[];
  readonly process: PluginProcess | null;
  readonly providers: PluginProviderPart | null;
  readonly build: PluginBuild | null;
  readonly contributes: Readonly<Record<string, unknown>>;
  readonly ignored: readonly PluginIgnored[];
};

export class PluginUnreadable extends Data.TaggedError('PluginUnreadable')<{ readonly path: string; readonly reason: string }> {
  override get message(): string {
    return `${this.path} could not be read: ${this.reason}`;
  }
}

export class PluginRefused extends Data.TaggedError('PluginRefused')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export type PluginEntry = {
  readonly name: string;
  readonly fields: PluginManifest['fields'] | null;
};

export type PluginFormat = {
  readonly id: string;
  readonly prevails?: true;
  readonly claim: (root: string) => Effect.Effect<PluginClaim | null, PluginUnreadable, FileSystem.FileSystem>;
  readonly read: (
    root: string,
    claim: PluginClaim,
    entry: PluginEntry | null,
  ) => Effect.Effect<PluginPackage, PluginRefused | PluginUnreadable, FileSystem.FileSystem>;
};

export class PluginFormats extends Context.Service<PluginFormats, readonly PluginFormat[]>()('tagma/plugins/PluginFormats') {}
