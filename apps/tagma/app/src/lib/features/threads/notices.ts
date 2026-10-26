import { ChatBirthFailed, type ChatTurnFailure } from '@runlith/chat-ui/session/TurnCommands.svelte';
import { ComposerRefused } from '@runlith/chat-ui/composer';
import type { ChatNotice } from '@runlith/chat-ui/notice';
import { refusalOf } from '$lib/wire/refusal.js';
import type { Draft } from './Draft.svelte.js';

const WORDS = {
  alreadyRunning: 'The agent is already working on this thread.',
  noChat: 'Open a thread first.',
  noQuestion: 'There is no open question here.',
  questionSettled: 'The run that asked this question has ended.',
  answerInFlight: 'That answer is already on its way.',
  sendLate: 'The new thread is taking long to start; your message stays pending and appears once it is accepted.',
  takeUnsure: 'The server did not answer whether it gave the words up; they are back in the field and may still be waiting above it.',
  nothingRunning: 'Nothing was running on this thread to stop.',
} as const;

function stopMismatch(runId: string): string {
  return `Another run, ${runId}, is going on this thread now; press Stop again to stop it.`;
}

export function chatNotice(failure: ChatTurnFailure<Draft>): ChatNotice {
  switch (failure.kind) {
    case 'run-active':
      return { tone: 'error', message: WORDS.alreadyRunning };
    case 'no-thread':
      return { tone: 'error', message: WORDS.noChat };
    case 'question-closed':
      return { tone: 'error', message: WORDS.noQuestion };
    case 'question-settled':
      return { tone: 'error', message: WORDS.questionSettled };
    case 'answer-in-flight':
      return { tone: 'error', message: WORDS.answerInFlight };
    case 'send-late':
      return { tone: 'error', message: WORDS.sendLate };
    case 'take-unsure':
      return { tone: 'error', message: WORDS.takeUnsure };
    case 'nothing-running':
      return { tone: 'success', message: WORDS.nothingRunning };
    case 'stop-mismatch':
      return { tone: 'error', message: stopMismatch(failure.runId) };
    case 'send-refused':
    case 'compact-refused':
    case 'continue-refused':
    case 'answer-refused':
    case 'stop-refused':
    case 'unqueue-refused':
    case 'promote-refused':
      return { tone: 'error', message: failure.message, told: failure.told };
    default:
      return { tone: 'error', message: failure.message };
  }
}

export function birthFailed(error: unknown): ChatBirthFailed {
  return new ChatBirthFailed({ message: failure(error).message });
}

export function refused(error: unknown): ComposerRefused {
  return new ComposerRefused({ message: failure(error).message });
}

export function failure(error: unknown): ChatNotice {
  return { tone: 'error', message: error instanceof Error ? error.message : String(error) };
}

export function refusalNotice(error: unknown): ChatNotice {
  const refusal = refusalOf(error);
  return { tone: 'error', message: [refusal.reason, ...refusal.unblock].join(' ') };
}
