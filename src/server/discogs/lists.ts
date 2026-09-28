import type { DiscogsClient } from "./client.ts";
import type { DiscogsUserList } from "./types.ts";

export async function listUserLists(
  discogs: DiscogsClient,
  username: string,
): Promise<DiscogsUserList[]> {
  const lists: DiscogsUserList[] = [];
  for (let page = 1; ; page += 1) {
    const response = await discogs.getUserLists(username, page);
    lists.push(...response.lists);
    if (page >= response.pagination.pages || response.lists.length === 0) return lists;
  }
}
