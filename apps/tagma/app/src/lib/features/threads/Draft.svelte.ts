import type { ModelSwitches } from '@runlith/llm/models/description';
import type { TeamLayer } from '@runlith/agent/collaboration/team';
import type { ThreadAttachment } from '@runlith/agent/transcript/entries';
import type { ThreadAttachmentRef } from '@runlith/agent/transcript/attachments';
import type { StagedItem } from '$lib/shared/threads/staged.js';
import type { StagedItems } from './native/StagedItems.js';
import type { ThreadUploads } from './native/ThreadUploads.js';
import type { DraftShelf, DraftSlot } from './native/DraftShelf.svelte.js';
import { Effect } from 'effect';
import { CHAT_QUEUE_PREVIEW_MAX } from '@runlith/chat-ui/session/FeedVerdicts';
import type { ChatComposedTurn, ChatDraft, ChatTakenWords, ChatTurnOpening } from '@runlith/chat-ui/ChatDraft';
import type { ChatNotice } from '@runlith/chat-ui/notice';
import {
  type ChatDraftFile,
  type ChatDraftFileRejection,
  chatDraftFileAttachment,
  draftFileMediaType,
  stageDraftFiles,
} from '@runlith/chat-ui/draftFiles';
import {
  type ChatDraftImage,
  type ChatDraftImageRejection,
  chatDraftImageAttachment,
  stageDraftImages,
} from '@runlith/chat-ui/draftImages';
import { clipLabel } from '@runlith/utils/text';

export type DraftMention = {
  name: string;
  title: string;
  tag: string | null;
};

export type DraftDocument = { readonly id: string; readonly title: string; readonly text: string };

export type DraftPlace =
  | { readonly kind: 'main' }
  | { readonly kind: 'worktree'; readonly rootId: string }
  | { readonly kind: 'new'; readonly base: string | null };

export const MAIN_CHECKOUT: DraftPlace = { kind: 'main' };

export function mentionReference(name: string, title: string): string {
  const label = title.replaceAll(']', '').replaceAll('\n', ' ').trim();
  return label ? `[[${name}|${label}]]` : `[[${name}]]`;
}

export type Draft = {
  text: string;
  images: readonly ChatDraftImage[];
  files: readonly ChatDraftFile[];
  mentions: readonly DraftMention[];
  items: readonly StagedItem[];
  documents: readonly DraftDocument[];
};

export type DraftAttachResult = {
  added: number;
  notice?: string;
};

export interface DraftChoices {
  setAccount(value: string | null): void;
  setSwitches(value: ModelSwitches): void;
  setTeam(value: TeamLayer | null): void;
}

const SENT_ATTEMPTS = 3;
const SENT_DEADLINE_MS = 5_000;

const sameItem = (one: StagedItem, two: StagedItem): boolean => one.kind === two.kind && one.key === two.key;

export class ThreadDraft implements ChatDraft<Draft> {
  key = $state('new:none');

  constructor(
    private readonly shelf: DraftShelf,
    private readonly api: ThreadUploads,
    private readonly staged: StagedItems,
    private readonly taken: () => ReadonlySet<string> = () => new Set(),
  ) {}

  private get slot(): DraftSlot {
    return this.shelf.at(this.key, this.taken);
  }

  private keep(): void {
    this.shelf.keep(this.key);
  }

  get slashOpen(): boolean {
    return /^\s*\/\S*$/.test(this.text);
  }

  get text(): string {
    return this.slot.text;
  }

  get images(): readonly ChatDraftImage[] {
    return this.slot.images;
  }

  get files(): readonly ChatDraftFile[] {
    return this.slot.files;
  }

  get mentions(): readonly DraftMention[] {
    return this.slot.mentions;
  }

  get items(): readonly StagedItem[] {
    return this.slot.items;
  }

  get documents(): readonly DraftDocument[] {
    return this.slot.documents;
  }

  get name(): string {
    return this.slot.name;
  }

  get type(): string | null {
    return this.slot.type;
  }

  get account(): string | null {
    return this.slot.account;
  }

  get switches(): ModelSwitches {
    return this.slot.switches;
  }

