export const IKENTEI_LEVELS = ['E', 'D', 'C'];
export const IKENTEI_RANK = Object.freeze({ E: 0, D: 1, C: 2 });
export const IKENTEI_LABELS = Object.freeze({ E: 'E級目安', D: 'D級目安', C: 'C級目安' });

// The official diagnostic tests are reference anchors, not a complete word list.
// An item's exam level is therefore estimated from the textbook's stated E–C
// vocabulary range, unit progression, and the Appendix's everyday-life categories.
const SAMPLE_ANCHORS = Object.freeze({
  E: ['pisau', 'monyet', 'bir', 'air', 'susu', 'perlu', 'berbicara', 'guru', 'dengan', 'menunggu', 'telepon', 'toko kue', 'buah', 'mangga', 'enak', 'makan', 'kamar tamu', 'menyapu', 'kamar tidur', 'kamar kecil', 'kamar mandi', 'pukul', 'pagi', 'malam'],
  D: ['upacara', 'pengarang', 'pengajar', 'pelukis', 'pesan', 'kapan', 'mana', 'berapa', 'siapa', 'ngecek', 'cek', 'harga', 'tiket', 'bioskop', 'hapus', 'air mata', 'nasi goreng', 'mie goreng', 'sedap', 'berasal', 'pindah', 'pergi', 'sering', 'baju renang', 'pantai', 'besok', 'mendaki', 'gunung'],
  C: ['bertanda', 'berkenan', 'bernaung', 'bermanfaat', 'dilontarkan', 'pemuda', 'hati', 'laporan', 'singkat', 'selesai', 'pekerjaan', 'lengkap', 'ringkas', 'nyata', 'rumit', 'terpencil', 'bebas', 'gangguan', 'malaria', 'pesta', 'pernikahan', 'keponakan', 'sembuh', 'pengantin', 'seenaknya', 'menyeberang', 'menghiraukan', 'keselamatan', 'mengecam', 'karyawan', 'perusahaan', 'dihargai', 'pemimpin']
});

const E_APPENDIX = new Set(['人', '位置', '方角', '日付', '時間', '頻度', '曜日,月,季節,世紀', '果物', '野菜', '食べ物', '飲み物']);
const D_APPENDIX = new Set(['アクセサリー', 'お金', 'ショッピングモール', 'トラブル', 'レストラン', '乗り物', '列車、船', '飛行機', '宿泊施設', '携行品', '料理', '化粧品', '台所用品', '天気', '動物', '身体', '服', '植物', '郵便', '電話', '学校', '趣味', '素材', '虫', '調味料', '自然', '手工芸品']);

const norm = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const anchorSets = Object.fromEntries(Object.entries(SAMPLE_ANCHORS).map(([level, words]) => [level, new Set(words.map(norm))]));

