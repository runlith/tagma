import { holderLossContracts } from './survival';
import { hosted } from './host';
import { posix } from './posix';

holderLossContracts(hosted('POSIX', posix(), { lifetime: 'detached' }));
