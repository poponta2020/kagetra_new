import { mailAttachments } from '@kagetra/shared/schema'
import type { Db } from '../db.js'

type MailAttachmentRow = typeof mailAttachments.$inferSelect
type MailAttachmentInsert = typeof mailAttachments.$inferInsert

export interface InsertMailAttachmentInput {
  mailMessageId: number
  filename: string
  contentType: string
  sizeBytes: number
  data: Buffer
  extractedText: string | null
  extractionStatus: MailAttachmentInsert['extractionStatus']
}

/**
 * Append-only insert for mail_attachments.
 *
 * Unlike mail_messages we do NOT de-duplicate on (mail_message_id, filename):
 * the worker only enters this code path with a fresh mail_messages row id, so
 * duplicate calls would represent a logic bug worth surfacing rather than
 * silently coalescing. Dedup of the parent mail itself happens upstream via
 * `mail_messages.message_id UNIQUE`.
 */
export async function insertMailAttachment(
  db: Db,
  input: InsertMailAttachmentInput,
): Promise<MailAttachmentRow> {
  const inserted = await db
    .insert(mailAttachments)
    .values({
      mailMessageId: input.mailMessageId,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      data: input.data,
      extractedText: input.extractedText,
      extractionStatus: input.extractionStatus,
    })
    .returning()
  if (!inserted[0]) {
    throw new Error('insertMailAttachment: insert returned no rows')
  }
  return inserted[0]
}
