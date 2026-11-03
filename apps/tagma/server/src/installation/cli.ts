import { Command } from 'effect/cli';
import { SetupSteps } from './contract/service/steps.js';
import type { Applications } from './contract/service/applications.js';
import type { InstallationCli, Refreshed } from './cli/port.js';
import type { WorldParts } from './move/transfer.js';

type VerbSource = () => Promise<Record<string, unknown>>;

export const installationVerbs = <User, Repo, Entry extends Refreshed>(
  cli: () => Promise<InstallationCli<User, Repo, Entry>>,
  steps: () => Promise<SetupSteps['Service']>,
  parts: () => Promise<WorldParts>,
  applications: () => Promise<Applications>,
) => {
  const carrying: VerbSource = async () => {
    const [verbs, filled] = await Promise.all([import('./cli/transfer.js'), parts()]);
    return { transfer: verbs.transfer(filled) };
  };
  const server: VerbSource = async () => {
    const [verbs, port] = await Promise.all([import('./cli/server.js'), cli()]);
    return {
      restart: verbs.restart(port),
      status: verbs.status(port),
      switch: verbs.switching(port),
      quit: verbs.quitting,
      'process-state': verbs.processState,
    };
  };
  const clients: VerbSource = async () => {
    const [verbs, port, placing] = await Promise.all([import('./cli/clients.js'), cli(), applications()]);
    return { web: verbs.web(port), desktop: verbs.desktop(port, placing) };
  };
  const setup: VerbSource = async () => {
    const [verbs, port, filled] = await Promise.all([import('./cli/setup.js'), cli(), steps()]);
    return {
      install: verbs.install(port).pipe(Command.provideSync(SetupSteps, filled)),
      upgrade: verbs.upgrade(port).pipe(Command.provideSync(SetupSteps, filled)),
    };
  };
  return {
    restart: server,
    web: clients,
    desktop: clients,
    install: setup,
    upgrade: setup,
    status: server,
    switch: server,
    quit: server,
    'process-state': server,
    transfer: carrying,
  } as const;
};
