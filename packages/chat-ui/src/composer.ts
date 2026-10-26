import { Data, Effect } from 'effect';
import type { Snippet } from 'svelte';
import type { ChatNotice } from './notice';
import type { ChatChord } from './renderers';

export type ComposerSlashOption = {
  id: string;
  label: string;
  description?: string;
  active?: boolean;
  disabled?: boolean;
};

export type ComposerSlashField = {
  id: string;
  label: string;
  placeholder?: string;
  options?: readonly ComposerSlashOption[];
  optional?: boolean;
  multiline?: boolean;
};

export type ComposerSlashArguments = Readonly<Record<string, string>>;

export type ComposerGesture = 'send' | 'queue';

export class ComposerRefused extends Data.TaggedError('ComposerRefused')<{ readonly message: string }> {}

export type ComposerHandler = Effect.Effect<ChatNotice | void, ComposerRefused>;

export function settled(handler: ComposerHandler): Effect.Effect<ChatNotice | null> {
  return handler.pipe(
    Effect.map((notice) => notice ?? null),
    Effect.catchTag('ComposerRefused', (refusal) => Effect.succeed<ChatNotice>({ tone: 'error', message: refusal.message })),
  );
}

export type ComposerCommandArgs = {
  readonly gesture: ComposerGesture;
  readonly optionId?: string;
  readonly values?: ComposerSlashArguments;
  readonly query?: string;
};

export type ComposerKeyHint = { readonly chord: ChatChord; readonly words: string };

export type ComposerSlashCommand = {
  readonly name: string;
  readonly description?: string;
  readonly keyHint?: ComposerKeyHint;
  readonly disabled?: boolean;
  readonly value?: string;
  readonly valueActive?: boolean;
  readonly options?: readonly ComposerSlashOption[];
  readonly fields?: readonly ComposerSlashField[];
  readonly opens?: boolean;
  readonly order?: number;
  run(args: ComposerCommandArgs): ComposerHandler;
};

export type ComposerRegion = 'leading' | 'status' | 'right' | 'media' | 'dock' | 'edge';

export type ComposerCycle = {
  readonly available: boolean;
  run(): ComposerHandler;
};

export type ComposerChip = {
  readonly id: string;
  readonly region: ComposerRegion;
  readonly order?: number;
  readonly body: Snippet;
  readonly cycle?: ComposerCycle;
};

export type ComposerPanel = {
  readonly returnFocus: () => void;
};

export type ComposerPanelContribution = {
  readonly id: string;
  readonly open: boolean;
  readonly body: Snippet<[ComposerPanel]>;
  close?(): void;
};

export type ComposerMentionOption = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  hits?: readonly number[];
};

export type ComposerMention = {
  readonly query: string;
  readonly from: number;
  readonly to: number;
};

export type ComposerInsertion = {
  readonly text: string;
  readonly skip: number;
};

export type ComposerMark = {
  readonly from: number;
  readonly to: number;
};

export type ComposerMentionProvider = {
  readonly id: string;
  readonly prefix: string;
  readonly label?: string;
  readonly accent?: boolean;
  readonly notice?: string;
  readonly icon?: Snippet<[ComposerMentionOption]>;
  options(query: string): readonly ComposerMentionOption[];
  match?(text: string, from: number, to: number): ComposerMention | null;
  insertion?(id: string, suffix: string): ComposerInsertion;
  marks?(text: string): readonly ComposerMark[];
  search?(query: string): ComposerHandler;
  pick?(id: string): ComposerHandler;
  opened?(): ComposerHandler;
};

export type ComposerDropState = 'ready' | 'aimed';

export type ComposerDrop = {
  readonly id: string;
  readonly state: ComposerDropState | null;
};

export type ComposerAttachmentKind = {
  readonly id: string;
  readonly accept: string;
  readonly button: boolean;
  accepts?(file: File): boolean;
  intake(files: readonly File[]): ComposerHandler;
};

export type PromptSelection = {
  readonly text: string;
  readonly from: number;
  readonly to: number;
};
