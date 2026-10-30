import { metadataDecode, metadataText, recordedValue, type MetadataLocation, type MetadataSession } from '@runlith/tagma/adapter/metadata';

const titleText = metadataDecode(metadataText);

export const cursorSources = (_input: MetadataSession): readonly MetadataLocation[] => [
  { kind: 'terminal', cells: false, parse: (screen) => recordedValue(titleText(screen.title)), source: 'terminal', fields: ['title'] },
  { kind: 'unsupported', source: 'terminal', fields: ['effort'] },
];
