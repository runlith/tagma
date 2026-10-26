import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { ModelSpec } from '@runlith/llm/models/description';
import type { CatalogModels, CliHarnessCatalogReader } from '@runlith/tagma/adapter/provider';
import { Data, Effect, FileSystem, Schema } from 'effect';
import { findProgram, openHost } from './host';

class CatalogRefused extends Data.TaggedError('CatalogRefused')<{ readonly message: string }> {}

const modelSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  providerID: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.String,
  enabled: Schema.Boolean,
  capabilities: Schema.Struct({ tools: Schema.Boolean, input: Schema.Array(Schema.String), output: Schema.Array(Schema.String) }),
  variants: Schema.Array(Schema.Struct({ id: Schema.String })),
  limit: Schema.Struct({ context: Schema.Int, input: Schema.optional(Schema.Int), output: Schema.Int }),
});
const listing = Schema.Struct({ data: Schema.Array(modelSchema) });
const defaultModel = Schema.Struct({ data: Schema.NullOr(modelSchema) });

export const projectCatalog = Effect.fn('opencode.projectCatalog')(function* (
  body: unknown,
  preferred: unknown,
): Effect.fn.Return<CatalogModels, CatalogRefused> {
  const response = yield* Schema.decodeUnknownEffect(listing)(body).pipe(
    Effect.mapError((cause) => new CatalogRefused({ message: `OpenCode model list is invalid: ${cause.message}` })),
  );
  const selected = yield* Schema.decodeUnknownEffect(defaultModel)(preferred).pipe(
    Effect.mapError((cause) => new CatalogRefused({ message: `OpenCode default model is invalid: ${cause.message}` })),
  );
  const models: Record<string, ModelSpec> = {};
  const warnings: string[] = [];
  for (const model of response.data) {
    if (
      !model.enabled ||
      !model.capabilities.tools ||
      !model.capabilities.input.includes('text') ||
      !model.capabilities.output.includes('text')
    )
      continue;
    const id = `${model.providerID}/${model.id}`;
    if (model.limit.context <= 0) warnings.push(`${id}: context window is unknown`);
    models[id] = {
      label: model.name,
      capacity:
        model.limit.context > 0
          ? {
              context: model.limit.context,
              input: model.limit.input !== undefined && model.limit.input > 0 ? model.limit.input : undefined,
              output: model.limit.output > 0 ? model.limit.output : undefined,
            }
          : undefined,
      capabilities: model.capabilities.input.includes('image') ? ['text', 'vision'] : ['text'],
      reasoning: model.variants.map((variant) => variant.id),
      defaultReasoning: null,
      servedAs: id,
    };
  }
  const preferredId = selected.data === null ? null : `${selected.data.providerID}/${selected.data.id}`;
  if (preferredId !== null && models[preferredId] === undefined)
    warnings.push(`${preferredId}: the default model does not support hosted text and tools`);
  return {
    models,
    defaultTextModel: preferredId !== null && models[preferredId] !== undefined ? preferredId : (Object.keys(models)[0] ?? ''),
    warnings,
  };
});

export const catalog: CliHarnessCatalogReader = {
  read: Effect.fn('opencode.catalog')(
    function* (address) {
      const files = yield* FileSystem.FileSystem;
      const directory = yield* files
        .makeTempDirectoryScoped({ prefix: 'tagma-opencode-catalog-' })
        .pipe(Effect.mapError((cause) => new CatalogRefused({ message: cause.message })));
      const environment: Record<string, string | undefined> = { ...process.env };
      for (const entry of address.entries) environment[entry.name] = entry._tag === 'Set' ? entry.value : undefined;
      const program = yield* findProgram(environment);
      let stderr = '';
      const host = yield* openHost({
        program,
        cwd: directory,
        environment,
        config: {
          directory,
          content: JSON.stringify({
            snapshots: false,
            formatter: false,
            lsp: false,
            update: 'disable',
            share: 'disabled',
            warming: false,
            compaction: { auto: false },
          }),
          project: false,
          claude: false,
        },
        onStderr: (chunk) => {
          stderr += chunk;
        },
      });
      const location = { directory };
      const body = yield* Effect.tryPromise({
        try: (signal) => host.client.model.list({ location }, { signal }),
        catch: (cause) =>
          new CatalogRefused({ message: `OpenCode model list failed: ${String(cause)}${stderr ? `\n${stderr.trim()}` : ''}` }),
      });
      const preferred = yield* Effect.tryPromise({
        try: (signal) => host.client.model.default({ location }, { signal }),
        catch: (cause) => new CatalogRefused({ message: `OpenCode default model failed: ${String(cause)}` }),
      });
      return yield* projectCatalog(body, preferred);
    },
    Effect.scoped,
    Effect.provide(BunFileSystem.layer),
  ),
};
