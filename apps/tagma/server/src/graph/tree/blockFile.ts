import { Data, Effect, Schema } from 'effect';
import { edgeNameSchema } from '../contract/wire/edges.js';
import { fieldsField, tagsField } from '../contract/wire/fields.js';
import { SOURCE_KINDS } from '../contract/wire/sources.js';

const sourceSchema = Schema.Struct({
  kind: Schema.Literals(SOURCE_KINDS),
  ref: Schema.String,
  symbol: Schema.optional(Schema.String),
});

const edgeSchema = Schema.Struct({
  kind: edgeNameSchema,
  to: Schema.String.check(Schema.isMinLength(1)),
});

const frontmatterFields = {
  id: Schema.String.check(Schema.isMinLength(1)),
  title: Schema.String,
  ord: Schema.Number,
  tags: Schema.optional(tagsField),
  fields: Schema.optional(fieldsField),
  edges: Schema.optional(Schema.Array(edgeSchema)),
};

export const blockFrontmatterSchema = Schema.Struct({ ...frontmatterFields, sources: Schema.optional(Schema.Array(sourceSchema)) });

const RETIRED_SOURCE_KINDS = ['check', 'node', 'date', 'url'] as const;

const writtenFrontmatterSchema = Schema.Struct({
  ...frontmatterFields,
  verifiedAt: Schema.optional(Schema.String),
  sources: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literals([...SOURCE_KINDS, ...RETIRED_SOURCE_KINDS]),
        ref: Schema.String,
        symbol: Schema.optional(Schema.String),
        fingerprint: Schema.optional(Schema.String),
        probeRevision: Schema.optional(Schema.String),
        verifiedAt: Schema.optional(Schema.String),
      }),
    ),
  ),
});

const isSourceKind = (kind: string): kind is BlockSource['kind'] => (SOURCE_KINDS as readonly string[]).includes(kind);

function currentFrontmatter(written: typeof writtenFrontmatterSchema.Type): BlockFrontmatter {
  const { verifiedAt: _verifiedAt, sources, ...front } = written;
  const kept = sources?.flatMap((item) => (isSourceKind(item.kind) ? [{ kind: item.kind, ref: item.ref, symbol: item.symbol }] : []));
  return { ...front, sources: kept === undefined || kept.length === 0 ? undefined : kept };
}

export type BlockFrontmatter = typeof blockFrontmatterSchema.Type;
export type BlockSource = (typeof sourceSchema)['Type'];
export type BlockEdge = (typeof edgeSchema)['Type'];

export type BlockFile = {
  readonly frontmatter: BlockFrontmatter;
  readonly body: string;
};

export type BlockSourceRow = {
  readonly kind: BlockSource['kind'];
  readonly ref: string;
  readonly symbol: string | null;
};

export type BlockFileRow = {
  readonly id: string;
  readonly title: string;
  readonly ord: number;
  readonly tags: readonly string[];
  readonly fields: Readonly<Record<string, unknown>>;
  readonly edges: readonly BlockEdge[];
  readonly sources: readonly BlockSourceRow[];
};

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function blockFrontmatterOf(row: BlockFileRow): BlockFrontmatter {
  return {
    id: row.id,
    title: row.title,
    ord: row.ord,
    tags: row.tags.length === 0 ? undefined : [...row.tags],
    fields: Object.keys(row.fields).length === 0 ? undefined : { ...row.fields },
    edges:
      row.edges.length === 0
        ? undefined
        : row.edges.map((item) => ({ kind: item.kind, to: item.to })).toSorted((a, b) => order(a.kind, b.kind) || order(a.to, b.to)),
    sources:
      row.sources.length === 0
        ? undefined
        : row.sources.map((item) => ({
            kind: item.kind,
            ref: item.ref,
            symbol: item.symbol ?? undefined,
          })),
  };
}

export class BlockFileInvalid extends Data.TaggedError('BlockFileInvalid')<{
  readonly reason: 'conflict-markers' | 'frontmatter-missing' | 'frontmatter-unterminated' | 'frontmatter-yaml' | 'frontmatter-shape';
  readonly message: string;
}> {}

const OPEN = '---\n';
const OPEN_FENCE = /^---\r?\n/;

