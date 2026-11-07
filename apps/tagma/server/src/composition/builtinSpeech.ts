export const BUILTIN_SPEECH = ['openai', 'soniox', 'whisper'] as const;

export type BuiltinSpeechId = (typeof BUILTIN_SPEECH)[number];
