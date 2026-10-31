#!/usr/bin/env bun
import { runCli } from '../cli/main.js';
import { RELEASE } from './build.js';

runCli(RELEASE, () => import('./server.js'));
