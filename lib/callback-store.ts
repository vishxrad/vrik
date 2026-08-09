import "server-only";

import { neon } from "@neondatabase/serverless";

import {
  CALLBACK_CONFIG,
  type CallbackIssueType,
  type CallbackPriority,
} from "@/lib/callback-config";

export type CallbackStatus =
  | "requested"
  | "ringing"
  | "connected"
  | "completed"
  | "missed"
  | "declined"
  | "cancelled"
  | "failed";

export type SupportCallback = {
  id: string;
  idempotencyKey: string;
  provider: string;
  providerInteractionId: string | null;
  riderId: string;
  orderId: string;
  issueType: CallbackIssueType;
  priority: CallbackPriority;
  summary: string;
  riderLanguage: "hi-IN";
  supportLanguage: "en-IN";
  status: CallbackStatus;
  createdAt: string;
  updatedAt: string;
  connectedAt: string | null;
  endedAt: string | null;
};

type CallbackRow = {
  id: string;
  idempotency_key: string;
  provider: string;
  provider_interaction_id: string | null;
  rider_id: string;
  order_id: string;
  issue_type: CallbackIssueType;
  priority: CallbackPriority;
  summary: string;
  rider_language: "hi-IN";
  support_language: "en-IN";
  status: CallbackStatus;
  created_at: string | Date;
  updated_at: string | Date;
  connected_at: string | Date | null;
  ended_at: string | Date | null;
};

type CreateCallbackInput = {
  id: string;
  idempotencyKey: string;
  provider: "sarvam_on_end" | "manual_demo";
  providerInteractionId?: string | null;
  issueType: CallbackIssueType;
  priority: CallbackPriority;
  summary: string;
};

function database() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new CallbackDatabaseNotConfiguredError();
  return neon(databaseUrl);
}

function iso(value: string | Date | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toCallback(row: CallbackRow): SupportCallback {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    providerInteractionId: row.provider_interaction_id,
    riderId: row.rider_id,
    orderId: row.order_id,
    issueType: row.issue_type,
    priority: row.priority,
    summary: row.summary,
    riderLanguage: row.rider_language,
    supportLanguage: row.support_language,
    status: row.status,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    connectedAt: iso(row.connected_at),
    endedAt: iso(row.ended_at),
  };
}

export class CallbackDatabaseNotConfiguredError extends Error {}

export async function createSupportCallback(input: CreateCallbackInput) {
  const sql = database();
  const inserted = (await sql`
    INSERT INTO support_callbacks (
      id,
      idempotency_key,
      provider,
      provider_interaction_id,
      rider_id,
      order_id,
      issue_type,
      priority,
      summary,
      rider_language,
      support_language
    ) VALUES (
      ${input.id},
      ${input.idempotencyKey},
      ${input.provider},
      ${input.providerInteractionId || null},
      ${CALLBACK_CONFIG.rider.id},
      ${CALLBACK_CONFIG.rider.orderId},
      ${input.issueType},
      ${input.priority},
      ${input.summary},
      ${CALLBACK_CONFIG.rider.language},
      ${CALLBACK_CONFIG.support.language}
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
  `) as CallbackRow[];

  if (inserted[0]) {
    return { callback: toCallback(inserted[0]), created: true };
  }

  const existing = (await sql`
    SELECT * FROM support_callbacks
    WHERE idempotency_key = ${input.idempotencyKey}
    LIMIT 1
  `) as CallbackRow[];

  if (!existing[0]) throw new Error("Callback idempotency lookup failed");
  return { callback: toCallback(existing[0]), created: false };
}

export async function getSupportCallback(id: string) {
  const sql = database();
  const rows = (await sql`
    SELECT * FROM support_callbacks
    WHERE id = ${id} AND rider_id = ${CALLBACK_CONFIG.rider.id}
    LIMIT 1
  `) as CallbackRow[];
  return rows[0] ? toCallback(rows[0]) : null;
}

export async function getLatestSupportCallback() {
  const sql = database();
  const rows = (await sql`
    SELECT * FROM support_callbacks
    WHERE rider_id = ${CALLBACK_CONFIG.rider.id}
      AND status IN ('requested', 'ringing', 'connected')
    ORDER BY created_at DESC
    LIMIT 1
  `) as CallbackRow[];
  return rows[0] ? toCallback(rows[0]) : null;
}

export async function getRiderVisibleCallback() {
  const sql = database();
  const rows = (await sql`
    SELECT * FROM support_callbacks
    WHERE rider_id = ${CALLBACK_CONFIG.rider.id}
      AND status IN ('ringing', 'connected')
    ORDER BY created_at DESC
    LIMIT 1
  `) as CallbackRow[];
  return rows[0] ? toCallback(rows[0]) : null;
}

export async function ringSupportCallback(id: string) {
  const sql = database();
  const rows = (await sql`
    UPDATE support_callbacks
    SET status = 'ringing', updated_at = now()
    WHERE id = ${id}
      AND rider_id = ${CALLBACK_CONFIG.rider.id}
      AND status = 'requested'
    RETURNING *
  `) as CallbackRow[];
  return rows[0] ? toCallback(rows[0]) : getSupportCallback(id);
}

export async function acceptSupportCallback(id: string) {
  const sql = database();
  const rows = (await sql`
    UPDATE support_callbacks
    SET status = 'connected', connected_at = now(), updated_at = now()
    WHERE id = ${id}
      AND rider_id = ${CALLBACK_CONFIG.rider.id}
      AND status = 'ringing'
    RETURNING *
  `) as CallbackRow[];
  return rows[0] ? toCallback(rows[0]) : getSupportCallback(id);
}

export async function endSupportCallback(
  id: string,
  terminalStatus: Extract<CallbackStatus, "completed" | "declined" | "cancelled">,
) {
  const sql = database();
  const rows = (await sql`
    UPDATE support_callbacks
    SET status = ${terminalStatus}, ended_at = now(), updated_at = now()
    WHERE id = ${id}
      AND rider_id = ${CALLBACK_CONFIG.rider.id}
      AND status IN ('ringing', 'connected')
    RETURNING *
  `) as CallbackRow[];
  return rows[0] ? toCallback(rows[0]) : getSupportCallback(id);
}

