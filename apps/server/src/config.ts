import 'dotenv/config';
import path from 'node:path';

const aiProviders = ['none', 'openai', 'openrouter', 'nvidia-nim', 'ollama', 'llama-cpp'] as const;
const embeddingProviders = ['hash', 'ollama', 'openai'] as const;

type AiProvider = (typeof aiProviders)[number];
type EmbeddingProviderName = (typeof embeddingProviders)[number];

interface ProviderDefaults {
  embeddingProvider: EmbeddingProviderName;
  embeddingModel: string;
  embeddingDimensions: number;
  openAiBaseUrl?: string;
  chatBaseUrl?: string;
  chatModel?: string;
}

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  bodyLimitBytes: number;
  logLevel: string;
  embeddingProvider: EmbeddingProviderName;
  embeddingModel: string;
  embeddingDimensions: number;
  ollamaBaseUrl: string;
  openAiBaseUrl: string;
  openAiApiKey: string | undefined;
  reranker: 'hybrid' | 'cohere';
  cohereApiKey: string | undefined;
  cohereRerankModel: string;
  chatBaseUrl: string | undefined;
  chatApiKey: string | undefined;
  chatModel: string | undefined;
}

const dataDir = path.resolve(process.env.TRENDSETTER_DATA_DIR ?? './data');
const aiProvider = readEnum('AI_PROVIDER', aiProviders, 'none');
const ollamaBaseUrl = trimTrailingSlash(process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434');
const providerDefaults = getProviderDefaults(aiProvider, ollamaBaseUrl);
const aiBaseUrl = process.env.AI_BASE_URL ? trimTrailingSlash(process.env.AI_BASE_URL) : undefined;

export const config: AppConfig = {
  host: process.env.HOST ?? '127.0.0.1',
  port: readInteger('PORT', 3318),
  dbPath: process.env.SQLITE_PATH ? path.resolve(process.env.SQLITE_PATH) : path.join(dataDir, 'trendsetter.sqlite'),
  bodyLimitBytes: readInteger('BODY_LIMIT_BYTES', 25 * 1024 * 1024),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  embeddingProvider: process.env.RAG_EMBEDDING_PROVIDER
    ? readEnum('RAG_EMBEDDING_PROVIDER', embeddingProviders, providerDefaults.embeddingProvider)
    : providerDefaults.embeddingProvider,
  embeddingModel: process.env.EMBEDDING_MODEL ?? process.env.RAG_EMBEDDING_MODEL ?? providerDefaults.embeddingModel,
  embeddingDimensions: readInteger('EMBEDDING_DIMENSIONS', readInteger('RAG_EMBEDDING_DIMENSIONS', providerDefaults.embeddingDimensions)),
  ollamaBaseUrl,
  openAiBaseUrl: trimTrailingSlash(process.env.OPENAI_BASE_URL ?? aiBaseUrl ?? providerDefaults.openAiBaseUrl ?? 'https://api.openai.com/v1'),
  openAiApiKey: process.env.OPENAI_API_KEY ?? process.env.AI_API_KEY,
  reranker: readEnum('RAG_RERANKER', ['hybrid', 'cohere'], 'hybrid'),
  cohereApiKey: process.env.COHERE_API_KEY,
  cohereRerankModel: process.env.COHERE_RERANK_MODEL ?? 'rerank-v3.5',
  chatBaseUrl: process.env.RAG_CHAT_BASE_URL ? trimTrailingSlash(process.env.RAG_CHAT_BASE_URL) : aiBaseUrl ?? providerDefaults.chatBaseUrl,
  chatApiKey: process.env.RAG_CHAT_API_KEY ?? process.env.AI_API_KEY,
  chatModel: process.env.RAG_CHAT_MODEL ?? process.env.AI_MODEL ?? providerDefaults.chatModel
};

function getProviderDefaults(provider: AiProvider, localOllamaBaseUrl: string): ProviderDefaults {
  if (provider === 'openai') {
    return {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-large',
      embeddingDimensions: 3072,
      openAiBaseUrl: 'https://api.openai.com/v1',
      chatBaseUrl: 'https://api.openai.com/v1',
      chatModel: 'gpt-4.1-mini'
    };
  }

  if (provider === 'openrouter') {
    return {
      embeddingProvider: 'hash',
      embeddingModel: 'hash-embedding-384',
      embeddingDimensions: 384,
      openAiBaseUrl: 'https://openrouter.ai/api/v1',
      chatBaseUrl: 'https://openrouter.ai/api/v1',
      chatModel: 'meta-llama/llama-3.1-8b-instruct'
    };
  }

  if (provider === 'nvidia-nim') {
    return {
      embeddingProvider: 'openai',
      embeddingModel: 'nvidia/nv-embedqa-e5-v5',
      embeddingDimensions: 1024,
      openAiBaseUrl: 'https://integrate.api.nvidia.com/v1',
      chatBaseUrl: 'https://integrate.api.nvidia.com/v1',
      chatModel: 'meta/llama-3.1-8b-instruct'
    };
  }

  if (provider === 'ollama') {
    return {
      embeddingProvider: 'ollama',
      embeddingModel: 'bge-m3',
      embeddingDimensions: 1024,
      chatBaseUrl: `${localOllamaBaseUrl}/v1`,
      chatModel: 'llama3.1:8b'
    };
  }

  if (provider === 'llama-cpp') {
    return {
      embeddingProvider: 'openai',
      embeddingModel: 'local-embedding-model',
      embeddingDimensions: 1024,
      openAiBaseUrl: 'http://127.0.0.1:8080/v1',
      chatBaseUrl: 'http://127.0.0.1:8080/v1',
      chatModel: 'local-model'
    };
  }

  return {
    embeddingProvider: 'hash',
    embeddingModel: 'hash-embedding-384',
    embeddingDimensions: 384
  };
}

function readInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const value = process.env[name] as T | undefined;
  return value && allowed.includes(value) ? value : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}