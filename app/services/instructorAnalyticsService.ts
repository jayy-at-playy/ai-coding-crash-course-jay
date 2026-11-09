import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  courses,
  enrollments,
  LessonProgressStatus,
  lessonProgress,
  lessons,
  modules,
  purchases,
} from "~/db/schema";

// ─── Instructor Analytics Service ───
// All-time numbers across every course an instructor owns, for the analytics
// dashboard. Each metric is one grouped aggregate over all of the instructor's
// courses — no per-course or per-student query loops — and is computed live on
// every call.
//
// Uses positional parameters (project convention).

export type CourseAnalytics = {
  id: number;
  title: string;
  slug: string;
  status: CourseStatus;
  /** Enrolment rows, not unique students. */
  enrollments: number;
  /** Sum of amount paid (already PPP-discounted), in USD cents. */
  revenueCents: number;
  /** Completed enrolments ÷ all enrolments, 0–1; null with no enrolments. */
  completionRate: number | null;
  /**
   * Mean across enrolments of completed lessons ÷ the course's lessons, 0–1.
   * A completed enrolment counts as 1. Null with no enrolments.
   */
  averageProgress: number | null;
};

type AnalyticsTotals = Pick<
  CourseAnalytics,
  "enrollments" | "revenueCents" | "completionRate" | "averageProgress"
>;

export type InstructorAnalytics = {
  totals: AnalyticsTotals;
  courses: CourseAnalytics[];
};

/** A ratio that is undefined (null) when there is nothing to divide by. */
function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function getInstructorAnalytics(
  instructorId: number
): InstructorAnalytics {
  // Aggregate each source table on its own before joining, so enrolments and
  // purchases don't multiply each other.
  // Lesson aggregates only cover this instructor's courses, so their cost
  // grows with the instructor's catalogue, not the whole platform's.
  const instructorCourseIds = db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.instructorId, instructorId));

  const lessonCounts = db
    .select({
      courseId: modules.courseId,
      total: sql<number>`count(*)`.as("lesson_total"),
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(inArray(modules.courseId, instructorCourseIds))
    .groupBy(modules.courseId)
    .as("lesson_counts");

  // Completed lessons per (course, student). Quizzes and durations don't count.
  const completedLessons = db
    .select({
      courseId: modules.courseId,
      userId: lessonProgress.userId,
      done: sql<number>`count(distinct ${lessonProgress.lessonId})`.as(
        "lessons_done"
      ),
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(
      and(
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(modules.courseId, instructorCourseIds)
      )
    )
    .groupBy(modules.courseId, lessonProgress.userId)
    .as("completed_lessons");

  // Per-enrolment progress is worked out inside the aggregate. A completed
  // enrolment is 1 even if lessons were added after it finished; a course with
  // no lessons gives unfinished enrolments 0 rather than dividing by zero.
  const enrollmentCounts = db
    .select({
      courseId: enrollments.courseId,
      count: sql<number>`count(*)`.as("enrollment_count"),
      completed: sql<number>`count(${enrollments.completedAt})`.as(
        "completed_count"
      ),
      progressSum: sql<number>`sum(
        case
          when ${enrollments.completedAt} is not null then 1.0
          when coalesce(${lessonCounts.total}, 0) = 0 then 0.0
          else coalesce(${completedLessons.done}, 0) * 1.0 / ${lessonCounts.total}
        end
      )`.as("progress_sum"),
    })
    .from(enrollments)
    .leftJoin(lessonCounts, eq(lessonCounts.courseId, enrollments.courseId))
    .leftJoin(
      completedLessons,
      and(
        eq(completedLessons.courseId, enrollments.courseId),
        eq(completedLessons.userId, enrollments.userId)
      )
    )
    .groupBy(enrollments.courseId)
    .as("enrollment_counts");

  const revenueSums = db
    .select({
      courseId: purchases.courseId,
      total: sql<number>`sum(${purchases.amountPaid})`.as("revenue_total"),
    })
    .from(purchases)
    .groupBy(purchases.courseId)
    .as("revenue_sums");

  const revenueCents = sql<number>`coalesce(${revenueSums.total}, 0)`;

  const rows = db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      status: courses.status,
      enrollments: sql<number>`coalesce(${enrollmentCounts.count}, 0)`,
      completed: sql<number>`coalesce(${enrollmentCounts.completed}, 0)`,
      progressSum: sql<number>`coalesce(${enrollmentCounts.progressSum}, 0)`,
      revenueCents,
    })
    .from(courses)
    .leftJoin(enrollmentCounts, eq(enrollmentCounts.courseId, courses.id))
    .leftJoin(revenueSums, eq(revenueSums.courseId, courses.id))
    .where(
      and(
        eq(courses.instructorId, instructorId),
        // Drafts are unpublished work; archived courses keep their history.
        ne(courses.status, CourseStatus.Draft)
      )
    )
    // Ties fall back to title so the order is stable between loads.
    .orderBy(desc(revenueCents), asc(courses.title))
    .all();

  // Rates in the totals are taken across all enrolments, not averaged over
  // the per-course rates, so the raw counts are summed first.
  const sums = rows.reduce(
    (acc, row) => ({
      enrollments: acc.enrollments + row.enrollments,
      completed: acc.completed + row.completed,
      progressSum: acc.progressSum + row.progressSum,
      revenueCents: acc.revenueCents + row.revenueCents,
    }),
    { enrollments: 0, completed: 0, progressSum: 0, revenueCents: 0 }
  );

  return {
    totals: {
      enrollments: sums.enrollments,
      revenueCents: sums.revenueCents,
      completionRate: rate(sums.completed, sums.enrollments),
      averageProgress: rate(sums.progressSum, sums.enrollments),
    },
    courses: rows.map(({ completed, progressSum, ...row }) => ({
      ...row,
      completionRate: rate(completed, row.enrollments),
      averageProgress: rate(progressSum, row.enrollments),
    })),
  };
}
