import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';
import { isThreadFile } from '@runlith/agent/transcript/attachments';
import type { ThreadAttachment } from '@runlith/agent/transcript/entries';
import type { ChatTakenWords } from '@runlith/chat-ui/ChatDraft';
import type { ChatNotice } from '@runlith/chat-ui/notice';
import { type ChatDraftFile, chatDraftFile, draftFileMediaType, stageDraftFiles } from '@runlith/chat-ui/draftFiles';
import { type ChatDraftImage, chatDraftImage, stageDraftImages } from '@runlith/chat-ui/draftImages';
import { ChatDraftShelf } from '@runlith/chat-ui/draftShelf.svelte';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { TeamLayer } from '@runlith/agent/collaboration/team';
import { randomThreadName } from '@tagma/server/thread-record/contract/wire/name';
import { DraftFiles, type KeptFile } from './DraftFiles.js';
import { DraftStore, type StoredDraft } from './DraftStore.js';
import { type Draft, type DraftDocument, type DraftMention, type DraftPlace, MAIN_CHECKOUT } from '../Draft.svelte.js';
import { type StagedItem, StagedKinds } from '$lib/shared/threads/staged.js';

const NO_NAMES = (): ReadonlySet<string> => new Set();

export class DraftSlot {
  place: DraftPlace;
  text: string;
  images = $state<readonly ChatDraftImage[]>([]);
  files = $state<readonly ChatDraftFile[]>([]);
  mentions: readonly DraftMention[];
  items: readonly StagedItem[];
  documents: readonly DraftDocument[];
  type: string | null;
  account: string | null;
  switches: ModelSwitches;
  approvalMode: string | null;
  delegation: boolean | null;
  team: TeamLayer | null;
  lostAttachments = $state(0);
  restoring: { readonly images: readonly string[]; readonly files: readonly string[] } | null = null;
  restored: Promise<void> = Promise.resolve();
  readonly kept = new Set<string>();
  readonly uploaded = new Map<string, string>();

  constructor(
    readonly name: string,
    stored: StoredDraft | null = null,
  ) {
    this.place = $state.raw(stored?.place ?? MAIN_CHECKOUT);
    this.text = $state(stored?.text ?? '');
    this.mentions = $state(stored?.mentions ?? []);
    this.items = $state(stored?.items ?? []);
    this.documents = $state(stored?.documents ?? []);
    this.type = $state(stored?.type ?? null);
    this.account = $state(stored?.account ?? null);
    this.switches = $state(stored?.switches ?? {});
    this.approvalMode = $state(stored?.approvalMode ?? null);
    this.delegation = $state(stored?.delegation ?? null);
    this.team = $state.raw(stored?.team ?? null);
  }
}

