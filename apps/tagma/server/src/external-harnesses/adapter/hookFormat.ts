import type { HookSurface } from '@runlith/tagma/adapter/harness';
import type { HookVerdict } from '@runlith/tagma/adapter/hook';
import type { HarnessAnswer } from '../contract/wire/call.js';

export const verdictOf = (answer: HarnessAnswer): HookVerdict | null =>
  answer._tag === 'Allowed' || answer._tag === 'Denied'
    ? { allowed: answer._tag === 'Allowed', words: `${answer.reason ?? 'A rule of this project allows it.'} (tagma rule ${answer.ruleId})` }
    : null;

export const promptSupported = (hooks: HookSurface | null): boolean =>
  hooks !== null && hooks.promptContext === true && hooks.codec.prompt !== null;
