import { scopeContracts } from './scope';
import { hosted } from './host';
import { posix } from './posix';

scopeContracts(hosted('POSIX', posix()));
