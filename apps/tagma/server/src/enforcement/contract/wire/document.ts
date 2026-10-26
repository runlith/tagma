import { type Assembled, assembled, type Inspection, mapProblem, takesMap } from '@tagma/inspection/builtins';
import type { ModuleMap } from '@tagma/inspection/rule';
import {
  CONFIG_FILE,
  type Config,
  type Descriptor,
  type LinterInspection,
  type ProgramInspection,
} from '../../../config/contract/wire/config.js';
import type { Debt, LawEnforcement, Strictness, Trigger } from '../../../graph/contract/wire/enforcement.js';
import type { Unblock } from '../../../platform/contract/wire/refusal.js';

export type Programmed = { readonly key: string; readonly program: ProgramInspection | LinterInspection };

export type Unrun = { readonly unrun: string; readonly undeclared?: true; readonly cause?: 'module-map' };

export const MAP_RECOVERY: Unblock = ['set_module with the module cards corrected so their map holds together'];

export const unrunReason = (key: string, check: Unrun): string =>
  check.cause === 'module-map' ? check.unrun : `the inspection ${key} cannot run: ${check.unrun}`;

export type Check = Assembled | Programmed | Unrun;

export const isProgrammed = (check: Check): check is Programmed => 'program' in check && 'key' in check;

export const isUnrun = (check: Check): check is Unrun => 'unrun' in check;

export const isLinter = (program: Programmed['program']): program is LinterInspection => 'linter' in program;

export type MapReading = { readonly map: ModuleMap; readonly problems: readonly string[] };

const EMPTY: ModuleMap = { modules: [], relations: [], region: [] };

export const mapRefusalOf = (inspection: Inspection, reading: MapReading): string | undefined => {
  if (!takesMap(inspection)) return undefined;
  const problem = reading.problems[0] ?? mapProblem(inspection, reading.map);
  return problem === undefined ? undefined : `the module map the module cards draw does not hold together: ${problem}`;
};

export const storedInspection = (inspection: Assembled | Inspection): Inspection => {
  if (!('map' in inspection.params)) return inspection;
  const { map: _map, ...params } = inspection.params;
  return { builtin: inspection.builtin, params } as Inspection;
};

export type Descriptions = { readonly config: Config | null } | { readonly unread: string };

export const describedBy = (descriptions: Descriptions, key: string): Descriptor | string =>
  'unread' in descriptions
    ? `${CONFIG_FILE} of the judged version could not be read: ${descriptions.unread}`
    : descriptions.config === null
      ? `the judged version carries no ${CONFIG_FILE}, so it declares no inspection ${key}`
      : (descriptions.config.inspections.get(key) ?? `${CONFIG_FILE} of the judged version declares no inspection ${key}`);

export const checkOf = (key: string, descriptions: Descriptions, reading: MapReading | null): Check => {
  const described = describedBy(descriptions, key);
  if (typeof described === 'string') return { unrun: described, undeclared: true };
  if (!('builtin' in described)) return { key, program: described };
  if (reading === null) return assembled(described, EMPTY);
  const refused = mapRefusalOf(described, reading);
  return refused === undefined ? assembled(described, reading.map) : { unrun: refused, cause: 'module-map' };
};

export type CountedDebt = Debt & { readonly count?: number };

export type Ledger = {
  readonly debt: readonly CountedDebt[];
  readonly escaped: LawEnforcement['escaped'];
};

export type Law = Ledger & {
  readonly strictness: Strictness;
  readonly on: readonly Trigger[];
  readonly inspection: string;
  readonly check: Check;
};

export const documentOf = (strictness: Strictness, on: readonly Trigger[], key: string, ledger: Ledger): LawEnforcement => ({
  strictness,
  on,
  inspection: key,
  debt: ledger.debt,
  escaped: ledger.escaped,
});

export const readLaw = (stored: LawEnforcement, descriptions: Descriptions, reading: MapReading | null): Law => {
  const { strictness, on, inspection, debt, escaped } = stored;
  return { strictness, on, inspection, check: checkOf(inspection, descriptions, reading), debt, escaped };
};
