import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

// One row per shared project (a building/client). `snap` is the full app
// snapshot. When `passwordHash` is set the project is edit-locked: anyone can
// read it, but saving, deleting or changing the password needs the password.
export const projects = pgTable("projects", {
  id: text().primaryKey(),
  name: text().notNull(),
  snap: jsonb().notNull(),
  periodCount: integer("period_count").notNull().default(0),
  systemCount: integer("system_count").notNull().default(0),
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
});
