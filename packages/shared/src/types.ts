export const platforms = ['instagram', 'x', 'youtube'] as const;

export type Platform = (typeof platforms)[number];

export type ContentItemType =
  | 'post'
  | 'reel'
  | 'video'
  | 'short'
  | 'tweet'
  | 'unknown';

export interface SocialMetrics {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  replies?: number | null;
  reposts?: number | null;
  shares?: number | null;
  bookmarks?: number | null;
}

export interface CollectedContentItem {
  platform: Platform;
  accountHandle: string;
  accountUrl?: string;
  sourceUrl: string;
  canonicalUrl?: string;
  externalId?: string;
  itemType: ContentItemType;
  title?: string;
  text?: string;
  thumbnailUrl?: string;
  postedAt?: string;
  metrics: SocialMetrics;
  raw?: unknown;
  collectedAt: string;
}

export interface CollectorMetadata {
  name: string;
  version: string;
  collectedFromUrl: string;
  maxScrolls: number;
  userAgent?: string;
}

export interface IngestPayload {
  platform: Platform;
  accountHandle: string;
  accountUrl?: string;
  collector: CollectorMetadata;
  items: CollectedContentItem[];
}

export interface IngestResult {
  accountId: number;
  inserted: number;
  updated: number;
  indexed: number;
  totalReceived: number;
}

export interface AccountSummary {
  id: number;
  platform: Platform;
  handle: string;
  url?: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredContentItem extends CollectedContentItem {
  id: number;
  accountId: number;
  createdAt: string;
  updatedAt: string;
}

export interface SearchRequest {
  query: string;
  platform?: Platform;
  accountHandle?: string;
  topK?: number;
}

export interface SearchResultItem {
  item: StoredContentItem;
  score: number;
  semanticScore: number;
  rerankScore: number;
  reason: string;
}

export interface RagAnswer {
  answer: string;
  results: SearchResultItem[];
  model: string;
}