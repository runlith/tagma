import { Effect } from 'effect';
import type { VerbSources } from '../../cli/verbs.js';
import { COMPOSED_VERB_BINDINGS, VERB_MODULES } from '@tagma/server/composition/verbBindings';
import type { VerbBinding, VerbBindings } from './binding.js';
import { door, EXTERNAL_HARNESS_BINDINGS } from './doorBinding.js';

const live = async () => (await import('./live.js')).askLive;

const BINDINGS: VerbBindings = {
  ...COMPOSED_VERB_BINDINGS,
  installation: [
    async () => (await import('./installation.js')).installationCli,
    async () => (await import('./setupSteps.js')).mcpDeclarationSteps,
    async () => (await import('../worldParts.js')).WORLD_PARTS,
  ],
  providers: [
    async () => {
      const [{ here }, { perform }] = await Promise.all([door(), import('./perform.js')]);
      return { perform, here };
    },
  ],
  projects: [
    async () => {
      const [{ here }, { policy, renderGroups, renderProjects }, { perform }, { groupRegistry, projectRegistry }] = await Promise.all([
        door(),
        import('../../graph/cli/policy.js'),
        import('./perform.js'),
        import('./registry.js'),
      ]);
      return {
        registry: projectRegistry,
        groups: groupRegistry,
        here,
        render: renderProjects,
        renderGroups,
        policy: policy({ perform, here, render: renderProjects }),
      };
    },
  ],
  enforcement: [async () => (await import('./enforcement.js')).enforcementCli],
  graph: [
    async () => {
      const [{ ask, here, lens }, { blockRef }, { perform }] = await Promise.all([
        door(),
        import('../../graph/cli/args.js'),
        import('./perform.js'),
      ]);
      return {
        perform,
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
  sandbox: [async () => (await import('./sandbox.js')).sandboxCli],
  'external-harnesses': EXTERNAL_HARNESS_BINDINGS,
  'native-harness': [
    async () => {
      const [{ ask, lens }, { blockRefFlag }, { CHANNEL }, { dataDirectory }] = await Promise.all([
        door(),
        import('../../graph/cli/args.js'),
        import('@tagma/server/composition/channel'),
        import('../../installation/contract/wire/layout.js'),
      ]);
      return { ask, lens, blockRefFlag, dataPath: dataDirectory(CHANNEL, process.env) };
    },
  ],
  threads: [
    async () => {
      const [{ ask, lens }, askLive] = await Promise.all([door(), live()]);
      return { ask, askLive, lens };
    },
  ],
  cli: [async () => (await import('./operations.js')).operationsCli],
};

export const bindingsOf = (id: string): readonly VerbBinding[] => BINDINGS[id] ?? [];

export const TAGMA_VERBS: VerbSources = {
  serve: () => import('./serve.js'),
  db: () => import('./database.js'),
  ...Object.assign({}, ...VERB_MODULES.map((module) => module.verbs(...(bindingsOf(module.id) as never[])))),
};
