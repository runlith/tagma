ALTER TABLE `landing_intent` ADD `merge` text;
--> statement-breakpoint
CREATE INDEX `landing_intent_checkout_open_idx` ON `landing_intent` (`kind`,`checkout`,`at`,`key`) WHERE "landing_intent"."phase" in ('intended', 'publishing', 'published');
