import type { Pack } from '../../core/rule';
import { loads } from './loads/declaration';
import { platforms } from './platforms/declaration';
import { reexports } from './reexports/declaration';

export const js = {
  id: 'js',
  uses: { languages: ['js'] },
  rules: [loads, reexports, platforms],
} as const satisfies Pack;
