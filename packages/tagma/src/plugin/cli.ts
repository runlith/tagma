#!/usr/bin/env bun
import { watch } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { buildPlugin } from './build.js';
import { MANIFEST } from '../manifest.js';
import { pluginIdRefusal } from './checks.generated.js';
import { BuildFailed } from './failure.js';
import { pluginTemplate } from './template.js';

const USAGE = [
  'tagma-plugin build [folder]   type-check the plugin, write tagma-plugin.json and dist/process.js',
  'tagma-plugin dev [folder]     build, then build again after every change',
  'tagma-plugin init <folder> [--id <id>] [--title <title>]   write a new plugin folder',
].join('\n');

const IGNORED = new Set(['node_modules', 'dist', '.git', MANIFEST]);

const flag = (args: readonly string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const titled = (id: string): string =>
  id
    .split('-')
    .filter((word) => word !== '')
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');

const init = async (args: readonly string[]): Promise<number> => {
  const folder = args[0];
  if (folder === undefined || folder.startsWith('--')) {
    console.error(USAGE);
    return 2;
  }
  const directory = resolve(folder);
  const id = flag(args, '--id') ?? basename(directory);
  const refused = pluginIdRefusal(id);
  if (refused !== null) {
    console.error(`${JSON.stringify(id)} cannot name a plugin: ${refused}`);
    return 1;
  }
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length > 0) {
    console.error(`${directory} is not empty: init writes a new plugin folder`);
    return 1;
  }
  for (const file of pluginTemplate({ id, title: flag(args, '--title') ?? titled(id) }))
    await writeFile(join(directory, file.path), file.text, { flag: 'wx' });
  console.log(`Wrote ${directory}. Install its dependencies there, then run tagma-plugin build.`);
  return 0;
};

const build = async (folder: string): Promise<number> => {
  try {
    const built = await buildPlugin(folder);
    const tools = built.manifest.contributes?.tools;
    const count = Array.isArray(tools) ? `, ${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}` : '';
    console.log(
      `Built ${built.manifest.id} ${built.manifest.version}: ${MANIFEST}${built.process ? ' and dist/process.js' : ', no process'}${count}.`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof BuildFailed)) throw error;
    console.error(`The build stopped at ${error.step}:\n${error.reason}`);
    return 1;
  }
};

const dev = async (folder: string): Promise<number> => {
  const directory = resolve(folder);
  const script = process.argv[1]!;
  let running: Promise<void> | null = null;
  let again = false;
  const rebuild = (): void => {
    if (running !== null) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        await Bun.spawn([process.execPath, script, 'build', directory], { stdio: ['ignore', 'inherit', 'inherit'] }).exited;
      } while (again);
      running = null;
    })();
  };
  rebuild();
  watch(directory, { recursive: true }, (_event, name) => {
    if (
      name === null ||
      relative(directory, join(directory, name))
        .split(sep)
        .some((part) => IGNORED.has(part))
    )
      return;
    rebuild();
  });
  return new Promise<number>(() => undefined);
};

const [command, ...rest] = process.argv.slice(2);
const code =
  command === 'build'
    ? await build(rest[0] ?? '.')
    : command === 'dev'
      ? await dev(rest[0] ?? '.')
      : command === 'init'
        ? await init(rest)
        : 2;
if (code === 2 && command !== 'init') console.error(USAGE);
process.exit(code);
