CREATE TABLE `exam_profiles` (
	`doc_id` text PRIMARY KEY NOT NULL,
	`profile` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
