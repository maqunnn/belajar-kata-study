import { CARDS } from './data.js';
import { IKENTEI_LEVELS } from './ikentei.js';
import { DIRECTIONS, filterCards, filterStudySetCards, createStudySets, matchesReference, selectQuestions, selectDifficultyQuestions, aggregateStudyTrends } from './core.js';
import { readState, writeState, readSessions, saveSession, exportData, isMemoryOnly } from './db.js';
import { isAppsScriptHost, validateConfig, ping, translateBatch, sync } from './sync.js';

if (!window.__belajarKataStarted) {
window.__belajarKataStarted = true;
const $ = id => document.getElementById(id);
const screens = ['home-screen', 'study-screen', 'summary-screen', 'history-screen', 'dashboard-screen'];
let active = null;
let timer = null;
let toastTimer = null;
let selectedType = 'word';
let reviewOnly = false;
let randomDifficulty = 50;
let randomQuestionCount = 10;
let translationBusy = false;
const GOOGLE_ZH_SOURCE = 'Google Translate ja→zh-CN';

function show(id) { screens.forEach(key => { $(key).hidden = key !== id; }); }
function notify(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
function applyChineseTranslations(map) {
  if (!map || typeof map !== 'object') return;
  for (const card of CARDS) {
    const translated = map[card.id];
    if (typeof translated === 'string' && translated.trim()) {
      card.zh = translated;
      card.zhSource = GOOGLE_ZH_SOURCE;
    }
  }
}
async function readChineseTranslationMap() {
  const saved = await readState('zh-translations', {});
  if (Object.keys(saved || {}).length) return saved;
  try { return JSON.parse(localStorage.getItem('belajar-kata:zh-translations') || '{}'); }
  catch (_) { return {}; }
}
async function saveChineseTranslationMap(map) {
  await writeState('zh-translations', map);
  try { localStorage.setItem('belajar-kata:zh-translations', JSON.stringify(map)); } catch (_) {}
}
async function translateAllChinese() {
  if (translationBusy) return;
  const config = await readState('config', { endpoint: '', token: '' });
  try { validateConfig(config); } catch (error) { notify(`先にSheets連携を設定してください。${error.message}`); return; }
  translationBusy = true;
  $('translate-all').disabled = true;
  const saved = await readChineseTranslationMap();
  const translationMap = { ...saved };
  applyChineseTranslations(translationMap);
  const groupsByText = new Map();
  for (const card of CARDS) {
    if (translationMap[card.id] || card.zhSource === GOOGLE_ZH_SOURCE) continue;
    const text = String(card.ja || '').trim();
    if (!text) continue;
    const group = groupsByText.get(text) || { id: card.id, text, cardIds: [] };
    group.cardIds.push(card.id);
    groupsByText.set(text, group);
  }
  const groups = [...groupsByText.values()];
  let completed = 0;
  $('translate-progress').textContent = `0 / ${groups.length}件の日本語を翻訳します。Googleへ送信します。`;
  try {
    for (let offset = 0; offset < groups.length; offset += 20) {
      const batch = groups.slice(offset, offset + 20);
      const results = await translateBatch(config, batch.map(({ id, text }) => ({ id, text })));
      const byId = new Map(results.map(item => [item.id, item]));
      for (const group of batch) {
        const result = byId.get(group.id);
        if (!result || typeof result.zh !== 'string' || !result.zh.trim()) throw Error('一部の訳が返りませんでした。');
        for (const cardId of group.cardIds) translationMap[cardId] = result.zh.trim();
      }
      completed += batch.length;
      applyChineseTranslations(translationMap);
      await saveChineseTranslationMap(translationMap);
      $('translate-progress').textContent = `${completed} / ${groups.length}件の日本語を処理しました。途中結果は端末に保存済みです。`;
      renderSelection(await readState('progress', {}));
    }
    notify('教材全体の中国語補助訳を作成しました。');
  $('translate-progress').textContent = `完了：${CARDS.length.toLocaleString()}語。補助訳は端末に保存しました。下のCSVを書き出すと翻訳データも保存できます。`;
  } catch (error) {
    await saveChineseTranslationMap(translationMap);
    notify(`翻訳を一時停止しました（${completed} / ${groups.length}件）。再実行すると続きから処理します。${error.message}`);
  } finally {
    translationBusy = false;
    $('translate-all').disabled = false;
    renderSelection(await readState('progress', {}));
  }
}
function speak(text, lang) {
  if (!('speechSynthesis' in window)) { notify('この端末では読み上げ機能を利用できません。'); return; }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang; utterance.rate = 0.88;
  const prefix = lang.slice(0, 2).toLowerCase();
  const voice = speechSynthesis.getVoices().find(item => item.lang.toLowerCase().startsWith(prefix));
  if (voice) utterance.voice = voice;
  utterance.onerror = () => notify('音声を再生できません。端末の読み上げ設定をご確認ください。');
  speechSynthesis.speak(utterance);
}
function formatTime(seconds) {
  const min = Math.floor(seconds / 60), sec = seconds % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function describeDifficulty(value) {
  if (value < 20) return 'やさしめの問題が中心';
  if (value < 40) return 'やさしめ寄り';
  if (value < 60) return '基礎から応用までバランスよく';
  if (value < 80) return '少し挑戦的な問題が中心';
  return '挑戦的な問題が中心';
}
function updateRandomSettings() {
  const available = filterCards(CARDS, { type: selectedType, lesson: 'all', direction: $('direction-select').value }).length;
  const max = Math.min(20, available);
  const min = Math.min(10, max);
  $('random-count').min = String(min);
  $('random-count').max = String(max);
  $('random-count').disabled = available === 0;
  randomQuestionCount = Math.max(min, Math.min(max, Number($('random-count').value) || min));
  $('random-count').value = String(randomQuestionCount);
  randomDifficulty = Number($('random-difficulty').value);
  $('random-count-value').textContent = `${randomQuestionCount}問`;
  const countEnds = $('random-count-ends');
  if (countEnds) countEnds.innerHTML = `<span>${min}問</span><span>${max}問</span>`;
  $('random-difficulty-value').textContent = describeDifficulty(randomDifficulty);
  $('random-difficulty').setAttribute('aria-valuetext', describeDifficulty(randomDifficulty));
}
function newSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function elapsedStudySeconds() {
  return active.accumulated + (!active.paused ? Math.floor((Date.now() - active.resumedAt) / 1000) : 0);
}
function renderClock() { if (active) $('clock').textContent = formatTime(elapsedStudySeconds()); }
function dueCardIds(progress) {
  return new Set(CARDS.filter(card => progress[card.id]?.dueAt <= Date.now()).map(card => card.id));
}
function selectedCards(progress = {}, lessonOverride = null, includeReviewOnly = true) {
  const dueIds = dueCardIds(progress);
  return filterStudySetCards(CARDS, {
    type: selectedType,
    setId: lessonOverride || $('lesson-select').value,
    direction: $('direction-select').value,
    dueIds: includeReviewOnly && reviewOnly ? dueIds : null
  });
}
function renderLessonOptions(preferred = $('lesson-select').value) {
  const sets = createStudySets(CARDS, selectedType);
  const unit = '語';
  const options = sets.map(set => ({ value: set.id, label: `セット${String(set.number).padStart(2, '0')}｜${set.start}〜${set.end}番（${set.cards.length}${unit}）` }));
  options.push({ value: 'all', label: `すべて（${CARDS.length}語）` });
  $('lesson-select').replaceChildren(...options.map(option => {
    const element = document.createElement('option');
    element.value = option.value; element.textContent = option.label;
    return element;
  }));
  $('lesson-select').value = options.some(option => option.value === preferred) ? preferred : (options[0]?.value || 'all');
}
function renderSelection(progress = {}) {
  const dueIds = dueCardIds(progress);
  const initialLessonValue = $('lesson-select').value;
  const chineseCount = filterCards(CARDS, { type: selectedType, lesson: 'all', direction: 'zh-id' }).length;
  for (const option of $('direction-select').options) {
    if (['zh-id', 'id-zh'].includes(option.value)) option.disabled = chineseCount === 0;
  }
  if (['zh-id', 'id-zh'].includes($('direction-select').value) && chineseCount === 0) $('direction-select').value = 'ja-id';
  let scopeNote = '';
  const directionNow = $('direction-select').value;
  const selectedSetCards = filterStudySetCards(CARDS, { type: selectedType, setId: initialLessonValue, direction: 'ja-id' });
  const currentScopeHasChinese = selectedSetCards.some(card => card.zh);
  if (['zh-id', 'id-zh'].includes(directionNow) && !currentScopeHasChinese && chineseCount > 0) {
    $('lesson-select').value = 'all';
    try { localStorage.setItem('belajar-kata:lesson', 'all'); } catch (_) {}
    scopeNote = 'このセットに中国語訳がないため、訳のある教材全体から出題します。';
  }
  const lesson = $('lesson-select').value;
  const reviewCount = filterStudySetCards(CARDS, { type: selectedType, setId: lesson, direction: $('direction-select').value, dueIds }).length;
  const cardCount = selectedCards(progress).length;
  const lessonValue = $('lesson-select').value;
  const selectedLessonCards = filterStudySetCards(CARDS, { type: selectedType, setId: lessonValue, direction: 'ja-id' });
  const direction = $('direction-select').value;
  const chineseDirection = ['zh-id', 'id-zh'].includes(direction);
  $('review-count').textContent = reviewCount;
  $('review-toggle').setAttribute('aria-pressed', String(reviewOnly));
  $('review-toggle').classList.toggle('selected', reviewOnly);
  $('deck-count').textContent = `${cardCount}${selectedType === 'word' ? '語' : '件'}`;
  const selectedSet = createStudySets(CARDS, selectedType).find(set => set.id === lessonValue);
  if ($('set-progress')) {
    const mastered = selectedSet?.cards.filter(card => (progress[card.id]?.stage || 0) >= 3).length || 0;
    $('set-progress').textContent = selectedSet
      ? `このセットの習得記録 ${mastered} / ${selectedSet.cards.length}${selectedType === 'word' ? '語' : '件'} · 出典の課・ページはカードに表示`
      : `全語彙から選択 · 出典の課・ページはカードに表示`;
  }
  $('direction-note').textContent = chineseDirection
    ? `${scopeNote}中国語補助訳あり：この範囲 ${selectedLessonCards.filter(card => card.zh).length} / ${selectedLessonCards.length}件（全教材 ${chineseCount}件）。未翻訳カードは出題せず、ランダムテストは訳のある教材カードから選びます。`
    : `この条件で出題できるカード：${cardCount}件`;
  $('start-button').disabled = cardCount === 0;
  $('random-test-button').disabled = filterCards(CARDS, { type: selectedType, lesson: 'all', direction: $('direction-select').value }).length === 0;
  updateRandomSettings();
  $('start-button').firstElementChild.textContent = reviewOnly ? '復習を始める' : '練習を始める';
  renderLengthOptions(cardCount);
}
function renderLengthOptions(count) {
  const select = $('length-select');
  const previous = select.value || '10';
  const choices = [5, 10, 20].filter(value => value <= count).map(value => ({ value: String(value), label: `${value}問` }));
  choices.push({ value: 'all', label: `すべて（${count}）` });
  select.replaceChildren(...choices.map(choice => {
    const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; return option;
  }));
  select.value = choices.some(choice => choice.value === previous) ? previous : (choices.filter(choice => choice.value !== 'all').at(-1)?.value || 'all');
  try { localStorage.setItem('belajar-kata:length-select', select.value); } catch (_) {}
}
function startSession(progress, { lessonOverride = null, questionCount = null, randomTest = false, difficultyIntensity = null } = {}) {
  const lesson = lessonOverride || $('lesson-select').value;
  let cards = selectedCards(progress, lessonOverride, !randomTest);
  const direction = $('direction-select').value;
  if (!cards.length) { notify(reviewOnly ? 'この範囲に要復習カードはありません。' : 'この範囲に練習できるカードがありません。'); return; }
  const limit = questionCount ?? ($('length-select').value === 'all' ? cards.length : Number($('length-select').value));
  const dueIds = dueCardIds(progress);
  cards = randomTest
    ? selectDifficultyQuestions(cards, Math.min(limit, cards.length), difficultyIntensity)
    : selectQuestions(cards, limit, Math.random, dueIds);
  active = {
    deckId: `${selectedType}-${randomTest ? 'random' : lesson}`, deckLabel: `単語｜${randomTest ? `教材全体からランダム・${cards.length}問` : lesson === 'all' ? '全語彙' : `セット${lesson.slice(4)}`}${!randomTest && reviewOnly ? '｜要復習' : ''}`, direction, cards,
    testMode: randomTest ? 'random' : 'lesson', difficultyIntensity: randomTest ? difficultyIntensity : null,
    index: 0, attempts: 0, seen: new Set(), correct: 0, missed: new Set(), cardResults: [],
    accumulated: 0, resumedAt: Date.now(), paused: false, startedAt: new Date().toISOString(),
    progress, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
  $('pause-button').textContent = '一時停止'; show('study-screen'); drawCard(); renderClock();
  clearInterval(timer); timer = setInterval(renderClock, 500);
}
function drawCard() {
  if (!active) return;
  if (active.index >= active.cards.length) { finishSession(); return; }
  const card = active.cards[active.index], direction = DIRECTIONS[active.direction];
  active.current = card;
  active.currentMatched = null;
  $('prompt').textContent = card[direction.from] || '—';
  $('answer').textContent = card[direction.to] || '—';
  $('answer-input').lang = direction.to === 'idLang' ? 'id' : direction.to === 'zh' ? 'zh-CN' : 'ja';
  $('prompt-instruction').textContent = direction.label;
  $('prompt-kind').textContent = '単語';
  const cardLesson = card.lesson === 'appendix' ? '巻末付録' : `第${card.lesson}課`;
  $('prompt-tag').textContent = `${cardLesson} · p.${card.page} · ${card.id}`;
  $('root-note').textContent = card.root ? `語幹メモ｜${card.root}` : '';
  $('source-note').textContent = `書籍 p.${card.page}${card.audio ? ` · 参考書音声 No.${card.audio}（別音源）` : ''}`;
  $('answer-input').value = ''; $('match-feedback').textContent = ''; $('match-feedback').className = 'match-feedback';
  $('answer-side').hidden = true; $('recall-actions').hidden = false; $('grade-actions').hidden = true;
  $('counter').textContent = `${String(active.index + 1).padStart(2, '0')} / ${String(active.cards.length).padStart(2, '0')}`;
  $('progress-bar').style.width = `${Math.round(active.index / active.cards.length * 100)}%`;
  $('answer-input').disabled = active.paused; $('reveal-button').disabled = active.paused;
  if (!active.paused) $('answer-input').focus({ preventScroll: true });
}
function reveal() {
  if (!active || active.paused) return;
  const typed = $('answer-input').value.trim();
  if (!typed) { notify('先に答えを入力してください。'); $('answer-input').focus(); return; }
  const expected = active.current[DIRECTIONS[active.direction].to];
  const matched = matchesReference(typed, expected);
  active.currentMatched = matched;
  $('match-feedback').textContent = matched ? '入力が教材の表記と一致しました。' : '表記は一致しません。意味が合っていれば「できた」を選べます。';
  $('match-feedback').className = `match-feedback ${matched ? 'match' : 'different'}`;
  $('answer-side').hidden = false; $('recall-actions').hidden = true; $('grade-actions').hidden = false; $('answer-input').disabled = true;
}
function grade(recalled) {
  if (!active || !active.current) return;
  const card = active.current;
  active.attempts++; active.seen.add(active.current.id);
  active.cardResults.push({
    card_id: card.id, card_type: card.type, lesson: String(card.lesson), source_page: card.page,
    ja: card.ja, idLang: card.idLang, zh: card.zh || '', zh_source: card.zhSource || '', ikentei_level: card.ikenteiLevel,
    ikentei_basis: card.ikenteiBasis, ikentei_confidence: card.ikenteiConfidence,
    recalled, exact_match: active.currentMatched === true
  });
  if (recalled) { active.correct++; active.missed.delete(active.current.id); }
  else active.missed.add(active.current.id);
  active.index++; drawCard();
}
function finishSession() {
  clearInterval(timer); active.accumulated = elapsedStudySeconds(); active.finishedAt = new Date().toISOString();
  $('result-time').textContent = formatTime(active.accumulated);
  $('result-count').textContent = `${active.attempts}回 · ${active.seen.size}枚`;
  $('result-rate').textContent = `${active.attempts ? Math.round(active.correct / active.attempts * 100) : 0}%`;
  $('summary-subtitle').textContent = `${active.deckLabel}｜${DIRECTIONS[active.direction].label}｜できた ${active.correct} ・ 要復習 ${active.missed.size}`;
  const review = $('result-review');
  if (active.missed.size) {
    const names = [...active.missed].map(id => CARDS.find(card => card.id === id)?.idLang).filter(Boolean);
    review.innerHTML = `<b>次にもう一度</b>${escapeHTML(names.join(' · '))}`; review.hidden = false;
  } else review.hidden = true;
  $('summary-actions').hidden = false; $('saved-state').hidden = true; show('summary-screen');
}
function escapeHTML(text) { return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function localDate(iso, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  return `${parts.find(part=>part.type==='year').value}-${parts.find(part=>part.type==='month').value}-${parts.find(part=>part.type==='day').value}`;
}
async function saveCurrent() {
  if (!active) return;
  const endedAt = active.finishedAt || new Date().toISOString();
  const studySeconds = elapsedStudySeconds(), missedIds = [...active.missed];
  const config = await readState('config', { endpoint: '', token: '' });
  const progress = { ...active.progress };
  const now = Date.now();
  const cardResults = active.cardResults.map(result => {
    const oldStage = progress[result.card_id]?.stage || 0;
    const masteryStage = result.recalled ? Math.min(5, oldStage + 1) : 0;
    const intervalDays = result.recalled ? [1, 3, 7, 14, 30][Math.max(0, masteryStage - 1)] : 0;
    progress[result.card_id] = {
      stage: masteryStage, dueAt: now + intervalDays * 86400000,
      lastSeenAt: now, lastRecalled: result.recalled
    };
    return { ...result, mastery_stage: masteryStage, mastered: masteryStage >= 3 };
  });
  const session = {
    session_id: newSessionId(), local_date: localDate(active.startedAt, active.timezone),
    start_at: active.startedAt, end_at: endedAt, study_seconds: studySeconds,
    deck_label: active.deckLabel, direction: active.direction,
    source_pages: [...new Set(active.cards.flatMap(card => card.pages || [card.page]).filter(Boolean))].sort((a, b) => a - b).join(','),
    unique_cards: active.seen.size, card_ids: [...active.seen].join(','), recalled_count: active.correct,
    review_count: missedIds.length,
    test_mode: active.testMode, planned_questions: active.cards.length,
    difficulty_intensity: active.difficultyIntensity,
    difficulty_description: active.testMode === 'random' ? describeDifficulty(active.difficultyIntensity) : '',
    missed_card_ids: missedIds.join(','), timezone: active.timezone, recorded_at: '', pending: isAppsScriptHost() || !!config.endpoint,
    card_results: cardResults
  };
  try {
    await saveSession(session, progress); active = null;
    $('summary-actions').hidden = true; $('saved-state').hidden = false;
    $('saved-state').textContent = isMemoryOnly()
      ? 'このブラウザーでは一時保存で練習を続けます。記録はこのページを閉じると消えます。'
      : session.pending ? '端末に保存しました。Google Sheetsへ同期します。失敗しても記録はこの端末に残ります。' : '端末に保存しました。Google Sheetsへ接続すると、保存後に同期できます。';
    await refreshHome();
    if (session.pending) void sync().then(async () => { await refreshHome(); notify('Google Sheetsに同期しました。'); }).catch(error => notify(error.message));
  } catch (error) { notify(error.message || '保存できませんでした。'); }
}
function pauseToggle() {
  if (!active) return;
  if (active.paused) { active.paused = false; active.resumedAt = Date.now(); $('pause-button').textContent = '一時停止'; $('answer-input').disabled = false; $('reveal-button').disabled = false; notify('学習を再開しました。'); }
  else { active.accumulated = elapsedStudySeconds(); active.paused = true; $('pause-button').textContent = '再開'; $('answer-input').disabled = true; $('reveal-button').disabled = true; notify('一時停止しました。'); }
  renderClock();
}
async function refreshHome() {
  const privateHost = isAppsScriptHost();
  const [sessions, progress, config, translations] = await Promise.all([readSessions(), readState('progress', {}), readState('config', { endpoint: '', token: '' }), readChineseTranslationMap()]);
  applyChineseTranslations(translations);
  const translatedCount = Object.keys(translations || {}).length;
  $('translate-progress').textContent = translatedCount
    ? `端末保存済み ${translatedCount.toLocaleString()} / ${CARDS.length.toLocaleString()}件。続きの翻訳も実行できます。`
    : '教材の日本語語彙をGoogleへ送信します。Apps Scriptの翻訳権限が必要です。処理済みの訳は端末へ保存され、再実行で続きから再開できます。';
  const today = localDate(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const seconds = sessions.filter(row => row.local_date === today).reduce((sum, row) => sum + row.study_seconds, 0);
  $('today-total').textContent = `${Math.floor(seconds / 60)}分`; $('saved-total').textContent = sessions.length;
  $('review-total').textContent = CARDS.filter(card => progress[card.id]?.dueAt <= Date.now()).length;
  renderSelection(progress);
  $('endpoint').value = config.endpoint || ''; $('token').value = config.token || '';
  if (privateHost) {
    $('api-credentials').hidden = true;
    $('api-config-actions').hidden = true;
    $('settings-intro').textContent = 'Googleアカウント本人限定のアプリから、保存した記録を同じGoogle Sheetsへ送ります。';
  }
  const connected = privateHost || Boolean(config.endpoint);
  const state = $('sync-state'); state.dataset.state = connected ? 'connected' : 'local';
  const pending = sessions.filter(row=>row.pending).length;
  state.lastElementChild.textContent = isMemoryOnly() ? '一時保存（このページを閉じると記録は消えます）' : privateHost ? `Google Sheetsへ接続 · 未送信 ${pending}件` : config.endpoint ? `Google Sheets接続先を保存済み · 未送信 ${pending}件` : '端末内に保存';
  $('retry-sync').disabled = !connected || !pending;
}
function restorePreferences() {
  try {
    selectedType = 'word';
    reviewOnly = localStorage.getItem('belajar-kata:review-only') === 'true';
    for (const id of ['direction-select','length-select']) {
      const saved = localStorage.getItem(`belajar-kata:${id}`);
      if (saved && [...$(id).options].some(option => option.value === saved)) $(id).value = saved;
    }
    renderLessonOptions(localStorage.getItem('belajar-kata:lesson') || '10');
  } catch (_) { /* Private browsing may block optional preference storage. */ }
  renderSelection();
}
async function renderHistory() {
  const rows = await readSessions(); rows.sort((a, b) => b.start_at.localeCompare(a.start_at));
  const total = rows.reduce((sum, row) => sum + row.study_seconds, 0);
  $('history-summary').innerHTML = `<div><strong>${formatTime(total)}</strong><br><span>保存した学習時間</span></div><div><strong>${rows.length}</strong><br><span>セッション</span></div>`;
  $('history-list').innerHTML = rows.length ? rows.map(row => `<article class="history-item"><strong>${escapeHTML(row.deck_label)}</strong><b>${formatTime(row.study_seconds)}</b><small>${escapeHTML(row.local_date)} · ${row.direction} · ${row.unique_cards}枚 · 自己評価 ${row.unique_cards ? Math.round(row.recalled_count / row.unique_cards * 100) : 0}%${row.pending ? ' · Sheets未同期':''}</small></article>`).join('') : '<div class="empty-history">保存された学習記録はありません。<br>セッション終了時に保存を選ぶと、ここに表示されます。</div>';
}
async function renderDashboard() {
  const [progress, sessions] = await Promise.all([readState('progress', {}), readSessions()]);
  const trends = aggregateStudyTrends(sessions);
  const wordSets = createStudySets(CARDS, 'word');
  const wordCards = CARDS.filter(card => card.type === 'word');
  const masteredWords = wordCards.filter(card => (progress[card.id]?.stage || 0) >= 3).length;
  const masteredSets = wordSets.filter(set => set.cards.every(card => (progress[card.id]?.stage || 0) >= 3)).length;
  const dailyWordTarget = Math.ceil(wordCards.length / 100);
  const levels = IKENTEI_LEVELS.map(level => {
    const cards = CARDS.filter(card => card.ikenteiLevel === level);
    const mastered = cards.filter(card => (progress[card.id]?.stage || 0) >= 3).length;
    const percent = cards.length ? Math.round(mastered / cards.length * 100) : 0;
    const record = trends.attemptsByLevel[level];
    const recall = record.total ? `自己評価で思い出せた割合 ${Math.round(record.recalled / record.total * 100)}% · ${record.total}回答` : '自己評価の記録はまだありません';
    return `<article class="level-panel"><div class="level-panel-head"><h2>${level}級目安</h2><span>${cards.length.toLocaleString()}語・表現</span></div><div class="level-track"><div style="width:${percent}%"></div></div><p><strong>${mastered.toLocaleString()}</strong> / ${cards.length.toLocaleString()} 件に習得目安の記録（${percent}%）</p><small>${recall}</small></article>`;
  });
  const total = CARDS.length;
  const mastered = CARDS.filter(card => (progress[card.id]?.stage || 0) >= 3).length;
  const chart = (title, points, daily = false) => {
    const width = 560, height = 190, left = 34, right = 8, top = 12, bottom = 30;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const max = Math.max(daily ? 60 : 5, ...points.map(point => point.minutes));
    const step = plotWidth / points.length, barWidth = Math.max(4, step * 0.58);
    const targetBand = daily
      ? `<rect x="${left}" y="${top + plotHeight * (1 - 60 / max)}" width="${plotWidth}" height="${plotHeight * 15 / max}" class="chart-target-band"><title>1日45〜60分の目標帯</title></rect>`
      : '';
    const grid = [0, 0.5, 1].map(ratio => {
      const y = top + plotHeight * (1 - ratio), label = Math.round(max * ratio);
      return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="chart-grid"/><text x="${left - 5}" y="${y + 3}" text-anchor="end" class="chart-axis">${label}</text>`;
    }).join('');
    const bars = points.map((point, index) => {
      const barHeight = point.minutes ? Math.max(2, plotHeight * point.minutes / max) : 0;
      const x = left + index * step + (step - barWidth) / 2, y = top + plotHeight - barHeight;
      const showLabel = !daily || index % 2 === 0 || index === points.length - 1;
      return `<g><title>${point.label}: ${point.minutes}分</title><rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" class="chart-bar"/>${showLabel ? `<text x="${x + barWidth / 2}" y="${height - 8}" text-anchor="middle" class="chart-label">${point.label}</text>` : ''}</g>`;
    }).join('');
    return `<article class="trend-panel"><h2>${title}</h2><p>学習時間（分）${daily ? ' · 薄緑は1日45〜60分の目標' : ''}</p><svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}。棒にポインターを合わせると分数が表示されます。">${targetBand}${grid}${bars}</svg></article>`;
  };
  $('dashboard-summary').innerHTML = `<div class="dashboard-metrics"><div class="dashboard-total"><strong>${trends.targetDays} / 100日</strong><span>45分以上学習した日</span></div><div class="dashboard-total"><strong>${Math.floor(trends.totalMinutes / 60)}時間 ${trends.totalMinutes % 60}分</strong><span>保存記録の累計</span></div><div class="dashboard-total"><strong>${mastered.toLocaleString()} / ${total.toLocaleString()}</strong><span>全教材の習得目安</span></div></div><article class="level-panel study-plan-panel"><div class="level-panel-head"><h2>単語の100日計画</h2><span>教材語彙 ${wordCards.length.toLocaleString()}語</span></div><div class="level-track"><div style="width:${Math.round(masteredWords / wordCards.length * 100)}%"></div></div><p><strong>${masteredWords.toLocaleString()} / ${wordCards.length.toLocaleString()}語</strong> 習得目安 · 50語セット ${masteredSets} / ${wordSets.length}完了</p><small>1日約${dailyWordTarget}語を目安にすると100日で一巡できます。50語セットは進捗の単位です。課・ページ情報は各カードに残しています。</small></article><div class="trend-grid">${chart('日別｜直近14日', trends.daily, true)}${chart('月別｜直近12か月', trends.monthly)}</div>${levels.join('')}`;
}
function download(name, type, content) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function csvEscape(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
async function exportCSV() {
  const sessions = await readSessions();
  const headers = ['record_type','session_id','local_date','start_at','end_at','study_seconds','deck_label','direction','source_pages','unique_cards','recalled_count','review_count','card_ids','missed_card_ids','timezone','card_id','card_type','lesson','source_page','ja','idLang','ikentei_level','ikentei_basis','ikentei_confidence','recalled','exact_match','mastery_stage','mastered','recorded_at','test_mode','planned_questions','difficulty_intensity','difficulty_description','zh','zh_source'];
  const rows = [];
  for (const session of sessions) {
    const summary = Object.fromEntries(headers.map(key => [key, '']));
    Object.assign(summary, { record_type: 'session', ...session });
    rows.push(headers.map(key => summary[key] ?? ''));
    for (const card of session.card_results || []) {
      const detail = Object.fromEntries(headers.map(key => [key, '']));
      Object.assign(detail, {
        record_type: 'card', session_id: session.session_id, local_date: session.local_date,
        start_at: session.start_at, end_at: session.end_at, deck_label: session.deck_label,
        direction: session.direction, timezone: session.timezone, test_mode: session.test_mode,
        planned_questions: session.planned_questions, difficulty_intensity: session.difficulty_intensity,
        difficulty_description: session.difficulty_description, ...card
      });
      rows.push(headers.map(key => detail[key] ?? ''));
    }
  }
  const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
  download(`belajar-kata-sessions-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8', `\uFEFF${csv}`);
}
function exportGlossaryCSV() {
  const fields = ['id','type','ja','idLang','zh','zhSource','root','lesson','lessons','page','pages','audio','sources','categories','ikenteiLevel','ikenteiLabel','ikenteiDifficulty','ikenteiBasis','ikenteiConfidence','ikenteiSampleAnchor'];
  const quote = value => `"${String(value ?? '').replaceAll('"','""')}"`;
  const rows = [fields.map(quote).join(',')];
  for (const card of CARDS) rows.push(fields.map(field => quote(Array.isArray(card[field]) ? card[field].join('|') : card[field])).join(','));
  download(`Belajar-Kata-教材語彙データ-${new Date().toISOString().slice(0,10)}.csv`, 'text/csv;charset=utf-8', `\uFEFF${rows.join('\r\n')}\r\n`);
}

async function selectType(type) {
  selectedType = type;
  renderLessonOptions($('lesson-select').value);
  try {
    localStorage.setItem('belajar-kata:type', selectedType);
    localStorage.setItem('belajar-kata:lesson', $('lesson-select').value);
  } catch (_) {}
  renderSelection(await readState('progress', {}));
}

$('lesson-select').addEventListener('change', async () => {
  try { localStorage.setItem('belajar-kata:lesson', $('lesson-select').value); } catch (_) {}
  renderSelection(await readState('progress', {}));
});
$('review-toggle').addEventListener('click', async () => {
  reviewOnly = !reviewOnly;
  try { localStorage.setItem('belajar-kata:review-only', String(reviewOnly)); } catch (_) {}
  renderSelection(await readState('progress', {}));
});
$('direction-select').addEventListener('change', async () => {
  try { localStorage.setItem('belajar-kata:direction-select', $('direction-select').value); } catch (_) {}
  renderLessonOptions($('lesson-select').value);
  renderSelection(await readState('progress', {}));
});
$('length-select').addEventListener('change', () => { try { localStorage.setItem('belajar-kata:length-select', $('length-select').value); } catch (_) {} });
$('start-button').addEventListener('click', async () => startSession(await readState('progress', {})));
$('random-test-button').addEventListener('click', () => { updateRandomSettings(); $('random-dialog').showModal(); });
$('random-count').addEventListener('input', updateRandomSettings);
$('random-difficulty').addEventListener('input', updateRandomSettings);
$('random-close').addEventListener('click', () => $('random-dialog').close());
$('random-cancel').addEventListener('click', () => $('random-dialog').close());
$('random-start').addEventListener('click', async () => {
  $('random-dialog').close();
  const progress = await readState('progress', {});
  startSession(progress, { lessonOverride: 'all', questionCount: randomQuestionCount, randomTest: true, difficultyIntensity: randomDifficulty });
});
$('reveal-button').addEventListener('click', reveal);
$('answer-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); reveal(); } });
$('got-button').addEventListener('click', () => grade(true)); $('missed-button').addEventListener('click', () => grade(false));
$('pause-button').addEventListener('click', pauseToggle); $('leave-button').addEventListener('click', finishSession);
$('listen-prompt').addEventListener('click', () => { if (!active?.current) return; const code = DIRECTIONS[active.direction].from; speak(active.current[code], code === 'idLang' ? 'id-ID' : code === 'zh' ? 'zh-CN' : 'ja-JP'); });
$('listen-answer').addEventListener('click', () => { if (!active?.current) return; const code = DIRECTIONS[active.direction].to; speak(active.current[code], code === 'idLang' ? 'id-ID' : code === 'zh' ? 'zh-CN' : 'ja-JP'); });
$('save-session').addEventListener('click', () => void saveCurrent());
$('discard-session').addEventListener('click', async () => { active = null; await refreshHome(); show('home-screen'); notify('このセッションの記録を保存せず終了しました。'); });
$('history-button').addEventListener('click', () => void renderHistory().then(() => show('history-screen')));
$('history-back').addEventListener('click', () => show('home-screen')); $('export-csv').addEventListener('click', () => void exportCSV());
$('dashboard-open').addEventListener('click', () => void renderDashboard().then(() => show('dashboard-screen')));
$('dashboard-back').addEventListener('click', () => show('history-screen'));
$('settings-open').addEventListener('click', async () => { await refreshHome(); $('settings-dialog').showModal(); });
$('connect-button').addEventListener('click', async () => {
  const config = { endpoint: $('endpoint').value.trim(), token: $('token').value.trim() };
  try {
    validateConfig(config); $('connect-button').disabled = true; await writeState('config', config); await refreshHome();
    try { await ping(config); await sync(); await refreshHome(); notify('Sheetsへの接続を確認しました。'); }
    catch (error) { notify(`接続設定は保存しました。応答は未確認です。${error.message}`); }
  }
  catch (error) { notify(error.message); }
  finally { $('connect-button').disabled = false; }
});
$('disconnect-button').addEventListener('click', async () => { await writeState('config', { endpoint: '', token: '' }); await refreshHome(); notify('Sheets接続を解除しました。'); });
$('retry-sync').addEventListener('click', async () => { try { await sync(); await refreshHome(); notify('未送信の記録を確認しました。'); } catch (error) { notify(error.message); } });
$('translate-all').addEventListener('click', () => void translateAllChinese());
$('export-glossary').addEventListener('click', exportGlossaryCSV);
$('export-json').addEventListener('click', async () => download(`belajar-kata-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(await exportData(), null, 2)));
document.addEventListener('keydown', event => {
  if ($('settings-dialog').open || !active || event.isComposing) return;
  if (!$('grade-actions').hidden && event.key === '1') { grade(false); return; }
  if (!$('grade-actions').hidden && event.key === '2') { grade(true); return; }
  if (event.key === 'Escape') finishSession();
});
addEventListener('online', () => void sync().then(refreshHome).catch(() => {}));
restorePreferences();
void refreshHome();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
void sync().then(refreshHome).catch(() => {});
}
