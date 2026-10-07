import { readSessions, setPending, readState } from './db.js';

export function isAppsScriptHost() {
  return typeof google !== 'undefined' && Boolean(
    google.script && google.script.run &&
    typeof google.script.run.withSuccessHandler === 'function'
  );
}

export function validateConfig(config) {
  if (isAppsScriptHost()) return;
  let url;
  try { url = new URL(config.endpoint); }
  catch { throw Error('Apps Scriptの /exec URLを入力してください。'); }
  if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash) {
    throw Error('Apps Scriptの /exec URLを入力してください。');
  }
  if (!/^[a-f0-9]{64}$/i.test(config.token)) throw Error('API_TOKENは64桁の英数字で入力してください。');
}

function checkResult(result) {
  if (result?.ok === true) return result;
  const message = {
    UNAUTHORIZED: 'API_TOKENが一致しません。',
    SETUP_REQUIRED: 'Apps Scriptのsetupを実行してください。',
    HEADER_MISMATCH: 'シートの見出しが一致しません。',
    INVALID_REQUEST: 'Apps Scriptを最新版にデプロイしてください。',
    INVALID_SESSION: '保存形式が合いません。最新版のアプリとApps Scriptを使ってください。',
    TRANSLATION_FAILED: 'Google翻訳から一部の補助訳を取得できませんでした。再実行すると続きから処理します。',
    SERVER_BUSY_OR_ERROR: 'SheetsまたはApps Scriptでエラーが起きました。'
  };
  throw Error(message[result?.error] || result?.error || '保存を確認できませんでした。');
}

function requestPrivateAppsScript(body) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(error => reject(Error(error?.message || 'Google Apps Scriptとの通信に失敗しました。')))
      .handleAppRequest(body);
  });
}

export async function request(config, body) {
  if (isAppsScriptHost()) return checkResult(await requestPrivateAppsScript(body));
  validateConfig(config);
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    response = await fetch(config.endpoint, {
      method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ...body, token: config.token }), signal: controller.signal
    });
  } catch (error) {
    throw Error(error.name === 'AbortError'
      ? 'Apps Scriptの応答が時間切れです。'
      : 'ブラウザーがApps Scriptの応答を読めません。記録は端末に残ります。CSV出力も利用できます。');
  } finally { clearTimeout(timer); }
  if (!response.ok) throw Error(`Apps Scriptが応答しませんでした（HTTP ${response.status}）。`);
  let result;
  try { result = await response.json(); }
  catch { throw Error('Apps ScriptがJSON以外を返しました。URLと公開設定を確認してください。'); }
  return checkResult(result);
}

let sending = false;
export async function ping(config) { return request(config, { action: 'ping' }); }
export async function translateBatch(config, cards) {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 20) throw Error('翻訳は一度に20件までです。');
  const result = await request(config, { action: 'translate', cards });
  if (!Array.isArray(result.translations) || result.translations.length !== cards.length) throw Error('翻訳結果の件数が合いません。');
  return result.translations;
}

export async function sync() {
  if (sending || !navigator.onLine) return;
  const privateHost = isAppsScriptHost();
  const config = await readState('config', { endpoint: '', token: '' });
  if (!privateHost && (!config.endpoint || !config.token)) return;
  sending = true;
  try {
    const records = (await readSessions()).filter(row => row.pending);
    let batch = [];
    const send = async () => {
      if (!batch.length) return;
      const result = await request(config, { action: 'save', sessions: batch });
      if (!Array.isArray(result.ack) || batch.some(row => !result.ack.includes(row.session_id))) throw Error('保存確認待ちです。記録は端末に残っています。');
      await setPending(batch.map(row => row.session_id), false);
      batch = [];
    };
    for (const record of records) {
      const candidate = [...batch, record];
      const bytes = new TextEncoder().encode(JSON.stringify({ action: 'save', sessions: candidate, token: privateHost ? '' : config.token })).length;
      if (candidate.length > 20 || bytes > 1800000) {
        if (!batch.length) throw Error('この学習記録が送信上限を超えています。');
        await send();
      }
      batch.push(record);
    }
    await send();
  } finally { sending = false; }
}
