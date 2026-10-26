import { Schema, SchemaGetter } from 'effect';

export const trimmed = (checked: Schema.Codec<string, string>) =>
  Schema.String.pipe(
    Schema.decodeTo(checked, {
      decode: SchemaGetter.transform((value) => value.trim()),
      encode: SchemaGetter.passthrough(),
    }),
  );

export const elapsedWords = (ms: number | undefined): string => {
  if (ms === undefined) return '';
  const whole = Math.round(ms / 1000);
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes < 60) return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  const hours = Math.floor(minutes / 60);
  const left = minutes % 60;
  return left === 0 ? `${hours} h` : `${hours} h ${left} min`;
};
