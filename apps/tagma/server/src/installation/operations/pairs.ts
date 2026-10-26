import { vacuumDatabase } from './vacuum.js';
import { restartServer } from './restart.js';
import { readMachineState } from './machine.js';
import { installNext, stopInstalling } from './next.js';
import { prepareDowngrade } from './downgrade.js';
import { reportRestartWindow } from './window.js';
import { placeCommand } from './command.js';

export const INSTALLATION_PAIRS = {
  vacuum_database: vacuumDatabase,
  restart_server: restartServer,
  read_machine_state: readMachineState,
  report_restart_window: reportRestartWindow,
  install_next: installNext,
  stop_installing: stopInstalling,
  prepare_downgrade: prepareDowngrade,
  place_command: placeCommand,
};
