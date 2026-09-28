import type { Job } from "../shared/types.ts";
import type { Api } from "./api.ts";

export async function waitForJob(client: Api, job: Job, signal: AbortSignal): Promise<Job> {
  let current = job;
  while (current.status === "running" || current.status === "queued") {
    await waitForPoll(signal);
    current = await client.getJob(current.id);
    signal.throwIfAborted();
  }
  return current;
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 500);
    signal.addEventListener("abort", abort, { once: true });
  });
}
