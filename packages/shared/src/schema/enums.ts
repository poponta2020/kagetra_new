import { pgEnum } from 'drizzle-orm/pg-core'

export const userRoleEnum = pgEnum('user_role', ['admin', 'vice_admin', 'member'])
export const eventStatusEnum = pgEnum('event_status', ['draft', 'published', 'cancelled', 'done'])
export const gradeEnum = pgEnum('grade', ['A', 'B', 'C', 'D', 'E'])
export const eventKindEnum = pgEnum('event_kind', ['individual', 'team'])
export const attendanceStatusEnum = pgEnum('attendance_status', ['attend', 'absent'])
export const scheduleKindEnum = pgEnum('schedule_kind', ['practice', 'meeting', 'social', 'other'])
