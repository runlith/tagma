CREATE TABLE `change_landed` (
	`checkout` text NOT NULL,
	`path` text NOT NULL,
	`digest` text NOT NULL,
	`head` text,
	`working` text,
	`pieces` text NOT NULL,
	CONSTRAINT `change_landed_pk` PRIMARY KEY(`checkout`, `path`, `digest`)
);
