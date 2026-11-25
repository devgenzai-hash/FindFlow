import type { CollectedContentItem, IngestPayload, IngestResult } from '@trendsetter/shared';

interface CollectionResponse {
  ok: boolean;
  payload?: IngestPayload;
  error?: string;
}

const serverUrlInput = getElement<HTMLInputElement>('serverUrl');
const maxScrollsInput = getElement<HTMLInputElement>('maxScrolls');
const collectButton = getElement<HTMLButtonElement>('collectButton');
const downloadButton = getElement<HTMLButtonElement>('downloadButton');
const statusText = getElement<HTMLElement>('statusText');
const statusDot = getElement<HTMLElement>('statusDot');
const itemCount = getElement<HTMLElement>('itemCount');
const platformLabel = getElement<HTMLElement>('platformLabel');
const previewRows = getElement<HTMLTableSectionElement>('previewRows');

let latestPayload: IngestPayload | null = null;

void restoreSettings();
void refreshPlatformLabel();

collectButton.addEventListener('click', () => {
  void collectAndIngest();
});

downloadButton.addEventListener('click', () => {
  if (latestPayload) {
    void downloadPayload(latestPayload);
  }
});

serverUrlInput.addEventListener('change', () => {
  chrome.storage.local.set({ serverUrl: serverUrlInput.value.trim() });
});

maxScrollsInput.addEventListener('change', () => {
  chrome.storage.local.set({ maxScrolls: Number.parseInt(maxScrollsInput.value, 10) || 80 });
});

chrome.runtime.onMessage.addListener((message: { type?: string; message?: string }) => {
  if (message.type === 'TRENDSETTER_PROGRESS' && message.message) {
    setStatus(message.message, 'active');
  }
});

async function collectAndIngest(): Promise<void> {
  collectButton.disabled = true;
  downloadButton.disabled = true;
  latestPayload = null;
  renderPreview([]);
  setStatus('Collecting loaded and scroll-discovered items...', 'active');

  try {
    const tab = await getActiveTab();
    if (!tab.id) {
      throw new Error('No active tab found.');
    }

    const response = await sendCollectMessage(tab.id, {
      maxScrolls: Number.parseInt(maxScrollsInput.value, 10) || 80
    });

    if (!response.ok || !response.payload) {
      throw new Error(response.error ?? 'The content collector did not return data.');
    }

    latestPayload = response.payload;
    itemCount.textContent = String(response.payload.items.length);
    renderPreview(response.payload.items);
    try {
      await downloadPayload(response.payload);
    } catch {
      setStatus('Collected items. JSON download failed, continuing with local server save...', 'active');
    }
    downloadButton.disabled = false;

    const ingest = await sendToServer(response.payload);
    setStatus(
      `Saved ${ingest.totalReceived} items locally. Inserted ${ingest.inserted}, updated ${ingest.updated}, indexed ${ingest.indexed}.`,
      'active'
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Collection failed.';
    setStatus(message, 'error');
  } finally {
    collectButton.disabled = false;
  }
}

async function restoreSettings(): Promise<void> {
  const settings = await storageGet<{ serverUrl: string; maxScrolls: number }>({
    serverUrl: 'http://localhost:3318',
    maxScrolls: 80
  });
  serverUrlInput.value = settings.serverUrl;
  maxScrollsInput.value = String(settings.maxScrolls);
}

async function refreshPlatformLabel(): Promise<void> {
  const tab = await getActiveTab();
  const url = tab.url ? new URL(tab.url) : null;
  const host = url?.hostname.replace(/^www\./, '') ?? '';
  const label = host.includes('instagram')
    ? 'Instagram profile'
    : host === 'x.com' || host === 'twitter.com'
      ? 'X/Twitter profile'
      : host.includes('youtube')
        ? 'YouTube channel'
        : 'Unsupported page';
  platformLabel.textContent = label;
}

async function sendToServer(payload: IngestPayload): Promise<IngestResult> {
  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
  chrome.storage.local.set({ serverUrl });
  const response = await fetch(`${serverUrl}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server ingest failed: ${response.status} ${text.slice(0, 180)}`);
  }

  return (await response.json()) as IngestResult;
}

async function downloadPayload(payload: IngestPayload): Promise<void> {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const filename = `trendsetter-${payload.platform}-${sanitizeFilename(payload.accountHandle)}-${Date.now()}.json`;

  try {
    if (chrome.downloads?.download) {
      await new Promise<void>((resolve, reject) => {
        chrome.downloads.download({ url, filename, saveAs: false }, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve();
        });
      });
      return;
    }

    anchorDownload(url, filename);
  } catch {
    anchorDownload(url, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function anchorDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function renderPreview(items: CollectedContentItem[]): void {
  previewRows.replaceChildren();
  for (const item of items.slice(0, 20)) {
    const row = document.createElement('tr');
    row.append(
      tableCell(item.title ?? item.text ?? item.sourceUrl, 'left'),
      tableCell(formatMetric(item.metrics.views), 'right'),
      tableCell(formatMetric(item.metrics.likes), 'right'),
      tableCell(formatMetric(item.metrics.comments), 'right')
    );
    previewRows.append(row);
  }
}

function tableCell(value: string, align: 'left' | 'right'): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = value;
  cell.style.textAlign = align;
  return cell;
}

function formatMetric(value: number | null | undefined): string {
  return typeof value === 'number' ? Intl.NumberFormat().format(value) : '-';
}

function setStatus(message: string, state: 'active' | 'error' | 'idle'): void {
  statusText.textContent = message;
  statusDot.className = state === 'idle' ? '' : state;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'account';
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing popup element #${id}`);
  }
  return element as T;
}

function getActiveTab(): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      const tab = tabs[0];
      if (!tab) {
        reject(new Error('No active tab found.'));
        return;
      }
      resolve(tab);
    });
  });
}

function sendCollectMessage(tabId: number, options: { maxScrolls: number }): Promise<CollectionResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'TRENDSETTER_COLLECT', options }, (response: CollectionResponse) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(`${error.message}. Reload the page after installing the extension, then try again.`));
        return;
      }
      if (!response) {
        reject(new Error('No collector response. Reload the page after installing the extension, then try again.'));
        return;
      }
      resolve(response);
    });
  });
}

function storageGet<T>(defaults: T): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(defaults, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(items as T);
    });
  });
}