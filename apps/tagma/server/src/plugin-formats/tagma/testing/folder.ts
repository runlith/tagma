import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST } from '../contract/wire/manifest.js';

export const PROCESS_ENTRY = 'dist/process.js';

const BUILT_FROM_NOTHING = { hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', sources: [] };

export type PluginFolder = {
  readonly id: string;
  readonly title?: string;
  readonly program?: string;
  readonly resident?: boolean;
  readonly options?: readonly Readonly<Record<string, unknown>>[];
  readonly mcpServers?: Readonly<Record<string, unknown>>;
  readonly contributes?: Readonly<Record<string, unknown>>;
  readonly build?: { readonly hash: string; readonly sources: readonly string[] };
};

export const manifestText = (folder: PluginFolder): string =>
  JSON.stringify({
    id: folder.id,
    title: folder.title ?? folder.id,
    version: '0.0.0',
    process: folder.program === undefined ? undefined : { entry: PROCESS_ENTRY, resident: folder.resident },
    options: folder.options,
    mcpServers: folder.mcpServers,
    build: folder.build ?? BUILT_FROM_NOTHING,
    contributes: folder.contributes,
  });

export const entryText = (program: string): string => `await import(${JSON.stringify(program)});\n`;

export const writePlugin = async (root: string, folder: PluginFolder): Promise<void> => {
  await mkdir(join(root, 'dist'), { recursive: true });
  if (folder.program !== undefined) await writeFile(join(root, PROCESS_ENTRY), entryText(folder.program));
  await writeFile(join(root, MANIFEST), manifestText(folder));
};
