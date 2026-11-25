import type { Platform } from '@trendsetter/shared';
import type { SqliteDatabase } from '../db/connection.js';
import type { IndexFilters } from '../db/repositories.js';
import type { VectorCandidate, VectorDocument, VectorStore } from './types.js';

interface EmbeddingRow {
  item_id: number;
  vector_json: string;
}

export class SqliteVectorStore implements VectorStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly provider: string,
    private readonly model: string,
    private readonly dimensions: number
  ) {}

  async upsert(documents: VectorDocument[]): Promise<number> {
    if (!documents.length) {
      return 0;
    }

    const now = new Date().toISOString();
    const statement = this.db.prepare(
      `INSERT INTO embeddings (item_id, provider, model, dimensions, text_hash, vector_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id, provider, model) DO UPDATE SET
         dimensions = excluded.dimensions,
         text_hash = excluded.text_hash,
         vector_json = excluded.vector_json,
         updated_at = excluded.updated_at`
    );

    const save = this.db.transaction((rows: VectorDocument[]) => {
      for (const row of rows) {
        statement.run(row.itemId, this.provider, this.model, row.vector.length || this.dimensions, row.textHash, JSON.stringify(row.vector), now);
      }
    });

    save(documents);
    return documents.length;
  }

  async query(vector: number[], filters: IndexFilters, limit: number): Promise<VectorCandidate[]> {
    const where = ['e.provider = ?', 'e.model = ?'];
    const params: Array<Platform | string> = [this.provider, this.model];

    if (filters.platform) {
      where.push('ci.platform = ?');
      params.push(filters.platform);
    }

    if (filters.accountHandle) {
      where.push('a.handle = ?');
      params.push(filters.accountHandle);
    }

    const rows = this.db
      .prepare(
        `SELECT e.item_id, e.vector_json
         FROM embeddings e
         JOIN content_items ci ON ci.id = e.item_id
         JOIN accounts a ON a.id = ci.account_id
         WHERE ${where.join(' AND ')}`
      )
      .all(...params) as EmbeddingRow[];

    return rows
      .map((row) => ({ itemId: row.item_id, semanticScore: cosineSimilarity(vector, parseVector(row.vector_json)) }))
      .filter((row) => Number.isFinite(row.semanticScore))
      .sort((left, right) => right.semanticScore - left.semanticScore)
      .slice(0, limit);
  }
}

function parseVector(value: string): number[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === 'number') : [];
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator ? dot / denominator : 0;
}