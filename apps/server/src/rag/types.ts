import type { SearchResultItem, StoredContentItem } from '@trendsetter/shared';
import type { IndexFilters } from '../db/repositories.js';

export interface EmbeddingProvider {
  name: string;
  model: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorDocument {
  itemId: number;
  textHash: string;
  vector: number[];
}

export interface VectorCandidate {
  itemId: number;
  semanticScore: number;
}

export interface VectorStore {
  upsert(documents: VectorDocument[]): Promise<number>;
  query(vector: number[], filters: IndexFilters, limit: number): Promise<VectorCandidate[]>;
}

export interface RerankCandidate {
  item: StoredContentItem;
  document: string;
  semanticScore: number;
}

export interface Reranker {
  name: string;
  rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<SearchResultItem[]>;
}

export interface AnswerGenerator {
  model: string;
  generate(query: string, results: SearchResultItem[]): Promise<string>;
}