export class DraftShelf extends Service<DraftShelf>()('DraftShelf', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    const kinds = yield* StagedKinds;
    return new DraftShelf(platform.storage.local, new DraftFiles(platform.databases), (kind) => kinds.find(kind) !== undefined);
  }

  private readonly slots = new ChatDraftShelf<DraftSlot>((key) => this.hydrate(key));
  private readonly store: DraftStore;

  constructor(
    storage: PlatformStorage,
    private readonly staged: DraftFiles,
    known: (kind: string) => boolean,
  ) {
    super();
    this.store = new DraftStore(storage, known);
    void staged
      .prune((key, id) => {
        const draft = this.store.read(key);
        return draft !== null && (draft.images.includes(id) || draft.files.includes(id));
      })
      .catch(warn);
  }

  private taken: () => ReadonlySet<string> = NO_NAMES;

  at(key: string, taken: () => ReadonlySet<string> = NO_NAMES): DraftSlot {
    this.taken = taken;
    try {
      return this.slots.at(key);
    } finally {
      this.taken = NO_NAMES;
    }
  }

  keep(key: string): void {
    const slot = this.slots.at(key);
    const draft = storedDraft(slot);
    if (draft === null) this.store.drop(key);
    else this.store.write(key, draft);
    this.keepStaged(key, slot, draft === null ? [] : [...draft.images, ...draft.files]);
  }

  place(key: string, place: DraftPlace, taken: () => ReadonlySet<string> = NO_NAMES): void {
    this.at(key, taken).place = place;
    this.keep(key);
  }

  rename(from: string, to: string): void {
    if (from === to) return;
    this.slots.rename(from, to);
    this.store.move(from, to);
    void this.staged.move(from, to).catch(warn);
  }

  async carry(from: string, to: string): Promise<void> {
    if (from === to) return;
    const carried = this.slots.at(from);
    const parked = this.slots.at(to);
    if (storedDraft(parked) === null) {
      this.forget(to);
      this.rename(from, to);
      this.place(to, MAIN_CHECKOUT);
      return;
    }
    await Promise.all([carried.restored, parked.restored]);
    parked.type = carried.type;
    parked.account = carried.account;
    parked.switches = carried.switches;
    parked.approvalMode = carried.approvalMode;
    parked.delegation = carried.delegation;
    parked.team = carried.team;
    this.give(to, carried);
    this.forget(from);
  }

  forget(key: string): void {
    this.slots.forget(key);
    this.store.drop(key);
    void this.staged.drop(key).catch(warn);
  }

  give(key: string, draft: Draft, taken: () => ReadonlySet<string> = NO_NAMES): void {
    const slot = this.at(key, taken);
    const images = new Set(draft.images.map((image) => image.id));
    const files = new Set(draft.files.map((file) => file.id));
    const mentions = new Set(draft.mentions.map((mention) => mention.name));
    const items = new Set(draft.items.map(itemKey));
    const documents = new Set(draft.documents.map((document) => document.id));
    slot.text = ahead(draft.text, slot.text);
    slot.images = [...draft.images.map((image) => ({ ...image })), ...slot.images.filter((image) => !images.has(image.id))];
    slot.files = [...draft.files.map((file) => ({ ...file })), ...slot.files.filter((file) => !files.has(file.id))];
    slot.mentions = [
      ...draft.mentions.map((mention) => ({ ...mention })),
      ...slot.mentions.filter((mention) => !mentions.has(mention.name)),
    ];
    slot.items = [...draft.items, ...slot.items.filter((item) => !items.has(itemKey(item)))];
    slot.documents = [...draft.documents, ...slot.documents.filter((document) => !documents.has(document.id))];
    slot.restoring = null;
    this.keep(key);
  }

  stash(inputId: string, draft: Draft): void {
    const key = outboxKey(inputId);
    const slot = this.at(key);
    slot.text = draft.text;
    slot.images = draft.images.map((image) => ({ ...image }));
    slot.files = draft.files.map((file) => ({ ...file }));
    slot.mentions = draft.mentions.map((mention) => ({ ...mention }));
    slot.items = [...draft.items];
    slot.documents = [...draft.documents];
    this.keep(key);
  }

  async unstash(inputId: string, into: string, text: string): Promise<void> {
    const key = outboxKey(inputId);
    const stashed = this.at(key);
    const target = this.at(into);
    await Promise.all([stashed.restored, target.restored]);
    const draft: Draft = {
      text: stashed.text,
      images: stashed.images,
      files: stashed.files,
      mentions: stashed.mentions,
      items: stashed.items,
      documents: stashed.documents,
    };
    this.give(into, storedDraft(stashed) === null ? { ...draft, text } : draft);
    this.forget(key);
  }

  discard(inputId: string): void {
    this.forget(outboxKey(inputId));
  }

  async takeBack(
    key: string,
    sent: readonly ChatTakenWords[],
    fetch: (attachment: ThreadAttachment) => Promise<File>,
    taken: () => ReadonlySet<string> = NO_NAMES,
  ): Promise<ChatNotice | null> {
    const opened = sent.map((words) => unopened(words.text));
    const pictures: File[] = [];
    const pdfs: File[] = [];
    const documents: DraftDocument[] = [];
    let lost = 0;
    for (const attachment of sent.flatMap((words) => words.attachments)) {
      const file = await fetch(attachment).catch(() => null);
      if (file === null) lost += 1;
      else if (file.type === 'text/markdown')
        documents.push({ id: crypto.randomUUID(), title: attachment.filename ?? 'Document', text: await file.text() });
      else if (draftFileMediaType(file) !== null) pdfs.push(file);
      else pictures.push(file);
    }
    const slot = this.at(key, taken);
    slot.documents = [...slot.documents, ...documents];
    const staged = await stageDraftImages(slot.images, pictures);
    slot.images = [...slot.images, ...staged.added];
    const filed = await stageDraftFiles(slot.files, pdfs);
    slot.files = [...slot.files, ...filed.added];
    slot.text = [...opened.map((words) => words.text), slot.text]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n\n');
    const standing = new Set(slot.mentions.map((mention) => mention.name));
    const mentions = opened
      .flatMap((words) => words.mentions)
      .filter((mention) => {
        if (standing.has(mention.name)) return false;
        standing.add(mention.name);
        return true;
      });
    slot.mentions = [...slot.mentions, ...mentions];
    this.keep(key);
    const unread = lost + pictures.length - staged.added.length + pdfs.length - filed.added.length;
    if (unread === 0) return null;
    return { tone: 'error', message: `${unread === 1 ? 'An attachment' : `${unread} attachments`} could not be put back into the draft.` };
  }

  private keepStaged(key: string, slot: DraftSlot, listed: readonly string[]): void {
    const standing = new Set(listed);
    const added = [...slot.images, ...slot.files].filter((staged) => !slot.kept.has(staged.id));
    const removed = [...slot.kept].filter((id) => !standing.has(id));
    if (added.length === 0 && removed.length === 0) return;
    for (const staged of added) slot.kept.add(staged.id);
    for (const id of removed) slot.kept.delete(id);
    void this.staged.write(key, added, removed).catch(warn);
  }

  private hydrate(key: string): DraftSlot {
    const stored = this.store.read(key);
    if (stored === null) return new DraftSlot(randomThreadName(this.taken()));
    const slot = new DraftSlot(stored.name, stored);
    if (stored.images.length > 0 || stored.files.length > 0) {
      const restoring = { images: stored.images, files: stored.files };
      slot.restoring = restoring;
      for (const id of [...stored.images, ...stored.files]) slot.kept.add(id);
      slot.restored = this.restore(key, slot, restoring);
    }
    return slot;
  }

  private async restore(key: string, slot: DraftSlot, restoring: NonNullable<DraftSlot['restoring']>): Promise<void> {
    const rows = await this.staged.read(key).catch((error: unknown): readonly KeptFile[] => {
      warn(error);
      return [];
    });
    const found = new Map(rows.map((row) => [row.id, row]));
    const images: ChatDraftImage[] = [];
    const files: ChatDraftFile[] = [];
    for (const id of restoring.images) {
      const row = found.get(id);
      const image =
        row === undefined || isThreadFile(row.mediaType)
          ? null
          : await chatDraftImage(row.id, row.filename, row.mediaType, fileOf(row)).catch((error: unknown) => {
              warn(error);
              return null;
            });
      if (image !== null) images.push(image);
    }
    for (const id of restoring.files) {
      const row = found.get(id);
      if (row !== undefined && isThreadFile(row.mediaType)) files.push(chatDraftFile(row.id, row.filename, row.mediaType, fileOf(row)));
    }
    if (slot.restoring !== restoring) return;
    slot.restoring = null;
    slot.images = [...images, ...slot.images];
    slot.files = [...files, ...slot.files];
    slot.lostAttachments = restoring.images.length + restoring.files.length - images.length - files.length;
  }
}

