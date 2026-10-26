import { launchTempoContracts } from '../../holder/testing/tempo';
import { heldPosix } from './posix';

launchTempoContracts('POSIX', heldPosix(true));
