import { isAbsolute } from 'node:path';
import { isGitUrl } from '@runlith/git/clone';
import { page, pageRows, pastKey, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { cursorRefusal, GateRefusal } from '../platform/contract/wire/refusal.js';
import { type PluginPrepared, Plugins } from '../plugins/contract/service/plugins.js';
import { npmSourceOf } from '../plugins/contract/wire/rows.js';
import { installedFrom } from '../plugins/contract/wire/settings.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { Marketplaces } from './contract/service/marketplaces.js';
import { MARKETPLACE_ENTRIES, MARKETPLACE_OPERATIONS as OPS } from './contract/wire/operations.js';
import type { EntryRow } from './contract/wire/rows.js';

const CEILING = ceilingOf(MARKETPLACE_ENTRIES);

const keyOf = (row: EntryRow) => [row.marketplace, row.name] as const;

const projectId = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

const marketplace = <A extends object>(row: A) => ({ status: 'ok' as const, marketplace: row });

export const MARKETPLACE_PAIRS = {
  read_marketplaces: pair(
    OPS.read_marketplaces,
    body(OPS.read_marketplaces, {
      execute: Effect.fnUntraced(function* (input) {
        const marketplaces = yield* Marketplaces;
        const narrowed = input.marketplace;
        const rows = (yield* marketplaces.rows()).filter((row) => narrowed === undefined || row.id === narrowed);
        if (narrowed !== undefined && rows.length === 0) {
          return yield* new GateRefusal('marketplace-unknown', `No marketplace ${narrowed} is added on this machine.`, [
            'read_marketplaces without a marketplace names every one added',
          ]);
        }
        const question = { operation: 'read_marketplaces', selection: { marketplace: narrowed ?? null }, order: MARKETPLACE_ENTRIES.order };
        const read = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const entries = yield* marketplaces.entries(narrowed ?? null);
        const after = read === null ? entries : pastKey(entries, keyOf, ['asc', 'asc'], read.at);
        const shown = page({
          rows: after,
          asked: pageRows(input.limit, MARKETPLACE_ENTRIES, CEILING),
          keyOf,
          question,
          total: entries.length,
        });
        return {
          status: 'ok' as const,
          marketplaces: rows,
          entries: shown.rows,
          shown: shown.shown,
          total: entries.length,
          next: shown.next,
        };
      }),
    }),
  ),
  refresh_marketplace: pair(
    OPS.refresh_marketplace,
    body(OPS.refresh_marketplace, {
      execute: Effect.fnUntraced(function* (input) {
        return marketplace(yield* (yield* Marketplaces).refresh(input.id));
      }),
    }),
  ),
  add_marketplace: pair(
    OPS.add_marketplace,
    body(OPS.add_marketplace, {
      execute: Effect.fnUntraced(function* (input) {
        if (!isGitUrl(input.source) && !isAbsolute(input.source)) {
          return yield* new GateRefusal('field-invalid', `${input.source} is neither a git URL nor an absolute folder path.`, [
            'name the marketplace by its git URL or by the absolute path of its folder',
          ]);
        }
        const source = isGitUrl(input.source)
          ? { kind: 'git' as const, url: input.source }
          : { kind: 'folder' as const, path: input.source };
        return marketplace(yield* (yield* Marketplaces).add(source));
      }),
    }),
  ),
  inspect_source: pair(
    OPS.inspect_source,
    body(OPS.inspect_source, {
      execute: Effect.fnUntraced(function* (input) {
        if (npmSourceOf(input.source) !== null) {
          const prepared = yield* (yield* Plugins).prepare({ projectId: yield* projectId, source: input.source });
          return { status: 'ok' as const, found: { kind: 'plugin' as const, preview: prepared.preview } };
        }
        if (!isGitUrl(input.source) && !isAbsolute(input.source)) {
          return yield* new GateRefusal('field-invalid', `${input.source} is not a git URL, an absolute folder path or an npm package.`, [
            'name it by its git URL, the absolute path of its folder, or npm:<package>',
          ]);
        }
        const source = isGitUrl(input.source)
          ? { kind: 'git' as const, url: input.source }
          : { kind: 'folder' as const, path: input.source };
        const list = yield* (yield* Marketplaces).look(source);
        if (list !== null) {
          const found = { kind: 'marketplace' as const, name: list.name, title: list.title, description: list.description };
          return { status: 'ok' as const, found: { ...found, entries: list.entries.length + list.faults.length } };
        }
        const prepared = yield* (yield* Plugins).prepare({ projectId: yield* projectId, source: input.source });
        return { status: 'ok' as const, found: { kind: 'plugin' as const, preview: prepared.preview } };
      }),
    }),
  ),
  remove_marketplace: pair(
    OPS.remove_marketplace,
    body(OPS.remove_marketplace, {
      execute: Effect.fnUntraced(function* (input) {
        return marketplace(yield* (yield* Marketplaces).remove(input.id));
      }),
    }),
  ),
  preview_plugin: pair(
    OPS.preview_plugin,
    body(OPS.preview_plugin, {
      execute: Effect.fnUntraced(function* (input) {
        const plugins = yield* Plugins;
        const project = yield* projectId;
        return yield* (yield* Marketplaces).entry(input.marketplace, input.entry, ({ entry, resolved }) =>
          Effect.map(plugins.prepare({ projectId: project, source: resolved }), (prepared) => ({
            status: 'ok' as const,
            entry,
            preview: prepared.preview,
          })),
        );
      }),
    }),
  ),
  update_plugin: pair(
    OPS.update_plugin,
    body<typeof OPS.update_plugin, PluginPrepared, Plugins | Marketplaces | CurrentProject>(OPS.update_plugin, {
      prepare: Effect.fnUntraced(function* (input) {
        const plugins = yield* Plugins;
        const marketplaces = yield* Marketplaces;
        const install = (yield* plugins.installs()).find((standing) => standing.id === input.id);
        if (install === undefined) {
          return yield* new GateRefusal('plugin-not-installed', `The plugin ${input.id} is not installed on this machine.`, [
            'read_plugins names what is installed',
          ]);
        }
        const origin = install.origin;
        if (origin === undefined) {
          return yield* new GateRefusal(
            'plugin-without-marketplace',
            `${input.id} was installed from ${installedFrom(install)}, not from a marketplace entry, so no list says what to update it to.`,
            ['install_plugin from its source again to update it'],
          );
        }
        if (!(yield* marketplaces.rows()).some((row) => row.id === origin.marketplace)) {
          return yield* new GateRefusal(
            'marketplace-gone',
            `${input.id} came from the marketplace ${origin.marketplace}, which is no longer added, so it no longer updates.`,
            [`add_marketplace ${origin.marketplace} again, then update`],
          );
        }
        const project = yield* projectId;
        return yield* marketplaces.entry(origin.marketplace, origin.entry, ({ resolved }) =>
          plugins.prepare({ projectId: project, source: resolved }),
        );
      }),
      execute: Effect.fnUntraced(function* (_input, prepared) {
        return { status: 'ok' as const, plugin: yield* (yield* Plugins).update({ projectId: yield* projectId, prepared }) };
      }),
    }),
  ),
};
