CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`teachers` text DEFAULT '[]' NOT NULL,
	`defaults` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_answers`("id", "run_id", "question_id", "user_id", "choice", "text", "confidence", "served_at", "answered_at", "disqualified", "reason", "flag") SELECT "id", "run_id", "question_id", "user_id", "choice", "text", "confidence", "served_at", "answered_at", "disqualified", "reason", "flag" FROM `answers`;--> statement-breakpoint
DROP TABLE `answers`;--> statement-breakpoint
ALTER TABLE `__new_answers` RENAME TO `answers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `answers_run_q_user_idx` ON `answers` (`run_id`,`question_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD `questions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `course_id` text REFERENCES courses(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `tasks` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `review` text;--> statement-breakpoint
INSERT INTO `courses` (`id`, `owner_id`, `title`) SELECT 'c_' || `owner_id`, `owner_id`, 'My course' FROM `tasks` GROUP BY `owner_id`;--> statement-breakpoint
UPDATE `tasks` SET `course_id` = 'c_' || `owner_id`, `position` = (SELECT count(*) FROM `tasks` t2 WHERE t2.`owner_id` = `tasks`.`owner_id` AND t2.`created_at` < `tasks`.`created_at`);--> statement-breakpoint
UPDATE `runs` SET `questions` = (
  SELECT json_group_array(json_object('id', q.`id`, 'taskId', q.`task_id`, 'position', q.`position`, 'type', q.`type`, 'prompt', q.`prompt`, 'options', json(q.`options`), 'correctIndex', q.`correct_index`, 'scoring', q.`scoring`, 'askConfidence', json(CASE WHEN q.`ask_confidence` THEN 'true' ELSE 'false' END), 'timeLimitSec', q.`time_limit_sec`))
  FROM (SELECT * FROM `questions` WHERE `task_id` = `runs`.`task_id` ORDER BY `position`) q
);
