CREATE TABLE "app"."run_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"message" text,
	"task_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_events_sequence" CHECK ("app"."run_events"."seq" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."workflow_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_message_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" text NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"graph_version" text DEFAULT 'qa-v1' NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_event_sequence" integer DEFAULT 1 NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_runs_status" CHECK ("app"."workflow_runs"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "workflow_runs_counts" CHECK ("app"."workflow_runs"."attempts" >= 0 AND "app"."workflow_runs"."next_event_sequence" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."messages" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."run_events" ADD CONSTRAINT "run_events_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workflow_runs" ADD CONSTRAINT "workflow_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workflow_runs" ADD CONSTRAINT "workflow_runs_user_message_id_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "app"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_sequence_idx" ON "app"."run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_message_idx" ON "app"."workflow_runs" USING btree ("user_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_active_conversation_idx" ON "app"."workflow_runs" USING btree ("conversation_id") WHERE "app"."workflow_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "workflow_runs_claim_idx" ON "app"."workflow_runs" USING btree ("status","lease_until","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_conversation_idx" ON "app"."workflow_runs" USING btree ("conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_assistant_run_idx" ON "app"."messages" USING btree ("run_id") WHERE "app"."messages"."role" = 'assistant';