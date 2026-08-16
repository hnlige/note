CREATE TABLE `activities` (
	`id` varchar(36) NOT NULL,
	`content` text,
	`timestamp` datetime NOT NULL,
	`type` varchar(20) NOT NULL,
	CONSTRAINT `activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `async_tasks` (
	`id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`module` varchar(50),
	`status` varchar(20) NOT NULL DEFAULT 'PROCESSING',
	`progress` int DEFAULT 0,
	`result` text,
	`start_time` datetime NOT NULL,
	`end_time` datetime,
	CONSTRAINT `async_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_records` (
	`id` varchar(36) NOT NULL,
	`item_id` varchar(36),
	`item_title` varchar(200),
	`applicant_name` varchar(50),
	`reviewer_name` varchar(50),
	`status` varchar(20) NOT NULL DEFAULT 'PENDING',
	`result` varchar(20),
	`comment` text,
	`submitted_at` datetime NOT NULL,
	`reviewed_at` datetime,
	CONSTRAINT `audit_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`parent_id` varchar(36),
	`type` varchar(20) DEFAULT 'DEPARTMENT',
	`sort_order` int DEFAULT 0,
	CONSTRAINT `departments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dictionaries` (
	`id` varchar(36) NOT NULL,
	`type` varchar(50) NOT NULL,
	`label` varchar(100) NOT NULL,
	`value` varchar(100) NOT NULL,
	`sort_order` int DEFAULT 0,
	`created_at` datetime NOT NULL,
	CONSTRAINT `dictionaries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `global_rules` (
	`id` varchar(36) NOT NULL DEFAULT 'default',
	`auto_remind_enabled` boolean DEFAULT true,
	`auto_remind_days` int DEFAULT 3,
	`auto_urge_enabled` boolean DEFAULT false,
	`auto_urge_days` int DEFAULT 7,
	`light_delay_days` int DEFAULT 5,
	`light_warning_days` int DEFAULT 3,
	`wecom_corp_id` varchar(100),
	`wecom_corp_secret` varchar(200),
	`wecom_agent_id` varchar(50),
	`wecom_token` varchar(100),
	`wecom_encoding_aes_key` varchar(100),
	`wecom_callback_url` varchar(300),
	`wecom_templates` text,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `global_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` varchar(36) NOT NULL,
	`serial_no` varchar(50) NOT NULL,
	`title` varchar(200) NOT NULL,
	`content` text,
	`status` varchar(20) NOT NULL DEFAULT 'PENDING',
	`deadline` datetime,
	`owner_id` varchar(36),
	`owner_name` varchar(50),
	`follower_id` varchar(36),
	`follower_name` varchar(50),
	`progress` int DEFAULT 0,
	`light_status` varchar(10),
	`last_feedback_date` datetime,
	`category` varchar(50),
	`campus` varchar(50),
	`meeting_source` varchar(200),
	`raise_date` datetime,
	`required_completion_date` datetime,
	`planned_completion_date` datetime,
	`actual_completion_date` datetime,
	`owner_ids` text,
	`owner_names` text,
	`follower_ids` text,
	`follower_names` text,
	`dept_names` text,
	`sub_tasks` text,
	`shared_with` text,
	`attachments` text,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `items_id` PRIMARY KEY(`id`),
	CONSTRAINT `items_serial_no_unique` UNIQUE(`serial_no`)
);
--> statement-breakpoint
CREATE TABLE `light_records` (
	`id` varchar(36) NOT NULL,
	`item_id` varchar(36) NOT NULL,
	`color` varchar(10) NOT NULL,
	`reason` text,
	`trigger_mode` varchar(10) NOT NULL,
	`operator_name` varchar(50) NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `light_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` varchar(36) NOT NULL,
	`title` varchar(100) NOT NULL,
	`content` text,
	`type` varchar(20) NOT NULL,
	`timestamp` datetime NOT NULL,
	`read` boolean NOT NULL DEFAULT false,
	`link` varchar(200),
	`receiver_id` varchar(36),
	`receiver_name` varchar(50),
	`sender_id` varchar(36),
	`sender_name` varchar(50),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `operation_logs` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`user_name` varchar(50),
	`action` varchar(200) NOT NULL,
	`module` varchar(50),
	`detail` text,
	`ip` varchar(50),
	`timestamp` datetime NOT NULL,
	CONSTRAINT `operation_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` varchar(36) NOT NULL,
	`name` varchar(50) NOT NULL,
	`description` text,
	`permissions` text,
	`data_scope` varchar(50) DEFAULT 'SELF',
	`follower_data_scope` varchar(50),
	`allowed_actions` text,
	`org_ids` text,
	`owner_custom_user_ids` text,
	`follower_custom_user_ids` text,
	`custom_user_ids` text,
	`created_at` datetime NOT NULL,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`content` text,
	`category` varchar(50),
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`created_at` datetime NOT NULL,
	CONSTRAINT `templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `timeline_nodes` (
	`id` varchar(36) NOT NULL,
	`item_id` varchar(36) NOT NULL,
	`type` varchar(30) NOT NULL,
	`user` varchar(50) NOT NULL,
	`content` text,
	`timestamp` datetime NOT NULL,
	CONSTRAINT `timeline_nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `urge_records` (
	`id` varchar(36) NOT NULL,
	`item_id` varchar(36) NOT NULL,
	`item_title` varchar(200) NOT NULL,
	`sender_id` varchar(36),
	`sender` varchar(50) NOT NULL,
	`receiver_id` varchar(36),
	`receiver` varchar(50) NOT NULL,
	`timestamp` datetime NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'UNREAD',
	`response_content` text,
	`method` varchar(20) NOT NULL DEFAULT 'MESSAGE',
	`batch_id` varchar(36),
	`sub_task_id` varchar(36),
	`idempotency_key` varchar(64),
	`scope` varchar(20) NOT NULL DEFAULT 'SINGLE_ASSIGNEE',
	`source` varchar(20) NOT NULL DEFAULT 'MANUAL',
	`result` varchar(20) NOT NULL DEFAULT 'SUCCESS',
	CONSTRAINT `urge_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`username` varchar(50) NOT NULL,
	`password` varchar(255) NOT NULL,
	`name` varchar(50) NOT NULL,
	`role` varchar(20) NOT NULL DEFAULT 'OWNER',
	`role_id` varchar(36),
	`role_ids` text,
	`email` varchar(100),
	`phone` varchar(20),
	`dept_id` varchar(36),
	`org_id` varchar(36),
	`supervisor_id` varchar(36),
	`admin_org_ids` text,
	`preferences` text,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`created_at` datetime NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
