import type { CallAddress, CallRecord } from '@runlith/agent/callProgress';
import { toolSettled } from '@runlith/chat-ui/activity';
import type { ChatEntry } from '@runlith/chat-ui/entries';
import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
import { untrack } from 'svelte';
import type { CommandActivity } from '$lib/features/executions/commands/Activity.svelte.js';
import { isLive, type ProcessLine } from '$lib/features/executions/processes/lines.js';
import { terminalKey, type ExecutionAddress } from '$lib/features/executions/Repo.js';
import type { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { activityIdentity, awaitedTarget, isThreadId, launchedCommand } from '../activityIdentity.js';
import type { CallActivity } from '../CallActivity.svelte.js';
import type { ShownThread } from '../ShownThread.js';

export type EndedCall = { readonly call: CallRecord; readonly line: ProcessLine | null };

export class ToolActivity {
  constructor(
    private readonly shown: ShownThread,
    private readonly names: ThreadNames,
    private readonly commands: CommandActivity,
    private readonly calls: CallActivity,
    private readonly launches: () => ReadonlyMap<string, string>,
  ) {}

  view = $derived.by(() => {
    const thread = this.shown.id;
    if (thread === null) return null;
    const words = this.names.of(thread);
    if (words === undefined) return null;
    return untrack(() => this.commands.forThread(thread, words ?? { label: thread, archived: false, harness: false }));
  });

  label(address: string, projectId?: number): string {
    if (!isThreadId(address)) return address;
    const words = this.names.of(address, projectId === undefined ? undefined : String(projectId));
    if (words === undefined) return 'Loading thread…';
    if (words === null) return 'Thread unavailable';
    return words.label.trim() || 'Untitled thread';
  }

  commandTitle(address: ExecutionAddress): string | null {
    const key = terminalKey(address);
    return this.view?.line(key)?.label ?? this.launches().get(key) ?? null;
  }

  identity(entry: ChatEntry) {
    return activityIdentity(
      entry,
      (address, home) => this.label(address, home),
      (address) => this.commandTitle(address),
      (address) => this.callTitle(address),
      (address) => this.names.of(address)?.projectId,
    );
  }

  launchedLine(entry: ChatEntry): ProcessLine | null {
    const launched = launchedCommand(entry);
    if (launched !== null) return this.view === null ? null : this.view.line(terminalKey(launched));
    const outlived = this.endedCall(entry)?.line ?? null;
    return outlived !== null && isLive(outlived) ? outlived : null;
  }

  ended(entry: ChatEntry): EndedCall | null {
    const ended = this.endedCall(entry);
    return ended === null || (ended.line !== null && isLive(ended.line)) ? null : ended;
  }

  private endedCall(entry: ChatEntry): EndedCall | null {
    if (entry.kind !== 'tool' || toolSettled(entry)) return null;
    const call = this.calls.endedAt(this.shown.id, entry.runId, entry.toolCallId);
    if (call === null) return null;
    const command = call.executions.find((linked) => linked.kind === 'command');
    return { call, line: command === undefined || this.view === null ? null : this.view.line(terminalKey(command.execution)) };
  }

  pending(entry: ChatEntry): CallRecord | null {
    if (entry.kind !== 'tool' || !toolSettled(entry)) return null;
    const call = this.calls.callAt(this.shown.id, entry.runId, entry.toolCallId);
    return call !== null && call.mode === 'background' ? call : null;
  }

  callTitle(address: CallAddress): string | null {
    return this.calls.callAt(this.shown.id, address.runId, address.toolCallId)?.name ?? null;
  }

  awaited(entry: ChatEntryOf<'tool'>) {
    const awaited = awaitedTarget(entry);
    if (awaited === null) return null;
    const call = this.calls.callAt(this.shown.id, entry.runId, entry.toolCallId);
    if (call === null || call.admittedAt === null) return null;
    const { target } = awaited;
    return {
      call,
      admittedAt: call.admittedAt,
      budgetMs: awaited.budgetMs,
      line: target.kind === 'execution' ? (this.view?.line(terminalKey(target.address)) ?? null) : null,
      target: target.kind === 'call' ? this.calls.callAt(this.shown.id, target.address.runId, target.address.toolCallId) : null,
    };
  }
}
