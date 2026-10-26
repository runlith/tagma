import { performance as declaration } from './contract/wire/module.js';
import { Context } from 'effect';
import { CpuProfiles } from '@runlith/performance/CpuProfiles';
import { HeapSnapshots } from '@runlith/performance/HeapSnapshots';
import { MemoryCaptures } from '@runlith/performance/MemoryCaptures';
import { PerformanceReports } from '@runlith/performance/PerformanceReports';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { PERFORMANCE_SETTING_KEYS, PERFORMANCE_SETTING_SECTIONS } from './contract/wire/settings.js';

export const performance = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).PERFORMANCE_PAIRS),
  presentation: async () => (await import('./presentation.js')).PERFORMANCE_PRESENTATION,
  settings: [...PERFORMANCE_SETTING_KEYS],
  settingSections: PERFORMANCE_SETTING_SECTIONS,
  lifetimes: {
    preparation: lazyLayer(
      () => import('@runlith/performance/PerformanceStore'),
      ({ performancePreparationLayer }) => performancePreparationLayer,
    ),
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ performanceLayer }) => performanceLayer,
    ),
    call: (input: {
      readonly profiles: Context.Service.Shape<typeof CpuProfiles>;
      readonly memory: Context.Service.Shape<typeof MemoryCaptures>;
      readonly heap: Context.Service.Shape<typeof HeapSnapshots>;
      readonly performance: Context.Service.Shape<typeof PerformanceReports>;
    }) =>
      Context.make(CpuProfiles, input.profiles).pipe(
        Context.add(MemoryCaptures, input.memory),
        Context.add(HeapSnapshots, input.heap),
        Context.add(PerformanceReports, input.performance),
      ),
  },
});
