import { dirname, isAbsolute } from 'node:path';
import { Effect, Layer, Result, Schema, SchemaIssue } from 'effect';
import { AMENDMENT_OPS, batchSchema, type AmendmentOp, type BatchInput, type BatchOp } from '../contract/wire/batch.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { BatchSourceUnreadable, BatchFiles } from './batchFiles.js';
import { type Unblock, GateRefusal } from '../../platform/contract/wire/refusal.js';
import { optionalRef, refOf, register } from './amendmentOps.js';
import {
  Amendments,
  Batch,
  Review,
  Supersession,
  Tasks,
  type BatchAnswer,
  type DocumentScope,
  type BlockEnd,
  type Handles,
  type OpOutcome,
} from '../contract/service/work.js';
import { Sources } from '../contract/service/sources.js';
import { BlockRows } from '../acts/rows.js';
import { BlockNames } from '../contract/service/acts.js';
import type { HeldWork } from '../contract/wire/operations/shared.js';
import { ActState } from '../contract/service/transaction.js';
import { Trash } from '../contract/service/blocks.js';
import { InstalledCatalogs, Tags } from '../contract/service/vocabulary.js';
import { resolveTypes } from '../contract/wire/tags/profile.js';
import { aboutBody } from '../blocks/bodyFile.js';
import { closedParsing } from '../contract/wire/fields.js';

const standardSchemaIssue = SchemaIssue.makeFormatterStandardSchemaV1();

function plainObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function bodyFileNamed(value: unknown): string | undefined {
  const named = plainObject(value)?.['file'];
  return typeof named === 'string' && named.trim().length > 0 ? named.trim() : undefined;
}

type BodyHolder = { readonly index: number; readonly holder: Record<string, unknown> };

function bodyHolders(rawOps: readonly unknown[]): readonly BodyHolder[] {
  const holders: BodyHolder[] = [];
  for (const [index, raw] of rawOps.entries()) {
    const op = plainObject(raw);
    if (op === undefined) continue;
    holders.push({ index, holder: op });
    const nested = op['ops'];
    if (!Array.isArray(nested)) continue;
    for (const rawNested of nested) {
      const inner = plainObject(rawNested);
      if (inner !== undefined) holders.push({ index, holder: inner });
    }
  }
  return holders;
}

function sourceOps(source: string): readonly unknown[] {
  try {
    const ops = plainObject(JSON.parse(source))?.['ops'];
    return Array.isArray(ops) ? ops : [];
  } catch {
    return [];
  }
}

const HOLD_REFS: Readonly<Record<string, string>> = { claim: 'id', release: 'id', finish: 'id', close: 'id', supersede: 'oldId' };

function taskNames(source: string): readonly string[] {
  const names = new Set<string>();
  for (const raw of sourceOps(source)) {
    const op = plainObject(raw);
    const verb = op?.['op'];
    const field = typeof verb === 'string' && Object.hasOwn(HOLD_REFS, verb) ? HOLD_REFS[verb] : undefined;
    const id = field === undefined ? undefined : op?.[field];
    if (typeof id === 'string' && !id.startsWith('$')) names.add(id);
  }
  return [...names];
}

export function inlineBodyFiles(document: string | readonly unknown[] | undefined): readonly string[] {
  const ops = typeof document === 'string' ? sourceOps(document) : (document ?? []);
  return bodyHolders(ops)
    .map(({ holder }) => bodyFileNamed(holder['body']))
    .filter((named): named is string => named !== undefined && isAbsolute(named));
}

function batchDocumentUnblock(op: string | undefined, field: string | undefined, position: number, excess: boolean): Unblock {
  if (excess && field !== undefined && op !== undefined) {
    return [`in operation ${position}, remove \`${field}\`; batch \`${op}\` has no such field`];
  }
  if (field === 'id' && op !== undefined) {
    return [
      `in operation ${position}, set \`id\` to a block name, \`<project id>/<name>\` or \`$handle\`; batch \`${op}\` does not use \`blockId\``,
    ];
  }
  if (op === 'edit' && field === 'old') return [`in operation ${position}, set \`old\` to the exact text to replace`];
  if (op === 'edit' && field === 'new') return [`in operation ${position}, set \`new\` to what replaces it`];
  return [`correct operation ${position} so it carries the fields required by its op`];
}

