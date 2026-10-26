import { SchemaAST } from 'effect';

export const PRINTED = 'runlith/printed';

export type Printed = (value: unknown) => readonly string[];

export const printerOf = SchemaAST.resolveAt<Printed>(PRINTED);

export const HANDLE = 'runlith/handle';

export type Handle = (value: unknown) => string;

export const handle = (form: Handle = String) => ({ [HANDLE]: form });

export const handleOf = SchemaAST.resolveAt<Handle>(HANDLE);
