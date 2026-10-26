import { Effect, Schema } from 'effect';
import { instructionText } from '../graph/orientation/Instructions.js';
import { instructionSetSchema, type InstructionSet } from '../graph/contract/wire/instructions.js';
import { threadCallFailed } from '../threads/contract/service/failure.js';

const deliveredSchema = Schema.Record(Schema.String, instructionSetSchema);

export const instructionDelivery = Effect.fnUntraced(function* (
  delivered: unknown,
  sets: readonly InstructionSet[],
  withdrawn: readonly number[] = [],
) {
  const known = delivered === null ? {} : yield* Schema.decodeUnknownEffect(deliveredSchema)(delivered);
  const law = { ...known };
  for (const projectId of withdrawn) delete law[String(projectId)];
  const text: string[] = [];
  for (const set of sets) {
    const previous = known[String(set.projectId)];
    const changed = instructionText(set, previous);
    if (changed !== '') text.push(changed);
    law[String(set.projectId)] = set;
  }
  return { text: text.join('\n\n'), law };
}, Effect.mapError(threadCallFailed));
