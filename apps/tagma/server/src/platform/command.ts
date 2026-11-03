import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { Effect } from 'effect';

type Answered = { readonly status: number | null; readonly text: string };

export const answered = (command: string, args: readonly string[]): Effect.Effect<Answered> =>
  Effect.callback<Answered>((resume, signal) => {
    let text = '';
    let ended = false;
    const end = (answer: Answered) => {
      if (ended) return;
      ended = true;
      resume(Effect.succeed(answer));
    };
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], signal });
    child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    child.on('error', (error) => end({ status: null, text: error.message }));
    child.on('close', (code, by) => end({ status: code, text: by === null ? text : `${text}${basename(command)} ended on ${by}` }));
  });

export const refusalOf = (command: string, answer: Answered): string | null =>
  answer.status === 0 ? null : answer.text.trim() || `${basename(command)} exited ${answer.status ?? 'without starting'}`;
