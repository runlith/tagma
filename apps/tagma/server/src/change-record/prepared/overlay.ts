import { Effect } from 'effect';
import { eventReason } from '@runlith/utils/worker';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
export type OverlayAsk = { readonly base: Uint8Array; readonly selected: string; readonly staged: Uint8Array };

export type Overlaid = { readonly kind: 'overlaid'; readonly text: string | null } | { readonly kind: 'unweighable' };

export type OverlayAnswer = { readonly kind: 'ready' } | Overlaid | { readonly kind: 'failed'; readonly reason: string };

export const overlayOwn = (inputs: readonly OverlayAsk[]): Effect.Effect<readonly Overlaid[], GateRefusal<'walk-cut'>> =>
  Effect.callback((resume) => {
    const failed = (reason: string) =>
      resume(
        Effect.fail(
          new GateRefusal('walk-cut', `the selected lines could not be overlaid on the merge index: ${reason}`, [
            'submit again once the line worker answers',
          ]),
        ),
      );
    let worker: Worker;
    try {
      worker = new Worker(new URL('./overlay.worker.ts', import.meta.url), { type: 'module' });
    } catch (cause) {
      failed(String(cause));
      return;
    }
    const texts: Overlaid[] = [];
    const next = () => {
      if (texts.length === inputs.length) {
        resume(Effect.succeed(texts));
        return;
      }
      try {
        worker.postMessage(inputs[texts.length]);
      } catch (cause) {
        failed(String(cause));
      }
    };
    worker.addEventListener('message', (event: MessageEvent<OverlayAnswer>) => {
      const answer = event.data;
      if (answer.kind === 'failed') failed(answer.reason);
      else {
        if (answer.kind !== 'ready') texts.push(answer);
        next();
      }
    });
    worker.addEventListener('error', (event: ErrorEvent) => failed(eventReason(event, 'the line overlay worker failed')));
    worker.addEventListener('messageerror', () => failed('the line overlay answer could not be read'));
    worker.addEventListener('close', () => failed('the line overlay worker closed before answering'));
    return Effect.sync(() => worker.terminate());
  });
