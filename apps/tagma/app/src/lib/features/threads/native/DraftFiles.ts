import type { ThreadFileMediaType, ThreadImageMediaType } from '@runlith/agent/transcript/attachments';

export type KeptFile = {
  readonly draft: string;
  readonly id: string;
  readonly filename: string;
  readonly mediaType: ThreadImageMediaType | ThreadFileMediaType;
  readonly bytes: ArrayBuffer;
};

export type StagedFile = {
  readonly id: string;
  readonly filename: string;
  readonly mediaType: ThreadImageMediaType | ThreadFileMediaType;
  readonly file: File;
};

const DATABASE = 'tagma.drafts';
const STORE = 'pictures';
const BY_DRAFT = 'draft';

export class DraftFiles {
  private database: Promise<IDBDatabase> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly factory: IDBFactory) {}

  read(draft: string): Promise<readonly KeptFile[]> {
    return this.queued(async () => {
      const store = (await this.opened()).transaction(STORE).objectStore(STORE);
      return answer<KeptFile[]>(store.index(BY_DRAFT).getAll(draft));
    });
  }

  write(draft: string, added: readonly StagedFile[], removed: readonly string[]): Promise<void> {
    return this.queued(async () => {
      const rows: KeptFile[] = await Promise.all(
        added.map(async (staged) => ({
          draft,
          id: staged.id,
          filename: staged.filename,
          mediaType: staged.mediaType,
          bytes: await staged.file.arrayBuffer(),
        })),
      );
      const transaction = (await this.opened()).transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      for (const row of rows) store.put(row);
      for (const id of removed) store.delete([draft, id]);
      await finished(transaction);
    });
  }

  move(from: string, to: string): Promise<void> {
    return this.queued(async () => {
      const transaction = (await this.opened()).transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const rows = store.index(BY_DRAFT).getAll(from);
      rows.onsuccess = () => {
        for (const row of rows.result as KeptFile[]) {
          store.delete([from, row.id]);
          store.put({ ...row, draft: to });
        }
      };
      await finished(transaction);
    });
  }

  drop(draft: string): Promise<void> {
    return this.queued(async () => {
      const transaction = (await this.opened()).transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const keys = store.index(BY_DRAFT).getAllKeys(draft);
      keys.onsuccess = () => {
        for (const key of keys.result) store.delete(key);
      };
      await finished(transaction);
    });
  }

  prune(kept: (draft: string, id: string) => boolean): Promise<void> {
    return this.queued(async () => {
      const transaction = (await this.opened()).transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const cursor = store.openKeyCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (at === null) return;
        const [draft, id] = at.primaryKey as [string, string];
        if (!kept(draft, id)) store.delete(at.primaryKey);
        at.continue();
      };
      await finished(transaction);
    });
  }

  private opened(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: ['draft', 'id'] }).createIndex(BY_DRAFT, 'draft');
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
