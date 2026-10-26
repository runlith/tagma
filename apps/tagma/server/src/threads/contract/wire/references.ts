const THREAD_ID = String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`;
const THREAD_REF_SOURCE = String.raw`\[\[(${THREAD_ID})(?:\|([^\]\n]+))?\]\]`;
export const THREAD_REF = new RegExp(THREAD_REF_SOURCE, 'g');
export const THREAD_REF_INLINE = new RegExp(`^${THREAD_REF_SOURCE}`);
