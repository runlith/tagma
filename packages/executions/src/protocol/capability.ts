import { Schema } from 'effect';

export const Capability = Schema.Literals([
  'machine-load',
  'machine-load-parts',
  'end-residual',
  'end-process',
  'named-signals',
  'pipe-graceful-stop',
  'pace-raise',
  'terminal-foreground',
  'terminal-survives-holder',
  'pipe-survives-holder',
  'holder-replaces-itself',
  'screen-point',
  'screen-settled',
]);
export type Capability = typeof Capability.Type;

export type Served = ReadonlySet<Capability>;

export const CAPABILITIES: Served = new Set(Capability.literals);

export const announced = (names: ReadonlyArray<string> | undefined): Served =>
  new Set(Capability.literals.filter((known) => names?.includes(known)));

export const needing = <S extends Schema.Top>(capability: Capability, schema: S): S['Rebuild'] =>
  schema.annotate({ capability, description: `needs the ${capability} capability` });

export const capabilityOf = (schema: Schema.Top): Capability | undefined => {
  const named = Schema.resolveAnnotations(schema)?.['capability'];
  return typeof named === 'string' && Schema.is(Capability)(named) ? named : undefined;
};
