import type { CollectedContentItem, IngestPayload, Platform, SearchRequest, SocialMetrics } from '@trendsetter/shared';
import { platforms } from '@trendsetter/shared';

type JsonRecord = Record<string, unknown>;

export function validateIngestPayload(body: unknown): IngestPayload {
  const record = asRecord(body, 'Request body must be an object.');
  const platform = readPlatform(record.platform);
  const accountHandle = readRequiredString(record.accountHandle, 'accountHandle');
  const rawItems = Array.isArray(record.items) ? record.items : [];
  if (!rawItems.length) {
    throw new Error('items must contain at least one collected item.');
  }

  const collectorRecord = asRecord(record.collector ?? {}, 'collector must be an object.');
  const payload: IngestPayload = {
    platform,
    accountHandle,
    collector: {
      name: readString(collectorRecord.name) ?? 'trendsetter-extension',
      version: readString(collectorRecord.version) ?? '0.1.0',
      collectedFromUrl: readString(collectorRecord.collectedFromUrl) ?? readString(record.accountUrl) ?? '',
      maxScrolls: readNumber(collectorRecord.maxScrolls) ?? 0
    },
    items: rawItems.map((item) => normalizeItem(item, platform, accountHandle, readString(record.accountUrl)))
  };

  const accountUrl = readString(record.accountUrl);
  const userAgent = readString(collectorRecord.userAgent);
  if (accountUrl) payload.accountUrl = accountUrl;
  if (userAgent) payload.collector.userAgent = userAgent;

  return payload;
}

export function validateSearchRequest(body: unknown): SearchRequest {
  const record = asRecord(body, 'Request body must be an object.');
  const query = readRequiredString(record.query, 'query');
  const request: SearchRequest = {
    query,
    topK: clampInteger(readNumber(record.topK) ?? 8, 1, 50)
  };

  if (record.platform) {
    request.platform = readPlatform(record.platform);
  }

  const accountHandle = readString(record.accountHandle);
  if (accountHandle) {
    request.accountHandle = accountHandle;
  }

  return request;
}

function normalizeItem(raw: unknown, platform: Platform, accountHandle: string, accountUrl: string | undefined): CollectedContentItem {
  const record = asRecord(raw, 'Each item must be an object.');
  const sourceUrl = readRequiredString(record.sourceUrl, 'items[].sourceUrl');
  const metrics = normalizeMetrics(record.metrics);
  const itemPlatform = record.platform ? readPlatform(record.platform) : platform;
  const itemAccountHandle = readString(record.accountHandle) ?? accountHandle;

  if (itemPlatform !== platform) {
    throw new Error('items[].platform must match the top-level platform.');
  }

  if (itemAccountHandle !== accountHandle) {
    throw new Error('items[].accountHandle must match the top-level accountHandle.');
  }

  const item: CollectedContentItem = {
    platform,
    accountHandle,
    sourceUrl,
    itemType: readItemType(record.itemType),
    metrics,
    collectedAt: readString(record.collectedAt) ?? new Date().toISOString()
  };

  const finalAccountUrl = readString(record.accountUrl) ?? accountUrl;
  const canonicalUrl = readString(record.canonicalUrl);
  const externalId = readString(record.externalId);
  const title = readString(record.title);
  const text = readString(record.text);
  const thumbnailUrl = readString(record.thumbnailUrl);
  const postedAt = readString(record.postedAt);

  if (finalAccountUrl) item.accountUrl = finalAccountUrl;
  if (canonicalUrl) item.canonicalUrl = canonicalUrl;
  if (externalId) item.externalId = externalId;
  if (title) item.title = title;
  if (text) item.text = text;
  if (thumbnailUrl) item.thumbnailUrl = thumbnailUrl;
  if (postedAt) item.postedAt = postedAt;
  if ('raw' in record) item.raw = record.raw;

  return item;
}

function normalizeMetrics(value: unknown): SocialMetrics {
  const record = value && typeof value === 'object' ? (value as JsonRecord) : {};
  const metrics: SocialMetrics = {};
  for (const key of ['views', 'likes', 'comments', 'replies', 'reposts', 'shares', 'bookmarks'] as const) {
    const number = readNumber(record[key]);
    if (number !== undefined) {
      metrics[key] = number;
    }
  }
  return metrics;
}

function readPlatform(value: unknown): Platform {
  if (typeof value === 'string' && platforms.includes(value as Platform)) {
    return value as Platform;
  }
  throw new Error('platform must be instagram, x, or youtube.');
}

function readItemType(value: unknown): CollectedContentItem['itemType'] {
  const allowed = new Set(['post', 'reel', 'video', 'short', 'tweet', 'unknown']);
  return typeof value === 'string' && allowed.has(value) ? (value as CollectedContentItem['itemType']) : 'unknown';
}

function asRecord(value: unknown, message: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as JsonRecord;
}

function readRequiredString(value: unknown, fieldName: string): string {
  const text = readString(value);
  if (!text) {
    throw new Error(`${fieldName} is required.`);
  }
  return text;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.trunc(value);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}