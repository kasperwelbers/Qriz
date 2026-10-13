PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`question_id` text NOT NULL,
	`user_id` text NOT NULL,
	`choice` integer,
	`text` text,
	`confidence` integer,
	`served_at` integer NOT NULL,
	`answered_at` integer NOT NULL,
	`disqualified` integer DEFAULT false NOT NULL,
	`reason` text,
	`flag` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_answers`("id", "run_id", "question_id", "user_id", "choice", "text", "confidence", "served_at", "answered_at", "disqualified", "reason", "flag") SELECT "id", "run_id", "question_id", "user_id", "choice", NULL, NULL, "served_at", "answered_at", "disqualified", "reason", "flag" FROM `answers`;--> statement-breakpoint
DROP TABLE `answers`;--> statement-breakpoint
ALTER TABLE `__new_answers` RENAME TO `answers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `answers_run_q_user_idx` ON `answers` (`run_id`,`question_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `questions` ADD `type` text DEFAULT 'choice' NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `scoring` text DEFAULT 'correct' NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `ask_confidence` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `checks` text DEFAULT '{}' NOT NULL;