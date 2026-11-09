import { Link, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { requireInstructorOrAdmin } from "~/lib/access.server";
import { getInstructorAnalytics } from "~/services/instructorAnalyticsService";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, BarChart3, Plus } from "lucide-react";
import { CourseStatus } from "~/db/schema";
import { CourseStatusBadge } from "~/components/course-status-badge";
import { formatUsd } from "~/lib/utils";

// ─── Instructor Analytics Dashboard ───
// All-time enrolments and revenue across every non-draft course the instructor
// owns. The numbers come from instructorAnalyticsService and are live on every
// load.

export function meta() {
  return [{ title: "Analytics — Cadence" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  // Admins get in, but for now they only see their own (empty) instructor view.
  const { userId, user } = await requireInstructorOrAdmin(request);

  return {
    instructorName: user.name,
    analytics: getInstructorAnalytics(userId),
  };
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { instructorName, analytics } = loaderData;
  const { totals, courses } = analytics;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Analytics</h1>
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
              Analytics appear here once you publish a course.
            </p>
            <Link to="/instructor/new" className="mt-4 inline-block">
              <Button>
                <Plus className="mr-2 size-4" />
                Create Course
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2">
            <StatCard label="Enrolments" value={totals.enrollments.toLocaleString("en-US")} />
            <StatCard label="Revenue" value={formatUsd(totals.revenueCents)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Courses</CardTitle>
              <CardDescription>Sorted by revenue, highest first.</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Course</th>
                    <th className="pb-2 text-right font-medium">Enrolments</th>
                    <th className="pb-2 text-right font-medium">Revenue</th>
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
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
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
