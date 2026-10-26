import { provenanceLine } from '../../platform/contract/wire/provenance.js';
import type { MachineState } from '../contract/wire/machine.js';
import type { NextOffer } from '../contract/wire/next.js';
import type { InstallationCut, Source } from '../contract/wire/source.js';
import type { BuildState, FrozenState, FrozenTargetName } from '../contract/wire/builds.js';
import type { RestartRecord, StartupState } from '../contract/wire/restart.js';

type ProcessHealth = {
  readonly version: string;
  readonly database: string;
  readonly schema: { readonly applied: number; readonly latest: string | null };
};

export type Answered = {
  readonly _tag: 'Health';
  readonly health: ProcessHealth & {
    readonly source: Source;
    readonly builds: FrozenState;
    readonly standing: InstallationCut | null;
  };
};

const databaseLines = (process: ProcessHealth): string[] => [
  `database ${process.database}`,
  `schema ${process.schema.applied} migrations applied, latest ${process.schema.latest ?? 'none'}`,
];

const agoText = (from: string | null, now: number): string => {
  if (from === null) return '';
  const seconds = Math.max(0, Math.round((now - Date.parse(from)) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
};

const shortBuild = (build: string): string => build.split(' ')[0] ?? build;

const counted = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

const offerLine = (offer: NextOffer): string => {
  const facts = [
    offer.label,
    offer.size === null ? '' : `${(offer.size / 1024 ** 2).toFixed(1)} MB to download`,
    offer.irreversible === true ? 'no step back once it runs' : '',
    offer.current ? 'running' : '',
  ].filter(Boolean);
  return `        ${offer.title}${facts.length === 0 ? '' : ` · ${facts.join(' · ')}`} — ${offer.why ?? offer.disabled ?? offer.update}`;
};

export function renderMachine(standing: MachineState, url: string): string {
  const now = Date.parse(standing.readAt);
  const { server, host } = standing;
  const next = server.next;
  const runs = server.installation
    ? `build ${shortBuild(server.installation.build)}`
    : server.cut?.revision
      ? `checkout ${server.cut.revision.head.slice(0, 7)}${server.cut.revision.dirty ? ' with uncommitted changes' : ''}`
      : 'checkout';
  const born =
    server.born.replacedPid === null ? `up ${agoText(server.startedAt, now)}` : `restarted ${agoText(server.startedAt, now)} ago`;
  const lines = [`server  up  ${runs} · ${born} · ${url}`];
  if (server.waiting !== null) lines.push(`        update ready: build ${shortBuild(server.waiting.build)} — tagma restart`);
  lines.push(`next    ${next.standing.said.map((part) => part.text).join('')}`);
  if (next.issue !== null) lines.push(`        ${next.issue.reason}`);
  for (const offer of next.offers) lines.push(offerLine(offer));
  if (next.back !== null) lines.push(offerLine(next.back));
  if (next.installing !== null) {
    const installing = next.installing;
    const step = installing.steps.find((one) => one.id === installing.step)?.title ?? installing.step;
    lines.push(
      `        installing ${installing.title} ${installing.target}${installing.then === null ? '' : `, then ${installing.then}`} · ${step} · ${agoText(installing.since, now)} · ${installing.log}`,
    );
  } else if (next.installed !== null) {
    const ended = next.installed;
    const then =
      ended.then === null || ended.outcome !== 'landed'
        ? ''
        : ended.restartRefused === null
          ? ` · then ${ended.then}`
          : ` · ${ended.then} refused: ${ended.restartRefused}`;
    lines.push(
      ended.outcome === 'landed'
        ? `        installed ${shortBuild(ended.build ?? ended.target)} from ${ended.title} · ${agoText(ended.endedAt, now)} ago${then}`
        : `        install ${ended.outcome} from ${ended.title} ${ended.target} · ${agoText(ended.endedAt, now)} ago · ${ended.detail} · ${ended.log}`,
    );
  }
  if (host.presence !== 'answering') {
    lines.push(`host    ${host.presence === 'absent' ? 'down' : 'unspoken'}  ${host.detail}`);
  } else {
    const holds = host.holds;
    lines.push(
      `host    up  ${host.build === null ? '' : `build ${shortBuild(host.build)} · `}${host.since === null ? '' : `up ${agoText(host.since, now)}`}`.trimEnd(),
    );
    if (host.custody === 'other') lines.push('        held by another Tagma');
    if (holds !== null && holds.running.length > 0) {
      lines.push(
        `        running: ${[holds.terminals > 0 ? counted(holds.terminals, 'terminal') : '', holds.commands > 0 ? counted(holds.commands, 'command') : ''].filter(Boolean).join(', ')}`,
      );
      for (const row of holds.running) {
        lines.push(
          `          ${row.title} · ${row.holder === 'operator' ? 'yours' : row.holder}${row.since === null ? '' : ` · ${agoText(row.since, now)}`}`,
        );
      }
    }
  }
  if (standing.restart.record !== null) lines.push(renderRestart(standing.restart.record));
  if (standing.restart.issue !== null)
    lines.push(`restart ${standing.restart.issue.kind}: ${standing.restart.issue.detail} · ${standing.restart.issue.path}`);
  lines.push('');
  for (const act of [...standing.acts, ...next.acts]) {
    lines.push(`${act.command.padEnd(36)} ${act.disabled ?? 'available'}`);
  }
  return lines.join('\n');
}

export function renderRestart(record: RestartRecord): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(3)} s`;
  return [
    record.predecessor === null
      ? `start ${record.id} · pid ${record.successor?.pid ?? 'not received'}`
      : `restart ${record.id} · pid ${record.predecessor.pid} → ${record.successor?.pid ?? 'not received'}`,
    ...record.windows.map(
      (window) =>
        `        ${window.door} client ${window.clientId}: ${seconds(window.durationMs)}${window.exceeded ? ' · exceeded ceiling' : ''}`,
    ),
    ...record.frames.map(
      (frame) =>
        `        ${frame.door} server interval: ${frame.intervalMs === null ? 'not measured' : seconds(frame.intervalMs)} · ${frame.threadId}`,
    ),
    ...record.points.map(
      (point) =>
        `        ${point.name}${point.door === null ? '' : ` ${point.door}`} at ${new Date(point.at).toISOString()}${point.migrations === null ? '' : ` · ${point.migrations} migrations`}`,
    ),
    ...record.phases.map(
      (phase) =>
        `        pid ${phase.pid} ${phase.name}: ${phase.durationMs === null ? 'running' : seconds(phase.durationMs)}${phase.outcome === null ? '' : ` · ${phase.outcome}`}`,
    ),
    ...(record.failure === null ? [] : [`        failed: ${record.failure.detail}`]),
  ].join('\n');
}

export function renderStartup(state: StartupState, url: string): string {
  const { startup, issue } = state;
  const lines = [`server not ready at ${url}`];
  if (startup !== null) {
    lines.push(
      `last startup ${startup.status} · pid ${startup.pid} · ${startup.phase} · since ${new Date(startup.startedAt).toISOString()}`,
    );
    if (startup.step !== null) lines.push(`        migration ${startup.step.index}/${startup.step.total} ${startup.step.name}`);
    if (startup.expectedMs !== null) lines.push(`        expected ${startup.expectedMs / 1000} s`);
    if (startup.failure !== null) lines.push(`        failed during ${startup.failure.phase}: ${startup.failure.detail}`);
  }
  if (issue !== null) lines.push(`startup record ${issue.kind}: ${issue.detail} · ${issue.path}`);
  return lines.join('\n');
}

export function renderStatus(answered: Answered, url: string): string {
  const row = answered.health;
  return [
    `server up at ${url} — tagma ${row.version}`,
    ...(row.source.installation ? [`installation ${row.source.installation.build} — ${row.source.installation.digest}`] : []),
    ...(row.source.installation && row.standing && row.standing.build !== row.source.installation.build
      ? [`installation ${row.standing.build} stands on this machine — tagma restart brings it up`]
      : []),
    ...(row.source.cut ? [`source ${provenanceLine(row.source.cut)}`] : []),
    ...databaseLines(row),
    ...renderBuilds(row.builds, row.source.installation),
  ].join('\n');
}

function renderBuilds(builds: FrozenState, installation: InstallationCut | null): string[] {
  return [renderBuild('surface', builds.surface, installation), renderBuild('host', builds.host, installation)];
}

const NOTHING_INSTALLED: Record<FrozenTargetName, string> = {
  surface: 'surface none stands — the port answers the page that says so until Tagma is installed',
  host: 'host none stands — tagma desktop refuses until Tagma is installed',
};

function renderBuild(target: FrozenTargetName, build: BuildState, installation: InstallationCut | null): string {
  if (build.served === null) return NOTHING_INSTALLED[target];
  const whose = installation?.build === build.served.build ? '' : ` — installation ${build.served.build}`;
  return `${target} ${build.served.root}${whose}`;
}
