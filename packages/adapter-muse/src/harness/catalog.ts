import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Data, Effect, FileSystem, Schema } from 'effect';
import type { ModelSpec } from '@runlith/llm/models/description';
import type { CatalogModels, CliHarnessCatalogReader } from '@runlith/tagma/adapter/provider';
import { MUSE_SPECS } from '../models/muse.js';
import { Models } from '../runner/frames.js';
import { prepareHome } from '../runner/home.js';
import { loadMuseSdk } from '../runner/sdk.js';

class CatalogRefused extends Data.TaggedError('CatalogRefused')<{ readonly message: string }> {}

const PROVIDER_ID = 'meta';

const KNOWN: Readonly<Record<string, ModelSpec>> = MUSE_SPECS;

const projectCatalog = (listed: Models): CatalogModels => {
  const models: Record<string, ModelSpec> = {};
  const warnings: string[] = [];
  let preferred: string | null = null;
  for (const row of listed.models) {
    if (row.providerId !== PROVIDER_ID || models[row.modelId] !== undefined) continue;
    const reasoning = Array.isArray(row.variants) ? row.variants.filter((variant): variant is string => typeof variant === 'string') : [];
    if (row.contextLimit === null) warnings.push(`${row.modelId}: context window is unknown`);
    const listedSpec: ModelSpec = {
      label: KNOWN[row.modelId]?.label ?? (row.displayLabel.trim() || row.modelId),
      short: KNOWN[row.modelId]?.short,
      capacity:
        row.contextLimit === null
          ? undefined
          : { context: row.contextLimit, output: row.outputLimit === null ? undefined : row.outputLimit },
      capabilities: ['text', 'vision'],
      reasoning,
      defaultReasoning:
        row.defaultReasoningEffort !== undefined && reasoning.includes(row.defaultReasoningEffort) ? row.defaultReasoningEffort : null,
    };
    models[row.modelId] = listedSpec;
    const contributor = KNOWN[`${row.modelId}-contributor`];
    if (contributor !== undefined)
      models[`${row.modelId}-contributor`] ??= { ...listedSpec, label: contributor.label, short: contributor.short };
    if (row.isDefault && preferred === null) preferred = row.modelId;
  }
  return { models, defaultTextModel: preferred ?? Object.keys(models)[0] ?? '', warnings };
};

export const catalog: CliHarnessCatalogReader = {
  read: Effect.fn('museCode.catalog')(
    function* (address) {
      const files = yield* FileSystem.FileSystem;
      const refused = (cause: { readonly message: string }) => new CatalogRefused({ message: cause.message });
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-muse-catalog-' }).pipe(Effect.mapError(refused));
      const environment: Record<string, string | undefined> = { ...process.env };
      for (const entry of address.entries) environment[entry.name] = entry._tag === 'Set' ? entry.value : undefined;
      const program = Bun.which('muse', { PATH: environment.PATH ?? '' });
      if (program === null) return yield* new CatalogRefused({ message: "muse is not installed on this machine's PATH" });
      const env = yield* prepareHome(
        { account: join(directory, 'home'), config: join(directory, 'config') },
        environment,
        process.platform,
      ).pipe(Effect.mapError(refused));
      const sdk = yield* loadMuseSdk;
      const host = yield* sdk
        .open({
          program,
          args: ['serve', '--no-session-log'],
          cwd: directory,
          env,
          sessionMcp: false,
          frame: () => Effect.void,
          stderr: () => {},
        })
        .pipe(Effect.mapError(refused));
      const listed = yield* host.request('model/list', {}).pipe(
        Effect.mapError(refused),
        Effect.flatMap(Schema.decodeUnknownEffect(Models)),
        Effect.mapError((cause) => new CatalogRefused({ message: `Muse Code model list is unreadable: ${cause.message}` })),
      );
      return projectCatalog(listed);
    },
    Effect.scoped,
    Effect.provide(BunFileSystem.layer),
  ),
};
