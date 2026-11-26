import { pgSchema } from 'drizzle-orm/pg-core';

// Business tables will be added in M1; this is not the LangGraph checkpoint schema.
export const appSchema = pgSchema('app');
