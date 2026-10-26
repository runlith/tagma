import { Schema } from 'effect';

export const ROTATING_GRANT = {
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.Number,
};
