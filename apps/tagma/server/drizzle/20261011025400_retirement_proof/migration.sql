CREATE TABLE `retirement_proof` (
  `row` text PRIMARY KEY NOT NULL REFERENCES `workspace_change` (`id`) ON DELETE CASCADE,
  `checkout` text NOT NULL,
  `path` text NOT NULL,
  `commit` text NOT NULL,
  `after` text,
  `reason` text NOT NULL,
  `span` text
);
--> statement-breakpoint
CREATE INDEX `retirement_proof_checkout_idx` ON `retirement_proof` (`checkout`);