export function assessIkenTei(card) {
  const lessons = (card.lessons || [card.lesson]).map(String);
  const categories = card.categories || [];
  const hasAppendix = lessons.includes('appendix') || (card.sources || []).includes('appendix');
  const lessonNumbers = lessons.filter(value => /^\d+$/.test(value)).map(Number);
  let level;
  let basis;

  if (hasAppendix) {
    if (categories.some(category => E_APPENDIX.has(category))) level = 'E';
    else if (categories.some(category => D_APPENDIX.has(category))) level = 'D';
    else level = 'C';
    basis = 'appendix_category_estimate';
  } else {
    const lesson = lessonNumbers.length ? Math.min(...lessonNumbers) : null;
    level = lesson !== null && lesson <= 3 ? 'E' : lesson !== null && lesson <= 8 ? 'D' : 'C';
    basis = 'textbook_lesson_progression';
  }

  // Direct occurrences in official diagnostic samples are useful level anchors.
  // They never promote vocabulary beyond this book's declared C–E range.
  const term = norm(card.idLang);
  const officialSampleLevels = IKENTEI_LEVELS.filter(candidate => anchorSets[candidate].has(term));
  if (officialSampleLevels.length) {
    const sampleRank = Math.max(...officialSampleLevels.map(candidate => IKENTEI_RANK[candidate]));
    if (sampleRank > IKENTEI_RANK[level]) level = IKENTEI_LEVELS[sampleRank];
    basis = 'official_sample_and_textbook_context';
  }

  return {
    ikenteiLevel: level,
    ikenteiLabel: IKENTEI_LABELS[level],
    ikenteiDifficulty: IKENTEI_RANK[level] + 1,
    ikenteiBasis: basis,
    ikenteiConfidence: basis === 'official_sample_and_textbook_context' ? 'sample-aligned' : 'estimated',
    ikenteiSampleAnchor: officialSampleLevels.join('|')
  };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function allocate(groups, count, targetLevel) {
  const levels = [...groups.keys()].sort((a, b) => IKENTEI_RANK[a] - IKENTEI_RANK[b]);
  const quotas = new Map(levels.map(level => [level, 0]));
  const targetCount = Math.ceil(count * 0.5);
  if (targetLevel === 'all') {
    for (let index = 0; index < count; index++) quotas.set(levels[index % levels.length], quotas.get(levels[index % levels.length]) + 1);
  } else {
    quotas.set(targetLevel, Math.min(groups.get(targetLevel)?.length || 0, targetCount));
    let remaining = count - quotas.get(targetLevel);
    const lowerLevels = levels.filter(level => IKENTEI_RANK[level] < IKENTEI_RANK[targetLevel]);
    while (remaining > 0 && lowerLevels.length) {
      let moved = false;
      for (const level of lowerLevels) {
        if (remaining === 0) break;
        if (quotas.get(level) < groups.get(level).length) {
          quotas.set(level, quotas.get(level) + 1);
          remaining--; moved = true;
        }
      }
      if (!moved) break;
    }
    if (remaining > 0) {
      const target = levels.filter(level => quotas.get(level) < groups.get(level).length);
      while (remaining > 0 && target.length) {
        for (const level of target) {
          if (remaining === 0) break;
          if (quotas.get(level) < groups.get(level).length) { quotas.set(level, quotas.get(level) + 1); remaining--; }
        }
        for (let index = target.length - 1; index >= 0; index--) if (quotas.get(target[index]) >= groups.get(target[index]).length) target.splice(index, 1);
      }
    }
  }
  // Any tier smaller than its first allocation donates its spare slots to others.
  let overflow = 0;
  for (const level of levels) {
    if (quotas.get(level) > groups.get(level).length) {
      overflow += quotas.get(level) - groups.get(level).length;
      quotas.set(level, groups.get(level).length);
    }
  }
  while (overflow > 0) {
    const available = levels.filter(level => quotas.get(level) < groups.get(level).length);
    if (!available.length) break;
    for (const level of available) {
      if (!overflow) break;
      quotas.set(level, quotas.get(level) + 1); overflow--;
    }
  }
  return quotas;
}

export function filterByIkenTeiLevel(cards, targetLevel = 'all') {
  if (targetLevel === 'all') return cards;
  return cards.filter(card => IKENTEI_RANK[card.ikenteiLevel] <= IKENTEI_RANK[targetLevel]);
}

export function selectQuestions(cards, count, targetLevel = 'all', random = Math.random, priorityIds = new Set()) {
  if (!cards.length || count <= 0) return [];
  const pool = filterByIkenTeiLevel(cards, targetLevel);
  const limit = Math.min(count, pool.length);
  if (limit === pool.length) return shuffle(pool, random);

  const groups = new Map(IKENTEI_LEVELS.map(level => [level, pool.filter(card => card.ikenteiLevel === level)]).filter(([, items]) => items.length));
  const quotas = allocate(groups, limit, targetLevel);
  const selected = [];
  for (const level of groups.keys()) {
    const quota = quotas.get(level) || 0;
    if (!quota) continue;
    const items = groups.get(level);
    const priority = items.filter(card => priorityIds.has(card.id));
    const other = items.filter(card => !priorityIds.has(card.id));
    const chosenPriority = shuffle(priority, random).slice(0, quota);
    selected.push(...chosenPriority, ...shuffle(other, random).slice(0, quota - chosenPriority.length));
  }
  return shuffle(selected, random);
}
