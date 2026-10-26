import type { TransportCapabilities, TransportWeb } from '@runlith/agent/thread/record';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { HarnessModelChoice } from '../contract/service/adapter.js';

export type ConfigChoice = { readonly configId: string; readonly value: string };

export type AcpProves = {
  readonly law: NonNullable<TransportCapabilities['law']>;
  readonly touch: NonNullable<TransportCapabilities['touch']>;
  readonly authorship: NonNullable<TransportCapabilities['authorship']>;
  readonly fork: boolean;
  readonly rewind: boolean;
  readonly compaction: boolean | 'foreign';
  readonly continue: boolean;
  readonly usage: Exclude<TransportCapabilities['usage'], 'partial'>;
  readonly aside: Exclude<TransportCapabilities['aside'], 'request'>;
};

export type AcpProfile = {
  readonly argv: (choice: HarnessModelChoice | undefined) => readonly string[];
  readonly untitled?: readonly string[];
  readonly configure: (choice: HarnessModelChoice | undefined, switches: ModelSwitches) => readonly ConfigChoice[];
  readonly reportedModel: string | null;
  readonly hosts: string | null;
  readonly serves: string | null;
  readonly web: TransportWeb;
  readonly mode: string;
  readonly proves: AcpProves;
  readonly toolCatalog?: 'turn';
  readonly storage?: { readonly environment: string; readonly folder: string };
  readonly graceMs: number;
  readonly callEnvelopeMs: number | null;
  readonly handshakeMs: number;
  readonly login: { readonly command: string; readonly codes: readonly number[] };
  readonly lockedCode: number | null;
  readonly otherMutates: boolean;
  readonly midTurn: 'after-turn' | 'steer';
  readonly sharedSessions: boolean;
  readonly extensions: readonly string[];
};
