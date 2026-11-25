import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { EmbeddingProvider } from './types.js';

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

interface OpenAiEmbeddingResponse {
  data?: Array<{ embedding: number[] }>;
}

export function createEmbeddingProvider(config: AppConfig): EmbeddingProvider {
  const dimensions = Math.max(1, Math.trunc(config.embeddingDimensions));
  if (config.embeddingProvider === 'ollama') {
    return new OllamaEmbeddingProvider(config.ollamaBaseUrl, config.embeddingModel, dimensions);
  }

  if (config.embeddingProvider === 'openai') {
    return new OpenAiEmbeddingProvider(config.openAiBaseUrl, config.openAiApiKey, config.embeddingModel, dimensions);
  }

  return new HashEmbeddingProvider(config.embeddingModel, dimensions);
}

class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'hash';

  constructor(
    readonly model: string,
    readonly dimensions: number
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => normalizeVector(hashTextToVector(text, this.dimensions)));
  }
}

class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    readonly dimensions: number
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts })
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings failed with ${response.status}. Is Ollama running with model ${this.model}?`);
    }

    const body = (await response.json()) as OllamaEmbedResponse;
    if (!Array.isArray(body.embeddings)) {
      throw new Error('Ollama embedding response did not include embeddings.');
    }

    if (body.embeddings.length !== texts.length) {
      throw new Error('Ollama embedding response count did not match input count.');
    }

    return body.embeddings.map(normalizeVector);
  }
}

class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly model: string,
    readonly dimensions: number
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input: texts })
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible embeddings failed with ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as OpenAiEmbeddingResponse;
    const vectors = body.data?.map((item) => item.embedding) ?? [];
    if (vectors.length !== texts.length) {
      throw new Error('Embedding response count did not match input count.');
    }

    return vectors.map(normalizeVector);
  }
}

function hashTextToVector(text: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = text.toLowerCase().match(/[a-z0-9#@][a-z0-9_'#@-]*/g) ?? [];

  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    const sign = (digest.at(4) ?? 0) % 2 === 0 ? 1 : -1;
    const weight = 1 + Math.min(token.length, 24) / 24;
    vector[index] = (vector[index] ?? 0) + sign * weight;
  }

  return vector;
}

export function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) {
    return vector;
  }
  return vector.map((value) => value / norm);
}