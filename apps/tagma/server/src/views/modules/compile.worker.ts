/// <reference types="bun" />
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { type CompiledCache, graphFiles, svelteFiles, type ViewFailure } from '@runlith/tagma/plugin/bundling';
import { optimize } from '@tailwindcss/node';
import { Schema } from 'effect';
import { compile, compileModule, VERSION } from 'svelte/compiler';
import svelte from 'svelte/package.json' with { type: 'json' };
import { compile as compileStyles } from 'tailwindcss';
import { filesHasher } from '../../plugins/contract/service/digest.js';
import { VIEW_BUNDLE, viewCompileOptions, viewModuleOptions } from '../contract/wire/compile.js';
import { GRAPH_FILE, VIEW_GRAPH, ViewGraph } from '../contract/wire/graph.js';
import { hostModules } from '../contract/wire/host.js';
import { moduleAddress } from '../contract/wire/modules.js';
import { replayingLoader, utilitiesSource } from '../contract/wire/utilities.js';
import {
  type CompileAnswer,
  type CompileAsk,
  type CompileCancel,
  CompiledIndex,
  GONE,
  INDEX_FILE,
  keyOf,
  SOURCE,
  stagedBy,
} from './compile.js';

declare const self: Worker;

const KEPT = 4096;

const PICTURE = /\.(?:svg|png|webp|gif|jpg)$/u;

const UNPUBLISHED = new Date(0);

const held = new Map<string, string>();

const cache: CompiledCache = {
  get: (key) => {
    const code = held.get(key);
    if (code === undefined) return undefined;
    held.delete(key);
    held.set(key, code);
    return code;
  },
  set: (key, code) => {
    held.set(key, code);
    if (held.size > KEPT) held.delete(held.keys().next().value!);
  },
};

const hosts: ReadonlySet<string> = new Set(hostModules(svelte.exports));

const decodeGraph = Schema.decodeUnknownSync(Schema.fromJsonString(ViewGraph));

const decodeIndex = Schema.decodeUnknownSync(Schema.fromJsonString(CompiledIndex));

class Moved extends Error {}

const shortHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 10);

const logged = (logs: readonly unknown[]): string => logs.map((log) => String(log)).join('\n') || 'the bundler answered no reason';

const indexAt = (out: string): Promise<CompiledIndex | null> =>
  readFile(join(out, INDEX_FILE), 'utf8').then(
    (text) => {
      try {
        return decodeIndex(text);
      } catch {
        return null;
      }
    },
    () => null,
  );

const sheet = async (ask: Extract<CompileAsk, { kind: 'sheet' }>): Promise<CompileAnswer> => {
  const { entry, candidates, stylesheets } = ask.utilities;
  const styles = await compileStyles(utilitiesSource(entry), { base: '.', loadStylesheet: replayingLoader(stylesheets) });
  const { code } = optimize(styles.build([...candidates, ...ask.candidates]), { minify: true });
  const staging = join(dirname(ask.out), stagedBy(process.pid, ask.id, 'sheet'));
  await mkdir(dirname(ask.out), { recursive: true });
  await writeFile(staging, code);
  await rename(staging, ask.out);
  return { id: ask.id, ok: true, kind: 'sheet' };
};

const published = async (ask: Extract<CompileAsk, { kind: 'views' }>, staging: string, out: string): Promise<CompiledIndex | null> => {
  try {
    await rename(staging, out);
    return null;
  } catch {
    const won = await indexAt(out);
    if (won !== null) return won;
    await rename(out, `${out}.${process.pid}-${ask.id}${GONE}`).catch(() => undefined);
    await rename(staging, out);
    return null;
  }
};

