CREATE TABLE `card_reviews` (
	`id` integer PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`rating` integer NOT NULL,
	`reviewed_at` text NOT NULL,
	`elapsed_ms` integer NOT NULL,
	`srs_before` text NOT NULL,
	`srs_after` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_reviews_card_idx` ON `card_reviews` (`card_id`,`reviewed_at`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`topic_id` text,
	`type` text NOT NULL,
	`front` text NOT NULL,
	`back` text NOT NULL,
	`essential` integer NOT NULL,
	`source_pages` text NOT NULL,
	`evidence` text,
	`verification` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`due` text NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`reps` integer NOT NULL,
	`lapses` integer NOT NULL,
	`srs_state` text NOT NULL,
	`last_review` text,
	`elapsed_days` real NOT NULL,
	`scheduled_days` real NOT NULL,
	`learning_steps` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cards_doc_idx` ON `cards` (`doc_id`);--> statement-breakpoint
CREATE INDEX `cards_due_idx` ON `cards` (`status`,`due`);--> statement-breakpoint
CREATE TABLE `chunks` (
	`doc_id` text NOT NULL,
	`idx` integer NOT NULL,
	`start_page` integer NOT NULL,
	`end_page` integer NOT NULL,
	`path` text NOT NULL,
	`bytes` integer NOT NULL,
	PRIMARY KEY(`doc_id`, `idx`),
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`title` text NOT NULL,
	`stored_path` text NOT NULL,
	`page_count` integer NOT NULL,
	`outline` text NOT NULL,
	`language` text,
	`imported_at` text NOT NULL,
	`last_opened_at` text,
	`last_page` integer DEFAULT 1 NOT NULL,
	`index_state` text DEFAULT 'none' NOT NULL,
	`index_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_sha256_unique` ON `documents` (`sha256`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`doc_id` text,
	`payload` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`dedupe_key` text,
	`state` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`label` text NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_runnable_idx` ON `jobs` (`state`,`priority`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_dedupe_idx` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_doc_idx` ON `jobs` (`doc_id`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`page` integer NOT NULL,
	`label` text,
	`text` text NOT NULL,
	`char_count` integer NOT NULL,
	`has_text_layer` integer NOT NULL,
	`indexed_at` text,
	`kind` text,
	`teachable` integer DEFAULT false NOT NULL,
	`summary` text,
	`key_points` text DEFAULT '[]' NOT NULL,
	`concepts` text DEFAULT '[]' NOT NULL,
	`formulas` text DEFAULT '[]' NOT NULL,
	`exercises` text DEFAULT '[]' NOT NULL,
	`exam_signals` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_doc_page_uq` ON `pages` (`doc_id`,`page`);--> statement-breakpoint
CREATE TABLE `plans` (
	`doc_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`input` text NOT NULL,
	`result` text NOT NULL,
	`schedule` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_id_unique` ON `plans` (`id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`topic_id` text,
	`type` text NOT NULL,
	`purpose` text DEFAULT 'quiz' NOT NULL,
	`stem` text NOT NULL,
	`options` text,
	`answer` text NOT NULL,
	`explanation` text NOT NULL,
	`option_rationales` text,
	`difficulty` real NOT NULL,
	`source_pages` text NOT NULL,
	`evidence` text,
	`verification` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`status_reason` text,
	`from_book` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `questions_doc_idx` ON `questions` (`doc_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `quiz_attempts` (
	`id` integer PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`question_id` text NOT NULL,
	`correct` integer NOT NULL,
	`score` real NOT NULL,
	`result` text NOT NULL,
	`response` text,
	`elapsed_ms` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_attempts_quiz_question_uq` ON `quiz_attempts` (`quiz_id`,`question_id`);--> statement-breakpoint
CREATE INDEX `quiz_attempts_question_idx` ON `quiz_attempts` (`question_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`mode` text NOT NULL,
	`scope` text NOT NULL,
	`question_ids` text NOT NULL,
	`time_limit` integer,
	`created_at` text NOT NULL,
	`finished_at` text,
	`result` text,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quizzes_doc_idx` ON `quizzes` (`doc_id`,`finished_at`);--> statement-breakpoint
CREATE TABLE `reading` (
	`doc_id` text NOT NULL,
	`page` integer NOT NULL,
	`seconds` real NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`doc_id`, `page`),
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`value` blob NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`parent_id` text,
	`key` text NOT NULL,
	`ord` integer NOT NULL,
	`title` text NOT NULL,
	`page_start` integer NOT NULL,
	`page_end` integer NOT NULL,
	`objectives` text NOT NULL,
	`estimates` text,
	`mastery_alpha` real,
	`mastery_beta` real,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topics_doc_idx` ON `topics` (`doc_id`);--> statement-breakpoint
CREATE TABLE `usage` (
	`id` integer PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`model` text NOT NULL,
	`provider` text NOT NULL,
	`doc_id` text,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_read_tokens` integer NOT NULL,
	`cache_write_tokens` integer NOT NULL,
	`cost_usd` real,
	`notional` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `usage_created_idx` ON `usage` (`created_at`);