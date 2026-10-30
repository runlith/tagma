import type { HookSurface } from '@runlith/tagma/adapter/harness';
import type { HookEntry, HookVerdict } from '@runlith/tagma/adapter/hook';
import type { HarnessAnswer } from '../contract/wire/call.js';

export const commandGroup = (command: string, timeout: number | undefined): HookEntry => ({
  hooks: [{ type: 'command', command, ...(timeout === undefined ? {} : { timeout }) }],
});

export const specificOutput = (hookEventName: string, additionalContext: string): string =>
  JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } });

export const verdictOf = (answer: HarnessAnswer): HookVerdict | null =>
  answer._tag === 'Allowed' || answer._tag === 'Denied'
    ? { allowed: answer._tag === 'Allowed', words: `${answer.reason ?? 'A rule of this project allows it.'} (tagma rule ${answer.ruleId})` }
    : null;

export const promptSupported = (hooks: HookSurface | null): boolean =>
  hooks !== null && hooks.promptContext === true && hooks.codec.prompt !== null;
