#!/usr/bin/env bun
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export const createAdapter = async (directory: string, name = basename(directory)): Promise<void> => {
  if (!/^[a-z][a-z0-9-]*$/.test(name))
    throw new Error('The adapter name must start with a letter and contain lowercase letters, digits or hyphens');
  await mkdir(directory, { recursive: false });
  const template = join(import.meta.dir, 'template');
  for (const file of await readdir(template)) {
    const text = await readFile(join(template, file), 'utf8');
    await writeFile(join(directory, file.replace(/\.template$/, '')), text.replaceAll('__NAME__', name), { flag: 'wx' });
  }
};

if (import.meta.main) {
  const target = process.argv[2];
  if (target === undefined) throw new Error('usage: bun create @runlith/tagma-adapter <directory>');
  await createAdapter(resolve(target));
  console.log(`Created ${target}. Run bun install, bun run typecheck and bun run test there.`);
}
