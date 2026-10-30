import { Effect, type Exit } from 'effect';
import type { CompactionChoice } from '@tagma/server/native-harness/contract/wire/compactionChoices';
import { type ComposerHandler, settled } from '@runlith/chat-ui/composer';
import type { TurnShaping } from '@runlith/chat-ui/session/TurnShaping';
import type { ThreadModes } from '@runlith/chat-ui/wire/ChatConnection';
import { nextMode } from './modeWords.js';
import type { ThreadBirth } from './birth/ThreadBirth.svelte.js';
import type { ChatHold } from './ChatHold.svelte.js';
import { pickedSummarizer } from './native/compactionWords.js';
import type { SkillCatalog } from './native/SkillCatalog.svelte.js';
import type { Runner } from './Runner.js';
import type { ShownThread } from './ShownThread.js';
import { type ApproverPick, type DelegationPick } from './thread/authority.js';
import type { ModelView, PickOptions } from './thread/modelSettings.js';
import { asHandler } from './thread/ThreadRefused.js';
import { ThreadAuthority } from './thread/ThreadAuthority.svelte.js';
import { ThreadCompaction } from './thread/ThreadCompaction.svelte.js';
import { ThreadInstructions } from './thread/ThreadInstructions.js';
import { ThreadRecap } from './thread/ThreadRecap.svelte.js';
import { ThreadSettings } from './thread/ThreadSettings.svelte.js';
import type { ThreadViews } from './thread/ThreadViews.js';

export interface SlotNavigation {
  open(id: string): void;
  startDraft(): void;
  startDraftAs(type: string): void;
  rehome(projectId: number): void;
}

export class ThreadWrites {
  constructor(
    private readonly shown: ShownThread,
    private readonly chat: ChatHold,
    private readonly shaping: TurnShaping,
    private readonly birth: ThreadBirth,
    private readonly views: ThreadViews,
    private readonly skills: SkillCatalog,
    private readonly runner: Runner,
    private readonly navigation: SlotNavigation,
  ) {}

  private get writingSettings(): boolean {
    const lease = this.shown.lease;
    return lease === null ? this.birth.settings.busy : (lease.find(ThreadSettings)?.busy ?? false);
  }

  private get holdingOther(): boolean {
    const lease = this.shown.lease;
    if (lease === null) return this.birth.launching;
    return this.birth.launching || (lease.find(ThreadAuthority)?.busy ?? false) || (lease.find(ThreadRecap)?.busy ?? false);
  }

  get holding(): boolean {
    return this.writingSettings || this.holdingOther;
  }

  get modes(): ThreadModes | null {
    return this.views.authority.modes;
  }

  attempt<A, E>(work: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> {
    return this.runner.settle(work);
  }

  send = (): Promise<boolean> => this.chat.run(this.chat.commands.send(), false);
  queue = (): Promise<boolean> => this.chat.run(this.chat.commands.queueDraft(), false);

  perform(handler: ComposerHandler): Promise<void> {
    return this.chat.run(this.chat.commands.relay(settled(handler)), undefined);
  }

  chooseMode(id: string): ComposerHandler {
    return Effect.suspend(() => {
      this.chat.commands.dismiss();
      return asHandler(this.shaped(this.views.authority.chooseMode(id)));
    });
  }

  cycleMode(): ComposerHandler {
    return Effect.suspend(() => {
      const modes = this.modes;
      const next = modes === null ? null : nextMode(modes);
      return next === null ? Effect.void : this.chooseMode(next);
    });
  }

  setDelegation(pick: DelegationPick): ComposerHandler {
    return Effect.suspend(() => {
      this.chat.commands.dismiss();
      return asHandler(this.shaped(this.views.authority.setDelegation(pick)));
    });
  }

  setApprover(pick: ApproverPick): ComposerHandler {
    return Effect.suspend(() => {
      this.chat.commands.dismiss();
      return asHandler(this.shaped(this.views.authority.setApprover?.(pick) ?? Effect.void));
    });
  }

  setApproves(approves: readonly string[] | null): ComposerHandler {
    return Effect.suspend(() => {
      this.chat.commands.dismiss();
      return asHandler(this.shaped(this.views.authority.setApproves?.(approves) ?? Effect.void));
    });
  }

  applyDelegation(pick: DelegationPick): Promise<void> {
    return this.perform(this.setDelegation(pick));
  }

  promoteDelegation(): Promise<void> {
    return this.perform(asHandler(this.shaped(this.views.authority.promoteDelegation())));
  }

  applyTeam(write: () => Promise<void>): Promise<void> {
    return this.perform(
      asHandler(
        Effect.promise(() => {
          const threadId = this.shown.lease?.threadId ?? null;
          const release = threadId === null ? null : this.shaping.hold(threadId);
          const written = write();
          if (release !== null) written.then(release, release);
          return written;
        }),
      ),
    );
  }

  applyModel(provider: string, modelId: string, reasoning?: string | null, options?: PickOptions): Promise<void> {
    return this.writeSettings(this.views.model.chooseModel(provider, modelId, reasoning, options));
  }

  applyAccount(value: string | null): Promise<void> {
    return this.writeSettings(this.views.model.chooseAccount(value));
  }

  applySwitch(id: string, value: string | null): Promise<void> {
    return this.writeSettings(this.views.model.chooseSwitch(id, value));
  }

  private writeSettings(effect: ReturnType<ModelView['chooseModel']>): Promise<void> {
    if (this.birth.launching) return Promise.resolve();
    this.chat.commands.dismiss();
    return this.perform(asHandler(this.shaped(effect)));
  }

  private shaped<A, E>(write: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return Effect.suspend(() => (this.shown.lease === null ? this.shaping.shape(this.chat.commands.draft.key, write) : write));
  }

  writeRecap(): ComposerHandler {
    return Effect.suspend(() => {
      const recap = this.shown.lease?.get(ThreadRecap);
      if (recap === undefined || recap.busy) return Effect.void;
      this.chat.commands.dismiss();
      return asHandler(recap.write());
    });
  }

  refreshInstructions(): ComposerHandler {
    return Effect.suspend(() => {
      const lease = this.shown.lease;
      const refreshed = lease === null ? this.birth.refreshSources() : lease.get(ThreadInstructions).refresh();
      return asHandler(Effect.flatMap(refreshed, (notice) => Effect.promise(() => this.skills.refresh()).pipe(Effect.as(notice))));
    });
  }

  compaction(at: 'step' | 'end', row: CompactionChoice | null): Effect.Effect<void> {
    return Effect.suspend(() => {
      const lease = this.shown.lease;
      if (this.holding || lease === null) return Effect.void;
      return lease.get(ThreadCompaction).compact(this.chat.commands, at, row);
    });
  }

  compact(at: 'step' | 'end', row: CompactionChoice | null): Promise<void> {
    return this.chat.run(this.compaction(at, row), undefined);
  }

  compactWith(provider: string, model: string, rung: string | null, gesture: 'send' | 'queue'): void {
    const at = gesture === 'queue' ? 'end' : 'step';
    const read = this.shown.lease?.find(ThreadCompaction)?.choices ?? null;
    if (read === null) {
      void this.compact(at, null);
      return;
    }
    const picked = pickedSummarizer(read, provider, model, rung);
    if (picked !== null) void this.compact(at, picked.named);
  }

  open(id: string): void {
    this.navigation.open(id);
  }

  startDraft(): void {
    this.navigation.startDraft();
  }

  startDraftAs(type: string): void {
    this.navigation.startDraftAs(type);
  }

  rehome(projectId: number): void {
    this.navigation.rehome(projectId);
  }
}
