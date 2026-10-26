import type { Pack } from '../../core/rule';
import { modules } from './modules/declaration';
import { names } from './names/declaration';
import { size } from './size/declaration';

export const architecture = {
  id: 'architecture',
  uses: {},
  rules: [modules, names, size],
} as const satisfies Pack;
