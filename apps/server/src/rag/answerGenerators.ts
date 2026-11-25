import type { SearchResultItem } from '@trendsetter/shared';
import type { AppConfig } from '../config.js';
import type { AnswerGenerator } from './types.js';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export function createAnswerGenerator(config: AppConfig): AnswerGenerator {
  const extractive = new ExtractiveAnswerGenerator();
  if (config.chatBaseUrl && config.chatModel) {
    return new OpenAiCompatibleAnswerGenerator(config.chatBaseUrl, config.chatApiKey, config.chatModel, extractive);
  }
  return extractive;
}

class ExtractiveAnswerGenerator implements AnswerGenerator {
  readonly model = 'extractive-local';

  async generate(query: string, results: SearchResultItem[]): Promise<string> {
    if (!results.length) {
      return `No stored content matched: ${query}`;
    }

    const lines = results.slice(0, 5).map((result, index) => {
      const title = result.item.title ?? result.item.text ?? result.item.sourceUrl;
      const metrics = formatMetrics(result.item.metrics.views, result.item.metrics.likes, result.item.metrics.comments);
      return `${index + 1}. ${title} (${metrics}) - ${result.item.sourceUrl}`;
    });

    return `Top stored evidence for "${query}":\n${lines.join('\n')}`;
  }
}

class OpenAiCompatibleAnswerGenerator implements AnswerGenerator {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly model: string,
    private readonly fallback: AnswerGenerator
  ) {}

  async generate(query: string, results: SearchResultItem[]): Promise<string> {
    if (!results.length) {
      return this.fallback.generate(query, results);
    }

    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (this.apiKey) {
        headers.authorization = `Bearer ${this.apiKey}`;
      }

      const evidence = results
        .slice(0, 8)
        .map((result, index) => `${index + 1}. ${result.item.title ?? result.item.text ?? result.item.sourceUrl}\nURL: ${result.item.sourceUrl}\nMetrics: ${formatMetrics(result.item.metrics.views, result.item.metrics.likes, result.item.metrics.comments)}`)
        .join('\n\n');

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                'You are a content research assistant. Answer only from the provided stored social content evidence. Cite URLs inline when making claims.'
            },
            { role: 'user', content: `Question: ${query}\n\nEvidence:\n${evidence}` }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Chat completion failed with ${response.status}`);
      }

      const body = (await response.json()) as ChatCompletionResponse;
      return body.choices?.[0]?.message?.content?.trim() || this.fallback.generate(query, results);
    } catch {
      return this.fallback.generate(query, results);
    }
  }
}

function formatMetrics(views: number | null | undefined, likes: number | null | undefined, comments: number | null | undefined): string {
  return [`views ${views ?? '-'}`, `likes ${likes ?? '-'}`, `comments ${comments ?? '-'}`].join(', ');
}