import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { restartContracts } from './restart';
import { hosted } from './host';
import { posix } from './posix';

restartContracts(hosted('POSIX', posix(), { executions: 3 }), (directory, execution, what) => {
  const database = new Database(join(directory, 'executions.sqlite'));
  database.run('PRAGMA busy_timeout = 2000');
  if (what === 'start') database.run('DELETE FROM operation WHERE execution_id = ?', [execution]);
  else
    database.run(
      `CREATE TRIGGER departure_unwritable BEFORE INSERT ON execution_departure WHEN NEW.execution_id = '${execution}' AND NEW.lost IS NULL BEGIN SELECT RAISE(ABORT, 'the departure of this execution cannot be written'); END`,
    );
  database.close();
});
