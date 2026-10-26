DROP INDEX `retirement_proof_checkout_idx`;
--> statement-breakpoint
CREATE INDEX `retirement_proof_checkout_idx` ON `retirement_proof` (`checkout`, `path`);
