import { expect, it } from "vite-plus/test";
import type { ListenLogInput } from "../src/shared/api.ts";
import type { PlaylistEntry } from "../src/shared/playlist.ts";
import { ListenLog } from "../src/client/player/listen-log.ts";

const entry = {
  video: { videoId: "aaaaaaaaaa1", title: "A1 upload", durationSeconds: 300 },
  track: { position: "A1", heardKey: "tune-a1", artistDisplay: "Artist", title: "A1" },
} as PlaylistEntry;

function recordingLog() {
  const posts: ListenLogInput[] = [];
  const log = new ListenLog({
    postListenLog: async (input) => {
      posts.push(input);
      return { id: posts.length, heardKey: null };
    },
  });
  return { log, posts };
}

it("posts a play as heard once it passes the threshold, then the rest when it ends", () => {
  const { log, posts } = recordingLog();
  log.begin(7, entry, 150);
  expect(log.count(2, 152)).toBeNull();
  expect(log.count(2, 154)).toEqual({ position: "A1", heardKey: "tune-a1" });
  expect(log.count(2, 156)).toBeNull();
  log.flush(156);

  expect(posts.map((post) => [post.seconds, post.heard])).toEqual([
    [4, true],
    [2, true],
  ]);
  expect(posts.map((post) => [post.context?.startSeconds, post.context?.endSeconds])).toEqual([
    [150, 154],
    [154, 156],
  ]);
  expect(log.active).toBe(false);
});

it("posts a short play as not heard, and nothing for a dropped one", () => {
  const { log, posts } = recordingLog();
  log.begin(7, entry, 0);
  log.count(1, 1);
  log.flush(1);
  log.begin(7, entry, 1);
  log.count(1, 2);
  log.drop();
  log.flush(2);
  expect(posts.map((post) => [post.seconds, post.heard])).toEqual([[1, false]]);
});
