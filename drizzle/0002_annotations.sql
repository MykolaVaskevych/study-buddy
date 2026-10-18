CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`page` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `annotations_doc_page_kind` ON `annotations` (`doc_id`,`page`,`kind`);