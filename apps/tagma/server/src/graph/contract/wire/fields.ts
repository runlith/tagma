import { Schema, type SchemaAST } from 'effect';
import { BLOCK_ADDRESS, BLOCK_NAME } from './references.js';
import { trimmed } from '../../../platform/contract/wire/text.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const closedParsing: SchemaAST.ParseOptions = { onExcessProperty: 'error' };

export const nameRef = Schema.String.check(Schema.isPattern(BLOCK_NAME)).annotate(placeRole('block'));

export const blockRef = Schema.String.check(Schema.isPattern(BLOCK_ADDRESS)).annotate(placeRole('block'));

export const blockMention = blockRef.annotate(placeRole('mention'));

const DOCUMENT_REF = new RegExp(`^(?:\\$\\S+|${BLOCK_NAME.source.slice(1, -1)})$`, 'u');
export const documentRef = Schema.String.check(Schema.isPattern(DOCUMENT_REF)).annotate(placeRole('mention'));

export const title = trimmed(Schema.String.check(Schema.isMinLength(1)));

export const body = Schema.String;

export const oldText = Schema.String.check(Schema.isMinLength(1));

export const place = trimmed(Schema.String.check(Schema.isMinLength(1)));

export const codePlace = place.annotate(placeRole('path'));

export const projectPlace = place.annotate(placeRole('value'));

export const filePath = trimmed(Schema.String.check(Schema.isMinLength(1)));

export const line = trimmed(Schema.String.check(Schema.isMinLength(1)));

export const tagsField = Schema.Array(Schema.String.check(Schema.isMinLength(1)));
export const fieldsField = Schema.Record(Schema.String, Schema.Unknown);

const parseStored =
  <T>(what: string, holds: (parsed: unknown) => parsed is T) =>
  (stored: string): T => {
    const parsed: unknown = JSON.parse(stored);
    if (!holds(parsed)) throw new TypeError(`a stored ${what} column holds ${stored.slice(0, 80)}, which is not its shape`);
    return parsed;
  };

export const parseStoredTags = parseStored<readonly string[]>('tags', Schema.is(Schema.Array(Schema.String)));
export const parseStoredFields = parseStored<Readonly<Record<string, unknown>>>('fields', Schema.is(fieldsField));
