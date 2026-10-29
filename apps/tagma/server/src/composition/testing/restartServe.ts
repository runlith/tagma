#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { threads } from '../../threads/threads.js';
import { RESTART_STEP_ENV, restartStep } from './restartStep.js';

const marker = process.env[RESTART_STEP_ENV];
if (marker !== undefined && existsSync(marker)) Array.prototype.push.call(threads.formSteps, restartStep);

await import('../entries/cli.js');
