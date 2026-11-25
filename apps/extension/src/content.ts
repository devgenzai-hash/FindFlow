import type {
  CollectedContentItem,
  ContentItemType,
  IngestPayload,
  Platform,
  SocialMetrics
} from '@trendsetter/shared';

interface CollectOptions {
  maxScrolls?: number;
}

interface AccountContext {
  handle: string;
  url: string;
}

interface CollectMessage {
  type: 'TRENDSETTER_COLLECT';
  options?: CollectOptions;
}

const collectorVersion = '0.1.0';

chrome.runtime.onMessage.addListener((message: CollectMessage, _sender, sendResponse) => {
  if (message?.type !== 'TRENDSETTER_COLLECT') {
    return false;
  }

  collectCurrentPage(message.options)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error: unknown) => {
      const messageText = error instanceof Error ? error.message : 'Collection failed';
      sendResponse({ ok: false, error: messageText });
    });

  return true;
});

async function collectCurrentPage(options: CollectOptions = {}): Promise<IngestPayload> {
  const platform = detectPlatform(window.location.hostname);
  if (!platform) {
    throw new Error('Open an Instagram profile, X/Twitter profile, or YouTube channel videos page first.');
  }

  const account = detectAccount(platform);
  const maxScrolls = clampInteger(options.maxScrolls ?? 80, 1, 500);
  const items = await collectByScrolling(platform, account, maxScrolls);

  return {
    platform,
    accountHandle: account.handle,
    accountUrl: account.url,
    collector: {
      name: 'trendsetter-extension',
      version: collectorVersion,
      collectedFromUrl: window.location.href,
      maxScrolls,
      userAgent: navigator.userAgent
    },
    items
  };
}

async function collectByScrolling(
  platform: Platform,
  account: AccountContext,
  maxScrolls: number
): Promise<CollectedContentItem[]> {
  const seen = new Map<string, CollectedContentItem>();
  let stableRounds = 0;
  let previousSize = 0;

  for (let pass = 0; pass <= maxScrolls; pass += 1) {
    const batch = scanVisibleItems(platform, account);
    for (const item of batch) {
      seen.set(item.sourceUrl, item);
    }

    emitProgress(`Collected ${seen.size} unique items after ${pass + 1} scan${pass === 0 ? '' : 's'}.`);

    if (seen.size === previousSize) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    if (stableRounds >= 4 || (stableRounds >= 2 && isNearPageEnd())) {
      break;
    }

    if (pass === maxScrolls) {
      break;
    }

    previousSize = seen.size;
    window.scrollBy({ top: Math.max(window.innerHeight * 1.8, 900), behavior: 'smooth' });
    await sleep(platform === 'x' ? 1400 : 1100);
  }

  return Array.from(seen.values()).sort(compareByReach);
}

function scanVisibleItems(platform: Platform, account: AccountContext): CollectedContentItem[] {
  if (platform === 'instagram') {
    return scanInstagram(account);
  }

  if (platform === 'x') {
    return scanX(account);
  }

  return scanYouTube(account);
}

