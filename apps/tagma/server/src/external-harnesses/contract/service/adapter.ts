import type { AcpProfile, HarnessLaunch, HarnessModelReport, TerminalSurface } from '@runlith/tagma/adapter/harness';
import type { HarnessName } from '../../../threads/contract/wire/harness/names.js';

export type HarnessReport = {
  readonly sessionKey: string | null;
  readonly model: HarnessModelReport | null;
  readonly turnId: string | null;
};

export type HarnessAdapter = {
  readonly harness: HarnessName;
  readonly label: string;
  readonly iconProvider?: string;
  readonly mark?: string;
} & Omit<TerminalSurface, 'launch'> &
  ({ readonly launch: HarnessLaunch; readonly acp?: AcpProfile } | { readonly launch: null; readonly acp: AcpProfile });

export type TerminalHarnessAdapter = HarnessAdapter & { readonly launch: HarnessLaunch };