const REFS = /^(?:\[\[[^\]|\n]+(?:\|[^\]\n]*)?\]\]\s*)+$/;
const REF = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g;

function unopened(text: string): { text: string; mentions: DraftMention[] } {
  const cut = text.lastIndexOf('\n\n');
  const tail = (cut < 0 ? text : text.slice(cut + 2)).trim();
  if (!REFS.test(tail)) return { text, mentions: [] };
  const mentions = [...tail.matchAll(REF)].map((ref) => ({ name: ref[1]!.trim(), title: ref[2]?.trim() ?? '', tag: null }));
  return { text: cut < 0 ? '' : text.slice(0, cut), mentions };
}

function ahead(returned: string, standing: string): string {
  return [returned, standing]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

function itemKey(item: StagedItem): string {
  return JSON.stringify([item.kind, item.key]);
}

function outboxKey(inputId: string): string {
  return `outbox:${inputId}`;
}

function fileOf(row: KeptFile): File {
  return new File([row.bytes], row.filename, { type: row.mediaType });
}

function warn(error: unknown): void {
  console.warn('[drafts] Staged attachments were not kept or read back:', error);
}

function storedDraft(slot: DraftSlot): StoredDraft | null {
  const images = [...(slot.restoring?.images ?? []), ...slot.images.map((image) => image.id)];
  const files = [...(slot.restoring?.files ?? []), ...slot.files.map((file) => file.id)];
  const carries =
    slot.text !== '' ||
    slot.mentions.length > 0 ||
    slot.items.length > 0 ||
    slot.documents.length > 0 ||
    images.length > 0 ||
    files.length > 0 ||
    slot.type !== null ||
    slot.account !== null ||
    slot.approvalMode !== null ||
    slot.delegation !== null ||
    slot.team !== null ||
    slot.place.kind !== 'main' ||
    Object.keys(slot.switches).length > 0;
  if (!carries) return null;
  return {
    at: Date.now(),
    name: slot.name,
    text: slot.text,
    mentions: slot.mentions,
    items: slot.items,
    documents: slot.documents,
    type: slot.type,
    account: slot.account,
    switches: slot.switches,
    approvalMode: slot.approvalMode,
    delegation: slot.delegation,
    team: slot.team,
    place: slot.place,
    images,
    files,
  };
}
