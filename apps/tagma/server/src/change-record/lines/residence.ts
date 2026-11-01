import { Buffer } from 'node:buffer';
import { stepsIn } from '@runlith/utils/sequenceDiff';
import type { HunkLayout } from '@runlith/files/hunk';
import { shareText, type TextSlice } from './text.js';
import { foldPath, type FoldInput } from './fold.js';
import {
  contentFrom,
  digestOf,
  restoreFold,
  type Content,
  type FoldState,
  type RestoreResult,
  type TextContent,
  type Unknown,
} from './folding.js';
import { FoldMemory } from './memory.js';
import { packVerdict, type PackedVerdict } from './packed.js';
import type { BaseAlignment, Verdict } from './projection.js';
import { nobodyOf, readEvidence, shareEvidence, type ReadEvidence, type SharedEvidence } from './evidence.js';
import type { Nobody } from '../contract/wire/holdings.js';

type TextSide = Omit<Extract<TextContent, { kind: 'text' }>, 'text' | 'lines' | 'offsets'>;
type Side = Exclude<Content, { kind: 'text' }> | TextSide;
type HunkPayload = { readonly layout: HunkLayout; readonly before: TextSlice; readonly after: TextSlice };
type Row = Omit<FoldInput['rows'][number], 'before' | 'after' | 'hunk'> & {
  readonly before: Side;
  readonly after: Side;
  readonly hunk: HunkPayload | undefined;
};
export type FoldPayload = Omit<FoldInput, 'base' | 'head' | 'working' | 'rows' | 'evidence'> & {
  readonly base: Side;
  readonly evidence: SharedEvidence | undefined;
  readonly head: Side;
  readonly working: Side;
  readonly rows: readonly Row[];
};

export type FoldHandle = { readonly token: string; readonly revision: number };

export type FoldRecall = FoldHandle & {
  readonly base: Extract<Content, { kind: 'absent' | 'opaque' }>;
  readonly normalized: boolean;
  readonly rows: readonly { readonly id: string; readonly after: string | null | undefined }[];
  readonly bytes: number;
};

export type ResidentFold = {
  readonly packed: PackedVerdict;
  readonly nobody: readonly Nobody[];
  readonly retained: number;
  readonly record: FoldRecall | null;
  readonly restored: RestoreResult | Unknown | null;
};

export type JudgedFold = ResidentFold & { readonly result: Verdict };

export const payloadOf = (input: FoldInput): FoldPayload => {
  const side = (given: Content): Side =>
    given.kind === 'text' ? { kind: 'text', digest: given.digest, blob: given.blob, shared: given.shared } : given;
  const shared = (text: string, from: Content): TextSlice =>
    from.kind === 'text' && from.text === text ? from.shared : shareText(text, [0, text.length]);
  return {
    ...input,
    evidence: input.evidence === undefined ? undefined : shareEvidence(input.evidence),
    base: side(input.base),
    head: side(input.head),
    working: side(input.working),
    rows: input.rows.map((row) => {
      const hunk = row.hunk;
      return {
        ...row,
        before: side(row.before),
        after: side(row.after),
        hunk:
          hunk === undefined
            ? undefined
            : {
                layout: { firstLine: hunk.firstLine, oldLines: hunk.oldLines, newLines: hunk.newLines, windowBefore: hunk.windowBefore },
                before: shared(hunk.oldText, row.before),
                after: shared(hunk.newText, row.after),
              },
      };
    }),
  };
};

const inputOf = (payload: FoldPayload, decoded: ReadEvidence): FoldInput => {
  const { evidence, ...source } = payload;
  const texts = new Map<TextSlice, string>();
  const text = (shared: TextSlice): string => {
    const known = texts.get(shared);
    if (known !== undefined) return known;
    const value = Buffer.from(shared.bytes.buffer, shared.bytes.byteOffset, shared.bytes.byteLength).toString('utf16le');
    texts.set(shared, value);
    return value;
  };
  const side = (given: Side): Content =>
    given.kind === 'text' ? contentFrom(text(given.shared), { digest: given.digest, shared: given.shared }, given.blob) : given;
  return {
    ...source,
    debts: evidence === undefined ? payload.debts : decoded.debts,
    landed: evidence === undefined ? payload.landed : decoded.landed,
    base: side(payload.base),
    head: side(payload.head),
    working: side(payload.working),
    rows: payload.rows.map((row) => ({
      ...row,
      before: side(row.before),
      after: side(row.after),
      hunk: row.hunk === undefined ? undefined : { ...row.hunk.layout, oldText: text(row.hunk.before), newText: text(row.hunk.after) },
    })),
  };
};

