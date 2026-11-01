import { Data, Duration, Schedule } from 'effect';
import { ChatFeedBroken } from '../wire/ChatConnection';

export class FeedGap extends Data.TaggedError('FeedGap') {}

export const FEED_GAPS = 3;

export const feedGapPolicy = Schedule.upTo(Schedule.exponential(Duration.millis(250)), { times: FEED_GAPS }).pipe(
  Schedule.while(({ input }) => input instanceof FeedGap),
);

export const readRecoveryPolicy = Schedule.min([Schedule.exponential(Duration.millis(250)), Schedule.spaced(Duration.seconds(30))]);

export const feedRecoveryPolicy = readRecoveryPolicy.pipe(
  Schedule.while(({ input }) => input instanceof FeedGap || input instanceof ChatFeedBroken),
);