  get approvalMode(): string | null {
    return this.slot.approvalMode;
  }

  get place(): DraftPlace {
    return this.slot.place;
  }

  setPlace(value: DraftPlace): void {
    this.shelf.place(this.key, value, this.taken);
  }

  setType(value: string | null): void {
    this.slot.type = value;
    this.keep();
  }

  setAccount(value: string | null): void {
    this.slot.account = value;
    this.keep();
  }

  setSwitches(value: ModelSwitches): void {
    this.slot.switches = value;
    this.keep();
  }

  setApprovalMode(value: string | null): void {
    this.slot.approvalMode = value;
    this.keep();
  }

  get delegation(): boolean | null {
    return this.slot.delegation;
  }

  setDelegation(value: boolean | null): void {
    this.slot.delegation = value;
    this.keep();
  }

  get team(): TeamLayer | null {
    return this.slot.team;
  }

  setTeam(value: TeamLayer | null): void {
    this.slot.team = value;
    this.keep();
  }

  async lostNotice(): Promise<string | null> {
    const key = this.key;
    await this.slot.restored;
    const lost = this.slot.lostAttachments;
    if (this.key !== key || lost === 0) return null;
    this.slot.lostAttachments = 0;
    this.keep();
    return lost === 1
      ? 'The attachment staged here did not survive the reload — attach it again.'
      : `The ${lost} attachments staged here did not survive the reload — attach them again.`;
  }

  get current(): Draft {
    const slot = this.slot;
    return {
      text: slot.text,
      images: slot.images,
      files: slot.files,
      mentions: slot.mentions,
      items: slot.items,
      documents: slot.documents,
    };
  }

  useKey(key: string): void {
    this.key = key;
  }

  pin(): DraftChoices {
    const key = this.key;
    const slot = () => this.shelf.at(key, this.taken);
    return {
      setAccount: (value) => {
        slot().account = value;
        this.shelf.keep(key);
      },
      setSwitches: (value) => {
        slot().switches = value;
        this.shelf.keep(key);
      },
      setTeam: (value) => {
        slot().team = value;
        this.shelf.keep(key);
      },
    };
  }

  setText(value: string): void {
    this.slot.text = value;
    this.keep();
  }

  clear(): void {
    const slot = this.slot;
    slot.text = '';
    slot.images = [];
    slot.files = [];
    slot.restoring = null;
    slot.mentions = [];
    slot.items = [];
    slot.documents = [];
    slot.lostAttachments = 0;
    this.keep();
  }

  restore(draft: Draft): void {
    const slot = this.slot;
    slot.text = draft.text;
    slot.images = draft.images.map((image) => ({ ...image }));
    slot.files = draft.files.map((file) => ({ ...file }));
    slot.restoring = null;
    slot.mentions = draft.mentions.map((mention) => ({ ...mention }));
    slot.items = [...draft.items];
    slot.documents = [...draft.documents];
    this.keep();
  }

  filled(draft: Draft): boolean {
    return (
      draft.text.trim().length > 0 ||
      draft.images.length > 0 ||
      draft.files.length > 0 ||
      draft.mentions.length > 0 ||
      draft.items.length > 0 ||
      draft.documents.length > 0
    );
  }

  attached(draft: Draft): boolean {
    return draft.images.length > 0 || draft.files.length > 0 || draft.items.length > 0 || draft.documents.length > 0;
  }

  textOf(draft: Draft): string {
    return draft.text;
  }

  preview(draft: Draft): string {
    const line = clipLabel(draft.text.replace(/\s+/g, ' ').trim(), CHAT_QUEUE_PREVIEW_MAX);
    if (line) return line;
    const document = draft.documents[0] ?? draft.items[0];
    if (document) return clipLabel(document.title, CHAT_QUEUE_PREVIEW_MAX);
    const file = draft.files[0];
    if (file) return draft.files.length === 1 ? clipLabel(file.filename, CHAT_QUEUE_PREVIEW_MAX) : `${draft.files.length} PDFs`;
    const mention = draft.mentions[0];
    if (mention) return clipLabel(mention.title.trim() || mention.name, CHAT_QUEUE_PREVIEW_MAX);
    const image = draft.images[0];
    if (!image) return '';
    return draft.images.length === 1 ? image.filename : `${draft.images.length} images`;
  }

