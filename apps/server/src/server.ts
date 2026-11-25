import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config, type AppConfig } from './config.js';
import { openSqliteDatabase } from './db/connection.js';
import { TrendRepository, type IndexFilters, type ItemListFilters } from './db/repositories.js';
import { validateIngestPayload, validateSearchRequest } from './http/validation.js';
import { createRagService } from './rag/ragService.js';

interface ItemQuery {
  platform?: string;
  accountHandle?: string;
  sort?: string;
  limit?: string;
}

export async function buildServer(appConfig: AppConfig = config) {
  const app = Fastify({ bodyLimit: appConfig.bodyLimitBytes, logger: { level: appConfig.logLevel } });
  await app.register(cors, { origin: true });

  const db = openSqliteDatabase(appConfig.dbPath);
  const repository = new TrendRepository(db);
  const rag = createRagService(appConfig, repository, db);

  app.addHook('onClose', async () => {
    db.close();
  });

  app.get('/health', async () => ({ ok: true, dbPath: appConfig.dbPath }));

  app.get('/api/accounts', async () => repository.listAccounts());

  app.get('/api/items', async (request) => {
    const query = request.query as ItemQuery;
    return repository.listItems(readItemListFilters(query));
  });

  app.post('/api/ingest', async (request, reply) => {
    try {
      const payload = validateIngestPayload(request.body);
      const persisted = repository.ingest(payload);
      const indexed = await rag.indexItems(persisted.itemIds);
      return { ...persisted, indexed };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid ingest payload.';
      return reply.code(400).send({ error: message });
    }
  });

  app.post('/api/search', async (request, reply) => {
    try {
      const search = validateSearchRequest(request.body);
      return await rag.search(search);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid search request.';
      return reply.code(400).send({ error: message });
    }
  });

  app.post('/api/rag/query', async (request, reply) => {
    try {
      const search = validateSearchRequest(request.body);
      return await rag.answer(search);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid RAG request.';
      return reply.code(400).send({ error: message });
    }
  });

  app.post('/api/rag/reindex', async (request) => {
    const body = (request.body ?? {}) as { platform?: string; accountHandle?: string };
    return {
      indexed: await rag.indexMatchingContent(readIndexFilters(body))
    };
  });

  return app;
}

function readPlatformQuery(value: string | undefined) {
  return value === 'instagram' || value === 'x' || value === 'youtube' ? value : undefined;
}

function readSortQuery(value: string | undefined) {
  return value === 'likes' || value === 'comments' || value === 'updated' || value === 'views' ? value : undefined;
}

function readItemListFilters(query: ItemQuery): ItemListFilters {
  const filters: ItemListFilters = {};
  const platform = readPlatformQuery(query.platform);
  const sort = readSortQuery(query.sort);
  const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;

  if (platform) filters.platform = platform;
  if (query.accountHandle) filters.accountHandle = query.accountHandle;
  if (sort) filters.sort = sort;
  if (typeof limit === 'number' && Number.isFinite(limit)) filters.limit = limit;

  return filters;
}

function readIndexFilters(body: { platform?: string; accountHandle?: string }): IndexFilters {
  const filters: IndexFilters = {};
  const platform = readPlatformQuery(body.platform);

  if (platform) filters.platform = platform;
  if (body.accountHandle) filters.accountHandle = body.accountHandle;

  return filters;
}