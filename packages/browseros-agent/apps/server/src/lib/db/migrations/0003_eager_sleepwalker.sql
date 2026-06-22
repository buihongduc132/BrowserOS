CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`title` text,
	`cwd` text,
	`mode` text DEFAULT 'agent' NOT NULL,
	`model` text,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`last_message_preview` text,
	`last_message_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_agent_id_idx` ON `agent_sessions` (`agent_id`,`updated_at`);