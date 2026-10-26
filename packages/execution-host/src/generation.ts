import type { ExecutionRef, InstallationId } from '@runlith/executions/protocol/execution';
import type { Refusal } from '@runlith/executions/protocol/host';
import type { Request } from '@runlith/executions/protocol/wire';

export type Generation = 'current' | 'retired' | 'foreign';

export const generationOf = (ref: ExecutionRef, installation: InstallationId, incarnation: number): Generation =>
  ref.installation !== installation || ref.incarnation > incarnation ? 'foreign' : ref.incarnation === incarnation ? 'current' : 'retired';

export const liveReadRefOf = (request: Request): ExecutionRef | undefined => {
  switch (request._tag) {
    case 'Processes':
    case 'Listeners':
    case 'Foreground':
    case 'Screen':
    case 'ScreenPoint':
      return request.execution;
    case 'Subscribe':
      return request.source._tag === 'Inventory' || request.source._tag === 'Load'
        ? undefined
        : request.source._tag === 'Bytes'
          ? request.source.cursor.ref
          : request.source.execution;
    default:
      return undefined;
  }
};

export const replacedRefusal = (ref: ExecutionRef, incarnation: number): Refusal => ({
  _tag: 'HostUnavailable',
  reason: `generation ${ref.incarnation} was replaced by ${incarnation}; its live state is gone and only its retained record remains`,
});

export const actingRefusal = (ref: ExecutionRef, installation: InstallationId, incarnation: number): Refusal | undefined => {
  const generation = generationOf(ref, installation, incarnation);
  if (generation === 'current') return undefined;
  if (generation === 'retired') return replacedRefusal(ref, incarnation);
  return {
    _tag: 'HostUnavailable',
    reason: `${ref.execution} names installation ${ref.installation} generation ${ref.incarnation}; this host is installation ${installation} generation ${incarnation}`,
  };
};