function scanInstagram(account: AccountContext): CollectedContentItem[] {
  const anchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/reel/"], a[href*="/p/"]')
  );
  const collectedAt = new Date().toISOString();
  const items: CollectedContentItem[] = [];

  for (const anchor of anchors) {
    const url = normalizeInstagramUrl(anchor.href);
    if (!url) {
      continue;
    }

    const match = new URL(url).pathname.match(/\/(reel|p)\/([^/?#]+)/i);
    const externalId = match?.[2];
    const itemType: ContentItemType = match?.[1]?.toLowerCase() === 'reel' ? 'reel' : 'post';
    const image = anchor.querySelector<HTMLImageElement>('img');
    const nearbyText = nearbyElementText(anchor);
    const metrics = parseMetricsFromText(`${anchor.ariaLabel ?? ''} ${image?.alt ?? ''} ${nearbyText}`);
    const title = cleanText(image?.alt ?? anchor.getAttribute('title') ?? '');

    const item: CollectedContentItem = {
      platform: 'instagram',
      accountHandle: account.handle,
      accountUrl: account.url,
      sourceUrl: url,
      itemType,
      metrics,
      collectedAt
    };

    if (externalId) {
      item.externalId = externalId;
    }

    if (title) {
      item.title = title.slice(0, 240);
      item.text = title;
    }

    if (image?.src) {
      item.thumbnailUrl = image.src;
    }

    items.push(item);
  }

  return items;
}

function scanX(account: AccountContext): CollectedContentItem[] {
  const articles = Array.from(document.querySelectorAll<HTMLElement>('article[data-testid="tweet"], article'));
  const collectedAt = new Date().toISOString();
  const items: CollectedContentItem[] = [];

  for (const article of articles) {
    const statusLink = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')).find(
      (link) => /\/status\/\d+/.test(link.href)
    );
    if (!statusLink) {
      continue;
    }

    const url = normalizeXUrl(statusLink.href);
    const externalId = new URL(url).pathname.match(/\/status\/(\d+)/)?.[1];
    const text = cleanText(article.querySelector<HTMLElement>('[data-testid="tweetText"]')?.textContent ?? '');
    const groupLabel = article.querySelector<HTMLElement>('[role="group"][aria-label]')?.getAttribute('aria-label') ?? '';
    const metrics = parseMetricsFromText(`${groupLabel} ${article.textContent ?? ''}`);
    const time = article.querySelector<HTMLTimeElement>('time');
    const item: CollectedContentItem = {
      platform: 'x',
      accountHandle: account.handle,
      accountUrl: account.url,
      sourceUrl: url,
      itemType: 'tweet',
      metrics,
      collectedAt
    };

    if (externalId) {
      item.externalId = externalId;
    }

    if (text) {
      item.text = text;
      item.title = text.slice(0, 120);
    }

    if (time?.dateTime) {
      item.postedAt = time.dateTime;
    }

    items.push(item);
  }

  return items;
}

function scanYouTube(account: AccountContext): CollectedContentItem[] {
  const renderers = Array.from(
    document.querySelectorAll<HTMLElement>(
      'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-reel-item-renderer'
    )
  );
  const collectedAt = new Date().toISOString();
  const items: CollectedContentItem[] = [];

  for (const renderer of renderers) {
    const link = renderer.querySelector<HTMLAnchorElement>(
      'a#video-title-link, a#video-title, a[href*="/watch"], a[href*="/shorts/"]'
    );
    if (!link?.href) {
      continue;
    }

    const normalized = normalizeYouTubeUrl(link.href);
    if (!normalized) {
      continue;
    }

    const rendererText = cleanText(renderer.textContent ?? '');
    const title = cleanText(link.getAttribute('title') ?? link.textContent ?? '');
    const image = renderer.querySelector<HTMLImageElement>('img');
    const url = new URL(normalized);
    const externalId = url.pathname.startsWith('/shorts/')
      ? url.pathname.split('/').filter(Boolean)[1]
      : url.searchParams.get('v') ?? undefined;

    const item: CollectedContentItem = {
      platform: 'youtube',
      accountHandle: account.handle,
      accountUrl: account.url,
      sourceUrl: normalized,
      itemType: url.pathname.startsWith('/shorts/') ? 'short' : 'video',
      metrics: parseMetricsFromText(rendererText),
      collectedAt
    };

    if (externalId) {
      item.externalId = externalId;
    }

    if (title) {
      item.title = title;
      item.text = rendererText;
    }

    if (image?.src) {
      item.thumbnailUrl = image.src;
    }

    items.push(item);
  }

  return items;
}

function detectPlatform(hostname: string): Platform | null {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'instagram.com') {
    return 'instagram';
  }
  if (host === 'x.com' || host === 'twitter.com') {
    return 'x';
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    return 'youtube';
  }
  return null;
}

function detectAccount(platform: Platform): AccountContext {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (platform === 'youtube') {
    const channelParts = getYouTubeChannelParts(pathParts);
    if (!channelParts) {
      throw new Error('Open a YouTube channel videos page first.');
    }
    const handle = channelParts.join('/');
    return { handle, url: normalizeAccountUrl(platform, pathParts) };
  }

  const reserved = new Set([
    'explore',
    'accounts',
    'direct',
    'home',
    'i',
    'search',
    'notifications',
    'messages',
    'settings'
  ]);
  const handle = pathParts[0];
  if (!handle || reserved.has(handle.toLowerCase())) {
    throw new Error(`Open a ${platform === 'x' ? 'profile' : 'profile grid'} page first.`);
  }

  return { handle: handle.startsWith('@') ? handle : `@${handle}`, url: normalizeAccountUrl(platform, pathParts) };
}

function normalizeAccountUrl(platform: Platform, pathParts: string[]): string {
  const origin = window.location.origin;
  if (platform === 'youtube') {
    const channelParts = getYouTubeChannelParts(pathParts);
    return channelParts ? `${origin}/${channelParts.join('/')}/videos` : origin;
  }

  const handle = pathParts[0] ?? '';
  return `${origin}/${handle}`;
}

