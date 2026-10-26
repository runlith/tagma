import type { ThreadInstructionsRefreshed } from '@tagma/server/native-harness/contract/wire/instructions';

type WalkedSources = {
  skills: readonly { enabled: boolean }[];
  contextFiles: readonly unknown[];
  rejected: readonly { path: string; reason: string }[];
};

export function sourcesMessage(found: WalkedSources): string {
  const enabled = found.skills.filter((skill) => skill.enabled).length;
  const disabled = found.skills.length - enabled;
  const parts = [
    `${enabled} ${enabled === 1 ? 'skill' : 'skills'}${disabled > 0 ? ` (+${disabled} disabled)` : ''}`,
    `${found.contextFiles.length} ${found.contextFiles.length === 1 ? 'instruction file' : 'instruction files'}`,
  ];
  const head = `Read ${parts.join(' and ')} from the checkout.`;
  if (found.rejected.length === 0) return head;
  const unusable = found.rejected.map((entry) => `${entry.path} (${entry.reason})`).join(', ');
  return `${head} Unusable: ${unusable}`;
}

export function instructionsMessage(state: ThreadInstructionsRefreshed['instructions']): string {
  const entries = (count: number): string => `${count} ${count === 1 ? 'entry' : 'entries'}`;
  if (state.delivered === null)
    return `Project instructions: none in this context yet; the next step carries all ${entries(state.current.entries)}.`;
  if (state.pending.length === 0 && state.withdrawn.length === 0)
    return `Project instructions current (${entries(state.current.entries)}).`;
  const parts = [
    ...(state.pending.length > 0 ? [`${entries(state.pending.length)} to deliver at the next step`] : []),
    ...(state.withdrawn.length > 0 ? [`${entries(state.withdrawn.length)} withdrawn`] : []),
  ];
  return `Project instructions: ${parts.join(', ')}.`;
}
