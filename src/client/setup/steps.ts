/** The setup's four steps (docs/FIRST_RUN.md), in order; the step is in the address. */
export type SetupStep = "catalogue" | "discogs" | "sound" | "crate";

/** Each step with its place in the step list, numbered as tracks on a record's two sides. */
export const SETUP_STEPS: { step: SetupStep; title: string; position: string }[] = [
  { step: "catalogue", title: "Fetch the catalogue", position: "A1" },
  { step: "discogs", title: "Bring your Discogs", position: "A2" },
  { step: "sound", title: "Pick your sound", position: "B1" },
  { step: "crate", title: "Fill the crate", position: "B2" },
];

export function isSetupStep(value: string | null): value is SetupStep {
  return SETUP_STEPS.some((entry) => entry.step === value);
}
