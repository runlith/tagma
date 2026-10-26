import { describe, expect, it } from 'bun:test';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { Request } from '@runlith/executions/protocol/wire';
import { actingRefusal, generationOf, liveReadRefOf, replacedRefusal } from './generation';

const installation = InstallationId.make('here');
const at = (incarnation: number, owner = installation) => ({ installation: owner, execution: ExecutionId.make('e-1'), incarnation });

describe('which generation an explicit reference names', () => {
  it('routes the running generation to the live registry and an older one of this installation to its retained record', () => {
    expect(generationOf(at(4), installation, 4)).toBe('current');
    expect(generationOf(at(3), installation, 4)).toBe('retired');
    expect(generationOf(at(0), installation, 4)).toBe('retired');
  });

  it('never lets a reference reach work it does not name: another installation or a generation not yet born', () => {
    expect(generationOf(at(4, InstallationId.make('elsewhere')), installation, 4)).toBe('foreign');
    expect(generationOf(at(3, InstallationId.make('elsewhere')), installation, 4)).toBe('foreign');
    expect(generationOf(at(5), installation, 4)).toBe('foreign');
  });
});

describe('a live read or subscription stays within the generation its reference names', () => {
  const requests = (ref: ReturnType<typeof at>): readonly Request[] => [
    { _tag: 'Processes', execution: ref },
    { _tag: 'Listeners', execution: ref },
    { _tag: 'Screen', execution: ref },
    { _tag: 'Subscribe', source: { _tag: 'Screen', execution: ref }, credits: 1 },
    { _tag: 'Subscribe', source: { _tag: 'State', execution: ref }, credits: 1 },
    { _tag: 'Subscribe', source: { _tag: 'Bytes', cursor: { ref, stream: 'stdout', offset: byteOffset(0n) } }, credits: 1 },
  ];

  it('fences old and foreign references before any ID-only registry read or subscription', () => {
    for (const ref of [at(3), at(4, InstallationId.make('elsewhere')), at(5)]) {
      for (const request of requests(ref)) {
        const selected = liveReadRefOf(request);
        expect(selected).toEqual(ref);
        expect(selected === undefined ? undefined : actingRefusal(selected, installation, 4)?._tag).toBe('HostUnavailable');
      }
    }
  });

  it('allows current references and leaves inventory and keyed historical byte reads alone', () => {
    for (const request of requests(at(4))) {
      const selected = liveReadRefOf(request);
      expect(selected).toEqual(at(4));
      expect(selected === undefined ? undefined : actingRefusal(selected, installation, 4)).toBeUndefined();
    }
    expect(liveReadRefOf({ _tag: 'Subscribe', source: { _tag: 'Inventory' }, credits: 1 })).toBeUndefined();
    expect(liveReadRefOf({ _tag: 'Read', cursor: { ref: at(3), stream: 'stdout', offset: byteOffset(0n) }, limit: 1 })).toBeUndefined();
    expect(liveReadRefOf({ _tag: 'Retained', execution: at(3) })).toBeUndefined();
  });
});

describe('the fence an acting verb meets', () => {
  it('lets a reference to the running generation through to the act', () => {
    expect(actingRefusal(at(4), installation, 4)).toBeUndefined();
  });

  it('refuses a replaced generation with the same answer an old state read gets', () => {
    const refusal = actingRefusal(at(3), installation, 4);
    expect(refusal).toEqual(replacedRefusal(at(3), 4));
    expect(refusal?._tag).toBe('HostUnavailable');
  });

  it('refuses another installation and a generation not yet born before any act', () => {
    for (const ref of [at(4, InstallationId.make('elsewhere')), at(5)]) {
      expect(actingRefusal(ref, installation, 4)?._tag).toBe('HostUnavailable');
    }
  });
});
