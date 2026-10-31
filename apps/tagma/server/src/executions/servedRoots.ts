import { Effect } from 'effect';
import { sameNamespace, sameScope } from '@runlith/executions/protocol/evidence';
import type { ListenerReport, UnmeasuredReason } from '@runlith/executions/protocol/evidence';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { ServedRoots, ServingUnread } from '../browser/contract/service/sources.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { TerminalRows } from './store/terminalRows.js';
import { TerminalInventory } from './terminals/inventory.js';

const LOST_ROWS: ReadonlyArray<UnmeasuredReason> = ['truncated', 'failed', 'timeout'];

const socketsRead = (report: ListenerReport): boolean =>
  report.completeness !== 'unavailable' && !report.unmeasured.some((region) => LOST_ROWS.includes(region.reason));

export const makeServedRoots = Effect.gen(function* () {
  const inventory = yield* TerminalInventory;
  const rows = yield* TerminalRows;
  const units = yield* MachineUnits;
  return ServedRoots.of({
    root: Effect.fn('ServedRoots.root')(function* (projectId, origin) {
      if (!URL.canParse(origin)) return null;
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      const hostname = url.hostname;
      if (hostname !== 'localhost' && hostname !== '[::1]' && !/^127\.(?:\d{1,3}\.){2}\d{1,3}$/u.test(hostname)) return null;
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      const retained = inventory.retained(projectId);
      const report = retained?.listeners;
      if (retained === undefined || retained.stale || report === undefined || !socketsRead(report)) return null;
      if (report.scope.host._tag !== 'Local' || !sameNamespace(report.scope.host, report.scope.network)) return null;
      let owner: ExecutionRef | undefined;
      for (const socket of report.listeners) {
        if (!sameScope(report.scope, socket.scope) || socket.protocol !== 'tcp' || socket.port !== port) continue;
        const address = socket.address;
        const matches =
          address === '*' ||
          address === '::' ||
          (hostname === 'localhost'
            ? address === 'localhost' || address === '127.0.0.1' || address === '::1' || address === '0.0.0.0'
            : hostname === '[::1]'
              ? address === '::1'
              : address === hostname || address === '0.0.0.0');
        if (!matches) continue;
        const ref = socket.association?.execution;
        if (ref === undefined || socket.completeness !== 'complete' || socket.association?.identity === 'different') return null;
        const state = retained.stateOf(ref);
        if (state === undefined || state.phase !== 'running' || state.lifetime !== 'held') return null;
        if (
          owner !== undefined &&
          (owner.execution !== ref.execution || owner.incarnation !== ref.incarnation || owner.installation !== ref.installation)
        )
          return null;
        owner = ref;
      }
      if (owner === undefined) return null;
      const records = yield* units
        .read((unit) => rows.records(unit, [owner.execution]))
        .pipe(Effect.mapError((failure) => new ServingUnread({ message: `The serving terminal could not be read: ${failure._tag}` })));
      const record = records.get(owner.execution);
      if (
        record === undefined ||
        record.projectId !== projectId ||
        record.lifetime !== 'held' ||
        record.execution.incarnation !== owner.incarnation ||
        record.execution.installation !== owner.installation ||
        record.holdings.environmentUse !== undefined ||
        record.quarantine !== undefined
      )
        return null;
      return record.cwd ?? null;
    }),
  });
});
