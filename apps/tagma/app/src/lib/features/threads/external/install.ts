import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { type ExecutionsRepo, terminalKey } from '$lib/features/executions/Repo.js';
import { startedAt } from '$lib/features/executions/terminal/Tab.svelte.js';
import type { Addresses } from '$lib/features/workspace/Addresses.js';

export type CliInstall = { readonly label: string; readonly command: string };

export type Installing = { readonly href: string; readonly ended: Promise<void> };

export async function installInTerminal(
  executions: ExecutionsRepo,
  addresses: Addresses,
  project: Project,
  install: CliInstall,
): Promise<Installing | null> {
  const answer = await executions.start.run(
    {
      operationId: crypto.randomUUID(),
      cwd: project.rootPath,
      program: '/bin/sh',
      args: ['-c', install.command],
      label: `Install ${install.label}`,
      transport: 'pty',
      lifetime: 'held',
    },
    { throwOnError: true },
  );
  const at = answer === undefined ? undefined : startedAt(answer);
  if (at === undefined) return null;
  return { href: addresses.terminal(terminalKey(at), project.name), ended: ended(executions, at) };
}

async function ended(executions: ExecutionsRepo, at: NonNullable<ReturnType<typeof startedAt>>): Promise<void> {
  for (;;) {
    const waited = await executions.wait.run({ ...at, waitMs: LONGEST_ACT_MS }, { throwOnError: true });
    if (waited === undefined || waited._tag !== 'Undecided') return;
  }
}
