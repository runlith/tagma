import { existsSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
if (directory === undefined) throw new Error('missing churn hook directory');
const release = join(directory, 'release');
const watcher = watch(directory, () => {
  if (existsSync(release)) watcher.close();
});
writeFileSync(join(directory, 'entered'), 'entered\n');
if (existsSync(release)) watcher.close();
