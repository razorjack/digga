import type { Attachment } from "svelte/attachments";

/**
 * Reports a problem on its field: the custom validity drives `:user-invalid` and blocks the form's
 * submission, and `aria-invalid` tells assistive technology. An empty message clears both. The
 * field's description references the element that shows the message while there is one.
 */
export function reportProblem(message: string): Attachment<HTMLInputElement> {
  return (input) => {
    input.setCustomValidity(message);
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
}

/** The field's description: its hint, and the element with its problem while it has one. */
export function describedBy(hintId: string, problemId: string, problem: string): string {
  return problem ? `${hintId} ${problemId}` : hintId;
}
