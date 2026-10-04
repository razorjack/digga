import type { Attachment } from "svelte/attachments";
import type { ConfigIssue } from "../../shared/config.ts";

/** The config problem at `path`, such as "queue.limit"; empty when there is none. */
export function problemAt(issues: readonly ConfigIssue[], path: string): string {
  return issues.find((issue) => issue.path === path)?.message ?? "";
}

/**
 * Reports the config problem at `path` on its field: the constraint validation API drives
 * `:user-invalid` and blocks submission, `aria-invalid` tells assistive technology. The field's
 * description references the element that shows the message.
 */
export function reportProblem(
  issues: readonly ConfigIssue[],
  path: string,
): Attachment<HTMLInputElement> {
  return (input) => {
    const message = problemAt(issues, path);
    input.setCustomValidity(message);
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
}
