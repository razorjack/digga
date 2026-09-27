/** Subset of the Discogs API v2 JSON shapes that Digga reads. */

export interface DiscogsArtist {
  id: number;
  name: string;
  anv?: string;
  join?: string;
}

export interface DiscogsLabel {
  id: number;
  name: string;
  catno?: string;
}

export interface DiscogsFormat {
  name: string;
  qty?: string;
  text?: string;
  descriptions?: string[];
}

export interface DiscogsVideo {
  uri: string;
  title?: string;
  duration?: number;
  embed?: boolean;
}

export interface DiscogsTrack {
  position: string;
  title: string;
  duration?: string;
  artists?: DiscogsArtist[];
}

export interface DiscogsRelease {
  id: number;
  master_id?: number;
  title: string;
  year?: number;
  released?: string;
  country?: string;
  artists?: DiscogsArtist[];
  labels?: DiscogsLabel[];
  formats?: DiscogsFormat[];
  genres?: string[];
  styles?: string[];
  lowest_price?: number | null;
  num_for_sale?: number;
  community?: { have?: number; want?: number };
  videos?: DiscogsVideo[];
  tracklist?: DiscogsTrack[];
}

export interface DiscogsBasicInformation {
  id: number;
  master_id?: number | null;
  title: string;
  year?: number;
  artists?: DiscogsArtist[];
  labels?: DiscogsLabel[];
  formats?: DiscogsFormat[];
  genres?: string[];
  styles?: string[];
}

export interface DiscogsPagination {
  page: number;
  pages: number;
  per_page: number;
  items: number;
}

export interface DiscogsCollectionItem {
  id: number;
  instance_id: number;
  date_added: string;
  rating?: number;
  folder_id?: number;
  notes?: { field_id: number; value: string }[];
  basic_information: DiscogsBasicInformation;
}

export interface DiscogsCollectionPage {
  pagination: DiscogsPagination;
  releases: DiscogsCollectionItem[];
}

export interface DiscogsWantItem {
  id: number;
  rating?: number;
  notes?: string;
  date_added: string;
  basic_information: DiscogsBasicInformation;
}

export interface DiscogsWantlistPage {
  pagination: DiscogsPagination;
  wants: DiscogsWantItem[];
}

export interface DiscogsIdentity {
  id: number;
  username: string;
}

export interface DiscogsUserList {
  id: number;
  name: string;
  public: boolean;
  description?: string;
  date_changed?: string;
}

export interface DiscogsUserListsPage {
  pagination: DiscogsPagination;
  lists: DiscogsUserList[];
}

/** A list entry; `type` is release, master, artist or label. */
export interface DiscogsListItem {
  id: number;
  type: string;
  display_title?: string;
  comment?: string;
  uri?: string;
}

export interface DiscogsList {
  id: number;
  name: string;
  public?: boolean;
  items: DiscogsListItem[];
}

export interface DiscogsMaster {
  id: number;
  main_release: number;
  title?: string;
}
