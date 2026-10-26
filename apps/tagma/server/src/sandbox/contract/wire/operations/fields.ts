import { Schema } from 'effect';

export const optionalFields = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, Schema.optional(field)])) as {
    readonly [K in keyof Fields]: Schema.optional<Fields[K]>;
  };
