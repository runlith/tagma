import type { CallAddress } from '@runlith/agent/callProgress';
import { recipientsTitle } from '@runlith/agent/collaboration/label';
import type { ChatEntry } from '@runlith/chat-ui/entries';
import type { ExecutionAddress } from '$lib/features/executions/Repo.js';

export function isThreadId(address: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(address);
}

function activityAddresses(entry: ChatEntry): readonly string[] {
  if (entry.kind !== 'tool') return [];
  const reference = entry.display?.reference;
  if (reference?.kind === 'agent') {
    return reference.id === undefined || reference.id === reference.address ? [reference.address] : [reference.address, reference.id];
  }
  if (reference?.kind === 'thread') return [reference.id];
  const threadId = (entry.toolInput as { threadId?: unknown } | undefined)?.threadId;
  return typeof threadId === 'string' ? [threadId] : [];
}

export function launchedCommand(entry: ChatEntry): ExecutionAddress | null {
  if (entry.kind !== 'tool') return null;
  const reference = entry.display?.reference;
  return reference?.kind === 'command' && reference.standing
    ? { execution: reference.execution, incarnation: reference.incarnation }
    : null;
}

export type AwaitedTarget =
  | { readonly kind: 'execution'; readonly address: ExecutionAddress }
  | { readonly kind: 'call'; readonly address: CallAddress };

export type Awaited = { readonly target: AwaitedTarget; readonly budgetMs: number | null };

export function awaitedTarget(entry: ChatEntry): Awaited | null {
  if (entry.kind !== 'tool') return null;
  const display = entry.display;
  const reference = display?.reference;
  if (display === undefined || reference === undefined || display.awaitsMs === undefined) return null;
  const budgetMs = display.awaitsMs > 0 ? display.awaitsMs : null;
  if ((reference.kind === 'command' && !reference.standing) || reference.kind === 'terminal') {
    return { target: { kind: 'execution', address: { execution: reference.execution, incarnation: reference.incarnation } }, budgetMs };
  }
  if (reference.kind === 'call')
    return { target: { kind: 'call', address: { runId: reference.runId, toolCallId: reference.toolCallId } }, budgetMs };
  return null;
}

export function activityIdentity(
  entry: ChatEntry,
  label: (address: string, projectId?: number) => string,
  command: (address: ExecutionAddress) => string | null,
  call: (address: CallAddress) => string | null,
  home: (id: string) => number | undefined = () => undefined,
) {
  const agentThread = (address: string, id: string | undefined, projectId: number | undefined) => {
    const reached = id ?? address;
    if (!isThreadId(reached)) return null;
    const at = projectId ?? home(reached);
    return at === undefined ? null : { id: reached, title: label(reached, projectId), projectId: at };
  };
  const awaited = awaitedTarget(entry);
  if (awaited !== null) {
    const title = awaited.target.kind === 'execution' ? command(awaited.target.address) : call(awaited.target.address);
    return title === null ? undefined : { title, threads: [] };
  }
  const display = entry.kind === 'tool' ? entry.display : undefined;
  if (display?.reference?.kind === 'agents') {
    const recipients = display.reference.recipients;
    const threads = new Map(
      recipients.flatMap((recipient) => {
        const target = agentThread(recipient.address, recipient.id, recipient.projectId);
        return target === null ? [] : [[target.id, target] as const];
      }),
    );
    return {
      title: recipientsTitle(recipients.map((recipient) => label(recipient.address, recipient.projectId))),
      threads: [...threads.values()],
    };
  }
  const addresses = activityAddresses(entry);
  if (addresses.length === 0) return undefined;
  const reference = display?.reference;
  const projectId = reference?.kind === 'thread' || reference?.kind === 'agent' ? reference.projectId : undefined;
  const agent = reference?.kind === 'agent' ? agentThread(reference.address, reference.id, reference.projectId) : null;
  const threads =
    reference?.kind === 'agent'
      ? agent === null
        ? []
        : [agent]
      : [...new Set(addresses.filter(isThreadId))].flatMap((id) => {
          const at = projectId ?? home(id);
          return at === undefined ? [] : [{ id, title: label(id, projectId), projectId: at }];
        });
  if (entry.kind !== 'tool') return undefined;
  if (display?.reference?.kind === 'agent') return { title: label(addresses[0]!, projectId), threads };
  const title = display?.title;
  return { title: title === addresses[0] ? label(addresses[0]!) : title, threads };
}