const views = async (ask: Extract<CompileAsk, { kind: 'views' }>): Promise<CompileAnswer> => {
  const source = join(ask.place, SOURCE);
  const staging = join(ask.place, stagedBy(process.pid, ask.id, 'out'));
  try {
    await rm(source, { recursive: true, force: true });
    await mkdir(source, { recursive: true });
    const hasher = filesHasher();
    const taken = async (path: string): Promise<Uint8Array> => {
      const bytes = await readFile(join(ask.root, path)).catch(() => null);
      if (bytes === null) throw new Moved(`${VIEW_GRAPH}/${path} went away while the views were read: the plugin is being built again`);
      hasher.add(`${VIEW_GRAPH}/${path}`, bytes);
      await mkdir(dirname(join(source, path)), { recursive: true });
      await writeFile(join(source, path), bytes);
      return bytes;
    };
    const graph = decodeGraph(new TextDecoder().decode(await taken(GRAPH_FILE)));
    const shipped = Object.keys(graph.files).sort();
    for (const path of shipped) await taken(path);
    const missing = ask.entries.find((entry) => graph.files[entry] === undefined);
    if (missing !== undefined) throw new Moved(`${VIEW_GRAPH}/${GRAPH_FILE} stopped shipping ${missing} while the views were read`);
    const key = keyOf(hasher.digest(), ask.entries);
    const out = join(ask.place, key);
    const standing = await indexAt(out);
    if (standing !== null) return { id: ask.id, ok: true, kind: 'views', key, index: standing };
    const root = await realpath(source);
    const failures: ViewFailure[] = [];
    const result = await Bun.build({
      ...VIEW_BUNDLE,
      entrypoints: ask.entries.map((entry) => join(root, entry)),
      outdir: staging,
      publicPath: moduleAddress(ask.plugin, key, ''),
      metafile: true,
      throw: false,
      plugins: [
        graphFiles({ root, graph, hosts }),
        svelteFiles({
          compiler: { compile, compileModule, VERSION },
          graphPath: (absolute) => relative(root, absolute),
          component: (path) => viewCompileOptions(path, graph.files[path]?.dependency === true),
          module: viewModuleOptions,
          cache,
          failed: (found) => {
            failures.push(found);
          },
        }),
      ],
    });
    if (!result.success || result.metafile === undefined) {
      const [told] = failures;
      return { id: ask.id, ok: false, file: told?.file ?? null, message: told?.message ?? logged(result.logs), moved: false };
    }
    const built = new Map(ask.entries.map((entry) => [resolve(root, entry), entry]));
    const modules: Record<string, string> = {};
    for (const [output, made] of Object.entries(result.metafile.outputs)) {
      const entry = made.entryPoint === undefined ? undefined : built.get(resolve(made.entryPoint));
      if (entry !== undefined) modules[entry] = basename(output);
    }
    const icons: Record<string, string> = {};
    for (const icon of shipped.filter((path) => PICTURE.test(path) && graph.files[path]?.dependency !== true)) {
      const bytes = await readFile(join(root, icon));
      const name = `${basename(icon, extname(icon))}-${shortHash(bytes)}${extname(icon)}`;
      await writeFile(join(staging, name), bytes);
      icons[icon] = name;
    }
    const index: CompiledIndex = { modules, icons };
    await writeFile(join(staging, INDEX_FILE), JSON.stringify(index));
    const won = await published(ask, staging, out);
    if (won !== null) return { id: ask.id, ok: true, kind: 'views', key, index: won };
    await utimes(out, UNPUBLISHED, UNPUBLISHED);
    return { id: ask.id, ok: true, kind: 'views', key, index };
  } catch (error) {
    if (!(error instanceof Moved)) throw error;
    return { id: ask.id, ok: false, file: null, message: error.message, moved: true };
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
};

const pending = new Set<number>();

let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<CompileAsk | CompileCancel>) => {
  const message = event.data;
  if (message.kind === 'cancel') {
    pending.delete(message.id);
    return;
  }
  const ask = message;
  pending.add(ask.id);
  queue = queue.then(() =>
    pending.delete(ask.id)
      ? (ask.kind === 'views' ? views(ask) : sheet(ask)).then(
          (answer) => self.postMessage(answer),
          (error: unknown) =>
            self.postMessage({
              id: ask.id,
              ok: false,
              file: null,
              message: error instanceof Error ? error.message : String(error),
              moved: false,
            } satisfies CompileAnswer),
        )
      : undefined,
  );
};
