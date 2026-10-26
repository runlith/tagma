import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [pristine, output] = process.argv.slice(2);
if (pristine === undefined || output === undefined) throw new Error('expected pristine package and output patch');
const scratch = mkdtempSync(join(tmpdir(), 'node-file-position-'));
try {
  cpSync(pristine, join(scratch, 'old'), { recursive: true });
  cpSync(pristine, join(scratch, 'new'), { recursive: true });
  for (const file of ['src/NodeFileSystem.ts', 'dist/NodeFileSystem.js']) {
    const target = join(scratch, 'new', file);
    const text = readFileSync(target, 'utf8');
    const anchor = 'this.fd, buffer, undefined, undefined, nodePosition';
    if (text.split(anchor).length !== 3) throw new Error(`${file}: expected write and writeAll positional calls`);
    writeFileSync(target, text.replaceAll(anchor, 'this.fd, buffer, 0, buffer.byteLength, nodePosition'));
  }
  const diff = spawnSync('git', ['diff', '--no-index', '--', 'old', 'new'], { cwd: scratch, encoding: 'utf8' });
  if (diff.status !== 1) throw new Error(`git diff exited ${diff.status}: ${diff.stderr}`);
  writeFileSync(output, diff.stdout.replaceAll('a/old/', 'a/').replaceAll('b/new/', 'b/'));
} finally {
  rmSync(scratch, { recursive: true });
}
