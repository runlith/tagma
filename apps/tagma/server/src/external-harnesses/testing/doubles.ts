import { Context, Effect, Layer } from 'effect';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { ThreadHarness } from '../../threads/contract/service/engine.js';
import { SessionRead } from '../../threads/contract/service/harness.js';
import { sessionReadLayer } from '../sessions/sessionRead.js';
import { makeProtocolWords } from '../protocol/words.js';
import { HarnessObservations as HarnessObservationsImpl } from '../observations/admission.js';
import { HarnessSessionStore as HarnessSessionStoreImpl } from '../store/sessions.js';
import { harnessPlace as harnessPlaceImpl, terminalArgv as terminalArgvImpl } from '../sessions/launch.js';
import { terminalFaces as terminalFacesImpl } from '../asks/faces.js';
import { TerminalAsks as TerminalAsksImpl, type AskLedger as AskLedgerShape } from '../asks/terminal.js';
import { ProtocolDriver as ProtocolDriverImpl } from '../protocol/driver.js';
import { acpTransport as acpTransportImpl } from '../protocol/transport.js';
import { ProtocolJournal as ProtocolJournalImpl } from '../protocol/journal.js';
import { ProtocolRows as ProtocolRowsImpl } from '../store/protocol.js';
import { VendorTurns as VendorTurnsImpl } from '../store/turns.js';
import { HarnessScreenAsks as HarnessScreenAsksImpl, QUIET_BEAT_MS as QUIET_BEAT_MSImpl } from '../asks/screen.js';
import { HarnessLanes as HarnessLanesImpl } from '../sessions/lanes.js';
import { writeFrame as writeFrameImpl } from '../protocol/link.js';
import { makeSessionBirths as makeSessionBirthsImpl } from '../birth/sessionBirths.js';
import {
  readHarnessFrame as readHarnessFrameImpl,
  typeHarnessKeys as typeHarnessKeysImpl,
  typeHarnessWords as typeHarnessWordsImpl,
  widgetOn as widgetOnImpl,
} from '../sessions/keyboard.js';
import { SessionDriver as SessionDriverImpl } from '../sessions/drive.js';
import { screenTexts as screenTextsImpl } from '../sessions/speech.js';
import { METADATA_CADENCE as METADATA_CADENCEImpl, METADATA_LIMITS as METADATA_LIMITSImpl } from '../metadata/policy.js';
import { MetadataIndex as MetadataIndexImpl } from '../metadata/sessionIndex.js';
import { MetadataInvalid as MetadataInvalidImpl } from '@runlith/tagma/adapter/metadata';
import { MetadataBackend as MetadataBackendImpl } from '../metadata/runtime.js';
import { readWitness as readWitnessImpl } from '../sessions/readWitness.js';
import { LOST_LINE as LOST_LINEImpl } from '../sessions/lifecycle.js';
import { terminalKernel as terminalKernelImpl } from '../birth/seat.js';
import { transportSwitch as transportSwitchImpl } from '../sessions/switch.js';
import { inputWords as inputWordsImpl } from '../adapter/input.js';
import { installHooks as installHooksImpl } from '../installs/hookWrite.js';
import { hooksStatus as hooksStatusImpl, skillStatus as skillStatusImpl } from '../installs/status.js';
import { installInto as installIntoImpl, installSkill as installSkillImpl } from '../installs/skillInstall.js';
import { skillTarget as skillTargetImpl } from '../installs/targets.js';

export const HarnessObservations = HarnessObservationsImpl;
export type HarnessObservations = InstanceType<typeof HarnessObservationsImpl>;
export const HarnessSessionStore = HarnessSessionStoreImpl;
export type HarnessSessionStore = InstanceType<typeof HarnessSessionStoreImpl>;
export const terminalArgv = terminalArgvImpl;
export const harnessPlace = harnessPlaceImpl;
export const terminalFaces = terminalFacesImpl;
export const TerminalAsks = TerminalAsksImpl;
export type TerminalAsks = InstanceType<typeof TerminalAsksImpl>;
export type AskLedger = AskLedgerShape;
export const ProtocolDriver = ProtocolDriverImpl;
export const sessionRead = Effect.map(Layer.build(sessionReadLayer), (services) => Context.get(services, SessionRead));
export const protocolSessions = (input: { readonly driver: ProtocolDriverImpl; readonly harness: ThreadHarness['Service'] }) =>
  Effect.provideService(makeProtocolWords({ driver: input.driver }), ThreadHarness, input.harness);
export const acpTransport = acpTransportImpl;
export type ProtocolDriver = InstanceType<typeof ProtocolDriverImpl>;
export const ProtocolJournal = ProtocolJournalImpl;
export const ProtocolRows = ProtocolRowsImpl;
export const VendorTurns = VendorTurnsImpl;
export const HarnessScreenAsks = HarnessScreenAsksImpl;
export type HarnessScreenAsks = InstanceType<typeof HarnessScreenAsksImpl>;
export const QUIET_BEAT_MS = QUIET_BEAT_MSImpl;
export const HarnessLanes = HarnessLanesImpl;
export type HarnessLanes = InstanceType<typeof HarnessLanesImpl>;
export const writeFrame = writeFrameImpl;
export const makeSessionBirths = makeSessionBirthsImpl;
export const readHarnessFrame = readHarnessFrameImpl;
export const typeHarnessKeys = typeHarnessKeysImpl;
export const typeHarnessWords = typeHarnessWordsImpl;
export const widgetOn = widgetOnImpl;
export const SessionDriver = SessionDriverImpl;
export type SessionDriver = InstanceType<typeof SessionDriverImpl>;
export const screenTexts = screenTextsImpl;
export const METADATA_CADENCE = METADATA_CADENCEImpl;
export const METADATA_LIMITS = METADATA_LIMITSImpl;
export const MetadataIndex = MetadataIndexImpl;
export type MetadataIndex = InstanceType<typeof MetadataIndexImpl>;
export const MetadataInvalid = MetadataInvalidImpl;
export type MetadataInvalid = InstanceType<typeof MetadataInvalidImpl>;
export const MetadataBackend = MetadataBackendImpl;
export type MetadataBackend = InstanceType<typeof MetadataBackendImpl>;
export const readWitness = readWitnessImpl;
export const LOST_LINE = LOST_LINEImpl;

export const installHooks = installHooksImpl;
export const hooksStatus = hooksStatusImpl;
export const skillStatus = skillStatusImpl;
export const installInto = installIntoImpl;
export const installSkill = installSkillImpl;
export const skillTarget = skillTargetImpl;

export const transportSwitch = (...input: Parameters<typeof transportSwitchImpl>) => transportSwitchImpl(...input);

export const terminalKernel = terminalKernelImpl;
export const inputWords = inputWordsImpl;
