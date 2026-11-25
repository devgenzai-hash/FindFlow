import type {
  AccountSummary,
  CollectedContentItem,
  ContentItemType,
  IngestPayload,
  IngestResult,
  Platform,
  SocialMetrics,
  StoredContentItem
} from '@trendsetter/shared';
import type { SqliteDatabase } from './connection.js';

export interface IngestPersistenceResult extends IngestResult {
  itemIds: number[];
}

export interface ItemListFilters {
  platform?: Platform;
  accountHandle?: string;
  sort?: 'views' | 'likes' | 'comments' | 'updated';
  limit?: number;
}

export interface IndexFilters {
  platform?: Platform;
  accountHandle?: string;
}

interface AccountRow {
  id: number;
  platform: string;
  handle: string;
  url: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
}

interface ItemRow {
  id: number;
  account_id: number;
  account_handle: string;
  account_url: string | null;
  platform: string;
  external_id: string | null;
  url: string;
  item_type: string;
  title: string | null;
  body: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  collected_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  replies: number | null;
  reposts: number | null;
  shares: number | null;
  bookmarks: number | null;
  raw_json: string | null;
  created_at: string;
  updated_at: string;
}

export class TrendRepository {
  constructor(private readonly db: SqliteDatabase) {}

  ingest(payload: IngestPayload): IngestPersistenceResult {
    const persist = this.db.transaction((body: IngestPayload) => {
      const now = new Date().toISOString();
      const accountId = this.upsertAccount(body, now);
      this.insertIngestRun(accountId, body, now);

      let inserted = 0;
      let updated = 0;
      const itemIds: number[] = [];

      for (const item of body.items) {
        const existing = this.db
          .prepare('SELECT id FROM content_items WHERE platform = ? AND url = ?')
          .get(item.platform, item.sourceUrl) as { id: number } | undefined;

        if (existing) {
          this.updateItem(existing.id, accountId, item, now);
          itemIds.push(existing.id);
          updated += 1;
        } else {
          const id = this.insertItem(accountId, item, now);
          itemIds.push(id);
          inserted += 1;
        }
      }

      return {
        accountId,
        inserted,
        updated,
        indexed: 0,
        totalReceived: body.items.length,
        itemIds
      };
    });

    return persist(payload);
  }

