export type ChatThreadPhase =
  | { readonly kind: 'unborn' }
  | { readonly kind: 'opening'; readonly threadId: string }
  | { readonly kind: 'open'; readonly threadId: string }
  | { readonly kind: 'unreadable'; readonly threadId: string; readonly errors: readonly string[] };

export const CHAT_THREAD_UNBORN: ChatThreadPhase = { kind: 'unborn' };

export function chatThreadId(phase: ChatThreadPhase): string | null {
  return phase.kind === 'unborn' ? null : phase.threadId;
}

export function chatHeroVisible(input: {
  readonly phase: ChatThreadPhase;
  readonly entries: number;
  readonly hasCopy: boolean;
  readonly working: boolean;
  readonly awaitingConfirmation: boolean;
}): boolean {
  if (input.phase.kind !== 'unborn') return false;
  return input.hasCopy && input.entries === 0 && !input.working && !input.awaitingConfirmation;
}
