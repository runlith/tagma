import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputProfile } from '@runlith/executions/protocol/inputProfile';
import { offsetValue } from '@runlith/executions/protocol/record';
import type { PrepareAnswer } from '@runlith/executions/protocol/runtime';
import { PIPES, PTY } from '../../holder/testing/Adapter';
import { spawned } from '../../hostFixture';
import { bundledStand, type Stand } from './bundled';
import { driving, perl, run, until } from './standDriver';

let directory: string;

const COUNTER = perl(
  'use IO::Select; STDERR->autoflush(1); binmode STDIN; open(my $got, ">", "got.bin") or die; binmode $got; $got->autoflush(1); ' +
    'my $in = IO::Select->new(\\*STDIN); my $open = 1; my $n = 0; ' +
    'while (1) { print STDOUT "o$n\\n"; print STDERR "e$n\\n"; $n++; select(undef, undef, undef, 0.004); ' +
    'while ($open && -e "go-read" && $in->can_read(0)) { my $r = sysread(STDIN, my $b, 65536); if ($r) { print $got $b } else { $open = 0; close $got; open(my $f, ">", "got.end"); close $f; exit 7 } } }',
);

const SCREEN = perl(
  'use IO::Select; system("/bin/stty", "raw", "-echo") == 0 or die; print "MAIN\\e[?1049h\\e[2J\\e[HREADY\\e[2;6r\\e[?6h\\e[?2004h\\e[>1u\\e[>5u"; ' +
    'while (sysread(STDIN, my $b, 1)) { ' +
    'if ($b eq "p") { print "\\e[1;1HP" } elsif ($b eq "s") { print "\\e[5;1H\\nS" } elsif ($b eq "k") { print "\\e[<u" } elsif ($b eq "n") { print "\\e[?1049l" } ' +
    'elsif ($b eq "d") { print "\\e[6n"; select(undef, undef, undef, 0.02) until -e "go-dsr"; my $all = ""; ' +
    'until ($all =~ s/\\x01$//) { sysread(STDIN, my $c, 65536) or die "input ended before marker"; $all .= $c } open(my $f, ">", "dsr.next") or die; binmode $f; print $f $all; close $f or die; rename("dsr.next", "dsr.bin") or die; print "D" } }',
);

const PIPE_BUFFER = 64 * 1024;
const GAP = perl('while (-S "host.sock") { select(undef, undef, undef, 0.005) } exit 9');

let stand: Stand;
const facts: Record<string, unknown> = {};

const profileOf = (input: InputProfile) => (input._tag === 'Available' ? input : undefined);

const parentOf = async (pid: number) => Number((await spawned(['/bin/ps', '-o', 'ppid=', '-p', String(pid)])).stdout.trim());

const contiguous = (bytes: Buffer, mark: string) => {
  const values = bytes
    .toString()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => Number(line.slice(mark.length)));
  return { count: values.length, broken: values.findIndex((value, index) => value !== index) };
};

beforeAll(async () => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'logic-swap-')));
  stand = await bundledStand(directory, 3);
  const drive = driving(stand);
  const screen = async (ref: ExecutionRef) => {
    const answer = await run(stand.client.screen(ref));
    if (answer._tag !== 'ScreenTextFrame') throw new Error(`no screen: ${answer._tag}`);
    return answer;
  };
  const changed = async () => {
    const prepared = await stand.change();
    drive.forgetLanes();
    return prepared;
  };

  const counter = await drive.start(PIPES, COUNTER);
  await until('the counter created its input record', async () => (existsSync(join(directory, 'got.bin')) ? true : undefined));
  const painted = await drive.start(PTY, SCREEN);
  const gap = await drive.start(PIPES, GAP);
  await drive.showing(painted.ref, 'READY');
  await drive.typed(painted.ref, 'd');
  await until('the DSR reply', async () => {
    const accepted = (await run(stand.client.state(painted.ref)))?.input?.acceptedThrough;
    return accepted !== undefined && offsetValue(accepted) > 1n ? true : undefined;
  });
  const typedAhead = Buffer.alloc(96 * 1024, 'x');
  await drive.typed(painted.ref, Buffer.concat([typedAhead, Buffer.from([1])]));
  const sent = Buffer.from(Array.from({ length: 3072 }, (_, line) => `${String(line).padStart(31, '0')}\n`).join(''));
  await drive.typed(counter.ref, sent);
  await drive.acted(counter.ref, { _tag: 'End' }, 'end');
  facts.beforeCounters = {
    stdout: contiguous(await drive.recorded(counter.ref, 'stdout'), 'o').count,
    stderr: contiguous(await drive.recorded(counter.ref, 'stderr'), 'e').count,
  };
  facts.pendingBefore = [
    sent.length - readFileSync(join(directory, 'got.bin')).length - PIPE_BUFFER,
    (await run(stand.client.state(painted.ref)))?.input?.pendingBytes ?? 0,
  ];
  const generation = await run(stand.client.generation());

  await stand.offer({ build: 'logic-b' });
  facts.firstPrepared = await changed();
  await stand.offer({ build: 'holder-c', holder: 'distinct' });
  facts.secondPrepared = await changed();
  facts.prior = existsSync(join(directory, 'bundle.prior'));

  const kept = [counter, painted];
  facts.generation = { before: generation, after: await run(stand.client.generation()) };
  facts.pids = {
    before: kept.map((one) => one.pid),
    after: await Promise.all(kept.map((one) => drive.pidOf(one.ref))),
    parents: await Promise.all(kept.map((one) => parentOf(one.pid))),
  };
  facts.gapExit = await drive.exitOf(gap.ref);
  writeFileSync(join(directory, 'go-read'), '');
  facts.laterExit = await drive.exitOf(counter.ref);

  writeFileSync(join(directory, 'go-dsr'), '');
  facts.dsr = await until('the typed-ahead input', async () =>
    existsSync(join(directory, 'dsr.bin')) ? readFileSync(join(directory, 'dsr.bin')) : undefined,
  );
  facts.typedAhead = typedAhead;
  await drive.typed(painted.ref, 'p');
  const origin = await until('the origin write', async () => {
    const frame = await screen(painted.ref);
    return frame.rows[1]?.text.startsWith('P') ? frame : undefined;
  });
  await drive.typed(painted.ref, 's');
  const scrolled = await until('the margin scroll', async () => {
    const frame = await screen(painted.ref);
    return frame.rows[5]?.text.startsWith('S') ? frame : undefined;
  });
  const pushed = profileOf(scrolled.input);
  await drive.typed(painted.ref, 'k');
  const popped = await until('the kitty pop', async () => {
    const flags = profileOf((await screen(painted.ref)).input)?.kittyKeyboardFlags;
    return flags !== undefined && flags !== pushed?.kittyKeyboardFlags ? flags : undefined;
  });
  await drive.typed(painted.ref, 'n');
  const normal = await until('the normal buffer', async () => {
    const frame = await screen(painted.ref);
    return frame.buffer === 'normal' ? frame : undefined;
  });
  facts.screen = {
    origin: origin.rows.slice(0, 2).map((row) => row.text.trimEnd()),
    scrolled: scrolled.rows.slice(0, 6).map((row) => row.text.trimEnd()),
    pushed: pushed?.kittyKeyboardFlags,
    paste: pushed?.bracketedPaste,
    popped,
    normal: normal.rows[0]?.text.trimEnd(),
  };

  facts.input = await until('the counter input', async () =>
    existsSync(join(directory, 'got.end')) ? readFileSync(join(directory, 'got.bin')) : undefined,
  );
  facts.sent = sent;
  facts.counters = {
    stdout: contiguous(await drive.recorded(counter.ref, 'stdout'), 'o'),
    stderr: contiguous(await drive.recorded(counter.ref, 'stderr'), 'e'),
  };
});

