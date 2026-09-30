ALTER TABLE `task_completions` ADD `asap_snapshot` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `due_asap` integer DEFAULT 0 NOT NULL;