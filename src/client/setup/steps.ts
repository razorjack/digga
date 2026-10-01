/** The setup's four steps (docs/FIRST_RUN.md), in order; the step is in the address. */
export type SetupStep = "catalogue" | "discogs" | "sound" | "crate";

export const SETUP_STEPS: { step: SetupStep; title: string }[] = [
  { step: "catalogue", title: "Fetch the catalogue" },
  { step: "discogs", title: "Bring your Discogs" },
  { step: "sound", title: "Pick your sound" },
  { step: "crate", title: "Fill the crate" },
];

export function isSetupStep(value: string | null): value is SetupStep {
  return SETUP_STEPS.some((entry) => entry.step === value);
}
