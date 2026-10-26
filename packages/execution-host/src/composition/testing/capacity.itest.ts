import { capacityContracts } from './capacity';
import { hosted } from './host';
import { posix } from './posix';

capacityContracts(hosted('POSIX', posix(), { executions: 24, nofile: 36 }));
