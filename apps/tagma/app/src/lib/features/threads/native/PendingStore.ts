import { Effect, Schema } from 'effect';
import { ThreadAttachment, ThreadInteractionAnswer } from '@runlith/agent/transcript/entries';
import type { KeptAct, KeptTurn, PendingShelf } from '@runlith/chat-ui/session/PendingTurns';
import type { DraftShelf } from './DraftShelf.svelte.js';

const DATABASE = 'tagma.outbox';
const STORE = 'turns';
const BY_PROJECT = 'project';
const HOLDER_LOCK = 'tagma.outbox.holder.';
const TURN_LOCK = 'tagma.outbox.turn.';

const AnswerRow = Schema.Struct({
  inputId: Schema.String,
  at: Schema.Number,
  project: Schema.Number,
  holder: Schema.String,
  threadId: Schema.String,
  answer: Schema.Struct({ questionId: Schema.String, answers: Schema.Array(ThreadInteractionAnswer), key: Schema.String }),
});

const TurnRow = Schema.Struct({
  inputId: Schema.String,
  at: Schema.Number,
  project: Schema.Number,
  holder: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  draftKey: Schema.String,
  text: Schema.String,
  bubble: Schema.Boolean,
  stored: Schema.optional(Schema.Array(ThreadAttachment)),
  sent: Schema.NullOr(
    Schema.Struct({
      words: Schema.Struct({
        text: Schema.String,
        key: Schema.String,
        attachments: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String }))),
      }),
      queue: Schema.Boolean,
    }),
  ),
});

const Row = Schema.Union([AnswerRow, TurnRow]);

type Row = typeof Row.Type;

const rowOf = Schema.decodeUnknownOption(Row);

export class PendingStore implements PendingShelf {
  private readonly holder = crypto.randomUUID();
  private readonly returning = new Set<string>();
  private database: Promise<IDBDatabase> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly factory: IDBFactory,
    private readonly locks: LockManager | null,
    private readonly drafts: DraftShelf,
    private readonly fetch: (attachment: ThreadAttachment) => Promise<File>,
    private readonly projectId: number,
  ) {
    void locks?.request(HOLDER_LOCK + this.holder, () => new Promise<never>(() => {})).catch(warn);
  }

  keep(act: KeptAct): void {
    const row: Row = { ...act, project: this.projectId, holder: this.holder };
    void this.queued(async () => {
      const transaction = (await this.opened()).transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(row);
      await finished(transaction);
    }).catch(warn);
  }

  drop(inputId: string): void {
    if (!this.returning.has(inputId)) this.drafts.discard(inputId);
    void this.queued(async () => {
      const transaction = (await this.opened()).transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(inputId);
      await finished(transaction);
    }).catch(warn);
  }

  orphans(): Effect.Effect<readonly KeptAct[]> {
    return Effect.promise(() =>
      this.taken().catch((error: unknown): readonly KeptAct[] => {
        warn(error);
        return [];
      }),
    );
  }

  handBack(turn: KeptTurn): void {
    this.returning.add(turn.inputId);
    const stored = turn.stored ?? [];
    void this.drafts
      .unstash(turn.inputId, turn.draftKey, turn.text)
      .then(() => (stored.length === 0 ? null : this.drafts.takeBack(turn.draftKey, [{ text: '', attachments: stored }], this.fetch)))
      .catch(warn)
      .finally(() => this.returning.delete(turn.inputId));
  }

  private async taken(): Promise<readonly KeptAct[]> {
    const rows = await this.queued(async () => {
      const store = (await this.opened()).transaction(STORE).objectStore(STORE);
      return answer<unknown[]>(store.index(BY_PROJECT).getAll(this.projectId));
    });
    const alive = await this.alive();
    const taken: KeptAct[] = [];
    for (const raw of rows) {
      const row = rowOf(raw);
      if (row._tag === 'None' || row.value.holder === this.holder || alive.has(row.value.holder)) continue;
      const act = await this.claim(row.value.inputId);
      if (act !== null) taken.push(act);
    }
    return taken;
  }

  private claim(inputId: string): Promise<KeptAct | null> {
    const adopt = async () => {
      const alive = await this.alive();
      return this.queued(async () => {
        const transaction = (await this.opened()).transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        const adopted: { act: KeptAct | null } = { act: null };
        const read = store.get(inputId);
        read.onsuccess = () => {
          const row = rowOf(read.result);
          if (row._tag === 'None' || row.value.holder === this.holder || alive.has(row.value.holder)) return;
          store.put({ ...row.value, holder: this.holder });
          adopted.act = actOf(row.value);
        };
        await finished(transaction);
        return adopted.act;
      });
    };
    if (this.locks === null) return adopt();
    return this.locks.request(TURN_LOCK + inputId, { ifAvailable: true }, (lock) => (lock === null ? null : adopt()));
  }

  private async alive(): Promise<ReadonlySet<string>> {
    if (this.locks === null) return new Set();
    const state = await this.locks.query();
    return new Set((state.held ?? []).flatMap((lock) => (lock.name?.startsWith(HOLDER_LOCK) ? [lock.name.slice(HOLDER_LOCK.length)] : [])));
  }

  private opened(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'inputId' }).createIndex(BY_PROJECT, 'project');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.database;
  }

  private queued<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function actOf(row: Row): KeptAct {
  if ('answer' in row) return { inputId: row.inputId, at: row.at, threadId: row.threadId, answer: row.answer };
  return {
    inputId: row.inputId,
    at: row.at,
    threadId: row.threadId,
    draftKey: row.draftKey,
    text: row.text,
    bubble: row.bubble,
    stored: row.stored,
    sent: row.sent,
  };
}

function answer<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function warn(error: unknown): void {
  console.warn('[outbox] A pending turn was not kept or read back:', error);
}
