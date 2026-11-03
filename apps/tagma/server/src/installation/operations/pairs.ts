import { vacuumDatabase } from './vacuum.js';
import { checkSuccessor, restartServer } from './restart.js';
import { readMachineState } from './machine.js';
import { checkForUpdates, installNext, stopInstalling } from './next.js';
import { prepareDowngrade } from './downgrade.js';
import { reportRestartWindow } from './window.js';
import { placeCommand } from './command.js';

export const INSTALLATION_PAIRS = {
  vacuum_database: vacuumDatabase,
  restart_server: restartServer,
  check_successor: checkSuccessor,
  read_machine_state: readMachineState,
  check_for_updates: checkForUpdates,
  report_restart_window: reportRestartWindow,
  install_next: installNext,
  stop_installing: stopInstalling,
  prepare_downgrade: prepareDowngrade,
  place_command: placeCommand,
};
