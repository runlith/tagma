import { Data, Schema } from 'effect';
import { isAbsolute, join } from 'node:path';
import type { TransportFailure } from '@runlith/agent/transcript/entries';
import type { Usage } from '@runlith/llm/schema/events';
import { HARNESS_ID_MAX, type HarnessClaim, type HarnessProvenance } from './harness';

export type MetadataField = 'model' | 'effort' | 'title';

export class MetadataInvalid extends Data.TaggedError('MetadataInvalid')<{
  readonly reason: 'malformed' | 'identity' | 'limit' | 'path' | 'changed' | 'terminal-unavailable';
}> {}

export type MetadataValue = { readonly value: string; readonly claim: HarnessClaim; readonly turnId: string | null };

export type MetadataValues = { readonly [K in MetadataField]: MetadataValue | null };

export const emptyValues = (): MetadataValues => ({ model: null, effort: null, title: null });

export const metadataText = Schema.String.check(Schema.isMaxLength(HARNESS_ID_MAX));

export const recordedValue = (value: string | null | undefined, turnId: string | null = null): MetadataValue | null =>
  value === undefined || value === null || value.trim() === '' ? null : { value, claim: 'last-recorded', turnId };

export const jsonValue = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new MetadataInvalid({ reason: 'malformed' });
  }
};

export const metadataDecode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const decode = Schema.decodeUnknownResult(schema);
  return (input: unknown): S['Type'] => {
    const result = decode(input);
    if (result._tag === 'Failure') throw new MetadataInvalid({ reason: 'malformed' });
    return result.success;
  };
};

export type MetadataFold<A> = {
  readonly json?: true;
  readonly empty: () => A;
  line(value: A, text: string): A;
  readonly missed?: (head: string) => readonly MetadataField[];
};

export type MetadataSession = {
  readonly rootKey: string;
  readonly cwd: string;
  readonly transcriptPath?: string;
  readonly exportPath?: string;
  readonly storage: { readonly entries: readonly { readonly name: string; readonly value: string }[] };
};

export const storageHome = (input: MetadataSession, variable: string, folder: string): string | null => {
  const entries = new Map(input.storage.entries.map((entry) => [entry.name, entry.value]));
  const configured = entries.get(variable);
  const home = entries.get('HOME');
  const path = configured ?? (home === undefined ? undefined : join(home, folder));
  return path !== undefined && isAbsolute(path) ? path : null;
};

export type MetadataScreen = { readonly title: string };

type Sourced = { readonly source: HarnessProvenance; readonly fields: readonly MetadataField[] };

export type MetadataLocation = Sourced &
  (
    | {
        readonly kind: 'file';
        readonly root: string;
        readonly path: string;
        readonly fold: MetadataFold<MetadataValues>;
        readonly computed?: true;
      }
    | {
        readonly kind: 'index';
        readonly root: string;
        readonly path: string;
        readonly parse: (text: string) => { id: string; title: string | null };
      }
    | { readonly kind: 'terminal'; readonly cells: boolean; readonly parse: (screen: MetadataScreen) => MetadataValue | null }
    | {
        readonly kind: 'command';
        readonly program: string;
        readonly args: readonly string[];
        readonly parse: (text: string) => MetadataValue | null;
      }
    | { readonly kind: 'unreadable'; readonly reason: string }
    | { readonly kind: 'unsupported' }
  );

export function fileSource(
  root: string | null,
  path: string | undefined,
  fold: MetadataFold<MetadataValues>,
  fields: Sourced['fields'],
  source: HarnessProvenance = 'transcript',
  computed = false,
): MetadataLocation {
  if (root === null || path === undefined) return { kind: 'unreadable', reason: 'source-location-unavailable', source, fields };
  return computed ? { kind: 'file', root, path, fold, computed, source, fields } : { kind: 'file', root, path, fold, source, fields };
}

export type TranscriptSaid = {
  readonly texts: readonly string[];
  readonly typed: readonly string[];
  readonly at: number | null;
};

