import { Data, type Effect } from 'effect';
import type { Minimatch } from 'minimatch';
import { pathMatcher } from './patterns';
import type { ChangeTarget, WorkspaceChange } from '@runlith/files/change';

export class IntakeRefused extends Data.TaggedError('IntakeRefused')<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `The change record could not take the write at ${this.path}: ${this.reason}`;
  }
}

export type Landed =
  | { readonly _tag: 'moved' }
  | { readonly _tag: 'written'; readonly kept: boolean }
  | { readonly _tag: 'unconfirmed'; readonly reason: string };

export const landedOf = (written: boolean, kept: boolean): Landed => (written ? { _tag: 'written', kept } : { _tag: 'moved' });

export type CommandMove = {
  readonly name: string;
  readonly before: string | null;
  readonly after: string;
  readonly present: boolean;
  readonly existed: boolean | null;
  readonly written: CommandWindow | null;
  readonly bytes: Uint8Array | null;
  readonly link: boolean;
  readonly mode: number | null;
};

export type CommandWindow = { readonly from: number; readonly to: number };

export type CommandMoves = {
  readonly base: string | null;
  readonly window: CommandWindow;
  readonly moves: readonly CommandMove[];
};

export type CommandContent = { readonly bytes: Uint8Array } | { readonly file: string };

export type CommandBase = {
  readonly head: string | null;
  readonly at: number;
  readonly dirty: ReadonlyMap<string, { readonly digest: string; readonly present: boolean | null }>;
  readonly contents: ReadonlyMap<string, CommandContent>;
};

export type CommandVerdict =
  | { readonly name: string; readonly verdict: 'attributed' | 'unclaimed' | 'unproven' | 'overlap' | 'team' }
  | { readonly name: string; readonly verdict: 'taken'; readonly by: string };

export type CommandLife = {
  readonly based: (base: CommandBase) => Effect.Effect<void>;
  readonly opened: () => void;
  readonly ended: () => void;
  readonly settle: (moved: CommandMoves) => Effect.Effect<readonly CommandVerdict[]>;
  readonly close: () => void;
  readonly forget: () => void;
};

export type CommandPath = string | { readonly glob: string };

export const literalGlob = (text: string): string => text.replace(/[\\*?[\]{},!^-]/g, '\\$&');

const matchers = new WeakMap<object, Minimatch>();

export const namedBy = (paths: readonly CommandPath[], name: string): boolean => {
  const parts = name.split('/');
  return paths.some((path) => {
    if (typeof path === 'string') return path === '' || name === path || name.startsWith(`${path}/`);
    if (path.glob === '') return true;
    let matcher = matchers.get(path);
    if (matcher === undefined) {
      matcher = pathMatcher(path.glob, {
        noext: true,
        noglobstar: true,
        nobrace: true,
        nonegate: true,
        nocomment: true,
        dot: false,
        optimizationLevel: 0,
        platform: 'linux',
      });
      matchers.set(path, matcher);
    }
    return matcher.set.some(
      (row) =>
        row.length <= parts.length &&
        row.every((part, at) => {
          const value = parts[at] as string;
          return typeof part === 'string' ? part === value : part instanceof RegExp && part.test(value);
        }),
    );
  });
};

export type CommandPart = {
  readonly readsOnly: boolean;
  readonly named: readonly CommandPath[] | null;
  readonly signature: string | null;
  readonly listed: boolean;
  readonly implicit: readonly string[];
};

export type CommandFacts = {
  readonly readsOnly: boolean;
  readonly parts: readonly CommandPart[];
};

const directoriesOf = (name: string): readonly string[] => name.split('/').slice(0, -1);

export const impliedBy = (implicit: readonly string[], name: string): boolean =>
  implicit.some((pattern) => {
    const directory = pattern.endsWith('/');
    const stem = pattern.slice(pattern.startsWith('*') ? 1 : 0, directory ? -1 : undefined);
    if (directory && stem.includes('/')) return name.startsWith(`${stem}/`) || name.includes(`/${stem}/`);
    if (directory) return directoriesOf(name).some((one) => (pattern.startsWith('*') ? one.endsWith(stem) : one === stem));
    return pattern.startsWith('*') ? name.endsWith(stem) : name === stem || name.endsWith(`/${stem}`);
  });

export type WorkspaceChanges = {
  readonly land: <E, R>(
    changes: readonly WorkspaceChange[],
    write: Effect.Effect<boolean, E, R>,
  ) => Effect.Effect<Landed, E | IntakeRefused, R>;
  readonly records?: (path: string, target?: ChangeTarget) => Effect.Effect<boolean, IntakeRefused>;
  readonly normalized?: (path: string) => Effect.Effect<boolean | undefined, IntakeRefused>;
  readonly basis?: <A, E, R>(paths: readonly string[], work: Effect.Effect<A, E, R>) => Effect.Effect<A, E | IntakeRefused, R>;
  readonly turn?: <A, E, R>(
    paths: readonly string[],
    work: Effect.Effect<A, E, R>,
    target?: ChangeTarget,
  ) => Effect.Effect<A, E | IntakeRefused, R>;
  readonly command?: (tree: string, facts: CommandFacts) => Effect.Effect<CommandLife | null, IntakeRefused>;
  readonly rewrittenBy?: (path: string, text: string) => Effect.Effect<{ readonly commit: string | null } | null>;
};
