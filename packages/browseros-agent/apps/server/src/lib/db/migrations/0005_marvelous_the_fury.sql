PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_tags` (
	`session_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`session_id`, `tag`)
);
--> statement-breakpoint
INSERT INTO `__new_session_tags`("session_id", "tag") SELECT "session_id", "tag" FROM `session_tags`;--> statement-breakpoint
DROP TABLE `session_tags`;--> statement-breakpoint
ALTER TABLE `__new_session_tags` RENAME TO `session_tags`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `session_tags_tag_idx` ON `session_tags` (`tag`);