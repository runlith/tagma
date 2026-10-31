#!/usr/bin/env bun
import { runCli } from '../cli/main.js';
import { DEVELOPER } from './build.js';

runCli(DEVELOPER, () => import('./server.js'));
