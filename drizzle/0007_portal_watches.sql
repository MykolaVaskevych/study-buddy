CREATE TABLE `portal_watches` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`seen_links` text DEFAULT '[]' NOT NULL,
	`checked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_watches_course_url` ON `portal_watches` (`course_id`,`url`);