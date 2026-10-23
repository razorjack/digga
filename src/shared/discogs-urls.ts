export function discogsReleaseUrl(id: number): string {
  return `https://www.discogs.com/release/${id}`;
}

export function discogsMasterUrl(id: number): string {
  return `https://www.discogs.com/master/${id}`;
}

export function discogsListingUrl(id: number): string {
  return `https://www.discogs.com/sell/item/${id}`;
}