  clone(draft: Draft): Draft {
    return {
      text: draft.text,
      images: draft.images.map((image) => ({ ...image })),
      files: draft.files.map((file) => ({ ...file })),
      mentions: draft.mentions.map((mention) => ({ ...mention })),
      items: [...draft.items],
      documents: [...draft.documents],
    };
  }

  withText(draft: Draft, text: string): Draft {
    return { ...draft, text };
  }

  opening(draft: Draft): ChatTurnOpening {
    const refs = draft.mentions.map((mention) => mentionReference(mention.name, mention.title)).join(' ');
    const previews = [
      ...[...draft.items, ...draft.documents].map((document): ThreadAttachment => ({
        mime: 'text/markdown',
        url: '',
        filename: document.title,
      })),
      ...draft.files.map(chatDraftFileAttachment),
      ...draft.images.map(chatDraftImageAttachment),
    ];
    return {
      text: [draft.text.trim(), refs].filter(Boolean).join('\n\n'),
      previews: previews.length > 0 ? previews : undefined,
    };
  }

  handBack(key: string, draft: Draft): void {
    this.shelf.give(key, draft, this.taken);
  }

  setAside(inputId: string, draft: Draft): void {
    this.shelf.stash(inputId, draft);
  }

  compose(sessionId: string, draft: Draft): Effect.Effect<ChatComposedTurn> {
    return Effect.promise(() => this.composed(sessionId, draft));
  }

  private async composed(sessionId: string, draft: Draft): Promise<ChatComposedTurn> {
    const receipts = this.slot.uploaded;
    const attachments: ThreadAttachmentRef[] = [];
    const staged = [
      ...draft.items.map((item) => ({
        receipt: `${sessionId}:${JSON.stringify([item.kind, item.key, item.data])}`,
        title: item.title,
        read: () => this.staged.file(item),
        item,
      })),
      ...draft.documents.map((document) => ({
        receipt: `${sessionId}:document:${document.id}`,
        title: document.title,
        read: async () => new File([document.text], 'document.md', { type: 'text/markdown' }),
        item: null,
      })),
    ];
    for (const one of staged) {
      const kept = receipts.get(one.receipt);
      if (kept) {
        attachments.push({ id: kept });
        continue;
      }
      const file = await one.read().catch((error: unknown) => error as Error);
      if (file instanceof Error)
        return { status: 'failed', notice: { tone: 'error', message: `${one.title} could not be read: ${file.message}` } };
      if (file === null) {
        if (one.item !== null) this.unstage(one.item);
        continue;
      }
      const result = await this.api.upload(sessionId, file);
      if (result.status === 'failed') return { status: 'failed', notice: { tone: 'error', message: result.message } };
      attachments.push(result.attachment);
      receipts.set(one.receipt, result.attachment.id);
    }
    for (const staged of [...draft.files, ...draft.images]) {
      const receipt = `${sessionId}:${staged.id}`;
      const uploaded = receipts.get(receipt);
      if (uploaded) {
        attachments.push({ id: uploaded });
        continue;
      }
      const result = await this.api.upload(sessionId, staged.file);
      if (result.status === 'failed') return { status: 'failed', notice: { tone: 'error', message: result.message } };
      attachments.push(result.attachment);
      receipts.set(receipt, result.attachment.id);
    }
    if (attachments.length === 0 && draft.text.trim() === '' && draft.mentions.length === 0) {
      return { status: 'failed', notice: { tone: 'error', message: 'Nothing was left to send: what was staged holds nothing new.' } };
    }
    return { status: 'composed', attachments };
  }

  accepted(threadId: string, draft: Draft): Effect.Effect<ChatNotice | null> {
    return Effect.promise(() => this.acceptance(threadId, draft));
  }

