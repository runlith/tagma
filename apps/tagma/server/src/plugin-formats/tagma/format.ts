import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { type PluginFormat, type PluginProcess, PluginRefused } from '../../plugins/contract/service/format.js';
import { entryOf, jsonOf, textOf } from '../../plugins/contract/service/reading.js';
import { Envelope, MANIFEST } from './contract/wire/manifest.js';

const decodeManifest = Schema.decodeUnknownEffect(Envelope);

const claim: PluginFormat['claim'] = Effect.fnUntraced(function* (root) {
  return (yield* entryOf(root, MANIFEST)).kind === 'file' ? 'manifest' : null;
});

const read: PluginFormat['read'] = Effect.fn('tagma.read')(function* (root, _claim, entry) {
  if (entry?.fields != null) {
    return yield* new PluginRefused({ reason: `a plugin in Tagma’s format is its own manifest: a marketplace entry declares none for it` });
  }
  const path = join(root, MANIFEST);
  const parsed = jsonOf(yield* textOf(path));
  if ('reason' in parsed) return yield* new PluginRefused({ reason: `${path} is not JSON: ${parsed.reason}` });
  const manifest = yield* decodeManifest(parsed.value, { onExcessProperty: 'error' }).pipe(
    Effect.mapError((failure) => new PluginRefused({ reason: `${path}: ${failure.message}` })),
  );
  if (entry !== null && entry.name !== manifest.id) {
    return yield* new PluginRefused({ reason: `its marketplace entry names it ${entry.name}, but ${MANIFEST} names it ${manifest.id}` });
  }
  const process: PluginProcess | null =
    manifest.process === undefined ? null : { entry: manifest.process.entry, resident: manifest.process.resident ?? false };
  if (process !== null && (yield* entryOf(root, process.entry)).kind !== 'file') {
    return yield* new PluginRefused({
      reason: `${MANIFEST} runs ${process.entry}, which is not a file inside the plugin: build the plugin again`,
    });
  }
  return {
    name: manifest.id,
    title: manifest.title,
    version: manifest.version,
    description: manifest.description ?? null,
    about: { author: null, homepage: null, repository: null, license: null },
    skills: [],
    commands: [],
    agents: [],
    servers: [],
    hooks: [],
    options: (manifest.options ?? []).map((option) => ({
      key: option.key,
      type: option.type ?? 'string',
      title: option.title,
      description: option.description,
      sensitive: option.sensitive ?? false,
      required: option.required ?? false,
      fallback: option.default ?? null,
    })),
    process,
    build: {
      hash: manifest.build.hash,
      sources: manifest.build.sources,
      outputs: process === null ? [MANIFEST] : [MANIFEST, process.entry],
    },
    contributes: manifest.contributes ?? {},
    ignored: [],
  };
});

export const tagmaFormat: PluginFormat = { id: 'tagma', prevails: true, claim, read };
