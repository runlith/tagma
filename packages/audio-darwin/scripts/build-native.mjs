import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const native = join(root, 'native');
if (process.platform !== 'darwin') throw new Error('The audio helper is built on macOS');
const archAt = process.argv.indexOf('--arch');
const arch = archAt < 0 ? undefined : process.argv[archAt + 1];
const machine = arch === undefined ? undefined : { arm64: 'arm64', x64: 'x86_64' }[arch];
if (archAt >= 0 && machine === undefined) throw new Error(`The audio helper is built for arm64 or x64, not ${arch}`);
const run = (args, capture = false) => {
  const result = spawnSync('swift', args, { cwd: native, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? `swift exited ${result.status}`);
  return result.stdout?.trim();
};
const release = ['build', '-c', 'release', '-j', '3', '-Xlinker', '-S', ...(machine === undefined ? [] : ['--arch', machine])];
run(release);
const built = run([...release, '--show-bin-path'], true);
const out = arch === undefined ? join(root, 'bin') : join(root, 'bin', `darwin-${arch}`);
mkdirSync(out, { recursive: true });
copyFileSync(join(built, 'audio-helper'), join(out, 'audio-helper'));
chmodSync(join(out, 'audio-helper'), 0o755);
