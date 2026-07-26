/**
 * Grade constants shared by page.tsx / actions.ts / GradeGroupList.tsx.
 *
 * Kept out of actions.ts on purpose: that file has `'use server'` at the
 * top, and Next.js requires every export from a `'use server'` module to be
 * an async function. A plain `const` export there is a build-time error
 * that `tsc` / vitest won't catch (they don't run the Next compiler).
 */
export const GRADES = ['A', 'B', 'C', 'D', 'E'] as const
export type Grade = (typeof GRADES)[number]