  private async acceptance(threadId: string, draft: Draft): Promise<ChatNotice | null> {
    const noted = draft.items.filter((item) => this.staged.noted(item));
    const unmoved = (await Promise.all(noted.map((item) => this.sent(item, threadId)))).filter((title): title is string => title !== null);
    if (unmoved.length === 0) return null;
    return {
      tone: 'error',
      message: `What was staged reached the thread, but its owner did not record the sending (${unmoved.join(', ')}). The next one may repeat it.`,
    };
  }

  private async sent(item: StagedItem, threadId: string): Promise<string | null> {
    const deadline = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), SENT_DEADLINE_MS));
    for (let attempt = 0; attempt < SENT_ATTEMPTS; attempt += 1) {
      const done = await Promise.race([
        this.staged.sent(item, threadId).then(
          () => 'noted' as const,
          () => 'refused' as const,
        ),
        deadline,
      ]);
      if (done === 'noted') return null;
      if (done === 'late') break;
    }
    return item.title;
  }

  async attach(files: readonly File[]): Promise<DraftAttachResult> {
    const slot = this.slot;
    const pictures = files.filter((file) => file.type.startsWith('image/'));
    const pdfs = files.filter((file) => draftFileMediaType(file) !== null);
    const images = await stageDraftImages(slot.images, pictures);
    const filed = await stageDraftFiles(slot.files, pdfs);
    slot.images = [...slot.images, ...images.added];
    slot.files = [...slot.files, ...filed.added];
    this.keep();
    const notices = [
      ...(images.rejection ? [refusal(images.rejection)] : []),
      ...(filed.rejection ? [fileRefusal(filed.rejection)] : []),
      ...(pictures.length + pdfs.length < files.length ? [UNSUPPORTED] : []),
    ];
    return { added: images.added.length + filed.added.length, notice: notices.length === 0 ? undefined : notices.join(' ') };
  }

  takeBack(key: string, sent: readonly ChatTakenWords[]): Effect.Effect<ChatNotice | null> {
    return Effect.promise(() => this.shelf.takeBack(key, sent, (attachment) => this.api.attachmentFile(attachment), this.taken));
  }

  stageDocument(document: DraftDocument): void {
    const slot = this.slot;
    slot.documents = [...slot.documents, document];
    this.keep();
  }

  removeDocument(id: string): void {
    const slot = this.slot;
    slot.documents = slot.documents.filter((document) => document.id !== id);
    this.keep();
  }

  removeAttachment(id: string): void {
    const slot = this.slot;
    slot.images = slot.images.filter((image) => image.id !== id);
    slot.files = slot.files.filter((file) => file.id !== id);
    this.keep();
  }

  stageMentions(mentions: readonly DraftMention[]): void {
    const slot = this.slot;
    const standing = new Set(slot.mentions.map((item) => item.name));
    const fresh = mentions.filter((mention) => !standing.has(mention.name) && standing.add(mention.name));
    if (fresh.length === 0) return;
    slot.mentions = [...slot.mentions, ...fresh];
    this.keep();
  }

  stage(item: StagedItem): void {
    const slot = this.slot;
    slot.items = [...slot.items.filter((standing) => !sameItem(standing, item)), item];
    this.keep();
  }

  unstage(item: StagedItem): void {
    const slot = this.slot;
    slot.items = slot.items.filter((standing) => !sameItem(standing, item));
    this.keep();
  }

  removeMention(name: string): void {
    const slot = this.slot;
    slot.mentions = slot.mentions.filter((mention) => mention.name !== name);
    this.keep();
  }
}

const UNSUPPORTED = 'A thread takes images and PDFs.';

function refusal(rejection: ChatDraftImageRejection): string {
  switch (rejection.reason) {
    case 'not-images':
      return UNSUPPORTED;
    case 'too-large':
      return `An image can be up to ${rejection.maxBytes / 1024 / 1024} MB.`;
    case 'unreadable':
      return 'That image could not be read.';
  }
}

function fileRefusal(rejection: ChatDraftFileRejection): string {
  switch (rejection.reason) {
    case 'too-large':
      return `A PDF can be up to ${rejection.maxBytes / 1024 / 1024} MB.`;
    case 'unreadable':
      return 'That PDF could not be read.';
  }
}
