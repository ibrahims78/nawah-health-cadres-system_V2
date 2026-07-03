/**
 * Atomically inserts a project record with a deduplicated sequential number.
 * Uses a per-project advisory lock inside a transaction to prevent duplicate
 * sequential_number values under concurrent submissions.
 */
import { pool } from "../db.js";

export interface InsertedRecord {
  id: string;
  sequential_number: number;
  edit_token: string;
  sheets_row_index: number | null;
  submitted_at: string;
}

export async function insertRecordAtomic(
  projectId: string,
  data: object,
  tokenExpiresAt: Date,
  autoIncrementKeys: string[] = []
): Promise<InsertedRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Acquire a per-project advisory lock for the duration of this transaction.
    // hashtext() maps the UUID string to an int4, giving a project-scoped lock.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [projectId]);

    const { rows: seqRows } = await client.query(
      "SELECT COALESCE(MAX(sequential_number), 0) + 1 AS seq FROM project_records WHERE project_id = $1",
      [projectId]
    );
    const seqNum: number = Number(seqRows[0].seq);

    // Auto-fill autoincrement fields inside the lock to prevent race conditions.
    // Uses parameterized ->>$2 to safely pass the field key without SQL injection.
    const enrichedData: Record<string, any> = { ...(data as Record<string, any>) };
    for (const key of autoIncrementKeys) {
      const { rows: autoRows } = await client.query(
        "SELECT COALESCE(MAX((data->>$2)::numeric), 0) + 1 AS next_val FROM project_records WHERE project_id = $1",
        [projectId, key]
      );
      enrichedData[key] = String(Number(autoRows[0]?.next_val ?? 1));
    }

    const { rows } = await client.query<InsertedRecord>(
      `INSERT INTO project_records
         (id, project_id, data, sequential_number, edit_token, token_expires_at, submitted_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, gen_random_uuid(), $4, NOW())
       RETURNING id, sequential_number, edit_token, sheets_row_index, submitted_at`,
      [projectId, JSON.stringify(enrichedData), seqNum, tokenExpiresAt]
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
