import { servingContracts } from './serving';
import { hosted } from './host';
import { posix } from './posix';

servingContracts(
  hosted('POSIX', posix(), { usage: { periodMs: 100 } }),
  new Set([
    'machine-load',
    'machine-load-parts',
    'machine-load-gpu',
    'machine-load-roles',
    'end-residual',
    'end-process',
    'named-signals',
    'pipe-graceful-stop',
    'pace-raise',
    'terminal-survives-holder',
    'pipe-survives-holder',
    'holder-replaces-itself',
    'terminal-foreground',
    'screen-point',
    'screen-settled',
  ]),
);
