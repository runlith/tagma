import type { Git } from '@runlith/git/Git';
import type { WriterRegister } from '../../../platform/contract/service/writers.js';
import type { ProjectIdentification, Projects } from '../../../projects/contract/service/registry.js';
import type { ProjectChanges } from '../../../projects/contract/service/changes.js';
import type { Settings } from '../../../settings/contract/service/values.js';
import type { ManagedWrite } from '../../../settings/contract/service/managed.js';
import type { DeclaredSettings, SettingDeclarations } from '../../../settings/contract/service/declarations.js';
import type { SettingChanges } from '../../../settings/contract/service/changes.js';
import type { BlockRows } from '../../acts/rows.js';
import type { BatchFiles } from '../../work/batchFiles.js';
import type { Act, BlockAnswers, BlockNames, BlockProjection, BlockReferences } from './acts.js';
import type { Blocks, Edges, Trash } from './blocks.js';
import type { Amendments, Batch, Reflections, Review, Supersession, Tasks } from './work.js';
import type { Digest, Orientation, SessionNames, Touches } from './orientation.js';
import type { Sources } from './sources.js';
import type { GraphFeed, GraphJournal } from './journal.js';
import type { BlockReads, History, Ranking, Selection } from './reads.js';
import type { InstalledCatalogs, Tags } from './vocabulary.js';
import type { Catalogs } from '../wire/catalogs.js';
import type { Behaviours } from './behaviours.js';
import type { GraphScopes, ProjectLifecycle, ProjectPolicy } from './serving.js';
import type { GraphSource, SourceProject } from './source.js';

export type GraphServices =
  | Git
  | WriterRegister
  | Tags
  | InstalledCatalogs
  | Catalogs
  | Behaviours
  | ManagedWrite
  | Settings
  | DeclaredSettings
  | SettingDeclarations
  | SettingChanges
  | Act
  | BlockNames
  | BlockAnswers
  | BlockProjection
  | BlockReferences
  | BlockRows
  | Projects
  | ProjectIdentification
  | ProjectChanges
  | GraphScopes
  | ProjectPolicy
  | ProjectLifecycle
  | Selection
  | Edges
  | Trash
  | Touches
  | SessionNames
  | GraphJournal
  | Ranking
  | Sources
  | Blocks
  | History
  | Tasks
  | Supersession
  | Amendments
  | GraphFeed
  | Review
  | Reflections
  | GraphSource
  | SourceProject
  | Batch
  | BatchFiles
  | BlockReads
  | Orientation
  | Digest;
