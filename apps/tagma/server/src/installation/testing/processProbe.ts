import { Effect } from 'effect';
import { readProcessState } from '../process/probe.js';
import { testProcesses } from './processes.js';

const data = process.argv[2];
if (data === undefined) throw new Error('a data directory is required');
const state = await Effect.runPromise(readProcessState(data, process.env).pipe(Effect.provide(testProcesses)));
console.log(JSON.stringify(state));
