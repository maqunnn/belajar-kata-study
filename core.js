export const DIRECTIONS = {
  'ja-id': { from: 'ja', to: 'idLang', label: '日本語 → インドネシア語', prompt: '日本語を見て、インドネシア語を入力' },
  'zh-id': { from: 'zh', to: 'idLang', label: '中国語 → インドネシア語', prompt: '中国語を見て、インドネシア語を入力' },
  'id-ja': { from: 'idLang', to: 'ja', label: 'インドネシア語 → 日本語', prompt: 'インドネシア語を見て、日本語を入力' },
  'id-zh': { from: 'idLang', to: 'zh', label: 'インドネシア語 → 中国語', prompt: 'インドネシア語を見て、中国語を入力' }
};

export function normalizeAnswer(value) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

export function matchesReference(input, expected) {
  return normalizeAnswer(input) === normalizeAnswer(expected);
}

export function filterCards(cards, { type, lesson = 'all', direction = 'ja-id', dueIds = null } = {}) {
  return cards.filter(card =>
    card.type === 'word' && (!type || card.type === type) &&
    (lesson === 'all' || (card.lessons || [card.lesson]).map(String).includes(String(lesson))) &&
    (!['zh-id', 'id-zh'].includes(direction) || Boolean(card.zh)) &&
    (!dueIds || dueIds.has(card.id))
  );
}

// Stable, source-order learning batches. A card keeps its textbook lesson/pages;
// the batch is only a study-plan grouping and never replaces provenance.
export function createStudySets(cards, type = 'word', batchSize = 50) {
  const eligible = cards.filter(card => card.type === 'word' && type === 'word');
  const sets = [];
  for (let offset = 0; offset < eligible.length; offset += batchSize) {
    const batch = eligible.slice(offset, offset + batchSize);
    const number = sets.length + 1;
    sets.push({
      id: `set-${String(number).padStart(2, '0')}`,
      number,
      start: offset + 1,
      end: offset + batch.length,
      cards: batch
    });
  }
  return sets;
}

export function filterStudySetCards(cards, { type, setId = 'all', direction = 'ja-id', dueIds = null } = {}) {
  const eligible = filterCards(cards, { type, lesson: 'all', direction, dueIds });
  if (setId === 'all') return eligible;
  const sets = createStudySets(cards, type);
  const target = sets.find(set => set.id === setId);
  if (!target) return [];
  const ids = new Set(target.cards.map(card => card.id));
  return eligible.filter(card => ids.has(card.id));
}

export function selectQuestions(cards, count, random = Math.random, priorityIds = new Set()) {
  if (!cards.length || count <= 0) return [];
  const shuffled = items => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [copy[index], copy[other]] = [copy[other], copy[index]];
    }
    return copy;
  };
  const due = shuffled(cards.filter(card => priorityIds.has(card.id)));
  const other = shuffled(cards.filter(card => !priorityIds.has(card.id)));
  return shuffled([...due.slice(0, count), ...other.slice(0, Math.max(0, count - due.length))]);
}

export function selectDifficultyQuestions(cards, count, intensity, random = Math.random) {
  const levels = ['E', 'D', 'C'];
  const t = Math.max(0, Math.min(100, Number(intensity) || 0)) / 100;
  const shares = [0.75 - 0.6 * t, 0.25, 0.6 * t];
  const exact = shares.map(share => share * count);
  const quotas = exact.map(Math.floor);
  let remainder = count - quotas.reduce((sum, value) => sum + value, 0);
  exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, remainder)
    .forEach(item => quotas[item.index]++);

  const buckets = Object.fromEntries(levels.map(level => [level, cards.filter(card => card.ikenteiLevel === level)]));
  const selected = [];
  const selectedIds = new Set();
  levels.forEach((level, index) => {
    const group = selectQuestions(buckets[level], Math.min(quotas[index], buckets[level].length), random);
    group.forEach(card => { selected.push(card); selectedIds.add(card.id); });
  });
  const remaining = selectQuestions(cards.filter(card => !selectedIds.has(card.id)), count - selected.length, random);
  return selectQuestions([...selected, ...remaining], Math.min(count, cards.length), random);
}

const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function aggregateStudyTrends(sessions, now = new Date()) {
  const dailySeconds = new Map();
  const monthlySeconds = new Map();
  const attemptsByLevel = Object.fromEntries(['E', 'D', 'C'].map(level => [level, { recalled: 0, total: 0 }]));
  for (const session of sessions) {
    const date = String(session.local_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const seconds = Math.max(0, Number(session.study_seconds) || 0);
    dailySeconds.set(date, (dailySeconds.get(date) || 0) + seconds);
    const month = date.slice(0, 7);
    monthlySeconds.set(month, (monthlySeconds.get(month) || 0) + seconds);
    for (const card of session.card_results || []) {
      if (!attemptsByLevel[card.ikentei_level]) continue;
      attemptsByLevel[card.ikentei_level].total++;
      if (card.recalled) attemptsByLevel[card.ikentei_level].recalled++;
    }
  }
  const daily = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let offset = 13; offset >= 0; offset--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const key = dateKey(date);
    daily.push({ key, label: `${date.getMonth() + 1}/${date.getDate()}`, minutes: Math.round((dailySeconds.get(key) || 0) / 60) });
  }
  const monthly = [];
  for (let offset = 11; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthly.push({ key, label: `${date.getMonth() + 1}月`, minutes: Math.round((monthlySeconds.get(key) || 0) / 60) });
  }
  const targetStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 99);
  let targetDays = 0;
  for (let offset = 0; offset < 100; offset++) {
    const date = new Date(targetStart.getFullYear(), targetStart.getMonth(), targetStart.getDate() + offset);
    if ((dailySeconds.get(dateKey(date)) || 0) >= 45 * 60) targetDays++;
  }
  const totalMinutes = [...dailySeconds.values()].reduce((sum, seconds) => sum + seconds, 0) / 60;
  return { daily, monthly, targetDays, totalMinutes: Math.round(totalMinutes), attemptsByLevel };
}
