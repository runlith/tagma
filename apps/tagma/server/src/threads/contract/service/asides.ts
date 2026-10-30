import type { ThreadAsides } from '@runlith/agent/thread/ThreadAsides';
import { Context } from 'effect';

export class HarnessAsides extends Context.Service<HarnessAsides, ThreadAsides>()('tagma/threads/HarnessAsides') {}
