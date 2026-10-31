import type { PlatformStorage } from '@runlith/layer/Platform';
import type { ModelSwitches } from '@runlith/llm/models/description';
import { type DraftDocument, type DraftMention, type DraftPlace, MAIN_CHECKOUT } from '../Draft.svelte.js';
import { Piece } from '@tagma/server/speech/contract/wire/listening';
import { TeamLayer, TeamModelKey } from '@runlith/agent/collaboration/team';
import { Option, Schema } from 'effect';

export type StoredDraft = {
  at: number;
  name: string;
  text: string;
  mentions: readonly DraftMention[];
  pieces: readonly Piece[];
  documents: readonly DraftDocument[];
  type: string | null;
  account: string | null;
  switches: ModelSwitches;
  approvalMode: string | null;
  delegation: boolean | null;
  team: TeamLayer | null;
  place: DraftPlace;
  images: readonly string[];
  files: readonly string[];
};

const INDEX_KEY = 'tagma.drafts';
const DRAFT_KEY = 'tagma.draft.';
const KEPT_MAX = 50;
const SPEND_STEPS = 10;
const SPEND_FROM_FIVE: Readonly<Record<number, number>> = { 1: 1, 2: 3, 3: 5, 4: 8, 5: 10 };

export class DraftStore {
  constructor(private readonly storage: PlatformStorage) {}

  read(key: string): StoredDraft | null {
    const raw = this.storage.getItem(DRAFT_KEY + key);
    if (raw === null) return null;
    try {
      return draftOf(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  write(key: string, draft: StoredDraft): void {
    this.storage.setItem(DRAFT_KEY + key, JSON.stringify({ ...draft, spendSteps: SPEND_STEPS }));
    const kept = new Set(readIndex(this.storage));
    if (kept.has(key)) return;
    kept.add(key);
    this.evict(kept);
    this.writeIndex(kept);
  }

  drop(key: string): void {
    this.storage.removeItem(DRAFT_KEY + key);
    const kept = new Set(readIndex(this.storage));
    if (kept.delete(key)) this.writeIndex(kept);
  }

  move(from: string, to: string): void {
    if (from === to) return;
    const raw = this.storage.getItem(DRAFT_KEY + from);
    const kept = new Set(readIndex(this.storage));
    this.remove(kept, from);
    this.remove(kept, to);
    if (raw !== null) {
      this.storage.setItem(DRAFT_KEY + to, raw);
      kept.add(to);
    }
    this.writeIndex(kept);
  }

  private remove(kept: Set<string>, key: string): void {
    this.storage.removeItem(DRAFT_KEY + key);
    kept.delete(key);
  }

  private evict(kept: Set<string>): void {
    while (kept.size > KEPT_MAX) {
      let oldest: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const key of kept) {
        const at = this.read(key)?.at ?? 0;
        if (at < oldestAt) {
          oldestAt = at;
          oldest = key;
        }
      }
      if (oldest === null) return;
      this.remove(kept, oldest);
    }
  }

  private writeIndex(kept: ReadonlySet<string>): void {
    this.storage.setItem(INDEX_KEY, JSON.stringify([...kept]));
  }
}

function readIndex(storage: PlatformStorage): readonly string[] {
  const raw = storage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function draftOf(value: unknown): StoredDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.text !== 'string' || typeof row.name !== 'string') return null;
  return {
    at: typeof row.at === 'number' ? row.at : 0,
    name: row.name,
    text: row.text,
    mentions: mentionsOf(row.mentions),
    pieces: piecesOf(row.pieces),
    documents: documentsOf(row.documents),
    type: typeof row.type === 'string' ? row.type : null,
    account: typeof row.account === 'string' ? row.account : null,
    switches: switchesOf(row.switches),
    approvalMode: typeof row.approvalMode === 'string' ? row.approvalMode : null,
    delegation: typeof row.delegation === 'boolean' ? row.delegation : null,
    team: Option.getOrNull(
      Option.map(teamOf(row.team), (team) => reviewOnRows(row.team, row.spendSteps === SPEND_STEPS ? team : spendOnTen(team))),
    ),
    place: placeOf(row.place),
    images: idsOf(row.images),
    files: idsOf(row.files),
  };
}

function idsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

const storedPlace = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal('worktree'), rootId: Schema.String }),
    Schema.Struct({ kind: Schema.Literal('new'), base: Schema.NullOr(Schema.String) }),
  ]),
);

function placeOf(value: unknown): DraftPlace {
  return Option.getOrElse(storedPlace(value), () => MAIN_CHECKOUT);
}

const teamOf = Schema.decodeUnknownOption(TeamLayer);

const spendOnTen = (team: TeamLayer): TeamLayer => ({
  ...team,
  models: team.models.map((edit) =>
    'model' in edit && edit.spend !== undefined ? { ...edit, spend: SPEND_FROM_FIVE[edit.spend] ?? edit.spend } : edit,
  ),
});

const pooled = Schema.decodeUnknownOption(
  Schema.Struct({ review: Schema.Struct({ pool: Schema.Array(TeamModelKey), split: Schema.optional(Schema.String) }) }),
);

const reviewOnRows = (stored: unknown, team: TeamLayer): TeamLayer =>
  Option.match(pooled(stored), {
    onNone: () => team,
    onSome: ({ review }) => ({
      models: [...team.models, ...review.pool.map((key) => ({ ...key, reviews: true }))],
      review: review.split === 'same' ? { ...team.review, lenses: [] } : team.review,
    }),
  });

const documentOf = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String, title: Schema.String, text: Schema.String }));

function documentsOf(value: unknown): readonly DraftDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const document = documentOf(item);
    return document._tag === 'Some' ? [document.value] : [];
  });
}

const pieceOf = Schema.decodeUnknownOption(Piece);

function piecesOf(value: unknown): readonly Piece[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const piece = pieceOf(item);
    return piece._tag === 'Some' ? [piece.value] : [];
  });
}

function mentionsOf(value: unknown): readonly DraftMention[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.name !== 'string' || typeof row.title !== 'string') return [];
    const tag = typeof row.tag === 'string' ? row.tag : typeof row.kind === 'string' ? row.kind : null;
    return [{ name: row.name, title: row.title, tag }];
  });
}

function switchesOf(value: unknown): ModelSwitches {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap((entry) =>
      typeof entry[1] === 'string' ? [[entry[0], entry[1]] as const] : [],
    ),
  );
}
