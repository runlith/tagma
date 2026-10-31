import { Effect } from 'effect';
import type { VerbSources } from '../../cli/verbs.js';
import type { Build } from '../build.js';
import type { Assembly } from '../manifest.js';
import type { VerbBinding, VerbBindings } from './binding.js';
import { doorFor, externalHarnessBindings } from './doorBinding.js';

const once = <A>(load: () => Promise<A>): (() => Promise<A>) => {
  let loading: Promise<A> | undefined;
  return () => (loading ??= load());
};

export const bindingsOf = (build: Build): VerbBindings => {
  const { channel } = build;
  const door = doorFor(channel);
  const perform = async () => (await import('./perform.js')).performThrough(await door());
  const assembled = once(async (): Promise<Assembly> => (await import('../manifest.js')).assemble(await build.parts()));
  const live = async () => {
    const [{ liveAsking }, bound, { live: group }] = await Promise.all([import('./live.js'), door(), assembled()]);
    return liveAsking(bound, group);
  };
  const installation = once(async () => {
    const [{ installationCli }, { doctrineText }, bound] = await Promise.all([
      import('./installation.js'),
      import('../doctrine.js'),
      door(),
    ]);
    return installationCli(
      channel,
      bound,
      Effect.promise(async () => doctrineText(await assembled())),
    );
  });
  return {
    ...build.verbBindings({ installation }),
    installation: [
      installation,
      async () => (await import('./setupSteps.js')).mcpDeclarationSteps(channel),
      async () => {
        const [{ worldParts }, { modules }] = await Promise.all([import('../worldParts.js'), build.parts()]);
        return worldParts(modules);
      },
    ],
    providers: [
      async () => {
        const [{ here }, performed] = await Promise.all([door(), perform()]);
        return { perform: performed, here };
      },
    ],
    projects: [
      async () => {
        const [{ here }, { policy, renderGroups, renderProjects }, performed, { groupRegistry, projectRegistry }] = await Promise.all([
          door(),
          import('../../graph/cli/policy.js'),
          perform(),
          import('./registry.js'),
        ]);
        return {
          registry: projectRegistry(performed),
          groups: groupRegistry(performed),
          here,
          render: renderProjects,
          renderGroups,
          policy: policy({ perform: performed, here, render: renderProjects }),
        };
      },
    ],
    enforcement: [async () => (await import('./enforcement.js')).enforcementCli(await door())],
    graph: [
      async () => {
        const [{ ask, here, lens }, { blockRef }, performed] = await Promise.all([door(), import('../../graph/cli/args.js'), perform()]);
        return {
          perform: performed,
          here,
          lens,
          blockRef,
          sessionIdentity: () => ask((client) => client.health.health()).pipe(Effect.map((health) => health.sessionIdentity)),
          writer: async () => (await import('../../external-harnesses/installs/law.js')).writeLawSection,
        };
      },
    ],
    artifacts: [
      async () => {
        const { ask } = await door();
        return { ask };
      },
    ],
    executions: [
      async () => {
        const { ask, lens } = await door();
        return { ask, lens };
      },
    ],
    sandbox: [async () => (await import('./sandbox.js')).sandboxCli(await perform())],
    'external-harnesses': externalHarnessBindings(channel),
    'native-harness': [
      async () => {
        const [{ ask, lens }, { blockRefFlag }, { dataDirectory }] = await Promise.all([
          door(),
          import('../../graph/cli/args.js'),
          import('../../installation/contract/wire/layout.js'),
        ]);
        return { ask, lens, blockRefFlag, dataPath: dataDirectory(channel, process.env) };
      },
    ],
    threads: [
      async () => {
        const [{ ask, lens }, askLive] = await Promise.all([door(), live()]);
        return { ask, askLive, lens };
      },
    ],
    cli: [
      async () => {
        const [{ operationsCli }, bound, { registry }] = await Promise.all([import('./operations.js'), door(), assembled()]);
        return operationsCli(channel, bound, registry);
      },
    ],
  };
};

export const verbsOf = (build: Build, server: () => Promise<unknown>): VerbSources => {
  const bindings = bindingsOf(build);
  const bound = (id: string): readonly VerbBinding[] => bindings[id] ?? [];
  return {
    serve: async () => ({ serve: (await import('./serve.js')).serveCommand(build.channel, server) }),
    db: async () => ({ database: (await import('./database.js')).databaseCommand(build) }),
    ...Object.assign({}, ...build.verbs.map((module) => module.verbs(...(bound(module.id) as never[])))),
  };
};
