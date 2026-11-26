CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."auction_events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"city" text NOT NULL,
	"venue" text NOT NULL,
	"address" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"preview_starts_at" timestamp with time zone NOT NULL,
	"preview_ends_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"is_demo" boolean DEFAULT true NOT NULL,
	"source_note" text NOT NULL,
	"source_url" text,
	CONSTRAINT "auction_events_time_order" CHECK ("app"."auction_events"."ends_at" > "app"."auction_events"."starts_at"),
	CONSTRAINT "auction_events_preview_order" CHECK ("app"."auction_events"."preview_ends_at" > "app"."auction_events"."preview_starts_at")
);
--> statement-breakpoint
CREATE TABLE "app"."auctions" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"hall" text NOT NULL,
	"lot_count" integer NOT NULL,
	"description" text NOT NULL,
	"is_demo" boolean DEFAULT true NOT NULL,
	"source_note" text NOT NULL,
	"source_url" text,
	CONSTRAINT "auctions_time_order" CHECK ("app"."auctions"."ends_at" > "app"."auctions"."starts_at"),
	CONSTRAINT "auctions_nonnegative_lots" CHECK ("app"."auctions"."lot_count" >= 0),
	CONSTRAINT "auctions_category" CHECK ("app"."auctions"."category" in ('painting', 'porcelain', 'jewelry', 'wine', 'books', 'contemporary'))
);
--> statement-breakpoint
ALTER TABLE "app"."auctions" ADD CONSTRAINT "auctions_event_id_auction_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."auction_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auction_events_city_start_idx" ON "app"."auction_events" USING btree ("city","starts_at");--> statement-breakpoint
CREATE INDEX "auctions_event_start_idx" ON "app"."auctions" USING btree ("event_id","starts_at");--> statement-breakpoint
CREATE INDEX "auctions_category_start_idx" ON "app"."auctions" USING btree ("category","starts_at");