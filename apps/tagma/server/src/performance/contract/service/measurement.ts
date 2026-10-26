import type { Context } from 'effect';
import type { CpuProfiles } from '@runlith/performance/CpuProfiles';
import type { HeapSnapshots } from '@runlith/performance/HeapSnapshots';
import type { MemoryCaptures } from '@runlith/performance/MemoryCaptures';
import type { PerformanceReports } from '@runlith/performance/PerformanceReports';

export type Measurement = Context.Context<PerformanceReports | CpuProfiles | MemoryCaptures | HeapSnapshots>;
