import { presentationContracts } from './presentation';
import { hosted } from './host';
import { posix } from './posix';

presentationContracts(hosted('POSIX', posix()));
