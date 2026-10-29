import { Context, Data, type Effect, type FileSystem } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { PluginHookPoint, PluginManifest, PluginOptionType } from '../wire/rows.js';

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

export type PluginHookCall =
  | { readonly point: 'beforeTool'; readonly tool: string; readonly input: unknown; readonly callId: string }
  | { readonly point: 'afterTool'; readonly tool: string; readonly input: unknown; readonly output: unknown; readonly callId: string }
  | { readonly point: 'beforeStep'; readonly text: string }
  | { readonly point: 'beforeClose'; readonly answer: string | null; readonly continued: boolean }
  | { readonly point: 'threadStarted'; readonly resumed: boolean }
  | { readonly point: 'threadEnded'; readonly reason: string };

export type PluginHookSession = { readonly thread: string; readonly cwd: string };

export type PluginHookAnswer = {
  readonly deny?: string;
  readonly input?: unknown;
  readonly context?: string;
  readonly block?: string;
  readonly failure?: string;
};

export type PluginHook = {
  readonly point: PluginHookPoint;
  readonly label: string;
  readonly matches: (call: PluginHookCall) => boolean;
  readonly run: (
    call: PluginHookCall,
    session: PluginHookSession,
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
  readonly claim: (root: string) => Effect.Effect<PluginClaim | null, PluginUnreadable, FileSystem.FileSystem>;
  readonly read: (
    root: string,
    claim: PluginClaim,
    entry: PluginEntry | null,
  ) => Effect.Effect<PluginPackage, PluginRefused | PluginUnreadable, FileSystem.FileSystem>;
};

export class PluginFormats extends Context.Service<PluginFormats, readonly PluginFormat[]>()('tagma/plugins/PluginFormats') {}