export type TranscriptRequest = {
  readonly id: string;
  readonly usage: Usage;
  readonly model: string | null;
  readonly at: number | null;
  readonly main: boolean;
};

export type TranscriptCompaction = { readonly tokens: number | null; readonly at: number | null };

export type TranscriptWords = {
  readonly said: readonly TranscriptSaid[];
  readonly requests: Map<string, TranscriptRequest>;
  readonly compacted: TranscriptCompaction | null;
};

export const unsaid = (): TranscriptWords => ({ said: [], requests: new Map(), compacted: null });

export const stampMillis = (value: string | undefined): number | null => {
  const at = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isNaN(at) ? null : at;
};

export function userTexts(message: unknown): readonly string[] {
  if (typeof message === 'string') return [message];
  if (!Array.isArray(message)) return [];
  return message.flatMap((part) => {
    if (typeof part !== 'object' || part === null) return [];
    const entry = part as Record<string, unknown>;
    return (entry.type === 'text' || entry.type === 'input_text') && typeof entry.text === 'string' ? [entry.text] : [];
  });
}

export function transcriptSaid(message: unknown, stamp: string | undefined): TranscriptSaid | null {
  const texts = userTexts(message);
  if (texts.join('\n').trim() === '') return null;
  const typed = texts.filter((part) => {
    const text = part.trim();
    return text !== '' && !text.startsWith('<') && !text.startsWith('# AGENTS.md');
  });
  return { texts, typed, at: stampMillis(stamp) };
}

export type WordsSource = {
  readonly root: string | null;
  readonly path: string | undefined;
  readonly fold: MetadataFold<TranscriptWords>;
};

export type MetadataFieldSource = { readonly source: HarnessProvenance; readonly readable: boolean } | null;

export type TailEnd =
  | { readonly _tag: 'Completed'; readonly message: string | null }
  | { readonly _tag: 'Aborted' }
  | { readonly _tag: 'Failed'; readonly reason: string; readonly cause?: TransportFailure }
  | { readonly _tag: 'Open' };

export type TailWindow = { readonly since: number; readonly offset: number | null; readonly turn: string | null };

export type TailReader = {
  readonly shape: 'lines' | 'document';
  readonly window: 'time' | 'offset';
  readonly grain: number;
  readonly stampOf: (record: unknown) => number | null;
  readonly records?: (document: unknown) => readonly unknown[];
  readonly judge: (newestFirst: readonly unknown[], exhausted: boolean, turn: string | null) => TailEnd | null;
};

export type TailLocation = { readonly root: string; readonly path: string };

export type TailSource = {
  readonly reader: TailReader;
  readonly locate: (input: MetadataSession) => TailLocation | null;
  readonly located: 'launch' | 'reported';
};

export type Fields = Readonly<Record<string, unknown>>;

export const fieldsOf = (value: unknown): Fields | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null;

export const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export const blocksOf = (content: unknown): readonly Fields[] =>
  Array.isArray(content)
    ? content.flatMap((block): Fields[] => {
        const fields = fieldsOf(block);
        return fields === null ? [] : [fields];
      })
    : [];

export const textBlocks = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : blocksOf(content)
        .flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
        .join('\n');

export const answered = (text: string): TailEnd => ({ _tag: 'Completed', message: text.trim() === '' ? null : text });

export const isoStamp = (value: unknown): number | null => (typeof value === 'string' ? stampMillis(value) : null);

export type ArtifactFold = {
  readonly fold: (rootKey: string) => MetadataFold<{ readonly bound: boolean }>;
  readonly scan: 'one-record' | 'whole-file';
};

export type MetadataReader = {
  readonly sources: (input: MetadataSession) => readonly MetadataLocation[];
  readonly provenance: { readonly [K in MetadataField]: MetadataFieldSource };
  readonly words?: { readonly sources: (input: MetadataSession) => readonly WordsSource[]; readonly usage: boolean };
  readonly ends?: TailSource;
  readonly artifact?: ArtifactFold;
};
