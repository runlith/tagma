import { Effect, Schema } from 'effect';
import { instructionText } from '../graph/orientation/Instructions.js';
import { instructionSetSchema, type InstructionDiff, type InstructionSet } from '../graph/contract/wire/instructions.js';
import { threadCallFailed } from '../threads/contract/service/failure.js';

const deliveredSchema = Schema.Record(Schema.String, instructionSetSchema);

export type DeliveredLaw = Readonly<Record<string, InstructionSet>>;

export const deliveredLaw = Effect.fnUntraced(function* (delivered: unknown) {
  const known: DeliveredLaw = delivered === null ? {} : yield* Schema.decodeUnknownEffect(deliveredSchema)(delivered);
  return known;
}, Effect.mapError(threadCallFailed));

export function instructionDelivery(
  known: DeliveredLaw,
  diffs: readonly InstructionDiff[],
  reader: string,
  withdrawn: readonly number[] = [],
) {
  const law: Record<string, InstructionSet> = { ...known };
  for (const projectId of withdrawn) delete law[String(projectId)];
  const text: string[] = [];
  for (const { set, changes } of diffs) {
    const changed = instructionText(set, known[String(set.projectId)], changes, reader);
    if (changed !== '') text.push(changed);
    law[String(set.projectId)] = set;
  }
  return { text: text.join('\n\n'), law };
}
