import { Context, type Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ManagedWriteInput } from '../../../settings/contract/service/managed.js';
import type { SettingLandRefusal } from '../../../settings/contract/service/values.js';
import type { InstalledCatalog } from '../wire/tags/declaration.js';
import type { CatalogFinding } from '../wire/tags/findings.js';
import type { TagTable } from '../wire/tags/table.js';
import type { BlockRow } from './acts.js';
import type { ActState } from './transaction.js';

export class Tags extends Context.Service<
  Tags,
  {
    of(projectId: number): Effect.Effect<TagTable, StoreFailure>;
    reader(projectId: number): Effect.Effect<() => TagTable, StoreFailure>;
    forget(projectId?: number): Effect.Effect<void>;
    publish(unit: Context.Service.Shape<typeof ActState>): Effect.Effect<void>;
  }
>()('tagma/graph/Tags') {}

export class InstalledCatalogs extends Context.Service<
  InstalledCatalogs,
  {
    read(
      projectId: number,
    ): Effect.Effect<
      InstalledCatalog[],
      StoreFailure | GateRefusal<'field-invalid' | 'field-target' | 'not-found' | 'deleted' | 'bad-name' | 'ambiguous-name'>
    >;
    findings(projectId: number): Effect.Effect<readonly CatalogFinding[], StoreFailure>;
    assertMembersStand(
      db: StoreDb<'graph'>,
      projectId: number,
      falling: readonly Pick<BlockRow, 'id' | 'uuid' | 'tags'>[],
    ): Effect.Effect<void, StoreFailure | GateRefusal<'catalog-member'>>;
    assertCatalog(
      db: StoreDb<'graph'>,
      node: Pick<BlockRow, 'id' | 'uuid' | 'projectId' | 'tags' | 'fields'>,
    ): Effect.Effect<void, StoreFailure | GateRefusal<'field-invalid'>>;
  }
>()('tagma/graph/InstalledCatalogs') {}

export class CatalogInstall extends Context.Service<
  CatalogInstall,
  {
    write(input: ManagedWriteInput<readonly string[]>): Effect.Effect<void, StoreFailure | GateRefusal<SettingLandRefusal>>;
  }
>()('tagma/graph/CatalogInstall') {}
