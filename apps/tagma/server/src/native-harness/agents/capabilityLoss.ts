import { Schema } from 'effect';
import { withdrawn, worldStateSection, type PackedWorldStateSection } from '@runlith/agent/WorldState';
import type { CapabilityUnavailable } from '../capabilities/contract.js';

type CapabilityLoss = {
  readonly capability: string;
  readonly reason: string;
};

const lossCodec = Schema.Array(Schema.Struct({ capability: Schema.String, reason: Schema.String }));

export function capabilityLossSection(
  losses: readonly CapabilityUnavailable[],
  describe: (capability: string) => string,
): PackedWorldStateSection {
  const said = (loss: CapabilityLoss): string =>
    `\`${loss.capability}\` is unavailable: ${loss.reason}. Its tools are withheld from this run — ${describe(loss.capability)}. The thread itself is unaffected.`;
  const renderLosses = (told: readonly CapabilityLoss[]): string => told.map(said).join('\n\n');
  const current: readonly CapabilityLoss[] = losses.map((loss) => ({
    capability: loss.capability,
    reason: loss.reason,
  }));
  return worldStateSection({
    id: 'unavailable-capabilities',
    codec: lossCodec,
    read: () => (current.length === 0 ? withdrawn : current),
    baseline: (told) => renderLosses(told),
    update: (_previous, told) => `The unavailable capabilities changed. This list supersedes the previous one.\n\n${renderLosses(told)}`,
    removed: (previous) =>
      previous === undefined || previous.length === 0
        ? ''
        : `The following capabilities are available again: ${previous.map((loss) => `\`${loss.capability}\``).join(', ')}.`,
  });
}
