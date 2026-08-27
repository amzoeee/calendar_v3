CREATE TABLE `task_boards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`order_index` integer NOT NULL,
	`sort_mode` text DEFAULT 'manual' NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_completions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`task_id` integer NOT NULL,
	`completed_at` text NOT NULL,
	`title_snapshot` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_tags` (
	`task_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`task_id`, `tag_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`board_id` integer NOT NULL,
	`parent_id` integer,
	`depth` integer DEFAULT 0 NOT NULL,
	`order_index` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_datetime` text,
	`due_has_time` integer DEFAULT 0 NOT NULL,
	`remind_at` text,
	`remind_offset_minutes` integer,
	`remind_offset_days` integer,
	`remind_time_of_day` text,
	`is_starred` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`rrule` text,
	`counter_value` integer,
	`counter_end` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `task_boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `tags` ADD `scope` text DEFAULT 'both' NOT NULL;