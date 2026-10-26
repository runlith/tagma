import { performance } from '../performance/performance.js';
import { mcp } from '../mcp/mcp.js';
import { platform } from '../platform/platform.js';
import { workspace } from '../workspace/workspace.js';
import { executions } from '../executions/executions.js';
import { landing } from '../landing/landing.js';
import { Git } from '@runlith/git/Git';
import { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import { workOwners } from './callOwners.js';
import { callPorts, type PortFillers } from './callPorts.js';
import { Context, Effect } from 'effect';
import { SandboxFiles } from '../sandbox/contract/service/files.js';
import { ChangeRecord } from '../change-record/contract/service/record.js';
import type { CommandTimes } from '@runlith/agent-tools/CommandWork';
import type { CommentPolicy } from '@runlith/source-comments';
import type { Settings } from '../settings/contract/service/values.js';
import { commentPolicy } from '../graph/settings.js';
import { checkoutSettingAt } from '../workspace/governing.js';
import type { WorkPlaces } from '../threads/contract/service/working.js';
import type { GraphServices } from '../graph/contract/service/services.js';
import type { McpServers } from '../mcp/contract/service/servers.js';
import type { GraphStore, MachineStore } from '../platform/contract/service/store.js';
import type { MachineUnits } from '../platform/contract/service/units.js';
import type { ServingGit } from '../executions/contract/service/git.js';
import type { ThreadWorld } from '../executions/contract/service/worlds.js';
import type { WorkingOrigin } from '../workspace/contract/wire/place.js';
import type { CpuProfiles } from '@runlith/performance/CpuProfiles';
import type { HeapSnapshots } from '@runlith/performance/HeapSnapshots';
import type { MemoryCaptures } from '@runlith/performance/MemoryCaptures';
import type { PerformanceReports } from '@runlith/performance/PerformanceReports';
import type { CheckoutWrites } from '../workspace/contract/service/checkouts.js';

export type CallServices = {
  readonly performance: PerformanceReports['Service'];
  readonly profiles: CpuProfiles['Service'];
  readonly memory: MemoryCaptures['Service'];
  readonly heap: HeapSnapshots['Service'];
  readonly checkoutActs: CheckoutWrites['Service'];
  readonly owners: Context.Context<ChangeRecord | SandboxFiles | RunAdmission | PortFillers>;
};

export type CallScope = {
  readonly thread: { readonly id: string; readonly ownerId: string };
  readonly projectId: number;
  readonly projectRoot: string;
  readonly workingRoot: string;
  readonly runId?: string | null;
  readonly origin: WorkingOrigin | null;
  readonly world: ThreadWorld;
  readonly machine: Context.Service.Shape<typeof MachineStore>;
  readonly units: MachineUnits['Service'];
  readonly commandTimes: CommandTimes;
  readonly comments: () => CommentPolicy;
  readonly settings: Settings['Service'];
  readonly places: WorkPlaces['Service'];
  readonly servingGit: ServingGit['Service'];
  readonly mcpServers: Context.Service.Shape<typeof McpServers>;
};

export const callLifetimes = (services: CallServices) => {
  const ports = callPorts(services.owners);
  return (ctx: CallScope, graph: Context.Context<GraphServices | GraphStore>) =>
    Effect.sync(() => lifetimesOf(services, ports, ctx, graph));
};

const lifetimesOf = (
  services: CallServices,
  ports: ReturnType<typeof callPorts>,
  ctx: CallScope,
  graph: Context.Context<GraphServices | GraphStore>,
) => {
  const owners = services.owners;
  const worked = workOwners(
    {
      machine: ctx.machine,
      changes: Context.get(owners, ChangeRecord),
      files: Context.get(owners, SandboxFiles),
      git: Context.get(graph, Git),
      admission: Context.get(owners, RunAdmission),
    },
    {
      thread: { id: ctx.thread.id, ownerId: ctx.thread.ownerId, projectId: ctx.projectId },
      projectRoot: ctx.projectRoot,
      place: { root: ctx.world.root, origin: ctx.origin },
      world: ctx.world.world,
      runId: ctx.runId ?? null,
      comments: checkoutSettingAt(
        ctx.settings,
        ctx.world.facts.shared ? (at) => ctx.places.resource(at) : null,
        commentPolicy,
        { projectId: ctx.projectId, value: ctx.comments },
        'allowed',
      ),
      times: ctx.commandTimes,
    },
  );
  const base = Context.merge(graph, owners);
  const machine = Context.merge(base, platform.lifetimes.call({ machine: ctx.machine }));
  const contributed = Context.merge(machine, mcp.lifetimes.call({ mcpServers: ctx.mcpServers }));
  const measured = Context.merge(
    contributed,
    performance.lifetimes.call({
      profiles: services.profiles,
      memory: services.memory,
      heap: services.heap,
      performance: services.performance,
    }),
  );
  const execution = Context.merge(measured, executions.lifetimes.call({ servingGit: ctx.servingGit, world: ctx.world, runId: ctx.runId }));
  const placed = Context.merge(execution, workspace.lifetimes.call({ checkoutActs: services.checkoutActs }));
  const landed = Context.merge(placed, landing.lifetimes.call({ servingGit: ctx.servingGit.run }));
  return Context.merge(Context.merge(landed, ports), worked);
};
