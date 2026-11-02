CREATE TABLE `unbound_edge` (
  `from_id` integer NOT NULL,
  `kind` text NOT NULL,
  `to` text NOT NULL,
  CONSTRAINT `unbound_edge_pk` PRIMARY KEY (`from_id`, `kind`, `to`),
  CONSTRAINT `fk_unbound_edge_from_id_block_id_fk` FOREIGN KEY (`from_id`) REFERENCES `block` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `unbound_edge_target_idx` ON `unbound_edge` (`to`);
