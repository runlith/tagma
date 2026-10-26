import { Context } from 'effect';

export const InspectionCode = Context.Reference<string | null>('enforcement/InspectionCode', { defaultValue: () => null });
