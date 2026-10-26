import { SvelteMap } from 'svelte/reactivity';
import type { HarnessRowDetail } from '@tagma/server/threads/contract/wire/harness/externalSession';
import { terminalChat } from '@tagma/server/external-harnesses/settings';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { Service } from '@runlith/layer/key';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';

export type SurfaceKind = 'chat' | 'terminal';

export type TerminalThread = {
  readonly threadId: string;
  readonly projectId: number;
  readonly execution: HarnessRowDetail['execution'];
  readonly harness: HarnessRowDetail | null;
};

export const hasScreen = (thread: WireThread): boolean => thread.capabilities.screen;

const processStands = (thread: WireThread): boolean => {
  const process = thread.harness?.process ?? null;
  return process !== null && process.state !== 'ended';
};

const switchable = (thread: WireThread): boolean => hasScreen(thread) && processStands(thread);

export const surfaceOf = (thread: WireThread, chatOver: boolean): SurfaceKind => (switchable(thread) && !chatOver ? 'terminal' : 'chat');

export class SurfaceChoices extends Service<SurfaceChoices>()('SurfaceChoices', { tier: 'app' }) {
  static *make() {
    return new SurfaceChoices(yield* SettingsRepo);
  }

  private readonly chosen = new SvelteMap<string, SurfaceKind>();

  constructor(private readonly settings: ReturnType<typeof SettingsRepo.use>) {
    super();
  }

  chatOver(projectId: number, threadId: string): boolean {
    const chosen = this.chosen.get(threadId);
    if (chosen !== undefined) return chosen === 'chat';
    return this.settings.catalog.key(projectId).data?.entries.find((row) => row.id === terminalChat.id)?.value === true;
  }

  choose(threadId: string, kind: SurfaceKind): void {
    this.chosen.set(threadId, kind);
  }
}

export class ThreadSurface {
  constructor(
    private readonly projectId: number,
    private readonly thread: () => WireThread | null,
    private readonly choices: SurfaceChoices,
  ) {}

  kind = $derived.by<SurfaceKind>(() => {
    const thread = this.thread();
    return thread === null ? 'chat' : surfaceOf(thread, this.choices.chatOver(this.projectId, thread.id));
  });

  switchable = $derived.by<boolean>(() => {
    const thread = this.thread();
    return thread !== null && switchable(thread);
  });

  terminal = $derived.by<TerminalThread | null>(() => {
    const thread = this.thread();
    return thread === null || this.kind !== 'terminal'
      ? null
      : {
          threadId: thread.id,
          projectId: this.projectId,
          execution: thread.harness?.execution ?? null,
          harness: thread.harness,
        };
  });

  toggle(): void {
    const thread = this.thread();
    if (thread === null || !switchable(thread)) return;
    this.choices.choose(thread.id, this.kind === 'terminal' ? 'chat' : 'terminal');
  }
}
