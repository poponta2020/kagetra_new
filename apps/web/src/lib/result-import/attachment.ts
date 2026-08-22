// Dependency-free leaf module: may be imported from both server actions
// ('use server' files cannot export non-async values) and client components.
// Do not add 'node:' imports here.

const RESULT_IMPORT_EXTENSIONS = ['.xls', '.xlsx', '.pdf']

/**
 * Returns true if the given filename is an attachment type that can be
 * queued for result import (Excel or PDF, case-insensitive).
 */
export function isResultImportAttachment(filename: string): boolean {
  const lower = filename.toLowerCase()
  return RESULT_IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}
