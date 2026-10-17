import type { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  // Calculator tasks no longer carry a duration. Existing task history is retained.
  await db.raw('ALTER TABLE "CoachTask" ALTER COLUMN minutes DROP NOT NULL');
}

export async function down(db: Knex): Promise<void> {
  // Refuse rollback while duration-free tasks exist rather than fabricate estimates.
  await db.raw('ALTER TABLE "CoachTask" ALTER COLUMN minutes SET NOT NULL');
}