const recallOf = (token: string, revision: number, state: FoldState): FoldRecall => {
  const rows: { readonly id: string; readonly after: string | null | undefined }[] = [];
  for (let link = state.rows; link !== null; link = link.previous) rows.push({ id: link.row.id, after: digestOf(link.row.after) });
  rows.reverse();
  const digest = digestOf(state.base);
  return {
    token,
    revision,
    base: digest === null ? { kind: 'absent', digest: null, blob: null } : { kind: 'opaque', digest: digest ?? null },
    normalized: state.normalized,
    rows,
    bytes: 512 + token.length * 2 + rows.reduce((sum, row) => sum + 128 + (row.id.length + (row.after?.length ?? 0)) * 2, 0),
  };
};

type SavedFold = { readonly state: FoldState; readonly revision: number; readonly bytes: number };

export class FoldResidence {
  private readonly memory: FoldMemory<SavedFold>;
  private readonly prefix = crypto.randomUUID();
  private sequence = 0;

  constructor(limit: number) {
    this.memory = new FoldMemory(limit);
  }

  judge(
    payload: FoldPayload,
    recalled: FoldHandle | undefined,
    alignment: BaseAlignment | undefined,
    selected?: ReadonlySet<string>,
  ): ResidentFold {
    const saved = recalled === undefined ? undefined : this.memory.fold(recalled.token);
    if (recalled !== undefined && (saved === undefined || saved.revision !== recalled.revision)) {
      const verdict: Verdict = {
        verdict: 'unknown',
        reason: 'alignment',
        writers: payload.rows.filter((row) => !payload.ended?.has(row.id)).map((row) => ({ row: row.id, holder: row.holder })),
      };
      return { packed: packVerdict(verdict, Infinity)!, record: null, restored: null, nobody: [], retained: this.memory.retained };
    }
    const evidence: ReadEvidence =
      payload.evidence === undefined
        ? { outside: { kind: 'external' }, debts: [], released: [], landed: [] }
        : readEvidence(payload.evidence);
    const input = inputOf(payload, evidence);
    const base = saved?.state.base ?? input.base;
    const aligned =
      alignment ??
      ((base.kind === 'text' || base.kind === 'absent') && (input.head.kind === 'text' || input.head.kind === 'absent')
        ? this.memory.alignment(base, input.head, input.normalized)
        : undefined);
    const folded = foldPath(input, stepsIn(1 << 23), saved === undefined ? undefined : { kind: 'complete', state: saved.state }, aligned);
    if (folded.alignment !== null) this.memory.aligned(folded.alignment);
    let record: FoldRecall | null = null;
    const first = input.rows[0];
    if (folded.record !== null && selected === undefined && first !== undefined) {
      const token = `${this.prefix}:${first.id}`;
      const revision = ++this.sequence;
      if (this.memory.keep(token, { state: folded.record, revision, bytes: folded.record.bytes + 128 }).kind === 'kept')
        record = recallOf(token, revision, folded.record);
    }
    const verdict =
      folded.result.verdict === 'proven' ? { ...folded.result, overwritten: new Map(folded.result.overwritten) } : folded.result;
    const restored =
      selected === undefined || folded.working === null || folded.result.verdict === 'unknown'
        ? null
        : restoreFold(folded.working, selected, stepsIn(2_000_000), input.working);
    return {
      packed: packVerdict(verdict, Infinity)!,
      nobody: verdict.verdict === 'proven' ? nobodyOf(verdict, evidence) : [],
      retained: this.memory.retained,
      record,
      restored:
        restored === null || 'reason' in restored
          ? restored
          : { text: restored.text, restored: restored.restored, partial: restored.partial, blocked: restored.blocked },
    };
  }
}
