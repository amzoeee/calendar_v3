CREATE TABLE `user_preferences` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`name_matching` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
