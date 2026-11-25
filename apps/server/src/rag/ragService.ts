import { createHash } from 'node:crypto';
import type { RagAnswer, SearchRequest, SearchResultItem, StoredContentItem } from '@trendsetter/shared';
import type { AppConfig } from '../config.js';
import type { SqliteDatabase } from '../db/connection.js';
import type { IndexFilters, TrendRepository } from '../db/repositories.js';
import { createAnswerGenerator } from './answerGenerators.js';
import { createEmbeddingProvider } from './embeddings.js';
import { createReranker } from './rerankers.js';
import { SqliteVectorStore } from './sqliteVectorStore.js';
import type { AnswerGenerator, EmbeddingProvider, RerankCandidate, Reranker, VectorStore } from './types.js';

export function createRagService(config: AppConfig, repository: TrendRepository, db: SqliteDatabase): RagService {
  const embeddings = createEmbeddingProvider(config);
  const vectorStore = new SqliteVectorStore(db, embeddings.name, embeddings.model, embeddings.dimensions);
  const reranker = createReranker(config);
  const answerGenerator = createAnswerGenerator(config);
  return new RagService(repository, embeddings, vectorStore, reranker, answerGenerator);
}

export class RagService {
  constructor(
    private readonly repository: TrendRepository,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectorStore: VectorStore,
    private readonly reranker: Reranker,
    private readonly answerGenerator: AnswerGenerator
  ) {}

  async indexItems(itemIds: readonly number[]): Promise<number> {
    const items = this.repository.getItemsByIds(itemIds);
    if (!items.length) {
      return 0;
    }

    const documents = items.map((item) => ({ item, text: buildDocumentText(item) }));
    const vectors = await this.embeddings.embed(documents.map((document) => document.text));
    return this.vectorStore.upsert(
      documents.flatMap((document, index) => {
        const vector = vectors[index];
        return vector
          ? [
              {
                itemId: document.item.id,
                textHash: hashText(document.text),
                vector
              }
            ]
          : [];
      })
    );
  }

  async indexMatchingContent(filters: IndexFilters): Promise<number> {
    const items = this.repository.listItemsForIndex(filters);
    return this.indexItems(items.map((item) => item.id));
  }

  async search(request: SearchRequest): Promise<SearchResultItem[]> {
    const topK = Math.min(50, Math.max(1, request.topK ?? 8));
    const filters: IndexFilters = {};
    if (request.platform) filters.platform = request.platform;
    if (request.accountHandle) filters.accountHandle = request.accountHandle;

    const queryVector = (await this.embeddings.embed([request.query]))[0];
    if (!queryVector) {
      return [];
    }

    let candidates = await this.vectorStore.query(queryVector, filters, topK * 8);
    if (!candidates.length) {
      await this.indexMatchingContent(filters);
      candidates = await this.vectorStore.query(queryVector, filters, topK * 8);
    }

    const items = this.repository.getItemsByIds(candidates.map((candidate) => candidate.itemId));
    const byId = new Map(items.map((item) => [item.id, item]));
    const rerankCandidates: RerankCandidate[] = candidates.flatMap((candidate) => {
      const item = byId.get(candidate.itemId);
      return item
        ? [
            {
              item,
              document: buildDocumentText(item),
              semanticScore: candidate.semanticScore
            }
          ]
        : [];
    });

    return this.reranker.rerank(request.query, rerankCandidates, topK);
  }

  async answer(request: SearchRequest): Promise<RagAnswer> {
    const results = await this.search(request);
    return {
      answer: await this.answerGenerator.generate(request.query, results),
      results,
      model: this.answerGenerator.model
    };
  }
}

function buildDocumentText(item: StoredContentItem): string {
  const metrics = Object.entries(item.metrics)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');

  return [
    `platform: ${item.platform}`,
    `account: ${item.accountHandle}`,
    `type: ${item.itemType}`,
    item.title ? `title: ${item.title}` : '',
    item.text ? `text: ${item.text}` : '',
    metrics ? `metrics: ${metrics}` : '',
    `url: ${item.sourceUrl}`
  ]
    .filter(Boolean)
    .join('\n');
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}