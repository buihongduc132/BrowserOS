CREATE TABLE `assistant_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`mode` text DEFAULT 'chat' NOT NULL,
	`model` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`last_message_preview` text,
	`last_message_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `assistant_sessions_updated_idx` ON `assistant_sessions` (`updated_at`);--> statement-breakpoint
CREATE TABLE `session_tags` (
	`session_id` text NOT NULL,
	`tag` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_tags_tag_idx` ON `session_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `session_workspaces` (
	`session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`workspace_name` text NOT NULL,
	PRIMARY KEY(`session_id`, `workspace_id`)
);
--> statement-breakpoint
CREATE INDEX `session_workspaces_session_idx` ON `session_workspaces` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_workspaces_path_idx` ON `session_workspaces` (`workspace_path`);