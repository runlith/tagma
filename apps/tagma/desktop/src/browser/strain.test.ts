import { expect, test } from 'bun:test';
import { RendererStrain } from './strain.js';

test('renderer leases snapshot their processes and preserve overlapping CPU and native pause contributions on release', () => {
  const strains = new RendererStrain();
  const renderers = [11, 22, 22];
  const cpu = strains.hold(renderers, { factor: 20, paused: false });
  const slower = strains.hold([22], { factor: 4, paused: false });
  const wirePause = strains.hold([11], { factor: 1, paused: true });
  const nativePause = strains.hold([11], { factor: 1, paused: true });

  expect(strains.current(11, 'one')).toEqual({ factor: 20, paused: true });
  expect(strains.current(22, 'one')).toEqual({ factor: 20, paused: false });
  expect(strains.current(33, 'one')).toEqual({ factor: 1, paused: false });

  renderers.splice(0, renderers.length, 33);
  cpu();
  wirePause();
  expect(strains.current(11, 'one')).toEqual({ factor: 1, paused: true });
  expect(strains.current(22, 'one')).toEqual({ factor: 4, paused: false });
  expect(strains.current(33, 'one')).toEqual({ factor: 1, paused: false });

  cpu();
  nativePause();
  slower();
  expect(strains.current(11, 'one')).toEqual({ factor: 1, paused: false });
  expect(strains.current(22, 'one')).toEqual({ factor: 1, paused: false });
});

test('CPU membership follows renderer changes and borrows only the profile factor while navigation is pending', () => {
  const strains = new RendererStrain();
  const cpu = strains.cpu('one', 20);
  const peer = strains.cpu('one', 4);
  const pause = strains.hold([11], { factor: 1, paused: true });
  cpu.update([11, 22], false);
  expect(strains.current(44, 'one')).toEqual({ factor: 1, paused: false });

  cpu.update([33], true);
  peer.update([22], true);
  expect(strains.current(44, 'one')).toEqual({ factor: 20, paused: false });
  expect(strains.current(44, 'two')).toEqual({ factor: 1, paused: false });
  expect(strains.current(33, 'two')).toEqual({ factor: 20, paused: false });
  expect(strains.current(11, 'one')).toEqual({ factor: 20, paused: true });

  cpu.update([33], false);
  expect(strains.current(44, 'one')).toEqual({ factor: 4, paused: false });
  expect(strains.current(11, 'one')).toEqual({ factor: 4, paused: true });
  peer.release();
  expect(strains.current(44, 'one')).toEqual({ factor: 1, paused: false });
  expect(strains.current(22, 'one')).toEqual({ factor: 1, paused: false });
  expect(strains.current(11, 'one')).toEqual({ factor: 1, paused: true });
  expect(strains.current(33, 'one')).toEqual({ factor: 20, paused: false });

  cpu.release();
  pause();
  expect(strains.current(33, 'one')).toEqual({ factor: 1, paused: false });
  expect(strains.current(11, 'one')).toEqual({ factor: 1, paused: false });
});