function batchDocumentRefusal(error: Schema.SchemaError, ops: readonly unknown[]): GateRefusal<'bad-document'> {
  const issues = standardSchemaIssue(error.issue).issues;
  const located = issues
    .filter((issue) => issue.path?.[0] === 'ops' && typeof issue.path[1] === 'number')
    .sort(
      (left, right) =>
        (right.path?.length ?? 0) - (left.path?.length ?? 0) ||
        Number(right.message === 'Missing key') - Number(left.message === 'Missing key'),
    )[0];
  const index = typeof located?.path?.[1] === 'number' ? located.path[1] : 0;
  const raw = ops[index];
  const operation = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
  const op = typeof operation?.['op'] === 'string' ? operation['op'] : undefined;
  const position = index + 1;
  const label = `operation ${position}${op === undefined ? '' : ` (${op})`}`;
  const field = located?.path
    ?.slice(2)
    .map((part) => String(part))
    .join('.');
  const reason =
    located === undefined || field === undefined || field.length === 0
      ? `${label} does not match the batch operation grammar`
      : located.message === 'Missing key'
        ? `${label}: field \`${field}\` is missing`
        : `${label}: field \`${field}\` is invalid: ${located.message}`;
  return new GateRefusal(
    'bad-document',
    reason,
    batchDocumentUnblock(op, field, position, located?.message === 'Expected no excess property'),
  );
}

function batchDocumentOps(document: unknown): Effect.Effect<readonly unknown[], GateRefusal<'bad-document'>> {
  const envelope = plainObject(document);
  if (envelope === undefined) {
    return new GateRefusal(
      'bad-document',
      Array.isArray(document)
        ? 'a batch document is an object `{ "ops": [...] }`, not a bare operations array'
        : 'a batch document is an object `{ "ops": [...] }`',
      [Array.isArray(document) ? 'wrap the array once as `{ "ops": [...] }`' : 'write the document as `{ "ops": [ ... ] }`'],
    );
  }
  const ops = envelope['ops'];
  if (!Array.isArray(ops)) {
    return new GateRefusal('bad-document', 'a batch document has one required `ops` array', ['set the document to `{ "ops": [ ... ] }`']);
  }
  if (ops.length === 0) {
    return new GateRefusal('bad-document', 'the batch document has an empty `ops` array', ['put at least one operation in `ops`']);
  }
  return Effect.succeed(ops);
}

export const batchLayer: Layer.Layer<
  Batch,
  never,
  BlockRows | BlockNames | Amendments | BatchFiles | Sources | Tasks | Supersession | Review | Trash | Tags | InstalledCatalogs
