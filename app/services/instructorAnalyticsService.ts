import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  courses,
  enrollments,
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
};

export type InstructorAnalytics = {
  totals: { enrollments: number; revenueCents: number };
  courses: CourseAnalytics[];
};

export function getInstructorAnalytics(
  instructorId: number
): InstructorAnalytics {
  // Aggregate each source table on its own before joining, so enrolments and
  // purchases don't multiply each other.
  const enrollmentCounts = db
    .select({
      courseId: enrollments.courseId,
      count: sql<number>`count(*)`.as("enrollment_count"),
    })
    .from(enrollments)
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

  const totals = rows.reduce(
    (acc, row) => ({
      enrollments: acc.enrollments + row.enrollments,
      revenueCents: acc.revenueCents + row.revenueCents,
    }),
    { enrollments: 0, revenueCents: 0 }
  );

  return { totals, courses: rows };
}
