import { HARNESS_AGENT_ID, isHarnessName, type HarnessName } from './names.js';
import { unmeasuredObservation } from './observation.js';
import type { ExternalSession, HarnessInstall, HarnessPresentation } from './externalSession.js';

const SEPARATOR = ':';
const PREFIX = `${HARNESS_AGENT_ID}${SEPARATOR}`;

export function harnessTypeId(harness: string): string {
  return `${PREFIX}${harness}`;
}

export function harnessOfTypeId(typeId: string): HarnessName | null {
  if (!typeId.startsWith(PREFIX)) return null;
  const named = typeId.slice(PREFIX.length);
  return isHarnessName(named) ? named : null;
}

const roadsOf = (presentation: HarnessPresentation): string =>
  presentation.terminal && presentation.acp && !presentation.hosted
    ? 'in its terminal or over ACP'
    : presentation.terminal
      ? 'in its terminal'
      : 'over ACP';

export function harnessSpawnTypes(installs: readonly HarnessInstall[]) {
  return installs.map((install) => {
    const { label } = install.presentation;
    return {
      id: harnessTypeId(install.harness),
      name: label,
      description: `${label}'s own agent, run ${roadsOf(install.presentation)} as a thread of Tagma in the thread's own world.`,
      baseAgentId: HARNESS_AGENT_ID,
      harness: install,
    };
  });
}

export function harnessFacet(name: HarnessName, presentation: HarnessPresentation): ExternalSession {
  return { name, presentation, sessionKey: null, execution: null, observation: unmeasuredObservation() };
}
