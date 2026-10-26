import { afterAll, expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Schema } from 'effect';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { heldHost } from '../../posix/testing/holder';
import { hostPolicy, hostShare, hostWireLimits, registrationOf, stateDirectories } from '../../hostFixture';

const directories = stateDirectories('refused-claim-');
let child: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | undefined;
afterAll(async () => {
  if (child !== undefined) {
    if (child.exitCode === null) child.kill('SIGKILL');
    await child.exited;
  }
  directories.clear();
});

it('releases the real writer claim when startup refuses its native artifact', async () => {
  const directory = directories.open();
  const policy = hostPolicy({ transports: ['pipes'] });
  const boot = join(directory, 'boot.json');
  writeFileSync(
    boot,
    Schema.encodeSync(Schema.fromJsonString(HostBoot))({
      state: directory,
      registration: registrationOf(directory),
      library: join(directory, 'missing.dylib'),
      policy,
      share: hostShare(policy),
      limits: hostWireLimits(policy, 1, { envelopeBytes: 16_384, connections: 2, requests: 4 }),
      lifetime: 'with-parent',
    }),
    { mode: 0o600 },
  );
  child = Bun.spawn(heldHost(resolve(import.meta.dir, '../../main.ts'), boot), { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const [code] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).not.toBe(0);
  const claim = Bun.spawn(
    [
      '/usr/bin/perl',
      '-e',
      'open(my $f,"+>>",$ARGV[0]) or die "open claim"; flock($f,6) or exit 2; print "free";',
      join(directory, 'writer.lock'),
    ],
    {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [claimed, output, errors] = await Promise.all([claim.exited, new Response(claim.stdout).text(), new Response(claim.stderr).text()]);
  expect({ code: claimed, output, errors }).toEqual({ code: 0, output: 'free', errors: '' });
});
