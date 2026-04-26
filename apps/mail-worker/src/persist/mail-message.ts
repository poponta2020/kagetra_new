import { eq, sql } from 'drizzle-orm'
import { mailMessages } from '@kagetra/shared/schema'
import type { Db } from '../db.js'

type MailMessageRow = typeof mailMessages.$inferSelect
type MailMessageInsert = typeof mailMessages.$inferInsert

export interface InsertMailMessageInput {
  messageId: string
  fromAddress: string
  fromName: string | null
  toAddresses: string[]
  /** Nullable: mails legitimately omit Subject; the column is nullable too. */
  subject: string | null
  receivedAt: Date
  bodyText: string | null
  bodyHtml: string | null
  status?: MailMessageInsert['status']
  classification?: MailMessageInsert['classification']
  imapUid: number | null
  imapBox: string | null
}

export interface InsertMailMessageResult {
  /** The persisted row, or the existing row if Message-ID was a duplicate. */
  row: MailMessageRow
  /** True when the Message-ID already existed (idempotent insert hit). */
  duplicated: boolean
}

/**
 * Idempotent insert keyed on `message_id` UNIQUE.
 *
 * We use Postgres `ON CONFLICT (message_id) DO NOTHING RETURNING *` and, when
 * RETURNING is empty (conflict), follow up with a SELECT to give the caller a
 * full row reference. This avoids races where two workers fetch the same UID
 * at the same time.
 */
export async function insertMailMessage(
  db: Db,
  input: InsertMailMessageInput,
): Promise<InsertMailMessageResult> {
  const inserted = await db
    .insert(mailMessages)
    .values({
      messageId: input.messageId,
      fromAddress: input.fromAddress,
      fromName: input.fromName,
      toAddresses: input.toAddresses,
      subject: input.subject,
      receivedAt: input.receivedAt,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      status: input.status ?? 'fetched',
      classification: input.classification ?? null,
      imapUid: input.imapUid,
      imapBox: input.imapBox,
    })
    .onConflictDoNothing({ target: mailMessages.messageId })
    .returning()

  if (inserted.length > 0) {
    return { row: inserted[0]!, duplicated: false }
  }

  const existing = await findByMessageId(db, input.messageId)
  if (!existing) {
    // Highly unlikely (insert returned no rows but lookup also fails) — surface
    // a clear error rather than returning a partial result.
    throw new Error(
      `insertMailMessage: ON CONFLICT DO NOTHING returned no row but Message-ID ${input.messageId} was not found on follow-up SELECT`,
    )
  }
  return { row: existing, duplicated: true }
}

export async function findByMessageId(
  db: Db,
  messageId: string,
): Promise<MailMessageRow | null> {
  const rows = await db
    .select()
    .from(mailMessages)
    .where(eq(mailMessages.messageId, messageId))
    .limit(1)
  return rows[0] ?? null
}

export async function updateStatus(
  db: Db,
  id: number,
  status: MailMessageInsert['status'],
): Promise<void> {
  await db
    .update(mailMessages)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(mailMessages.id, id))
}