const decodeFrontmatter = Schema.decodeUnknownResult(writtenFrontmatterSchema, { onExcessProperty: 'error' });

const FILE_IDENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CONFLICT_MARKER = /^(<+|>+)(?: |\r?$)/gm;

export function decodeBlockFile(text: string, markerSize = 7): Effect.Effect<BlockFile, BlockFileInvalid> {
  for (const match of text.matchAll(CONFLICT_MARKER)) {
    if (match[1]!.length < markerSize) continue;
    return Effect.fail(
      new BlockFileInvalid({
        reason: 'conflict-markers',
        message: 'the file holds git conflict markers: a merge of it was never finished',
      }),
    );
  }
  const open = OPEN_FENCE.exec(text);
  if (open === null) {
    return Effect.fail(
      new BlockFileInvalid({ reason: 'frontmatter-missing', message: 'a block file opens with a --- fence on its first line' }),
    );
  }
  const closeFence = /\n---\r?(?:\n|$)/g;
  closeFence.lastIndex = open[0].length - 1;
  const close = closeFence.exec(text);
  if (close === null) {
    return Effect.fail(new BlockFileInvalid({ reason: 'frontmatter-unterminated', message: 'the opening --- fence never closes' }));
  }
  const yaml = text.slice(open[0].length, close.index + 1).replaceAll('\r\n', '\n');
  const body = close[0].endsWith('\n') ? text.slice(close.index + close[0].length) : '';
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(yaml);
  } catch (error) {
    return Effect.fail(
      new BlockFileInvalid({ reason: 'frontmatter-yaml', message: error instanceof Error ? error.message : String(error) }),
    );
  }
  const parsed = decodeFrontmatter(raw);
  if (parsed._tag === 'Failure') {
    return Effect.fail(new BlockFileInvalid({ reason: 'frontmatter-shape', message: parsed.failure.message }));
  }
  if (!FILE_IDENTITY.test(parsed.success.id)) {
    return Effect.fail(
      new BlockFileInvalid({
        reason: 'frontmatter-shape',
        message: `id "${parsed.success.id}" is not a uuid; a block's identity is the uuidv7 it was minted with`,
      }),
    );
  }
  const front = currentFrontmatter(parsed.success);
  if (front.fields !== undefined) {
    try {
      JSON.stringify(front.fields);
    } catch {
      return Effect.fail(new BlockFileInvalid({ reason: 'frontmatter-shape', message: 'the fields are not plain data' }));
    }
  }
  return Effect.succeed({ frontmatter: front, body });
}

function scalar(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value);
  if (value === '' || value.includes('\n')) return JSON.stringify(value);
  let read: unknown;
  try {
    read = (Bun.YAML.parse(`v: ${value}`) as { v?: unknown }).v;
  } catch {
    read = undefined;
  }
  return read === value ? value : JSON.stringify(value);
}

function withSortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => order(a, b)));
}

function fieldLines(fields: unknown): string[] {
  return JSON.stringify(fields, withSortedKeys, 2)
    .split('\n')
    .map((line) => `  ${line}`);
}

export function encodeBlockFile(file: BlockFile): string {
  const front = file.frontmatter;
  const lines: string[] = [`id: ${scalar(front.id)}`, `title: ${scalar(front.title)}`, `ord: ${scalar(front.ord)}`];
  if (front.tags !== undefined) lines.push(`tags: ${JSON.stringify(front.tags)}`);
  if (front.fields !== undefined) lines.push('fields:', ...fieldLines(front.fields));
  if (front.edges !== undefined) {
    lines.push('edges:');
    for (const edge of front.edges) {
      lines.push(`  - kind: ${scalar(edge.kind)}`, `    to: ${scalar(edge.to)}`);
    }
  }
  if (front.sources !== undefined) {
    lines.push('sources:');
    for (const measured of front.sources) {
      lines.push(`  - kind: ${scalar(measured.kind)}`, `    ref: ${scalar(measured.ref)}`);
      if (measured.symbol !== undefined) lines.push(`    symbol: ${scalar(measured.symbol)}`);
    }
  }
  return `${OPEN}${lines.join('\n')}\n---\n${file.body}`;
}
