const DB_NAME = 'belajar-kata-v1';
let opening;
let memoryOnly = false;
const memoryState = new Map();
const memorySessions = new Map();

export function database() {
  if (memoryOnly) return Promise.resolve(null);
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB is unavailable')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'session_id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB could not open'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked'));
  }).catch(error => {
    memoryOnly = true;
    opening = null;
    return null;
  });
  return opening;
}

export function isMemoryOnly() { return memoryOnly; }

async function transact(stores, mode, work) {
  const db = await database();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    try { result = work(tx); }
    catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error('端末への保存に失敗しました。'));
  });
}

export async function readState(key, fallback = null) {
  const db = await database();
  if (!db) return memoryState.has(key) ? memoryState.get(key) : fallback;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state'), request = tx.objectStore('state').get(key);
    request.onsuccess = () => resolve(request.result ?? fallback);
    request.onerror = () => reject(request.error);
  });
}

export async function writeState(key, value) {
  const db = await database();
  if (!db) { memoryState.set(key, value); return; }
  await transact('state', 'readwrite', tx => tx.objectStore('state').put(value, key));
}

export async function readSessions() {
  const db = await database();
  if (!db) return [...memorySessions.values()];
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions'), request = tx.objectStore('sessions').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSession(session, progress) {
  const db = await database();
  if (!db) {
    memorySessions.set(session.session_id, session);
    memoryState.set('progress', progress);
    return;
  }
  await transact(['sessions', 'state'], 'readwrite', tx => {
    tx.objectStore('sessions').put(session);
    tx.objectStore('state').put(progress, 'progress');
  });
}

export async function setPending(ids, pending) {
  const db = await database();
  if (!db) {
    ids.forEach(id => {
      const session = memorySessions.get(id);
      if (session) memorySessions.set(id, { ...session, pending });
    });
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite'), store = tx.objectStore('sessions');
    ids.forEach(id => {
      const request = store.get(id);
      request.onsuccess = () => { if (request.result) store.put({ ...request.result, pending }); };
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error('同期状態を更新できませんでした。'));
  });
}

export async function exportData() {
  const config = await readState('config', { endpoint: '', token: '' });
  let translations = await readState('zh-translations', {});
  if (!Object.keys(translations || {}).length) {
    try { translations = JSON.parse(localStorage.getItem('belajar-kata:zh-translations') || '{}'); } catch (_) { translations = {}; }
  }
  return {
    schema_version: 2,
    exported_at: new Date().toISOString(),
    sessions: await readSessions(),
    progress: await readState('progress', {}),
    zh_translations: translations,
    sheets_sync_configured: !!(config.endpoint && config.token)
  };
}
