CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ord` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `course_id` text REFERENCES courses(id);--> statement-breakpoint
ALTER TABLE `documents` ADD `ord` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Every existing file becomes a one-file course named after it, in import order.
INSERT INTO `courses` (`id`, `name`, `ord`, `created_at`) SELECT `id`, `title`, (SELECT count(*) FROM `documents` `d2` WHERE `d2`.`imported_at` < `documents`.`imported_at`), `imported_at` FROM `documents`;--> statement-breakpoint
UPDATE `documents` SET `course_id` = `id`;
