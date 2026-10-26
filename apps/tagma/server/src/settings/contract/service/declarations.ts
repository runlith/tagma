import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { SettingContribution, SettingDeclarationsAnswer } from '../wire/declarations.js';

export class DeclaredSettings extends Context.Service<DeclaredSettings, SettingContribution>()('tagma/settings/DeclaredSettings') {}

export class SettingDeclarations extends Context.Service<
  SettingDeclarations,
  {
    read(projectId?: number): Effect.Effect<SettingDeclarationsAnswer, StoreFailure>;
  }
>()('tagma/settings/SettingDeclarations') {}