  listAccounts(): AccountSummary[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, COUNT(ci.id) AS item_count
         FROM accounts a
         LEFT JOIN content_items ci ON ci.account_id = a.id
         GROUP BY a.id
         ORDER BY a.updated_at DESC`
      )
      .all() as AccountRow[];

    return rows.map((row) => ({
      id: row.id,
      platform: row.platform as Platform,
      handle: row.handle,
      url: row.url,
      itemCount: row.item_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  listItems(filters: ItemListFilters = {}): StoredContentItem[] {
    const where: string[] = [];
    const params: Array<number | string> = [];

    if (filters.platform) {
      where.push('ci.platform = ?');
      params.push(filters.platform);
    }

    if (filters.accountHandle) {
      where.push('a.handle = ?');
      params.push(filters.accountHandle);
    }

    const sortColumn = filters.sort === 'likes' ? 'ci.likes' : filters.sort === 'comments' ? 'ci.comments' : filters.sort === 'updated' ? 'ci.updated_at' : 'ci.views';
    const limit = clampLimit(filters.limit ?? 100);
    params.push(limit);

    const rows = this.db
      .prepare(
        `SELECT ci.*, a.handle AS account_handle, a.url AS account_url
         FROM content_items ci
         JOIN accounts a ON a.id = ci.account_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY ${sortColumn} DESC NULLS LAST, ci.updated_at DESC
         LIMIT ?`
      )
      .all(...params) as ItemRow[];

    return rows.map(toStoredItem);
  }

  getItemsByIds(ids: readonly number[]): StoredContentItem[] {
    if (!ids.length) {
      return [];
    }

    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT ci.*, a.handle AS account_handle, a.url AS account_url
         FROM content_items ci
         JOIN accounts a ON a.id = ci.account_id
         WHERE ci.id IN (${placeholders})`
      )
      .all(...ids) as ItemRow[];
    const byId = new Map(rows.map((row) => [row.id, toStoredItem(row)]));
    return ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
  }

  listItemsForIndex(filters: IndexFilters = {}): StoredContentItem[] {
    return this.listItems({ ...filters, sort: 'updated', limit: 10_000 });
  }

  private upsertAccount(payload: IngestPayload, now: string): number {
    const existing = this.db
      .prepare('SELECT id FROM accounts WHERE platform = ? AND handle = ?')
      .get(payload.platform, payload.accountHandle) as { id: number } | undefined;

    if (existing) {
      this.db
        .prepare('UPDATE accounts SET url = COALESCE(?, url), updated_at = ? WHERE id = ?')
        .run(payload.accountUrl ?? null, now, existing.id);
      return existing.id;
    }

    const result = this.db
      .prepare('INSERT INTO accounts (platform, handle, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(payload.platform, payload.accountHandle, payload.accountUrl ?? null, now, now);
    return Number(result.lastInsertRowid);
  }

  private insertIngestRun(accountId: number, payload: IngestPayload, now: string): void {
    this.db
      .prepare(
        `INSERT INTO ingest_runs (
          account_id, collector_name, collector_version, collected_from_url, max_scrolls, user_agent, item_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        accountId,
        payload.collector.name,
        payload.collector.version,
        payload.collector.collectedFromUrl,
        payload.collector.maxScrolls,
        payload.collector.userAgent ?? null,
        payload.items.length,
        now
      );
  }

  private insertItem(accountId: number, item: CollectedContentItem, now: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO content_items (
          account_id, platform, external_id, url, item_type, title, body, thumbnail_url, posted_at, collected_at,
          views, likes, comments, replies, reposts, shares, bookmarks, raw_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(...this.insertItemParams(accountId, item, now), now, now);
    return Number(result.lastInsertRowid);
  }

  private updateItem(itemId: number, accountId: number, item: CollectedContentItem, now: string): void {
    this.db
      .prepare(
        `UPDATE content_items SET
          account_id = ?, external_id = COALESCE(?, external_id), item_type = ?, title = COALESCE(?, title),
          body = COALESCE(?, body), thumbnail_url = COALESCE(?, thumbnail_url), posted_at = COALESCE(?, posted_at),
          collected_at = ?, views = COALESCE(?, views), likes = COALESCE(?, likes), comments = COALESCE(?, comments),
          replies = COALESCE(?, replies), reposts = COALESCE(?, reposts), shares = COALESCE(?, shares),
          bookmarks = COALESCE(?, bookmarks), raw_json = COALESCE(?, raw_json), updated_at = ?
         WHERE id = ?`
      )
      .run(...this.updateItemParams(accountId, item, now), now, itemId);
  }

  private insertItemParams(accountId: number, item: CollectedContentItem, now: string): Array<number | string | null> {
    return [
      accountId,
      item.platform,
      item.externalId ?? null,
      item.sourceUrl,
      item.itemType,
      item.title ?? null,
      item.text ?? null,
      item.thumbnailUrl ?? null,
      item.postedAt ?? null,
      item.collectedAt || now,
      metricValue(item.metrics.views),
      metricValue(item.metrics.likes),
      metricValue(item.metrics.comments),
      metricValue(item.metrics.replies),
      metricValue(item.metrics.reposts),
      metricValue(item.metrics.shares),
      metricValue(item.metrics.bookmarks),
      item.raw === undefined ? null : JSON.stringify(item.raw)
    ];
  }

  private updateItemParams(accountId: number, item: CollectedContentItem, now: string): Array<number | string | null> {
    return [
      accountId,
      item.externalId ?? null,
      item.itemType,
      item.title ?? null,
      item.text ?? null,
      item.thumbnailUrl ?? null,
      item.postedAt ?? null,
      item.collectedAt || now,
      metricValue(item.metrics.views),
      metricValue(item.metrics.likes),
      metricValue(item.metrics.comments),
      metricValue(item.metrics.replies),
      metricValue(item.metrics.reposts),
      metricValue(item.metrics.shares),
      metricValue(item.metrics.bookmarks),
      item.raw === undefined ? null : JSON.stringify(item.raw)
    ];
  }
}

function toStoredItem(row: ItemRow): StoredContentItem {
  const metrics: SocialMetrics = {};
  if (row.views !== null) metrics.views = row.views;
  if (row.likes !== null) metrics.likes = row.likes;
  if (row.comments !== null) metrics.comments = row.comments;
  if (row.replies !== null) metrics.replies = row.replies;
  if (row.reposts !== null) metrics.reposts = row.reposts;
  if (row.shares !== null) metrics.shares = row.shares;
  if (row.bookmarks !== null) metrics.bookmarks = row.bookmarks;

  const item: StoredContentItem = {
    id: row.id,
    accountId: row.account_id,
    platform: row.platform as Platform,
    accountHandle: row.account_handle,
    sourceUrl: row.url,
    itemType: row.item_type as ContentItemType,
    metrics,
    collectedAt: row.collected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  if (row.account_url) item.accountUrl = row.account_url;
  if (row.external_id) item.externalId = row.external_id;
  if (row.title) item.title = row.title;
  if (row.body) item.text = row.body;
  if (row.thumbnail_url) item.thumbnailUrl = row.thumbnail_url;
  if (row.posted_at) item.postedAt = row.posted_at;
  if (row.raw_json) {
    try {
      item.raw = JSON.parse(row.raw_json) as unknown;
    } catch {
      item.raw = row.raw_json;
    }
  }

  return item;
}

function metricValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function clampLimit(value: number): number {
  return Math.min(10_000, Math.max(1, Math.trunc(value)));
}