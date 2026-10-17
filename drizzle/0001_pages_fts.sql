-- Full-text search over page text + AI summary + key points (custom: drizzle cannot express FTS5).
-- The FTS table stores its own copy of the text (not external-content) so snippet() returns clean
-- plain text for key points instead of their JSON encoding. Triggers keep it in sync with `pages`,
-- including rows removed by ON DELETE CASCADE when a document is deleted.
-- rowid = pages.id (an INTEGER PRIMARY KEY, stable across VACUUM).
CREATE VIRTUAL TABLE `pages_fts` USING fts5(
	`doc_id` UNINDEXED,
	`page` UNINDEXED,
	`text`,
	`summary`,
	`key_points`,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
--> statement-breakpoint
CREATE TRIGGER `pages_fts_ai` AFTER INSERT ON `pages` BEGIN
	INSERT INTO `pages_fts` (`rowid`, `doc_id`, `page`, `text`, `summary`, `key_points`)
	VALUES (
		new.`id`, new.`doc_id`, new.`page`, new.`text`, coalesce(new.`summary`, ''),
		(SELECT coalesce(group_concat(`value`, ' · '), '') FROM json_each(new.`key_points`))
	);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_au` AFTER UPDATE OF `text`, `summary`, `key_points` ON `pages` BEGIN
	UPDATE `pages_fts` SET
		`text` = new.`text`,
		`summary` = coalesce(new.`summary`, ''),
		`key_points` = (SELECT coalesce(group_concat(`value`, ' · '), '') FROM json_each(new.`key_points`))
	WHERE `rowid` = new.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_ad` AFTER DELETE ON `pages` BEGIN
	DELETE FROM `pages_fts` WHERE `rowid` = old.`id`;
END;
