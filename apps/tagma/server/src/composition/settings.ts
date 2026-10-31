import { Effect } from 'effect';
import type { Manifest, SettingControlSource } from '../platform/contract/service/manifest.js';
import type { SettingControlReader } from '../platform/contract/wire/setting.js';
import type { SettingContribution } from '../settings/contract/wire/declarations.js';
import { graphCatalogs } from '../catalogs/contract/wire/settings.js';
import { catalogs } from '../catalogs/install.js';
import type { Assembly } from './manifest.js';
import type { CORE_MODULES } from './core.js';

export const SHIPPED_CATALOGS = catalogs(graphCatalogs);

const byOrder = (left: { readonly order: number }, right: { readonly order: number }): number => left.order - right.order;

export const settingDeclarations = (
  settings: Assembly['settings'],
  controls?: ReadonlyMap<string, SettingControlReader>,
): SettingContribution => ({
  sections: [...settings.sections].sort(byOrder),
  keys: [...settings.keys].sort(byOrder),
  controls,
});

export type ControlServices<M> = M extends { readonly settingControls: readonly SettingControlSource<infer R>[] } ? R : never;

export type SettingControlNeeds = ControlServices<(typeof CORE_MODULES)[number]>;

export const declaredSettings = ({ modules, settings }: Assembly) =>
  Effect.map(Effect.context<SettingControlNeeds>(), (context) =>
    settingDeclarations(
      settings,
      new Map(
        modules.flatMap((module: Manifest) =>
          (module.settingControls ?? []).map((source) => [source.id, () => source.read(context)] as const),
        ),
      ),
    ),
  );
