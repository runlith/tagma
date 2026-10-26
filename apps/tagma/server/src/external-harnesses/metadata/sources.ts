import { isAbsolute, join } from 'node:path';
import { Effect, type FileSystem } from 'effect';
import type { ScreenAnswer } from '@runlith/executions/protocol/presentation';
import type { HarnessExecutionRef, HarnessFields, HarnessProvenance } from '../../threads/contract/wire/harness/observation.js';
import type { HarnessStorage } from '../../threads/contract/wire/harness/session.js';
import { MetadataFile, type MetadataFold, type MetadataLimits, type MetadataPage } from './file.js';
import { DOCUMENT_LIMITS } from './policy.js';
import type { MetadataValue, MetadataValues } from './fields.js';

export type MetadataInput = {
  readonly rootKey: string;
  readonly cwd: string;
  readonly execution: HarnessExecutionRef;
  readonly storage: HarnessStorage;
  readonly transcriptPath?: string;
  readonly exportPath?: string;
};

type Sourced = { readonly source: HarnessProvenance; readonly fields: readonly (keyof HarnessFields)[] };
export type MetadataLocation = Sourced &
  (
    | {
        readonly kind: 'file';
        readonly open: (limits: MetadataLimits) => (files: FileSystem.FileSystem) => Effect.Effect<MetadataPage<MetadataValues>>;
      }
    | {
        readonly kind: 'index';
        readonly root: string;
        readonly path: string;
        readonly parse: (text: string) => { id: string; title: string | null };
      }
    | { readonly kind: 'terminal'; readonly cells: boolean; readonly parse: (screen: ScreenAnswer) => MetadataValue | null }
    | {
        readonly kind: 'command';
        readonly program: string;
        readonly args: readonly string[];
        readonly parse: (text: string) => MetadataValue | null;
      }
    | { readonly kind: 'unreadable'; readonly reason: string }
    | { readonly kind: 'unsupported' }
  );
export type MetadataAdapter = (input: MetadataInput) => readonly MetadataLocation[];

export const storageHome = (input: MetadataInput, variable: string, folder: string): string | null => {
  const entries = new Map(input.storage.entries.map((entry) => [entry.name as string, entry.value]));
  const configured = entries.get(variable);
  const home = entries.get('HOME');
  const path = configured ?? (home === undefined ? undefined : join(home, folder));
  return path !== undefined && isAbsolute(path) ? path : null;
};

export function fileSource<A extends MetadataValues>(
  root: string | null,
  path: string | undefined,
  fold: MetadataFold<A>,
  fields: Sourced['fields'],
  source: HarnessProvenance = 'transcript',
  computed = false,
): MetadataLocation {
  if (root === null || path === undefined) return { kind: 'unreadable', reason: 'source-location-unavailable', source, fields };
  return {
    kind: 'file',
    source,
    fields,
    open: (limits) => {
      const cursor = new MetadataFile(fold, fold.json === true ? DOCUMENT_LIMITS : limits);
      return (files) =>
        cursor
          .read(files, root, path)
          .pipe(
            Effect.map((page) =>
              page._tag === 'Absent' && computed ? ({ _tag: 'Unreadable', reason: 'session-path-unresolved' } as const) : page,
            ),
          );
    },
  };
}
