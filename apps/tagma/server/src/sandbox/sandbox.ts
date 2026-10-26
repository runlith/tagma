import { sandbox as declaration } from './contract/wire/module.js';
import { Context, Effect, Layer } from 'effect';
import { sandboxVerbs } from './cli.js';
import type { ToolFactoryOptions } from '@runlith/agent-tools/workspace';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { sandboxCapability } from './contract/wire/capability.js';
import { GuestFileReader, ImportDestination } from './contract/service/imports.js';
import type { GuestImportContext } from './guests/imports.js';
import { theSandboxTree } from './doctrine/theSandboxTree.js';
import { Sandboxes } from './contract/service/sandboxes.js';
import { PreparedTrees } from './contract/service/preparedTrees.js';

export const sandbox = manifest({
  ...declaration,
  capabilities: [sandboxCapability],
  verbs: sandboxVerbs,
  bodies: async () => Object.values((await import('./operations/routes.js')).SANDBOX_PAIRS),
  tables: async () => {
    const tables = await import('./store/tables.js');
    return { entities: [tables.sandbox, tables.preparedTree], history: [] };
  },
  sections: [
    {
      id: 'the-sandbox-tree',
      place: { prompt: 60 },
      owner: 'sandbox',
      render: theSandboxTree,
      path: 'src/sandbox/doctrine/theSandboxTree.ts',
    },
  ],
  drivers: [{ id: 'sandbox-sweeps' }],
  lifetimes: {
    installation: lazyLayer(
      () => Promise.all([import('./layer.js'), import('./maintenance.js')]),
      ([{ sandboxLayer }, { installSandboxDrivers }]) =>
        Layer.effectDiscard(
          Effect.gen(function* () {
            yield* installSandboxDrivers(yield* Sandboxes, yield* PreparedTrees);
          }),
        ).pipe(Layer.provideMerge(sandboxLayer)),
    ),
    call: (input: { readonly source: GuestImportContext; readonly destination: ToolFactoryOptions }) =>
      Context.make(GuestFileReader, {
        open: (namespace, path) =>
          Effect.flatMap(
            Effect.promise(() => import('./guests/imports.js')),
            ({ guestImports }) => guestImports(input.source).open(namespace, path),
          ),
      }).pipe(Context.add(ImportDestination, input.destination)),
  },
});
