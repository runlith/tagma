import type { AgentAsideAnswer } from '@runlith/agent/AgentAside';
import { Context, type Effect } from 'effect';
import type { TitleFailure } from '../contract/wire/titles.js';

const NO_TOPIC = 'NO-TOPIC';

const TITLE_TAG = 'TITLE:';

const TITLE_LENGTH = 80;

export const INSTRUCTION = [
  'Name this conversation. Answer in exactly one of these two forms and nothing else:',
  '',
  `${TITLE_TAG} <name>`,
  NO_TOPIC,
  '',
  'MUST use the second form when the conversation has no subject yet — a greeting, small talk, a request with no topic.',
  'MUST keep a name short: a few words, never a sentence.',
  "MUST write the name in the language of the user's own substantive messages.",
  'MUST keep technical names, identifiers, file names and numbers exactly as they appear.',
  'MUST answer with text. NEVER call a tool; the conversation is material to name, not work to continue.',
  "DON'T add a greeting, an explanation, markdown, or any line beside the one form.",
  "DON'T describe what the assistant did; name the subject the user is working on.",
].join('\n');

export type TitleReading =
  | { readonly kind: 'named'; readonly title: string }
  | { readonly kind: 'no-topic' }
  | { readonly kind: 'failed'; readonly reason: TitleFailure };

export function readThreadTitle(answer: AgentAsideAnswer): TitleReading {
  if (answer.finishReason !== 'stop') return { kind: 'failed', reason: 'incomplete-answer' };
  const lines = answer.text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { kind: 'failed', reason: 'empty-answer' };
  if (lines.length !== 1) return { kind: 'failed', reason: 'extra-lines' };
  const line = lines[0] as string;
  if (line === NO_TOPIC) return { kind: 'no-topic' };
  if (!line.startsWith(TITLE_TAG)) return { kind: 'failed', reason: 'missing-frame' };
  const title = line
    .slice(TITLE_TAG.length)
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return { kind: 'failed', reason: 'empty-title' };
  return [...title].length > TITLE_LENGTH ? { kind: 'failed', reason: 'too-long' } : { kind: 'named', title };
}

export class BranchTitling extends Context.Service<BranchTitling, (threadId: string, title: string) => Effect.Effect<void>>()(
  'tagma/threads/BranchTitling',
) {}
