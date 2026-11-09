import { CourseStatus } from "~/db/schema";

const STYLES: Record<CourseStatus, { label: string; className: string }> = {
  [CourseStatus.Published]: {
    label: "Published",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  [CourseStatus.Draft]: {
    label: "Draft",
    className:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  [CourseStatus.Archived]: {
    label: "Archived",
    className: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  },
};

/** A small pill naming a course's status. Renders nothing for unknown values. */
export function CourseStatusBadge({ status }: { status: string }) {
  const style = STYLES[status as CourseStatus];
  if (!style) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}
