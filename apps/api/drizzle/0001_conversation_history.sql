CREATE TABLE "app"."conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"visitor_id" uuid NOT NULL,
	"client_conversation_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "conversations_count" CHECK ("app"."conversations"."message_count" >= 0 AND "app"."conversations"."next_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"client_message_id" uuid,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "messages_sequence" CHECK ("app"."messages"."sequence" > 0),
	CONSTRAINT "messages_role" CHECK ("app"."messages"."role" in ('user', 'assistant', 'system'))
);
--> statement-breakpoint
CREATE TABLE "app"."visitor_sessions" (
	"token_digest" text PRIMARY KEY NOT NULL,
	"visitor_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "visitor_sessions_expiry_order" CHECK ("app"."visitor_sessions"."expires_at" > "app"."visitor_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "app"."visitors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD CONSTRAINT "conversations_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "app"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."visitor_sessions" ADD CONSTRAINT "visitor_sessions_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "app"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_visitor_client_idx" ON "app"."conversations" USING btree ("visitor_id","client_conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_visitor_updated_idx" ON "app"."conversations" USING btree ("visitor_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_client_idx" ON "app"."messages" USING btree ("conversation_id","client_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_sequence_idx" ON "app"."messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "visitor_sessions_visitor_idx" ON "app"."visitor_sessions" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "visitor_sessions_expiry_idx" ON "app"."visitor_sessions" USING btree ("expires_at");