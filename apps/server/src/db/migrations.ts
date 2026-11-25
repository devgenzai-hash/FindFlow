import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(platform, handle)
    );

    CREATE TABLE IF NOT EXISTS ingest_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      collector_name TEXT NOT NULL,
      collector_version TEXT NOT NULL,
      collected_from_url TEXT NOT NULL,
      max_scrolls INTEGER NOT NULL,
      user_agent TEXT,
      item_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      external_id TEXT,
      url TEXT NOT NULL,
      item_type TEXT NOT NULL,
      title TEXT,
      body TEXT,
      thumbnail_url TEXT,
      posted_at TEXT,
      collected_at TEXT NOT NULL,
      views INTEGER,
      likes INTEGER,
      comments INTEGER,
      replies INTEGER,
      reposts INTEGER,
      shares INTEGER,
      bookmarks INTEGER,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(platform, url)
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      text_hash TEXT NOT NULL,
      vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(item_id, provider, model)
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_platform_handle ON accounts(platform, handle);
    CREATE INDEX IF NOT EXISTS idx_content_account ON content_items(account_id);
    CREATE INDEX IF NOT EXISTS idx_content_platform_metrics ON content_items(platform, views DESC, likes DESC, comments DESC);
    CREATE INDEX IF NOT EXISTS idx_embeddings_provider_model ON embeddings(provider, model);
  `);
}