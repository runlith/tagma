import type { ThreadTypeRow } from '@tagma/server/threads/contract/wire/birth';
import type { HarnessName } from '@tagma/server/threads/contract/wire/harness/names';
import type { HarnessPresentation } from '@tagma/server/threads/contract/wire/harness/externalSession';

const ABSENT = 'not installed';

export type LaunchRow = {
  readonly type: string;
  readonly name: HarnessName;
  readonly presentation: HarnessPresentation;
  readonly label: string;
  readonly description: string;
  readonly version: string | null;
  readonly unreadable: string | null;
  readonly missing: string | null;
  readonly unavailable: string | null;
};

export function launchRows(types: readonly ThreadTypeRow[]): readonly LaunchRow[] {
  return types.flatMap((type) => {
    const install = type.harness;
    if (install === undefined || !install.presentation.terminal) return [];
    return [
      {
        type: type.id,
        name: install.harness,
        presentation: install.presentation,
        label: type.name,
        description: type.description,
        version: install.version,
        unreadable: install.unreadable,
        missing: install.missing,
        unavailable: install.binary === null ? ABSENT : null,
      },
    ];
  });
}

export function agentsOf(types: readonly ThreadTypeRow[]): readonly ThreadTypeRow[] {
  return types.filter((type) => type.harness === undefined);
}

export function draftedType(type: string | null, types: readonly ThreadTypeRow[] | null): string | null {
  if (type === null || types === null) return type;
  return agentsOf(types).some((row) => row.id === type) ? type : null;
}

export function launchTitle(row: LaunchRow): string {
  if (row.missing !== null) return `${row.description}\nNot found: ${row.missing}`;
  if (row.unreadable !== null) return `${row.description}\nVersion unread: ${row.unreadable}`;
  if (row.version !== null) return `${row.description}\n${row.version}`;
  return row.description;
}
