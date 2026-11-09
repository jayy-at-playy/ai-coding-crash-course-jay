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
    .values({ name: `User ${emailCounter}`, email: `user${emailCounter}@example.com`, role })
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

function enroll(userId: number, courseId: number) {
  testDb.insert(schema.enrollments).values({ userId, courseId }).run();
}

function purchase(userId: number, courseId: number, amountPaid: number) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid, country: null })
    .returning()
    .get();
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

      expect(result.totals).toEqual({ enrollments: 2, revenueCents: 9800 });
      expect(result.courses).toEqual([
        {
          id: base.course.id,
          title: "Test Course",
          slug: "test-course",
          status: schema.CourseStatus.Published,
          enrollments: 2,
          revenueCents: 9800,
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
      expect(result.totals).toEqual({ enrollments: 1, revenueCents: 2000 });
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
      expect(result.totals).toEqual({ enrollments: 1, revenueCents: 3000 });
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

    it("returns no courses and zero totals when the instructor has none", () => {
      const newInstructor = createUser(schema.UserRole.Instructor);

      expect(getInstructorAnalytics(newInstructor.id)).toEqual({
        totals: { enrollments: 0, revenueCents: 0 },
        courses: [],
      });
    });
  });
});
