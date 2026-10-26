import { HARNESS_AGENT_ID, HARNESS_LABELS, HARNESS_NAMES, type HarnessName } from './names.js';
import { unmeasuredObservation } from './observation.js';
import type { ExternalSession, HarnessInstall } from './externalSession.js';

const SEPARATOR = ':';
const PREFIX = `${HARNESS_AGENT_ID}${SEPARATOR}`;

export function harnessTypeId(harness: string): string {
  return `${PREFIX}${harness}`;
}

export function harnessOfTypeId(typeId: string): HarnessName | null {
  if (!typeId.startsWith(PREFIX)) return null;
  const named = typeId.slice(PREFIX.length);
  return HARNESS_NAMES.find((harness) => harness === named) ?? null;
}

export function harnessSpawnTypes(installs: readonly HarnessInstall[]) {
  return installs.map((install) => {
    const label = HARNESS_LABELS[install.harness];
    return {
      id: harnessTypeId(install.harness),
      name: label,
      description: `${label}, run as a thread of Tagma in the thread's own world.`,
      baseAgentId: HARNESS_AGENT_ID,
      harness: install,
    };
  });
}

export function harnessFacet(name: HarnessName): ExternalSession {
  return { name, sessionKey: null, execution: null, observation: unmeasuredObservation() };
}
