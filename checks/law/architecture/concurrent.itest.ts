import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Side } from '@runlith/tagma/rules';
import { databaseAt } from '../declarations/database';
import { indexes } from './indexes';
import type { Snapshot } from './snapshot';
import { vendorIndex } from './vendors';

test('a competing cache writer does not lose literals needed by an unchanged source after a provider declaration changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'architecture-writers-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const source = 'apps/tagma/server/src';
  const target = `${source}/translations/probe.ts`;
  let other: Database | undefined;
  let main: Database | undefined;
  try {
    git('init', '-q');
    put('packages/adapter-orbit/src/adapter.ts', "export const ORBIT_PROVIDER = 'orbit';");
    put(target, "export const chosen = 'future-cloud';");
    git('add', '.');
    const base = git('write-tree');
    main = databaseAt(root);
    other = new Database(main.filename);
    other.exec('PRAGMA busy_timeout = 0');
    const index = indexes(root, base);
    const competing = {
      ...index,
      snapshot: (side: Side, scope?: readonly string[]): Snapshot => {
        const snapshot = index.snapshot(side, scope);
        return {
          tree: snapshot.tree,
          paths: snapshot.paths,
          get modules() {
            return snapshot.modules;
          },
          file: (path) => {
            if (path === target) {
              try {
                other!.exec('BEGIN IMMEDIATE');
                other!.exec("INSERT OR REPLACE INTO memo (key, value, at) VALUES ('competing-cache', '{}', 0)");
                other!.exec('COMMIT');
              } catch (error) {
                if (!(error instanceof Error) || !('code' in error) || error.code !== 'SQLITE_BUSY') throw error;
              }
            }
            return snapshot.file(path);
          },
        };
      },
    };
    const side = (commit: string, whole: boolean, paths: readonly string[]): Side => {
      const side: Side = {
        commit,
        whole,
        paths,
        facts: null,
        read: async (path) => {
          const tree = index.snapshot(side).tree;
          return tree.has(path) ? tree.read(path) : null;
        },
      };
      return side;
    };
    const params = { source, exclude: [] };
    vendorIndex(root, base, params, competing)(side(base, true, []));
    put('packages/adapter-orbit/src/adapter.ts', "export const ORBIT_PROVIDER = 'orbit'; export const FUTURE_PROVIDER = 'future-cloud';");
    git('add', '.');
    const tree = git('write-tree');
    const changed = ['packages/adapter-orbit/src/adapter.ts'];
    const read = vendorIndex(root, tree, params, indexes(root, tree));
    read(side(base, false, changed));
    const found = read(side(tree, false, changed));
    expect(found.findings.map((one) => one.fingerprint)).toEqual([`vendor:future-cloud:${target}`]);
  } finally {
    other?.close();
    main?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
