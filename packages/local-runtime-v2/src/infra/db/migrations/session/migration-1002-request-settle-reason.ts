import type { MigrationEntry } from "../../migrate.js";

/**
 * Retain why a settled model attempt settled the way it did.
 *
 * The request ledger already keeps every physical attempt durably, but
 * `outcome` only says success, error or abort. Across a session that cannot
 * distinguish a provider outage from a context overflow from a user cancel, so
 * a settled failure was durable but not diagnosable.
 *
 * The column holds a closed vocabulary (see `RequestSettleReason`), never the
 * provider's message: the ledger promises no prompt, content, error bodies or
 * credentials.
 */
export const REQUEST_SETTLE_REASON_MIGRATION_VERSION = 1002;

export const migration: MigrationEntry = {
  version: REQUEST_SETTLE_REASON_MIGRATION_VERSION,
  name: "bari_request_settle_reason",
  up: `
    ALTER TABLE local_runtime_llm_requests ADD COLUMN settle_reason TEXT;
  `,
};
