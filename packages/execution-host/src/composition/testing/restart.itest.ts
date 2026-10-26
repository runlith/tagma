import { Database } from 'bun:sqlite';
import { Effect, Schedule } from 'effect';
import { join } from 'node:path';
import { restartContracts } from './restart';
import { hosted } from './host';
import { posix } from './posix';

restartContracts(hosted('POSIX', posix(), { executions: 3 }), (directory, execution, what) =>
  Effect.try(() => {
    const database = new Database(join(directory, 'executions.sqlite'));
    try {
      if (what === 'start') database.run('DELETE FROM operation WHERE execution_id = ?', [execution]);
      else
        database.run(
          `CREATE TRIGGER departure_unwritable BEFORE INSERT ON execution_departure WHEN NEW.execution_id = '${execution}' AND NEW.lost IS NULL BEGIN SELECT RAISE(ABORT, 'the departure of this execution cannot be written'); END`,
        );
    } finally {
      database.close();
    }
  }).pipe(
    Effect.retry({
      while: (error) => error.cause instanceof Error && 'code' in error.cause && error.cause.code === 'SQLITE_BUSY',
      schedule: Schedule.spaced(10),
    }),
  ),
);
