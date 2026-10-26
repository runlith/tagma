import { defineInspection } from '@runlith/tagma/rules';
import type { MigrationsParams, StepPlacesParams } from './migrations';
import type { EffectStyleParams } from './effect-style/declaration';
import type { EnvironmentParams } from './environment/declaration';
import type { UiTokensParams } from './ui-tokens/declaration';

const program = 'checks/law/programs.ts';

export const effectStyle = defineInspection<EffectStyleParams>({ program, name: 'effect-style', concern: 'code' });

export const uiTokens = defineInspection<UiTokensParams>({ program, name: 'ui-tokens', concern: 'code' });

export const environment = defineInspection<EnvironmentParams>({ program, name: 'environment', concern: 'code' });

export const migrations = defineInspection<MigrationsParams>({ program, name: 'migrations', concern: 'code' });

export const stepPlaces = defineInspection<StepPlacesParams>({ program, name: 'step-places', concern: 'code' });
