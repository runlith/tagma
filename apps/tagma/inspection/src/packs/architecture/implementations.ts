import type { ImplementationsOf } from '../../core/node/reading';
import type { architecture } from './manifest';
import { modules } from './modules/implementation';
import { names } from './names/implementation';
import { size } from './size/implementation';

export const implementations: ImplementationsOf<typeof architecture> = { modules, names, size };
