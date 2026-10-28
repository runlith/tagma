import type { ChatFold } from './ChatFold.svelte';
import type { ChatAttachment } from './entries';
import type { FeedMemory } from './FeedMemory';
import type { ChatEntryContext } from './renderers';
import { type ChatDisclosurePreference, type ChatStretchDefault, type ChatStretchPreference, type ChatVerbosePreference } from './surface';

export type ChatEntryViewOptions = {
  fold(): ChatFold;
  copyText(text: string): Promise<boolean>;
  copyImage(image: ChatAttachment): Promise<boolean>;
  saveImage(image: ChatAttachment): Promise<void>;
  verbose: ChatVerbosePreference;
  stretches: ChatStretchPreference;
  disclosure: ChatDisclosurePreference;
};

const COPIED_CONFIRMATION_MS = 2_000;

export class ChatEntryView implements ChatEntryContext {
  private foldOf: () => ChatFold;
  private copyText: (text: string) => Promise<boolean>;
  private copyPicture: (image: ChatAttachment) => Promise<boolean>;
  private savePicture: (image: ChatAttachment) => Promise<void>;
  private preference: ChatVerbosePreference;
  private stretchPreference: ChatStretchPreference;
  private disclosure: ChatDisclosurePreference;
  private expandedRows = $state<Record<string, boolean>>({});
  private threadKey: string | null = null;
  private copiedKey = $state<string | null>(null);
  private opened = $state<ChatAttachment | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;
  private verboseEnabled: boolean;
  private stretchesDefault: ChatStretchDefault;
  private heldStretches = $state<Record<string, true>>({});
  revision = $state(0);
  private picks: Record<string, number> = $derived.by(() => {
    const picks: Record<string, number> = {};
    const fold = this.foldOf();
    for (const entry of fold.index.of('ready-answers')) {
      const at = fold.at(entry.id);
      if (at === undefined) continue;
      const text = this.nextWords(fold, at);
      if (text === null) continue;
      const picked = entry.answers.findIndex((answer) => answer.send.trim() === text.trim());
      if (picked >= 0) picks[entry.id] = picked;
    }
    return picks;
  });

  constructor(
    private readonly memory: FeedMemory,
    options: ChatEntryViewOptions,
  ) {
    this.foldOf = options.fold;
    this.copyText = options.copyText;
    this.copyPicture = options.copyImage;
    this.savePicture = options.saveImage;
    this.preference = options.verbose;
    this.stretchPreference = options.stretches;
    this.disclosure = options.disclosure;
    this.verboseEnabled = $state(options.verbose.read());
    this.stretchesDefault = $state(options.stretches.read());
  }

  private nextWords(fold: ChatFold, position: number): string | null {
    const user = fold.index.after('user', position);
    let said = fold.index.after('words', position);
    while (said !== undefined && said.sender !== null) {
      const at = fold.at(said.id);
      said = at === undefined ? undefined : fold.index.after('words', at);
    }
    const userAt = user === undefined ? Infinity : (fold.at(user.id) ?? Infinity);
    const saidAt = said === undefined ? Infinity : (fold.at(said.id) ?? Infinity);
    if (userAt === Infinity && saidAt === Infinity) return null;
    return (userAt < saidAt ? user?.text : said?.text) ?? '';
  }

  openThread(key: string | null): void {
    if (key === this.threadKey) return;
    this.threadKey = key;
    this.expandedRows = key === null ? {} : { ...this.memory.expansion(key) };
    this.heldStretches = {};
    this.revision += 1;
  }

  get verbose(): boolean {
    return this.verboseEnabled;
  }

  toggleVerbose(): void {
    this.verboseEnabled = !this.verboseEnabled;
    this.preference.write(this.verboseEnabled);
  }

  get stretches(): ChatStretchDefault {
    return this.stretchesDefault;
  }

  toggleStretches(): void {
    this.stretchesDefault = this.stretchesDefault === 'all' ? 'newest' : 'all';
    this.stretchPreference.write(this.stretchesDefault);
    this.revision += 1;
  }

  stretchDefault(key: string, newest: boolean): boolean {
    return this.stretchesDefault === 'all' || newest || this.heldStretches[key] === true;
  }

  hold(key: string): void {
    this.heldStretches[key] = true;
    this.revision += 1;
  }

  release(key: string): void {
    delete this.heldStretches[key];
    this.revision += 1;
  }

  get held(): readonly string[] {
    return Object.keys(this.heldStretches);
  }

  expanded(key: string, fallback = false): boolean {
    return this.expandedRows[key] ?? fallback;
  }

  setExpanded(key: string, value: boolean): void {
    this.expandedRows[key] = value;
    this.revision += 1;
    const thread = this.threadKey;
    if (thread === null) return;
    this.memory.expand(thread, key, value);
    this.disclosure.write(this.memory.disclosure());
  }

  copied(key: string): boolean {
    return this.copiedKey === key;
  }

  copy(key: string, text: string): void {
    void this.performCopy(key, () => this.copyText(text));
  }

  copyImage(key: string, image: ChatAttachment): void {
    void this.performCopy(key, () => this.copyPicture(image));
  }

  saveImage(image: ChatAttachment): void {
    void this.savePicture(image);
  }

  readyAnswerPick(entryId: string): number | undefined {
    return this.picks[entryId];
  }

  get openedImage(): ChatAttachment | null {
    return this.opened;
  }

  openImage(image: ChatAttachment): void {
    this.opened = image;
  }

  closeImage(): void {
    this.opened = null;
  }

  readAttachment(url: string, signal: AbortSignal): Promise<string> {
    return this.foldOf().readAttachment(url, signal);
  }

  dispose(): void {
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = undefined;
  }

  private async performCopy(key: string, write: () => Promise<boolean>): Promise<void> {
    if (!(await write())) return;
    this.copiedKey = key;
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => {
      this.copiedKey = null;
      this.copiedTimer = undefined;
    }, COPIED_CONFIRMATION_MS);
  }
}
