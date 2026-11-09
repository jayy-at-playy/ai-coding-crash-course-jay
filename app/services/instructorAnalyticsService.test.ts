import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import { getInstructorAnalytics } from "./instructorAnalyticsService";

let emailCounter = 0;

function createUser(role: schema.UserRole = schema.UserRole.Student) {
  emailCounter += 1;
  return testDb
    .insert(schema.users)
    .values({
      name: `User ${emailCounter}`,
      email: `user${emailCounter}@example.com`,
      role,
    })
    .returning()
    .get();
}

function createCourse(
  slug: string,
  status: schema.CourseStatus = schema.CourseStatus.Published,
  instructorId: number = base.instructor.id
) {
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${slug}`,
      slug,
      description: "A course",
      salesCopy: "Sales copy.",
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

function enroll(
  userId: number,
  courseId: number,
  completedAt: string | null = null
) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId, completedAt })
    .run();
}

function purchase(userId: number, courseId: number, amountPaid: number) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid, country: null })
    .returning()
    .get();
}

function createLessons(courseId: number, count: number) {
  const courseModule = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  return Array.from({ length: count }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({
        moduleId: courseModule.id,
        title: `Lesson ${i + 1}`,
        position: i + 1,
      })
      .returning()
      .get()
  );
}

function recordLessonProgress(
  userId: number,
  lessonId: number,
  status: schema.LessonProgressStatus = schema.LessonProgressStatus.Completed
) {
  testDb
    .insert(schema.lessonProgress)
    .values({ userId, lessonId, status })
    .run();
}

describe("instructorAnalyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getInstructorAnalytics", () => {
    it("reports enrolments and revenue for the instructor's course", () => {
      const student2 = createUser();
      enroll(base.user.id, base.course.id);
      enroll(student2.id, base.course.id);
      purchase(base.user.id, base.course.id, 4900);
      purchase(student2.id, base.course.id, 4900);

      const result = getInstructorAnalytics(base.instructor.id);

      expect(result.totals).toEqual({
        enrollments: 2,
        revenueCents: 9800,
        completionRate: 0,
        averageProgress: 0,
      });
      expect(result.courses).toEqual([
        {
          id: base.course.id,
          title: "Test Course",
          slug: "test-course",
          status: schema.CourseStatus.Published,
          enrollments: 2,
          revenueCents: 9800,
          completionRate: 0,
          averageProgress: 0,
        },
      ]);
    });

    it("excludes draft courses and includes archived ones", () => {
      const draft = createCourse("draft", schema.CourseStatus.Draft);
      const archived = createCourse("archived", schema.CourseStatus.Archived);
      enroll(base.user.id, draft.id);
      purchase(base.user.id, draft.id, 1000);
      enroll(base.user.id, archived.id);
      purchase(base.user.id, archived.id, 2000);

      const result = getInstructorAnalytics(base.instructor.id);

      expect(result.courses.map((c) => c.slug).sort()).toEqual([
        "archived",
        "test-course",
      ]);
      expect(result.courses.find((c) => c.slug === "archived")!.status).toBe(
        schema.CourseStatus.Archived
      );
      expect(result.totals).toMatchObject({
        enrollments: 1,
        revenueCents: 2000,
      });
    });

    it("sorts courses by revenue, highest first", () => {
      const low = createCourse("low");
      const high = createCourse("high");
      purchase(base.user.id, low.id, 1000);
      purchase(base.user.id, high.id, 9000);
      purchase(base.user.id, base.course.id, 5000);

      const result = getInstructorAnalytics(base.instructor.id);

      expect(result.courses.map((c) => c.slug)).toEqual([
        "high",
        "test-course",
        "low",
      ]);
    });

    it("never includes another instructor's courses", () => {
      const otherInstructor = createUser(schema.UserRole.Instructor);
      const theirs = createCourse(
        "theirs",
        schema.CourseStatus.Published,
        otherInstructor.id
      );
      enroll(base.user.id, theirs.id);
      purchase(base.user.id, theirs.id, 7000);
      enroll(base.user.id, base.course.id);
      purchase(base.user.id, base.course.id, 3000);

      const result = getInstructorAnalytics(base.instructor.id);

      expect(result.courses.map((c) => c.slug)).toEqual(["test-course"]);
      expect(result.totals).toMatchObject({
        enrollments: 1,
        revenueCents: 3000,
      });
    });

    it("counts the PPP-discounted amount actually paid as revenue", () => {
      testDb
        .update(schema.courses)
        .set({ price: 10000 })
        .where(eq(schema.courses.id, base.course.id))
        .run();
      // Full price from one student, a 60%-off PPP price from another.
      const student2 = createUser();
      purchase(base.user.id, base.course.id, 10000);
      purchase(student2.id, base.course.id, 4000);

      const result = getInstructorAnalytics(base.instructor.id);

      expect(result.courses[0].revenueCents).toBe(14000);
    });

    it("counts a team purchase in full, regardless of redeemed seats", () => {
      const buyer = createUser();
      const teamPurchase = purchase(buyer.id, base.course.id, 25000);
      const team = testDb.insert(schema.teams).values({}).returning().get();
      testDb
        .insert(schema.coupons)
        .values([
          {
            teamId: team.id,
            courseId: base.course.id,
            code: "SEAT-1",
            purchaseId: teamPurchase.id,
            redeemedByUserId: base.user.id,
            redeemedAt: new Date().toISOString(),
          },
          {
            teamId: team.id,
            courseId: base.course.id,
            code: "SEAT-2",
            purchaseId: teamPurchase.id,
          },
        ])
        .run();
      enroll(base.user.id, base.course.id);

      const result = getInstructorAnalytics(base.instructor.id);

      expect(result.courses[0]).toMatchObject({
        enrollments: 1,
        revenueCents: 25000,
      });
      expect(result.totals.revenueCents).toBe(25000);
    });

    it("reports the share of enrolments that are completed", () => {
      const student2 = createUser();
      const student3 = createUser();
      const student4 = createUser();
      enroll(base.user.id, base.course.id, "2026-01-01T00:00:00.000Z");
      enroll(student2.id, base.course.id);
      enroll(student3.id, base.course.id);
      enroll(student4.id, base.course.id);

      const result = getInstructorAnalytics(base.instructor.id);

      expect(result.courses[0].completionRate).toBe(0.25);
      expect(result.totals.completionRate).toBe(0.25);
    });

    it("averages each enrolment's share of completed lessons", () => {
      const lessons = createLessons(base.course.id, 4);
      const student2 = createUser();
      enroll(base.user.id, base.course.id);
      enroll(student2.id, base.course.id);
      // 3 of 4 lessons done, and 1 of 4 done with another merely started.
      recordLessonProgress(base.user.id, lessons[0].id);
      recordLessonProgress(base.user.id, lessons[1].id);
      recordLessonProgress(base.user.id, lessons[2].id);
      recordLessonProgress(student2.id, lessons[0].id);
      recordLessonProgress(
        student2.id,
        lessons[1].id,
        schema.LessonProgressStatus.InProgress
      );

      const result = getInstructorAnalytics(base.instructor.id);

      // (0.75 + 0.25) / 2
      expect(result.courses[0].averageProgress).toBe(0.5);
      expect(result.totals.averageProgress).toBe(0.5);
    });

    it("counts a completed enrolment as full progress, even after lessons are added", () => {
      const lessons = createLessons(base.course.id, 2);
      enroll(base.user.id, base.course.id, "2026-01-01T00:00:00.000Z");
      recordLessonProgress(base.user.id, lessons[0].id);
      recordLessonProgress(base.user.id, lessons[1].id);
      // Two more lessons published after the student finished.
      createLessons(base.course.id, 2);

      const result = getInstructorAnalytics(base.instructor.id);

      expect(result.courses[0].averageProgress).toBe(1);
    });

    it("reports null rates for a course with no enrolments", () => {
      const empty = createCourse("empty");
      createLessons(empty.id, 3);

      const result = getInstructorAnalytics(base.instructor.id);

      expect(result.courses.find((c) => c.id === empty.id)).toMatchObject({
        enrollments: 0,
        completionRate: null,
        averageProgress: null,
      });
      expect(result.totals).toMatchObject({
        completionRate: null,
        averageProgress: null,
      });
    });

    it("takes total rates across all enrolments, not as an average of course rates", () => {
      const big = createCourse("big");
      const bigLessons = createLessons(big.id, 2);
      createLessons(base.course.id, 1);
      const students = [createUser(), createUser(), createUser()];
      // One enrolment on the base course, finished.
      enroll(base.user.id, base.course.id, "2026-01-01T00:00:00.000Z");
      // Three on the big course, unfinished, each with half the lessons done.
      for (const student of students) {
        enroll(student.id, big.id);
        recordLessonProgress(student.id, bigLessons[0].id);
      }
      // An empty course must not drag the totals down.
      createCourse("empty");

      const result = getInstructorAnalytics(base.instructor.id);

      // Averaging course rates would give 0.5 and 0.75.
      expect(result.totals.completionRate).toBe(0.25);
      // (1 + 0.5 + 0.5 + 0.5) / 4
      expect(result.totals.averageProgress).toBe(0.625);
    });

    it("returns no courses and zero totals when the instructor has none", () => {
      const newInstructor = createUser(schema.UserRole.Instructor);

      expect(getInstructorAnalytics(newInstructor.id)).toEqual({
        totals: {
          enrollments: 0,
          revenueCents: 0,
          completionRate: null,
          averageProgress: null,
        },
        courses: [],
      });
    });
  });
});