afterAll(async () => {
  await stand?.dispose();
});

describe('a host whose logic changes twice, the second time with its holder', () => {
  it('prepares the next bundle at the holder, withdraws host.sock while it yields and rotates the standing bundle aside', () => {
    expect((facts.firstPrepared as PrepareAnswer)._tag).toBe('Prepared');
    expect((facts.secondPrepared as PrepareAnswer)._tag).toBe('Prepared');
    expect(facts.prior).toBe(true);
    expect(stand.output()).not.toContain('did not take over');
    expect(stand.resumes()).toHaveLength(2);
    expect(stand.resumes()).not.toContain('Resumed');
    expect(stand.custodyFound()).toEqual(['free', 'free', 'free']);
    expect(stand.endpointsFound()).toEqual(['absent', 'absent', 'absent']);
  });

  it('keeps the generation, the holder and every child with its pid under that holder', () => {
    const generation = facts.generation as { before: number; after: number };
    expect(generation.after).toBe(generation.before);
    const pids = facts.pids as { before: number[]; after: number[]; parents: number[] };
    expect(pids.after).toEqual(pids.before);
    expect(pids.parents).toEqual(pids.before.map(() => stand.holderPid));
  });

  it('writes the input the writer had not written whole and once, with the end of input behind it', () => {
    expect((facts.pendingBefore as number[]).map((pending) => pending > 0)).toEqual([true, true]);
    expect(Buffer.compare(facts.input as Buffer, facts.sent as Buffer)).toBe(0);
  });

  it('loses and repeats no line of a counter on stdout and stderr', () => {
    const counters = facts.counters as Record<string, { count: number; broken: number }>;
    expect(counters.stdout!.broken).toBe(-1);
    expect(counters.stderr!.broken).toBe(-1);
    const before = facts.beforeCounters as Record<string, number>;
    expect(counters.stdout!.count).toBeGreaterThan(before.stdout!);
    expect(counters.stderr!.count).toBeGreaterThan(before.stderr!);
  });

  it('answers a query asked before the change exactly once, ahead of the input typed after it', () => {
    const read = (facts.dsr as Buffer).toString('latin1');
    expect(read.match(/\x1b\[\d+;\d+R/g)?.length).toBe(1);
    expect(read.replace(/\x1b\[\d+;\d+R/, '')).toBe((facts.typedAhead as Buffer).toString('latin1'));
  });

  it('continues the screen with its margins, origin mode, bracketed paste, kitty stack and normal buffer', () => {
    const painted = facts.screen as Record<string, unknown>;
    expect(painted.origin).toEqual(['READY', 'P']);
    expect(painted.scrolled).toEqual(['READY', '', '', '', '', 'S']);
    expect(painted.paste).toBe(true);
    expect(painted.pushed).toBe(5);
    expect(painted.popped).toBe(1);
    expect(painted.normal).toBe('MAIN');
  });

  it('gives the codes of a child that left in the gap and of one that left after the change', () => {
    expect(facts.gapExit).toEqual({ _tag: 'Code', code: 9 });
    expect(facts.laterExit).toEqual({ _tag: 'Code', code: 7 });
  });
});
