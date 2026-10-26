import type { MetadataAdapter } from '../../metadata/sources.js';

export const cursorSources: MetadataAdapter = (input) => [
  { kind: 'terminal', cells: false, parse: (screen) => cursor(input.execution, screen), source: 'terminal', fields: ['title'] },
  { kind: 'unsupported', source: 'terminal', fields: ['effort'] },
];

import type { ScreenAnswer } from '@runlith/executions/protocol/presentation';
import type { HarnessExecutionRef } from '../../../threads/contract/wire/harness/observation.js';
import { MetadataInvalid } from '../../metadata/file.js';
import { metadataDecode, metadataText, recordedValue, type MetadataValue } from '../../metadata/fields.js';

const titleText = metadataDecode(metadataText);

export function cursor(execution: HarnessExecutionRef, screen: ScreenAnswer): MetadataValue | null {
  if (screen._tag === 'ScreenUnavailable') throw new MetadataInvalid({ reason: 'terminal-unavailable' });
  const ref = screen.provenance.ref;
  if (ref.execution !== execution.execution || ref.incarnation !== execution.incarnation) throw new MetadataInvalid({ reason: 'identity' });
  return recordedValue(titleText(screen._tag === 'ScreenTextFrame' ? screen.title : screen.appearance.title));
}
