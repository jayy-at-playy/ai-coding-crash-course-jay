import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { requireInstructorOrAdmin } from "~/lib/access.server";
import { getInstructorAnalytics } from "~/services/instructorAnalyticsService";
import { getUserById, getUsersByRole } from "~/services/userService";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, BarChart3, ChevronRight, Plus } from "lucide-react";
import { CourseStatus, UserRole } from "~/db/schema";
import { UserAvatar } from "~/components/user-avatar";
import { CourseStatusBadge } from "~/components/course-status-badge";
import { formatRate, formatUsd } from "~/lib/utils";

// ─── Instructor Analytics Dashboard ───
// All-time enrolments, revenue, completion, progress and quiz results across
// every non-draft course the instructor owns. The numbers come from
// instructorAnalyticsService and are live on every load.

export function meta() {
  return [{ title: "Analytics — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId, user, isAdmin } = await requireInstructorOrAdmin(request);

  const instructorIdParam = new URL(request.url).searchParams.get(
    "instructorId"
  );

  // Admins with no instructor selected get a picker.
  if (isAdmin && instructorIdParam === null) {
    return {
      view: "picker" as const,
      instructors: getUsersByRole(UserRole.Instructor).map((instructor) => ({
        id: instructor.id,
        name: instructor.name,
        email: instructor.email,
        avatarUrl: instructor.avatarUrl,
      })),
    };
  }

  // Instructors always see themselves; any instructorId param is ignored.
  const instructor = isAdmin
    ? findInstructor(instructorIdParam)
    : { id: userId, name: user.name };

  return {
    view: "dashboard" as const,
    isAdmin,
    instructorName: instructor.name,
    analytics: getInstructorAnalytics(instructor.id),
  };
}

function findInstructor(instructorIdParam: string | null) {
  const instructor =
    instructorIdParam !== null && /^\d+$/.test(instructorIdParam)
      ? getUserById(Number(instructorIdParam))
      : undefined;

  if (!instructor || instructor.role !== UserRole.Instructor) {
    throw data("Instructor not found.", { status: 404 });
  }

  return instructor;
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  if (loaderData.view === "picker") {
    return <InstructorPicker instructors={loaderData.instructors} />;
  }

  const { isAdmin, instructorName, analytics } = loaderData;
  const { totals, courses } = analytics;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        {isAdmin ? (
          <Link to="/instructor/analytics" className="hover:text-foreground">
            Instructor Analytics
          </Link>
        ) : (
          <Link to="/instructor" className="hover:text-foreground">
            My Courses
          </Link>
        )}
        <span className="mx-2">/</span>
        <span className="text-foreground">
          {isAdmin ? instructorName : "Analytics"}
        </span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">
          {isAdmin ? `Analytics: ${instructorName}` : "Analytics"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          All-time numbers for {instructorName}&apos;s courses.
        </p>
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="mx-auto mb-4 size-12 text-muted-foreground/50" />
            <p className="font-medium">No courses to report on yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Analytics appear here once{" "}
              {isAdmin ? "they publish" : "you publish"} a course.
            </p>
            {!isAdmin && (
              <Link to="/instructor/new" className="mt-4 inline-block">
                <Button>
                  <Plus className="mr-2 size-4" />
                  Create Course
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Enrolments"
              value={totals.enrollments.toLocaleString("en-US")}
            />
            <StatCard label="Revenue" value={formatUsd(totals.revenueCents)} />
            <StatCard
              label="Completion rate"
              value={formatRate(totals.completionRate)}
            />
            <StatCard
              label="Average progress"
              value={formatRate(totals.averageProgress)}
            />
            <StatCard label="Quiz score" value={formatRate(totals.quizScore)} />
            <StatCard label="Pass rate" value={formatRate(totals.passRate)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Courses</CardTitle>
              <CardDescription>
                Sorted by revenue, highest first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Course</th>
                    <th className="pb-2 text-right font-medium">Enrolments</th>
                    <th className="pb-2 text-right font-medium">Revenue</th>
                    <th className="pb-2 text-right font-medium">Completion</th>
                    <th className="pb-2 text-right font-medium">
                      Avg. progress
                    </th>
                    <th className="pb-2 text-right font-medium">Quiz score</th>
                    <th className="pb-2 text-right font-medium">Pass rate</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((course) => (
                    <tr key={course.id} className="border-b last:border-0">
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/instructor/${course.id}`}
                            className="font-medium hover:text-primary"
                          >
                            {course.title}
                          </Link>
                          {course.status === CourseStatus.Archived && (
                            <CourseStatusBadge status={course.status} />
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {course.enrollments.toLocaleString("en-US")}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatUsd(course.revenueCents)}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatRate(course.completionRate)}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatRate(course.averageProgress)}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatRate(course.quizScore)}
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {formatRate(course.passRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function InstructorPicker({
  instructors,
}: {
  instructors: {
    id: number;
    name: string;
    email: string;
    avatarUrl: string | null;
  }[];
}) {
  return (
    <div className="mx-auto max-w-3xl p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Instructor Analytics</h1>
        <p className="mt-1 text-muted-foreground">
          Choose an instructor to view their dashboard.
        </p>
      </div>

      {instructors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="mx-auto mb-4 size-12 text-muted-foreground/50" />
            <p className="font-medium">No instructors yet</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {instructors.map((instructor) => (
              <Link
                key={instructor.id}
                to={`/instructor/analytics?instructorId=${instructor.id}`}
                className="flex items-center gap-3 px-6 py-4 hover:bg-muted/50"
              >
                <UserAvatar
                  name={instructor.name}
                  avatarUrl={instructor.avatarUrl}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{instructor.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {instructor.email}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Skeleton className="mb-6 h-4 w-40" />
      <Skeleton className="mb-2 h-9 w-48" />
      <Skeleton className="mb-8 h-4 w-72" />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Not allowed";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have access to this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/instructor">
          <Button>My Courses</Button>
        </Link>
      </div>
    </div>
  );
}
