import { Effect, Layer } from 'effect';
import { ProcessTempo, TempoRefused, type PaceDirection, type TempoKept } from '../../ProcessTempo';
import { Holder, type HolderRefused } from '../../holder/Holder';

const refusal = (pid: number, reason: HolderRefused['reason'], detail: string): TempoRefused =>
  new TempoRefused({
    pid,
    reason: reason === 'gone' || reason === 'changed' || reason === 'unsupported' || reason === 'lost' ? reason : 'os',
    detail,
  });

export const tempoLayer = Layer.effect(
  ProcessTempo,
  Effect.gen(function* () {
    const holder = yield* Holder;
    return ProcessTempo.of({
      directions: (initial) => {
        const base = initial === 'low' ? 'low' : 'full';
        const directions: PaceDirection[] = [{ from: base, to: 'lowest' }];
        if (holder.capabilities.has('pace-raise')) directions.push({ from: 'lowest', to: base });
        return directions;
      },
      apply: (processes) =>
        holder.pace(processes.map(({ witness, initial, pace }) => ({ witness, initial, next: pace }))).pipe(
          Effect.match({
            onSuccess: (kept) =>
              kept.map((outcome, index): TempoKept => {
                if (outcome._tag === 'held') return { _tag: 'Held' };
                if (outcome._tag === 'moved') return { _tag: 'Moved' };
                return refusal(processes[index]!.witness.pid, outcome.reason, outcome.detail);
              }),
            onFailure: (failure) => processes.map(({ witness }) => refusal(witness.pid, failure.reason, failure.detail)),
          }),
        ),
    });
  }),
);
