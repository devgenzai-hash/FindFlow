import type { SearchResultItem } from '@trendsetter/shared';
import type { AppConfig } from '../config.js';
import type { RerankCandidate, Reranker } from './types.js';

interface CohereRerankResponse {
  results?: Array<{ index: number; relevance_score: number }>;
}

export function createReranker(config: AppConfig): Reranker {
  const hybrid = new HybridReranker();
  if (config.reranker === 'cohere' && config.cohereApiKey) {
    return new CohereReranker(config.cohereApiKey, config.cohereRerankModel, hybrid);
  }
  return hybrid;
}

class HybridReranker implements Reranker {
  readonly name = 'hybrid';

  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<SearchResultItem[]> {
    const queryTokens = tokenize(query);
    return candidates
      .map((candidate) => {
        const keywordScore = overlapScore(queryTokens, tokenize(candidate.document));
        const metricScore = metricBoost(candidate.item.metrics.views) + metricBoost(candidate.item.metrics.likes) + metricBoost(candidate.item.metrics.comments) * 1.4;
        const rerankScore = candidate.semanticScore * 0.68 + keywordScore * 0.22 + metricScore * 0.1;
        return {
          item: candidate.item,
          score: rerankScore,
          semanticScore: candidate.semanticScore,
          rerankScore,
          reason: `semantic=${candidate.semanticScore.toFixed(3)}, keyword=${keywordScore.toFixed(3)}, metrics=${metricScore.toFixed(3)}`
        };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);
  }
}

class CohereReranker implements Reranker {
  readonly name = 'cohere';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fallback: Reranker
  ) {}

  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<SearchResultItem[]> {
    if (!candidates.length) {
      return [];
    }

    try {
      const response = await fetch('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents: candidates.map((candidate) => candidate.document),
          top_n: topK
        })
      });

      if (!response.ok) {
        throw new Error(`Cohere rerank failed with ${response.status}`);
      }

      const body = (await response.json()) as CohereRerankResponse;
      const ranked = body.results ?? [];
      return ranked.flatMap((result) => {
        const candidate = candidates[result.index];
        if (!candidate) {
          return [];
        }
        return [
          {
            item: candidate.item,
            score: result.relevance_score,
            semanticScore: candidate.semanticScore,
            rerankScore: result.relevance_score,
            reason: `cohere=${result.relevance_score.toFixed(3)}, semantic=${candidate.semanticScore.toFixed(3)}`
          }
        ];
      });
    } catch {
      return this.fallback.rerank(query, candidates, topK);
    }
  }
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9#@][a-z0-9_'#@-]*/g) ?? []);
}

function overlapScore(queryTokens: Set<string>, documentTokens: Set<string>): number {
  if (!queryTokens.size || !documentTokens.size) {
    return 0;
  }

  let matches = 0;
  for (const token of queryTokens) {
    if (documentTokens.has(token)) {
      matches += 1;
    }
  }

  return matches / queryTokens.size;
}

function metricBoost(value: number | null | undefined): number {
  if (!value || value < 1) {
    return 0;
  }
  return Math.min(1, Math.log10(value + 1) / 7);
}