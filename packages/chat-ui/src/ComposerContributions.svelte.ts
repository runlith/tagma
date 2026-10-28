import { Effect } from 'effect';
import {
  type ComposerAttachmentKind,
  type ComposerChip,
  type ComposerDrop,
  type ComposerDropState,
  type ComposerHandler,
  type ComposerMentionProvider,
  type ComposerPanelContribution,
  type ComposerRegion,
  type ComposerSlashCommand,
  settled,
} from './composer';
import type { ChatNotice } from './notice';
import { clashOf } from './RegistryClash';
import { Roster } from './Roster.svelte';

const LAST = Number.MAX_SAFE_INTEGER;

const subject =
  (kind: string) =>
  (key: string): string =>
    `Composer ${kind} "${key}"`;

export class ComposerContributions {
  private readonly commandRoster = new Roster<ComposerSlashCommand>(subject('command'), (command) => command.name);
  private readonly chipRoster = new Roster<ComposerChip>(subject('chip'), (chip) => chip.id);
  private readonly panelRoster = new Roster<ComposerPanelContribution>(subject('panel'), (panel) => panel.id);
  private readonly mentionRoster = new Roster<ComposerMentionProvider>(subject('mention provider'), (provider) => provider.id);
  private readonly attachmentRoster = new Roster<ComposerAttachmentKind>(subject('attachment kind'), (kind) => kind.id);
  private readonly dropRoster = new Roster<ComposerDrop>(subject('drop'), (drop) => drop.id);

  commands = $derived([...this.commandRoster.items].sort((a, b) => (a.order ?? LAST) - (b.order ?? LAST)));
  mentions = $derived(this.mentionRoster.items);
  attachments = $derived(this.attachmentRoster.items);
  shownPanel = $derived(this.panelRoster.items.find((one) => one.open) ?? null);
  attachAccept = $derived(this.attachments.map((kind) => kind.accept).join(','));
  attachButton = $derived(this.attachments.some((kind) => kind.button));
  cycler = $derived(this.chipRoster.items.find((chip) => chip.cycle?.available === true) ?? null);
  dropState = $derived.by<ComposerDropState | null>(() => {
    const states = this.dropRoster.items.map((drop) => drop.state);
    return states.includes('aimed') ? 'aimed' : states.includes('ready') ? 'ready' : null;
  });

  command(contributor: string, command: ComposerSlashCommand): () => void {
    return this.commandRoster.add(contributor, command);
  }

  chip(contributor: string, chip: ComposerChip): () => void {
    if (chip.cycle !== undefined) {
      const holder = this.chipRoster.contributorOf((one) => one.cycle !== undefined);
      if (holder !== undefined) {
        throw clashOf(`Composer cycle (chip "${chip.id}")`, holder, contributor);
      }
    }
    return this.chipRoster.add(contributor, chip);
  }

  panel(contributor: string, panel: ComposerPanelContribution): () => void {
    return this.panelRoster.add(contributor, panel);
  }

  mention(contributor: string, provider: ComposerMentionProvider): () => void {
    return this.mentionRoster.add(contributor, provider);
  }

  attachment(contributor: string, kind: ComposerAttachmentKind): () => void {
    return this.attachmentRoster.add(contributor, kind);
  }

  drop(contributor: string, drop: ComposerDrop): () => void {
    return this.dropRoster.add(contributor, drop);
  }

  chips(region: ComposerRegion): readonly ComposerChip[] {
    return this.chipRoster.items.filter((chip) => chip.region === region).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  intake(files: readonly File[]): ComposerHandler {
    return Effect.suspend(() => {
      const claimed = new Set<File>();
      const groups = this.attachments.flatMap((kind) => {
        const group = files.filter((file) => !claimed.has(file) && (kind.accepts?.(file) ?? true));
        for (const file of group) claimed.add(file);
        return group.length === 0 ? [] : [{ kind, group }];
      });
      return Effect.map(
        Effect.forEach(groups, ({ kind, group }) => settled(kind.intake(group))),
        (told) => {
          const notices = told.filter((notice): notice is ChatNotice => notice !== null);
          return notices.find((notice) => notice.tone === 'error') ?? notices[0];
        },
      );
    });
  }
}
