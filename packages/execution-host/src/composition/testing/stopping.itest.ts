import { stopContracts } from './stopping';
import { hosted } from './host';
import { posix } from './posix';

stopContracts(hosted('POSIX', posix()));
