CREATE TABLE `lessons` (
	`doc_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`sections` text NOT NULL,
	`exercises` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`doc_id`, `topic_id`),
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
