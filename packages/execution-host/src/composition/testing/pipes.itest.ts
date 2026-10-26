import { pipeContracts } from '../../holder/testing/pipes';
import { heldPosix } from './posix';

pipeContracts('POSIX', heldPosix());
