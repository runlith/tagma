import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Cause, Effect } from 'effect';
import { AgentHostFailed } from '@runlith/agent/AgentFailure';
import type { AgentInterruptedCall, AgentRecovery, AgentRecoveryRequest } from '@runlith/agent/AgentRecovery';
import type { PendingRuntimeGuide } from '@runlith/agent/AgentGuidanceJournal';
import type { ThreadInterruptedInput } from '@runlith/agent/transcript/entries';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import { readConfirmedField } from '@runlith/utils/json';
import { ScratchAreas } from '../../threads/contract/service/scratch.js';

export type ThreadInterruptedRecord = (
  toolCallIds: readonly string[],
) => Effect.Effect<ReadonlyMap<string, ThreadInterruptedInput>, ThreadBorderFailed>;

export type InputRecoveryInput = { readonly threadId: string; readonly recorded: ThreadInterruptedRecord };

export const makeInputRecovery = Effect.gen(function* () {
  const scratch = yield* ScratchAreas;
  return ({ threadId, recorded }: InputRecoveryInput): AgentRecovery => {
    const workingCopy = Effect.fn('InputRecovery.workingCopy')(function* (
      call: AgentInterruptedCall,
      draft: string,
    ): Effect.fn.Return<string, AgentHostFailed> {
      const directory = yield* scratch
        .ensure(threadId)
        .pipe(Effect.catchCause((cause) => Effect.fail(new AgentHostFailed({ port: 'recovery', cause: Cause.squash(cause) }))));
      return yield* Effect.tryPromise({
        try: () => freshCopy(directory, workingCopyName(call), draft),
        catch: (cause) => new AgentHostFailed({ port: 'recovery', cause }),
      });
    });

    const notice = Effect.fnUntraced(function* (call: AgentInterruptedCall, kept: ThreadInterruptedInput | undefined) {
      const intended = destinationOf(call);
      const opening = `Your \`${call.toolName}\` call ${call.toolCallId} was cut off while its arguments were still arriving, so that call never ran${
        intended === undefined ? '' : ` and nothing was written to ${intended}`
      }.`;
      const held = heldSentence(kept);
      const draft = confirmedDraft(call);
      if (draft === null) return `${opening} ${held} Send the call again.`;
      const working = yield* workingCopy(call, draft);
      return [
        opening,
        held,
        `The ${draft.length} characters of \`${call.recovery?.content}\` that arrived are a working copy at ${working}.`,
        'Read or edit that file and finish the work with a fresh `write` naming `fromFile`, rather than generating the whole thing again.',
        'It is a draft that never landed, so check its end before you use it.',
      ].join(' ');
    });

    const interrupted = Effect.fnUntraced(function* (input: AgentRecoveryRequest) {
      const receipts = yield* recorded(input.calls.map((call) => call.toolCallId)).pipe(
        Effect.catch((cause) => Effect.fail(new AgentHostFailed({ port: 'recovery', cause }))),
      );
      const guides: PendingRuntimeGuide[] = [];
      for (const call of input.calls) {
        const text = yield* notice(call, receipts.get(call.toolCallId));
        guides.push({ hook: 'beforeStep', text, toolName: call.toolName, toolCallId: call.toolCallId });
      }
      return guides;
    });

    return { interrupted };
  };
});

async function freshCopy(directory: string, name: string, draft: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const suffix = dot > 0 ? name.slice(dot) : '';
  for (let version = 0; version < 1000; version += 1) {
    const path = join(directory, version === 0 ? name : `${stem}-${version}${suffix}`);
    try {
      await writeFile(path, draft, { flag: 'wx' });
      return path;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
    }
  }
  throw new Error(`${directory} already holds a thousand drafts named ${name}.`);
}

function heldSentence(kept: ThreadInterruptedInput | undefined): string {
  if (kept === undefined) return 'What it had sent could not be recorded.';
  if (kept.kind === 'text') return `What it had sent is kept in this conversation's record.`;
  if (kept.kind === 'retained') return `What it had sent is saved at ${kept.location ?? kept.outputId}.`;
  return `What it had sent could not be saved: ${kept.reason}.`;
}

function destinationOf(call: AgentInterruptedCall): string | undefined {
  const field = call.recovery?.destination;
  if (field === undefined) return undefined;
  const read = readConfirmedField(call.received, field);
  return read?.closed === true && read.text.length > 0 ? read.text : undefined;
}

function confirmedDraft(call: AgentInterruptedCall): string | null {
  const field = call.recovery?.content;
  if (field === undefined) return null;
  const read = readConfirmedField(call.received, field);
  return read !== undefined && read.text.length > 0 ? read.text : null;
}

function workingCopyName(call: AgentInterruptedCall): string {
  const intended = destinationOf(call) ?? '';
  const base = (intended.split(/[\\/]/).pop() ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/^\.+/, '')
    .slice(0, 64);
  const id = call.toolCallId.replace(/[^A-Za-z0-9]/g, '').slice(-8) || 'call';
  return base.length > 0 ? `interrupted-${id}-${base}` : `interrupted-${id}.txt`;
}