function normalizeInstagramUrl(href: string): string | null {
  const url = new URL(href, window.location.origin);
  const match = url.pathname.match(/\/(reel|p)\/([^/?#]+)/i);
  const itemType = match?.[1];
  const itemId = match?.[2];
  if (!itemType || !itemId) {
    return null;
  }
  return `https://www.instagram.com/${itemType}/${itemId}/`;
}

function normalizeXUrl(href: string): string {
  const url = new URL(href, window.location.origin);
  const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
  const handle = match?.[1];
  const statusId = match?.[2];
  if (!handle || !statusId) {
    return url.href.split('?')[0] ?? url.href;
  }
  return `https://x.com/${handle}/status/${statusId}`;
}

function normalizeYouTubeUrl(href: string): string | null {
  const url = new URL(href, window.location.origin);
  if (url.pathname.startsWith('/shorts/')) {
    const id = url.pathname.split('/').filter(Boolean)[1];
    return id ? `https://www.youtube.com/shorts/${id}` : null;
  }

  const videoId = url.searchParams.get('v');
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

function parseMetricsFromText(text: string): SocialMetrics {
  const metrics: SocialMetrics = {};
  const clean = cleanText(text).toLowerCase();
  const views = findMetric(clean, ['views', 'view']);
  const likes = findMetric(clean, ['likes', 'like']);
  const comments = findMetric(clean, ['comments', 'comment']);
  const replies = findMetric(clean, ['replies', 'reply']);
  const reposts = findMetric(clean, ['reposts', 'repost', 'retweets', 'retweet']);
  const shares = findMetric(clean, ['shares', 'share']);
  const bookmarks = findMetric(clean, ['bookmarks', 'bookmark']);

  if (views !== null) metrics.views = views;
  if (likes !== null) metrics.likes = likes;
  if (comments !== null) metrics.comments = comments;
  if (replies !== null) {
    metrics.replies = replies;
    metrics.comments ??= replies;
  }
  if (reposts !== null) metrics.reposts = reposts;
  if (shares !== null) metrics.shares = shares;
  if (bookmarks !== null) metrics.bookmarks = bookmarks;

  return metrics;
}

function findMetric(text: string, labels: string[]): number | null {
  const labelPattern = labels.map(escapeRegex).join('|');
  const numberPattern = '([0-9][0-9,.]*\\s*(?:k|m|b|thousand|million|billion)?)';
  const beforeLabel = new RegExp(`${numberPattern}\\s*(?:${labelPattern})\\b`, 'i').exec(text);
  if (beforeLabel?.[1]) {
    return parseSocialNumber(beforeLabel[1]);
  }

  const afterLabel = new RegExp(`(?:${labelPattern})\\s*[:\\-]?\\s*${numberPattern}`, 'i').exec(text);
  if (afterLabel?.[1]) {
    return parseSocialNumber(afterLabel[1]);
  }

  return null;
}

function parseSocialNumber(value: string): number | null {
  const normalized = value.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)(?:\s*(k|m|b|thousand|million|billion))?$/i);
  if (!match?.[1]) {
    return null;
  }

  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) {
    return null;
  }

  const suffix = match[2];
  const multiplier = suffix === 'k' || suffix === 'thousand' ? 1_000 : suffix === 'm' || suffix === 'million' ? 1_000_000 : suffix === 'b' || suffix === 'billion' ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}

function nearbyElementText(element: Element): string {
  let current: Element | null = element;
  for (let depth = 0; depth < 3 && current?.parentElement; depth += 1) {
    current = current.parentElement;
  }
  return cleanText(current?.textContent ?? '');
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function compareByReach(left: CollectedContentItem, right: CollectedContentItem): number {
  return reachScore(right.metrics) - reachScore(left.metrics);
}

function reachScore(metrics: SocialMetrics): number {
  return (metrics.views ?? 0) * 1 + (metrics.likes ?? 0) * 4 + (metrics.comments ?? 0) * 8 + (metrics.reposts ?? 0) * 6;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function isNearPageEnd(): boolean {
  return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function emitProgress(message: string): void {
  try {
    chrome.runtime.sendMessage({ type: 'TRENDSETTER_PROGRESS', message });
  } catch {
    // Popup may be closed while collection continues.
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getYouTubeChannelParts(pathParts: string[]): string[] | null {
  const firstPart = pathParts[0];
  const secondPart = pathParts[1];
  if (!firstPart) {
    return null;
  }

  if (firstPart.startsWith('@')) {
    return [firstPart];
  }

  const channelPrefixes = new Set(['channel', 'c', 'user']);
  if (secondPart && channelPrefixes.has(firstPart.toLowerCase())) {
    return [firstPart, secondPart];
  }

  return null;
}