import { rank } from '@runlith/search-text/match';
import type {
  ComposerKeyHint,
  ComposerMention,
  ComposerMentionProvider,
  ComposerSlashArguments,
  ComposerSlashCommand,
  PromptSelection,
} from './composer';

export type ComposerCatalogs = {
  readonly commands: readonly ComposerSlashCommand[];
  readonly providers: readonly ComposerMentionProvider[];
};

export type ComposerOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly keyHint?: ComposerKeyHint;
  readonly value?: string;
  readonly active?: boolean;
  readonly act?: boolean;
  readonly disabled?: boolean;
  readonly hits?: readonly number[];
};

export type ComposerPick =
  | { readonly kind: 'command'; readonly name: string; readonly optionId?: string }
  | { readonly kind: 'mention'; readonly provider: string; readonly id: string; readonly from: number; readonly to: number }
  | { readonly kind: 'form'; readonly command: ComposerSlashCommand; readonly values: ComposerSlashArguments }
  | { readonly kind: 'open'; readonly command: ComposerSlashCommand; readonly query: string };

const prefixPatterns = new WeakMap<ComposerMentionProvider, RegExp>();

function prefixMatch(provider: ComposerMentionProvider, text: string, from: number): ComposerMention | null {
  let pattern = prefixPatterns.get(provider);
  if (pattern === undefined) {
    pattern = new RegExp(`(?:^|\\s)${escaped(provider.prefix)}(\\S*)$`);
    prefixPatterns.set(provider, pattern);
  }
  const found = pattern.exec(text.slice(0, from));
  return found ? { query: found[1]!, from: from - found[1]!.length - provider.prefix.length, to: from } : null;
}

export class ComposerMenu {
  kind = $state<'slash' | 'mention' | null>(null);
  provider = $state.raw<ComposerMentionProvider | null>(null);
  query = $state('');
  active = $state(0);
  section = $state<string | null>(null);
  values = $state<Record<string, string>>({});
  private position: PromptSelection = { text: '', from: 0, to: 0 };
  private range = { from: 0, to: 0 };
  private dismissed: PromptSelection | null = null;
  private left: string | null = null;

  constructor(private readonly catalog: () => ComposerCatalogs) {}

  get command(): ComposerSlashCommand | undefined {
    return this.catalog().commands.find((command) => command.name === this.section);
  }

  get fields(): NonNullable<ComposerSlashCommand['fields']> {
    return this.command?.fields ?? [];
  }

  formReady = $derived(this.fields.every((field) => field.optional || (this.values[field.id] ?? '').trim().length > 0));
  options = $derived.by<readonly ComposerOption[]>(() => {
    const catalog = this.catalog();
    if (this.kind === 'slash') {
      if (this.command) return (this.command.options ?? []).map((option) => ({ ...option, value: undefined }));
      return rank(catalog.commands, this.query, (command) => ({ name: command.name, text: [command.description] })).map(
        ({ item: command, hit }) => ({
          id: command.name,
          label: `/${command.name}`,
          description: command.description,
          keyHint: command.keyHint,
          value: command.value,
          active: command.valueActive,
          disabled: command.disabled,
          hits: hit.positions.map((at) => at + 1),
        }),
      );
    }
    if (this.kind === 'mention') return this.provider?.options(this.query) ?? [];
    return [];
  });

  update(position: PromptSelection): void {
    this.position = position;
    const dismissed = this.dismissed;
    if (dismissed && dismissed.text === position.text && dismissed.from === position.from && dismissed.to === position.to) return;
    this.dismissed = null;
    if (position.from !== position.to) {
      this.hide();
      return;
    }
    const catalogs = this.catalog();
    const slash = /^\s*\/(\S*)$/.exec(position.text.slice(0, position.from));
    if (catalogs.commands.length && slash && position.text.slice(position.from).trim() === '') {
      this.open('slash', null, slash[1]!, { from: 0, to: position.text.length });
      return;
    }
    for (const provider of catalogs.providers) {
      const mention = provider.match
        ? provider.match(position.text, position.from, position.to)
        : prefixMatch(provider, position.text, position.from);
      if (mention) {
        this.open('mention', provider, mention.query, mention);
        return;
      }
    }
    this.hide();
  }

  private open(
    kind: NonNullable<ComposerMenu['kind']>,
    provider: ComposerMentionProvider | null,
    query: string,
    range: { from: number; to: number },
  ): void {
    const changed = this.kind !== kind || this.provider !== provider || this.query !== query;
    this.kind = kind;
    this.provider = provider;
    this.query = query;
    this.range = { from: range.from, to: range.to };
    if (!changed) return;
    this.active = 0;
    this.section = null;
    this.values = {};
    this.left = null;
    this.reconcile();
  }

  reconcile(): void {
    if (this.section !== null && (this.command === undefined || this.command.disabled)) {
      this.section = null;
      this.values = {};
      this.active = 0;
    }
    if (this.kind === 'slash' && this.section === null && this.query !== this.left) {
      const named = this.catalog().commands.find((entry) => entry.name === this.query && entry.options?.length && !entry.disabled);
      if (named) {
        this.enter(named);
        return;
      }
    }
    if (this.options[this.active] && !this.options[this.active]!.disabled) return;
    this.active = Math.max(
      0,
      this.options.findIndex((option) => !option.disabled),
    );
  }

  move(direction: number): void {
    const options = this.options;
    if (!options.length) return;
    let next = this.active;
    for (let count = 0; count < options.length; count += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]!.disabled) {
        this.active = next;
        return;
      }
    }
  }

  pick(index = this.active): ComposerPick | null {
    const option = this.options[index];
    if (!option || option.disabled) return null;
    if (this.kind === 'mention') {
      return this.provider ? { kind: 'mention', provider: this.provider.id, id: option.id, ...this.range } : null;
    }
    if (this.kind !== 'slash') return null;
    const command = this.command;
    if (command) return command.disabled ? null : { kind: 'command', name: command.name, optionId: option.id };
    const chosen = this.catalog().commands.find((entry) => entry.name === option.id);
    if (!chosen) return null;
    if (chosen.opens) return { kind: 'open', command: chosen, query: '' };
    if (chosen.fields?.length || chosen.options?.length) {
      this.enter(chosen);
      return null;
    }
    return { kind: 'command', name: chosen.name };
  }

  opening(text: string): ComposerPick | null {
    const typed = /^\s*\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
    if (!typed) return null;
    const command = this.catalog().commands.find((entry) => entry.name === typed[1] && entry.opens && !entry.disabled);
    return command ? { kind: 'open', command, query: (typed[2] ?? '').trim() } : null;
  }

  form(): ComposerPick | null {
    const command = this.command;
    return command && !command.disabled && this.formReady ? { kind: 'form', command, values: { ...this.values } } : null;
  }

  private enter(command: ComposerSlashCommand): void {
    this.section = command.name;
    this.values = Object.fromEntries((command.fields ?? []).map((field) => [field.id, field.options?.[0]?.id ?? '']));
    this.active = Math.max(
      0,
      (command.options ?? []).findIndex((option) => option.active && !option.disabled),
    );
    this.reconcile();
  }

  back(): void {
    if (this.section !== null) {
      this.left = this.query;
      this.section = null;
      this.active = 0;
      this.values = {};
      this.reconcile();
    } else this.dismiss();
  }

  dismiss(position = this.position): void {
    this.dismissed = position;
    this.hide();
  }

  hide(): void {
    this.kind = null;
    this.provider = null;
    this.query = '';
    this.active = 0;
    this.section = null;
    this.values = {};
  }
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
