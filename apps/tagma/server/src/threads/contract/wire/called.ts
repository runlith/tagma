import type { ToolDisplay } from '@runlith/agent/tool/display';

export type ThreadToolInput = {
  readonly threadId?: string;
  readonly path?: string;
  readonly archived?: boolean;
  readonly pinned?: boolean;
};

function reversedCall(input: ThreadToolInput): string | undefined {
  if (input.archived === false) {
    return input.threadId === undefined ? 'Bringing threads back' : 'Bringing a thread back';
  }
  if (input.pinned === false) return 'Releasing a thread from the top';
  return undefined;
}

export function threadCalledDisplay(input: ThreadToolInput): ToolDisplay {
  const subject = input.threadId ?? input.path;
  const verb = reversedCall(input);
  return {
    form: 'none',
    verb,
    title: subject,
  };
}
