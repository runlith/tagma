import { Schema } from 'effect';
import { projectField } from '../../../platform/contract/wire/place.js';

export const threadInput = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct({ project: projectField, ...fields });
