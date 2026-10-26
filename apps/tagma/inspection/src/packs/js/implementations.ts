import type { ImplementationsOf } from '../../core/node/reading';
import { loads } from './loads/implementation';
import type { js } from './manifest';
import { platforms } from './platforms/implementation';
import { reexports } from './reexports/implementation';

export const implementations: ImplementationsOf<typeof js> = { loads, reexports, platforms };
