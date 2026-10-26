import { Effect } from 'effect';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import type { Pace } from '@runlith/executions/protocol/pace';
import type { NativeExecution } from '../nativeLaunch';
import type { ProvenSet } from '../ProvenSet';

const unused = Effect.die('this case only observes the native process witness and pace');
const unread = (): never => {
  throw new Error('this case only observes the native process witness and pace');
};

export type NativeInput = {
  readonly witness: ProcessWitness;
  readonly proven: ProvenSet;
  readonly pace: Pace;
};

export const nativeExecution = ({ witness, proven, pace }: NativeInput): NativeExecution => ({
  get transport() {
    return unread();
  },
  held: {
    get id() {
      return unread();
    },
    pid: witness.pid,
    get work() {
      return unread();
    },
    birth: witness.birth,
    get terminal() {
      return unread();
    },
    pace,
    get channels() {
      return unread();
    },
    exit: unused,
    observed: unused,
    observe: unused,
    workState: unused,
    get reaped() {
      return unread();
    },
    act: () => unused,
    signal: () => unused,
    closeInput: unused,
    closeOutput: unused,
    reap: unused,
    release: unused,
  },
  get identity() {
    return unread();
  },
  witness,
  proven,
  pace,
  get sink() {
    return unread();
  },
  get target() {
    return unread();
  },
  get sources() {
    return unread();
  },
  pendingEchoes: unused,
  owe: () => unused,
  releaseOutput: unused,
  exit: unused,
  cost: unused,
});
