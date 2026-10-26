import { type Raised } from '@runlith/agent/permissions';
import { Schema } from 'effect';
import { arms, type DeclaredAnswer, operation } from '../../../platform/contract/wire/operation.js';
import { vacuumSchema } from './status.js';
import { machineStateSchema } from './machine.js';
import { installAskSchema, installedSchema, installingSchema, type NextOffer } from './next.js';
import { restartAskSchema, restartSchema } from './source.js';
import { downgradeAskSchema, downgradeReadySchema } from './downgrade.js';
import { restartRecordSchema, restartWindowSchema } from './restart.js';
import { ASKS_IN_REVIEW, ASKS_NEVER, INSTALL_RUNNING, NO_WAY_BACK } from '../../../platform/contract/wire/conditions.js';

type InstallTerms = { readonly consents: readonly Raised[]; readonly offer: NextOffer | null };

const operatorOnly = { doors: { http: true }, callers: 'operator', subject: 'none', place: 'machine', waits: [], lifetimes: [] } as const;

export const INSTALLATION_OPERATIONS = {
  vacuum_database: operation('vacuum_database', {
    approval: ASKS_IN_REVIEW,
    doors: { http: true },
    tool: { capability: 'graph' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    meaning: 'Rewrite this server’s database into incremental auto-vacuum and hand the pages it freed back to the filesystem.',
    grammar:
      'The ONE full rewrite, and the operator’s call: it copies the whole file, so it is measured first and refuses `disk-short` naming the file’s weight and the room left, before anything moves. While it runs every other statement waits behind it, which on a large file is minutes. Afterwards the file follows its contents without a second rewrite. The answer carries the pages returned, the file on either side of the act, and how long the database was held.',
    input: Schema.Struct({}),
    answer: arms({ ok: { vacuum: vacuumSchema } }),
    refusals: ['disk-short', 'no-file'],
    effect: 'write',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: () => ({
      summary: 'Rewrite the whole database to give its freed pages back to the filesystem?',
      consequence:
        'It needs the file’s own size free on disk, it can take minutes on a large file, and every other statement waits behind it for all of that time.',
    }),
    confirmLabel: 'Vacuum',
    presentation: { running: 'Vacuuming the database', done: 'Vacuumed the database' },
  }),
  restart_server: operation('restart_server', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    meaning: 'Hand this server over to a successor started from the installation that stands, or from the checkout it runs from.',
    grammar:
      'The successor is started and must answer before this server leaves; if it cannot be started it refuses `no-successor`, if it starts and dies it refuses `successor-left` naming its log, and if the execution host cannot prepare the successor build it refuses `host-unprepared`; this server keeps running in every case. The execution host moves to the successor build without ending anything it runs. The answer names the build leaving and the successor.',
    input: restartAskSchema,
    answer: arms({ restarting: { restart: restartSchema } }),
    refusals: ['no-successor', 'successor-left', 'host-unprepared'],
    effect: 'external',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: () => ({
      summary: 'Restart the server onto the installation that stands?',
      consequence: 'Every connection drops while the successor comes up; terminals and commands keep running.',
    }),
    confirmLabel: 'Restart',
    presentation: { running: 'Restarting the server', done: 'Handed the server over' },
  }),
  read_machine_state: operation('read_machine_state', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    meaning:
      'Read where this machine’s Tagma stands: the server process, the installation it runs and the one waiting, the next installations its source offers and the one installing, the execution host and what it holds, and which machine acts are open.',
    grammar:
      'A read of the live process: nothing is written. Each act is answered with the command that performs it and why it is disabled when it is.',
    input: Schema.Struct({}),
    answer: arms({ read: { machine: machineStateSchema } }),
    refusals: [],
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: () => ({ summary: 'Read where this machine stands?' }),
    confirmLabel: 'Read machine state',
    presentation: { running: 'Reading the machine state', done: 'Read the machine state' },
  }),
  report_restart_window: operation('report_restart_window', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    meaning: 'Record the window this client measured until its place returned and an action was accepted.',
    grammar:
      'The client supplies its own elapsed time and the restart identity. Repeating the same report returns the same record; a stale restart or a different report by the same client refuses.',
    input: restartWindowSchema,
    answer: arms({ recorded: { restart: restartRecordSchema } }),
    refusals: ['restart-window-refused', 'restart-record-unwritable'],
    effect: 'write',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: () => ({ summary: 'Record this client’s measured restart window?' }),
    confirmLabel: 'Record window',
    presentation: { running: 'Recording the restart window', done: 'Recorded the restart window' },
  }),
  install_next: operation('install_next', {
    approval: { ...ASKS_IN_REVIEW, when: [INSTALL_RUNNING, NO_WAY_BACK] },
    ...operatorOnly,
    meaning: 'Start installing one of the next installations this machine’s source offers, optionally restarting onto it once it lands.',
    grammar:
      "`offer` names an offer read_machine_state lists under `server.next`: one of `offers`, or `back`. The installation runs in the background and the answer is it as it starts: its steps, its log and how long it usually takes. One already running is stopped first, with the operator's word, and `replaced` answers how it ended. It refuses `no-offer` when the source offers nothing by that name here, `offer-unavailable` when the offer stands but cannot be taken now, `source-unreadable` or `offline` when the source could not be read, `platform-unavailable` when the machine's platform cannot be read or the newest release has no archive for it, `install-restarting` once the running one landed and the restart onto it is asked, and `install-running` when another began after the call named the one to stop.",
    input: installAskSchema,
    answer: arms({ started: { installing: installingSchema, replaced: Schema.NullOr(installedSchema) } }),
    refusals: [
      'no-offer',
      'offer-unavailable',
      'install-running',
      'install-restarting',
      'source-unreadable',
      'offline',
      'platform-unavailable',
    ],
    effect: 'external',
    identity: { key: 'call' },
    subjects: () => [],
    raises: (_input, prepared?: InstallTerms) => prepared?.consents ?? [],
    confirmation: ({ offer, then }, prepared?: InstallTerms) => ({
      summary: `Install ${prepared?.offer?.title ?? `the next installation offered as ${offer}`}?`,
      consequence:
        [
          prepared?.offer?.irreversible === true ? 'There is no stepping back from it once it runs.' : '',
          then === 'restart' ? 'Once it lands the server restarts onto it and every connection drops.' : '',
        ]
          .filter((said) => said !== '')
          .join(' ') || undefined,
    }),
    confirmLabel: 'Install',
    presentation: { running: 'Starting the installation', done: 'Started the installation' },
  }),
  stop_installing: operation('stop_installing', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    meaning: 'Stop the next installation that is running and answer how it ended.',
    grammar:
      'It ends every process the installation started and waits for its record. It refuses `nothing-installing` when nothing runs and `install-restarting` once it landed and the restart onto it is asked.',
    input: Schema.Struct({}),
    answer: arms({ ended: { installed: installedSchema } }),
    refusals: ['nothing-installing', 'install-restarting'],
    effect: 'external',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: () => ({ summary: 'Stop the installation that is running?' }),
    confirmLabel: 'Stop',
    presentation: { running: 'Stopping the installation', done: 'Stopped the installation' },
  }),
  place_command: operation('place_command', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    meaning:
      'Put the tagma command on PATH for this user: write the launcher of the installation that stands and the line that puts it first into the shell profile.',
    grammar:
      'The same act as `tagma release path`. The answer names the launcher and where it now reaches a new shell from. It refuses `no-installation` when no installation stands to launch and `path-unwritten` when the launcher could not be written.',
    input: Schema.Struct({}),
    answer: arms({ placed: { launcher: Schema.String, said: Schema.String } }),
    refusals: ['no-installation', 'path-unwritten'],
    effect: 'write',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: () => ({ summary: 'Put the tagma command on PATH?', consequence: 'It adds one line to your shell profile.' }),
    confirmLabel: 'Install command',
    presentation: { running: 'Putting tagma on PATH', done: 'Put tagma on PATH' },
  }),
  prepare_downgrade: operation('prepare_downgrade', {
    approval: ASKS_IN_REVIEW,
    doors: { http: 'perform' },
    callers: 'operator',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    meaning:
      'Run the steps a downgrade to the previous installation needs before its binary switches: the downgrade preflight, then the console-key rollback into the snapshot copy that binary opens.',
    grammar:
      'The preflight closes the commit queue’s admission and confirms nothing waits or stays unread; otherwise it refuses `queue-undrained` and the downgrade must not switch. The rollback writes the console keys into the named snapshot copy only after the preflight passed. A step no owner has bound is answered `unbound`, a step that did not run `skipped`, each with why.',
    input: downgradeAskSchema,
    answer: arms({ ready: downgradeReadySchema.fields }),
    refusals: ['queue-undrained', 'rollback-failed'],
    effect: 'write',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: () => ({
      summary: 'Prepare this machine to step back to the previous installation?',
      consequence: 'The commit queue stops admitting new lines until the server restarts.',
    }),
    confirmLabel: 'Prepare downgrade',
    presentation: { running: 'Preparing the downgrade', done: 'Prepared the downgrade' },
  }),
};

export type InstallationOperationId = keyof typeof INSTALLATION_OPERATIONS;

export type VacuumAnswer = DeclaredAnswer<(typeof INSTALLATION_OPERATIONS)['vacuum_database']['answer']>;
