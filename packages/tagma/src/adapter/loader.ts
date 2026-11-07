import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { Schema } from 'effect';
import { MANIFEST } from '../manifest';
import type { ProvidersDefinition } from '../plugin/plugin';

export type HostModule = () => Promise<object>;
export type HostModules = Readonly<Record<string, HostModule>>;

export type ImportedProviders = ProvidersDefinition & { readonly id: string; readonly version: string };

const envelopeSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  providers: Schema.optional(Schema.Struct({ entry: Schema.String })),
});
const decodeEnvelope = Schema.decodeUnknownSync(Schema.fromJsonString(envelopeSchema));

type Hosted = { readonly exports: object } | { readonly unloadable: unknown };
let hosted: Promise<void> | undefined;
const hostOnce = (host: HostModules): Promise<void> =>
  (hosted ??= (async () => {
    const loaded: (readonly [string, Hosted])[] = [];
    for (const [specifier, module] of Object.entries(host)) {
      loaded.push([
        specifier,
        await module().then(
          (exports) => ({ exports }),
          (unloadable: unknown) => ({ unloadable }),
        ),
      ]);
    }
    Bun.plugin({
      name: 'adapter-host',
      setup(build) {
        for (const [specifier, held] of loaded)
          build.module(specifier, () => {
            if ('unloadable' in held) throw held.unloadable;
            return { exports: { ...held.exports }, loader: 'object' };
          });
      },
    });
  })());

const definitionOf = (exported: unknown, path: string): ProvidersDefinition => {
  if (typeof exported !== 'object' || exported === null)
    throw new Error(`${path} exports no provider part as its default: write export default defineProviders({ models, speech })`);
  const { models, speech } = exported as { readonly models?: unknown; readonly speech?: unknown };
  if (models !== undefined && typeof models !== 'function')
    throw new Error(`${path}: models is not an adapter: make it with defineAdapter from @runlith/tagma/adapter/provider`);
  if (speech !== undefined && !Array.isArray(speech)) throw new Error(`${path}: speech is not a list of speech providers`);
  if (models === undefined && speech === undefined) throw new Error(`${path} declares neither models nor speech`);
  return exported as ProvidersDefinition;
};

export const importProviders = async (
  directory: string,
  host: HostModules,
  argv: readonly string[] = process.execArgv,
): Promise<ImportedProviders> => {
  if (!argv.includes('--no-install'))
    throw new Error(
      'the server runs without --no-install, so an import outside the host modules would install a second copy instead of failing; start it with bun --no-install',
    );
  const real = await realpath(directory);
  const manifest = join(real, MANIFEST);
  const { id, version, providers } = decodeEnvelope(await readFile(manifest, 'utf8'));
  if (providers === undefined) throw new Error(`${manifest} declares no provider part`);
  const entry = join(real, providers.entry);
  await hostOnce(host);
  const module = (await import(entry)) as { readonly default?: unknown };
  return { id, version, ...definitionOf(module.default, entry) };
};
