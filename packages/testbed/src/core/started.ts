import type { Meter } from './ledger.ts';

const usage = process.cpuUsage();

export const STARTED: Meter = { wall: Number(process.hrtime.bigint()) / 1e6, own: (usage.user + usage.system) / 1000, kids: 0 };