> = Layer.effect(
  Batch,
  Effect.gen(function* () {
    const blockRows = yield* BlockRows;
    const names = yield* BlockNames;
    const amendments = yield* Amendments;
    const documents = yield* BatchFiles;
    const sources = yield* Sources;
    const tasks = yield* Tasks;
    const standing = yield* Supersession;
    const review = yield* Review;
    const trash = yield* Trash;
    const vocabulary = yield* Tags;
    const catalogs = yield* InstalledCatalogs;

    const hintsFor = Effect.fn('Batch.hintsFor')(function* (
      projectId: number,
      refusal: GateRefusal,
    ): Effect.fn.Return<readonly string[], StoreFailure | GateRefusal> {
      if (refusal.code !== 'field-required' && refusal.code !== 'field-invalid') return [];
      const table = yield* vocabulary.of(projectId);
      return (yield* catalogs.read(projectId)).flatMap((catalog) =>
        (catalog.profile?.batch ?? []).flatMap((entry) => {
          const { keys } = resolveTypes(table.identities, [entry.type]);
          return keys.some((key) => refusal.reason.startsWith(`${key}.${entry.field}`)) ? [entry.unblock] : [];
        }),
      );
    });

    const applyOp = Effect.fn('Batch.applyOp')(function* (
      op: BatchOp,
      handles: Handles,
      projectId: number,
      operator: boolean,
      scope: DocumentScope | undefined,
    ): Effect.fn.Return<OpOutcome, StoreFailure | GateRefusal, ActState> {
      if (scope !== undefined && (op.op === 'link' || op.op === 'unlink')) {
        const from = yield* refOf(handles, op.fromId);
        const input = {
          fromId: from,
          kind: op.kind,
          toId: op.toId.startsWith('$') ? yield* refOf(handles, op.toId) : op.toId,
        };
        yield* op.op === 'link' ? scope.link(input) : scope.unlink(input);
        return { ok: true };
      }
      if ((AMENDMENT_OPS as readonly string[]).includes(op.op)) {
        return yield* amendments.applyOp(op as AmendmentOp, handles, projectId);
      }
      switch (op.op) {
        case 'claim':
          return yield* tasks.claim({ id: yield* refOf(handles, op.id) });
        case 'release':
          return yield* tasks.release({ id: yield* refOf(handles, op.id) });
        case 'finish':
          return yield* tasks.finish({ id: yield* refOf(handles, op.id), commit: op.commit, operator });
        case 'close':
          return yield* tasks.close({
            id: yield* refOf(handles, op.id),
            reason: op.reason,
            operator,
          });
        case 'anchor':
          return yield* sources.attach({
            blockId: yield* refOf(handles, op.blockId),
            kind: op.kind,
            ref: op.ref,
            symbol: op.symbol,
            fromId: yield* optionalRef(handles, op.fromId),
          });
        case 'unanchor':
          yield* sources.unanchor({ blockId: yield* refOf(handles, op.blockId), kind: op.kind, ref: op.ref, symbol: op.symbol });
          return { ok: true };
        case 'propose': {
          const target = yield* blockRows.blockById(yield* refOf(handles, op.amendsId));
          const row = yield* review.propose({
            projectId: target.projectId,
            title: op.title,
            body: op.body,
            amendsId: target.id,
            ops: op.ops,
            sources: op.sources,
          });
          yield* register(handles, op.$id, row.id);
          return row;
        }
        case 'accept':
          return yield* review.accept({
            id: yield* refOf(handles, op.id),
            reason: op.reason,
            enclosing: handles.declared,
          });
        case 'reject':
          return yield* review.reject({ id: yield* refOf(handles, op.id), reason: op.reason });
        case 'uphold':
          return yield* review.uphold({
            id: yield* refOf(handles, op.id),
            reason: op.reason,
            by: yield* Effect.forEach(op.by, (ref) => refOf(handles, ref)),
          });
        case 'supersede':
          return yield* standing.supersede({ oldId: yield* refOf(handles, op.oldId), withId: yield* refOf(handles, op.withId) });
        case 'unsupersede':
          return yield* standing.unsupersede({ id: yield* refOf(handles, op.id) });
        case 'restore':
          return yield* trash.restore({ id: yield* refOf(handles, op.id) });
        default:
          return yield* new GateRefusal('batch-shape', `unknown op "${(op as { op?: unknown }).op}"`, [
            'every op of the document mirrors an operation by name; apply_batch states the grammar',
          ]);
      }
    });

    const resolveBodyFiles = Effect.fnUntraced(function* (rawOps: readonly unknown[], base: string | undefined) {
      const files = new Map<number, string | undefined>();
      for (const { index, holder } of bodyHolders(rawOps)) {
        const named = bodyFileNamed(holder['body']);
        if (named === undefined) continue;
        const read = yield* documents
          .body(base, named)
          .pipe(
            Effect.catchTag(
              'BatchSourceUnreadable',
              (error: BatchSourceUnreadable) =>
                new GateRefusal('body-source', `operation ${index + 1}: body file ${error.message}`, [
                  'write the body as a file beside the document and name it relative to the document',
                  'or set `body` to the text itself',
                ]),
            ),
          );
        holder['body'] = read.text;
        files.set(index, files.has(index) ? undefined : read.path);
      }
      return files;
    });

    const documentAt = (file: string): Effect.Effect<{ readonly path: string; readonly source: string }, GateRefusal<'batch-source'>> =>
      documents
        .read(file)
        .pipe(
          Effect.catchTag(
            'BatchSourceUnreadable',
            (error: BatchSourceUnreadable) =>
              new GateRefusal('batch-source', error.message, ['write the document as a file and pass its absolute path']),
          ),
        );

    const apply = Effect.fn('Batch.apply')(function* (
      input: BatchInput,
      projectId: number,
      operator = false,
      scope?: DocumentScope,
    ): Effect.fn.Return<BatchAnswer, StoreFailure | GateRefusal> {
      if (input.file === undefined && input.source === undefined) {
        return yield* new GateRefusal('batch-source', 'a batch needs one source: file or source', [
          'pass an editable JSON file, or the JSON source itself',
        ]);
      }
      if (input.file !== undefined && input.source !== undefined) {
        return yield* new GateRefusal('batch-source', 'a batch has two sources: file and source', ['pass exactly one source']);
      }
      const opened: { readonly source: string; readonly path?: string } =
        input.source !== undefined ? { source: input.source } : yield* documentAt(input.file as string);
      let bodyFiles = new Map<number, string | undefined>();
      let refusedCreate: GateRefusal | undefined;
      const ended: BlockEnd[] = [];
      const work = Effect.gen(function* () {
        const document = yield* Effect.try({
          try: () => JSON.parse(opened.source) as unknown,
          catch: (error) =>
            new GateRefusal('bad-document', `invalid JSON: ${error instanceof Error ? error.message : String(error)}`, [
              'correct the JSON document',
            ]),
        });
        const rawOps = yield* batchDocumentOps(document);
        bodyFiles = yield* resolveBodyFiles(rawOps, opened.path === undefined ? undefined : dirname(opened.path));
        const decoded = yield* Schema.decodeUnknownEffect(batchSchema)(document, { ...closedParsing, errors: 'all' }).pipe(
          Effect.mapError((error) => batchDocumentRefusal(error, rawOps)),
        );
        const ran = yield* amendments.runDocument(
          decoded.ops,
          (op, handles, index) =>
            applyOp(op, handles, projectId, operator, scope).pipe(
              Effect.tap((outcome) =>
                op.op === 'finish' || op.op === 'close' || op.op === 'supersede'
                  ? Effect.sync(() => ended.push(outcome as BlockEnd))
                  : Effect.void,
              ),
              Effect.catchTag('GateRefusal', (refusal: GateRefusal) => {
                if (op.op === 'create') refusedCreate = refusal;
                const file = bodyFiles.get(index);
                return Effect.fail(
                  file === undefined || refusal.inputFile !== undefined || !aboutBody(refusal.code)
                    ? refusal
                    : new GateRefusal(refusal.code, refusal.reason, refusal.unblock, file),
                );
              }),
            ),
          undefined,
          bodyFiles,
          scope?.references,
        );
        const named = [...bodyFiles.entries()].filter((entry): entry is [number, string] => entry[1] !== undefined);
        const specs = yield* tasks.specsLeftBy(ended);
        const counted = specs.length === 0 ? ran : { ...ran, specs };
        return named.length === 0 ? counted : { ...counted, bodyFiles: Object.fromEntries(named) };
      });
      return yield* work.pipe(
        Effect.catchTag('GateRefusal', (refusal) =>
          Effect.gen(function* () {
            const hints = refusedCreate === undefined ? [] : yield* hintsFor(projectId, refusedCreate);
            const bodyFile = refusal.inputFile;
            const inputFile = bodyFile ?? opened.path ?? (yield* documents.write(opened.source).pipe(Effect.orDie));
            const way =
              bodyFile === undefined
                ? `edit the input file ${inputFile}, then pass that path to apply_batch`
                : opened.path === undefined
                  ? `edit the body file ${bodyFile}, then hand the document to apply_batch again`
                  : `edit the body file ${bodyFile}, then hand ${opened.path} to apply_batch again`;
            return yield* new GateRefusal(refusal.code, refusal.reason, [way, ...refusal.unblock, ...hints], inputFile);
          }),
        ),
      );
    });

    const held = Effect.fn('Batch.held')(function* (
      input: BatchInput,
    ): Effect.fn.Return<readonly HeldWork[], StoreFailure | GateRefusal<'batch-source'>> {
      const source = input.source ?? (input.file === undefined ? null : (yield* documentAt(input.file)).source);
      if (source === null) return [];
      const found: HeldWork[] = [];
      for (const name of taskNames(source)) {
        const row = yield* Effect.result(Effect.flatMap(names.idOfName(name), (id) => blockRows.rawBlockById(id)));
        if (Result.isFailure(row)) {
          if (row.failure instanceof GateRefusal) continue;
          return yield* row.failure;
        }
        const hold = yield* tasks.heldElsewhere(row.success);
        if (hold !== null) found.push(hold);
      }
      return found;
    });

    return Batch.of({ apply, held });
  }),
);
