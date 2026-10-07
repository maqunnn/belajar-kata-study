// Source text is transcribed from the user's integrated textbook; no added dictionary entries.
// Lesson 10 pages 134–135 were checked against the clear scan supplied in this conversation.
const BASE_CARDS = [
  {id:'l10-v01',type:'word',prompt:'買ってやる',answer:'membelikan',root:'語幹: beli',lesson:10,page:135,audio:147},
  {id:'l10-v02',type:'word',prompt:'探す',answer:'nyari',root:'語幹: cari',lesson:10,page:135,audio:147},
  {id:'l10-v03',type:'word',prompt:'買ってやる',answer:'belikan',root:'語幹: beli',lesson:10,page:135,audio:147},
  {id:'l10-v04',type:'word',prompt:'Tシャツ',answer:'kaus oblong',root:'',lesson:10,page:135,audio:147},
  {id:'l10-v05',type:'word',prompt:'遠い',answer:'jauh',root:'',lesson:10,page:135,audio:147},
  {id:'l10-v06',type:'word',prompt:'有名な',answer:'ternama',root:'語幹: nama',lesson:10,page:135,audio:147},
  {id:'l10-v07',type:'word',prompt:'方法、やり方',answer:'cara',root:'',lesson:10,page:135,audio:147},
  {id:'l10-v08',type:'word',prompt:'バティックを作る',answer:'membatik',root:'語幹: batik',lesson:10,page:135,audio:147},
  {id:'l10-v09',type:'word',prompt:'売る',answer:'jual',root:'',lesson:10,page:135,audio:147},
  {id:'l10-v10',type:'word',prompt:'速成講座',answer:'kursus kilat',root:'',lesson:10,page:135,audio:147},
  {id:'l10-v11',type:'word',prompt:'参加する、ついて行く',answer:'ikut',root:'',lesson:10,page:135,audio:147},
  {id:'l10-v12',type:'word',prompt:'登録する、申し込む',answer:'daftar',root:'',lesson:10,page:135,audio:147},
  {id:'l10-v13',type:'word',prompt:'事前に、前もって',answer:'sebelumnya',root:'語幹: belum',lesson:10,page:135,audio:147},
  {id:'l10-v14',type:'word',prompt:'先に、まずは',answer:'dulu',root:'',lesson:10,page:135,audio:147},
  {id:'l10-v15',type:'word',prompt:'登録する、申し込む（～させる）',answer:'daftarkan',root:'語幹: daftar',lesson:10,page:135,audio:147},
  {id:'l10-v16',type:'word',prompt:'心配する',answer:'khawatir',root:'',lesson:10,page:135,audio:147},
  {id:'l10-v17',type:'word',prompt:'満杯の、満員の',answer:'penuh',root:'',lesson:10,page:135,audio:147},
  {id:'l10-v18',type:'word',prompt:'～に参加する',answer:'ikuti',root:'語幹: ikut',lesson:10,page:135,audio:147},
  {id:'l10-v19',type:'word',prompt:'～だから',answer:'lantaran',root:'語幹: lantar',lesson:10,page:135,audio:147},
];

// 中国語欄は書籍に掲載のない、入力練習用の補助訳です。
const CHINESE = {
  'l10-v01':'买给（某人）','l10-v02':'找（口语）','l10-v03':'买给（某人）','l10-v04':'T恤','l10-v05':'远','l10-v06':'有名的','l10-v07':'方法；方式','l10-v08':'制作蜡染','l10-v09':'卖','l10-v10':'速成班','l10-v11':'参加；跟随','l10-v12':'报名；登记','l10-v13':'事先；提前','l10-v14':'先；首先','l10-v15':'替……报名','l10-v16':'担心','l10-v17':'满；满员','l10-v18':'参加……','l10-v19':'因为；由于',
  'l10-p01':'鲁迪，我今天中午想去买伴手礼。','l10-p02':'你想找什么样的伴手礼？','l10-p03':'我想给爸爸妈妈买蜡染衣服。','l10-p04':'葵呢？','l10-p05':'给葵的话，我只想给她买件T恤。','l10-p06':'我们可以直接在工厂买蜡染衣服。','l10-p07':'是吗？在哪里？我想去那家蜡染工厂。','l10-p08':'那里离这儿不远。工厂相当大，也很有名。','l10-p09':'我们可以在那里学习制作蜡染的方法吗？','l10-p10':'是的，除了卖蜡染制品，还有蜡染速成班。','l10-p11':'哇，我想参加。需要提前报名吗？','l10-p12':'我先打电话替我们报名。我担心已经满员了。','l10-p13':'想参加那个课程的人很多吗？','l10-p14':'是的，因为那家工厂非常受欢迎。'
};
import { EXTRACTED_CARDS, LESSON_LABELS } from './extracted-data.js';
import { assessIkenTei } from './ikentei.js';
import { CHINESE_TRANSLATIONS } from './chinese-translations.js';

const normalizeKey = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const BASE = BASE_CARDS.filter(card => card.type === 'word').map(card => ({
  ...card, ja: card.prompt, idLang: card.answer, zh: CHINESE[card.id] || '',
  zhSource: CHINESE[card.id] ? 'Japanese-based learning aid' : '',
  lesson: String(card.lesson), lessons: [String(card.lesson)], pages: [card.page], sources: ['checked_lesson10'], answers: []
}));
const matchedBase = new Set();
const JAPANESE_TRANSCRIPTION_FIXES = {
  'tb-e0b08b4e7b09': { ja: '~として', jaCorrection: '統合教材2304行の日本語欄「~にとして」をインドネシア語 sebagai と本文用例から補正' },
  'tb-0b29d2e52bc2': { ja: '~しなければならない', jaCorrection: '統合教材5283行の日本語欄をインドネシア語 harus から補正' },
  'tb-56dd57ae4b91': { ja: '~する必要がある', jaCorrection: '統合教材6339行の日本語欄を perlu と後半の用例から補正' },
  'tb-146898a9f87b': { ja: '送り届ける', jaCorrection: '統合教材6317行の mengantar を書籍本文と6541行の用例から補正' },
  'tb-c5d02a424e11': { ja: '伝統的な', jaCorrection: '統合教材9012行の日本語欄を tradisional から補正' },
  'tb-be3522bc27e5': { ja: '半分', jaCorrection: '統合教材9793行の日本語欄を separuhnya から補正し、隣接語 kantong と切り分け' },
  'tb-91982557bae5': { ja: 'ホテルの宿泊料金', jaCorrection: '統合教材16610行の tarif hotel と表の見出しからOCR崩れを補正' },
  'tb-2b09f7d6495f': { ja: 'ハンガー', jaCorrection: '統合教材16636行の gantungan baju, hanger からOCR記号を除去' },
  'tb-2967325394bc': { ja: '椅子', jaCorrection: '統合教材16633行の kursi と用語一覧からOCR誤認を補正' },
  'tb-19d9cfa50080': { ja: '蓮', jaCorrection: '統合教材16918行の teratai, lotus, padma と植物欄からOCR誤認を補正' },
  'tb-c70332f4ca99': { ja: '果実', jaCorrection: '統合教材16899行の buah と植物欄からOCR誤認を補正' },
  'tb-82f729329b98': { ja: '空芯菜', jaCorrection: '統合教材16986行の kangkung と野菜欄から先頭のOCR記号を除去' },
  'tb-e749603b740a': { ja: 'スープ', jaCorrection: '統合教材17187行の sup から先頭のOCR数字を除去' },
  'tb-fd337b7f5b9f': { ja: '魚の唐揚げ', jaCorrection: '統合教材17202行の ikan goreng と料理一覧からOCR誤認を補正' },
  'tb-af17d80d8df2': { ja: '鶏の唐揚げ', jaCorrection: '統合教材17201行の ayam goreng と料理一覧から先頭のOCR数字を除去' },
  'tb-c2fc9c156bb6': { ja: '魚のスパイシー包み焼き', jaCorrection: '統合教材17203行の ikan pepes と料理一覧からOCR誤認を補正' },
  'tb-775e0c5fc109': { ja: 'ちまき', jaCorrection: '統合教材17177行の lontong mi と料理一覧からOCR記号を除去' },
  'tb-0bf5018bf265': { ja: 'オックステールスープ', jaCorrection: '統合教材17189行の sup buntut と料理一覧からOCR記号を除去' },
  'tb-bc0421aa505c': { ja: '具だくさんスープ', jaCorrection: '統合教材17190行の soto と料理一覧からOCR記号を除去' },
  'tb-b2e711b7366a': { ja: '野菜の酸味スープ', jaCorrection: '統合教材17192行の sayur asam と料理一覧からOCR崩れを補正' },
  'tb-7e509eeefa65': { ja: '野菜のココナツミルク煮', jaCorrection: '統合教材17199行の sayur loden と料理一覧からOCR記号と空白を補正' },
  'tb-f0defbc1bdfc': { ja: 'オムレツ', jaCorrection: '統合教材17208行の telur dadar と料理一覧からOCR崩れを補正' },
  'tb-5f968288172f': { ja: 'トースト', jaCorrection: '統合教材17186行の roti panggang/bakar と料理一覧からOCR欠落を補正' },
  'tb-d44a6cf7a196': { ja: '錫', jaCorrection: '統合教材17389行の timah と素材欄からOCR誤認を補正' },
  'tb-03f72d734a65': { ja: '迷彩柄', jaCorrection: '統合教材17358行の loreng と柄欄からOCR崩れを補正' },
  'tb-3478af2fa837': { ja: '電気', jaCorrection: '統合教材17412行の listrik からOCR誤認を補正' },
  'tb-4f06fe52a611': { ja: '青銅', jaCorrection: '統合教材17385行の perunggu からOCR誤認を補正' },
  'tb-4394b8d50fb6': { ja: 'バリ・ヒンドゥー僧', jaCorrection: '統合教材17494行の pemangku から地名のOCR誤認を補正' },
  // Integrated textbook source line 2230 pairs datang with "米る"; the dictionary
  // entry and surrounding textbook examples confirm this is the OCR error "来る".
  'tb-ee5e1bac47df': { ja: '来る', jaCorrection: '統合教材2230行のOCR誤認を「datang」と用例により補正' }
};
const extracted = EXTRACTED_CARDS.filter(rawCard => rawCard.type === 'word').map(rawCard => {
  const card = { ...rawCard, ...(JAPANESE_TRANSCRIPTION_FIXES[rawCard.id] || {}) };
  // Preserve the original stable IDs for the existing Lesson 10 deck while
  // using the integrated textbook's checked Japanese and Indonesian fields.
  const match = BASE.find(base => !matchedBase.has(base.id) && base.type === card.type &&
    base.lesson === card.lesson && base.page === card.page && normalizeKey(base.idLang) === normalizeKey(card.idLang));
  if (match) {
    matchedBase.add(match.id);
    return { ...card, id: match.id, zh: match.zh, zhSource: match.zhSource, answers: [] };
  }
  return { ...card, answers: [] };
});
const retainedBase = BASE.filter(card => !matchedBase.has(card.id));
export const CARDS = [...extracted, ...retainedBase].map(card => {
  const zh = CHINESE_TRANSLATIONS[card.id];
  const translated = typeof zh === 'string' && zh.trim();
  const finalCard = translated
    ? { ...card, zh: zh.trim(), zhSource: 'Google Translate ja→zh-CN (validated keyed import)' }
    : card;
  return { ...finalCard, ...assessIkenTei(finalCard) };
});

const lessonIds = [...new Set(CARDS.flatMap(card => card.lessons || [card.lesson]).map(String))];
lessonIds.sort((a, b) => a === 'appendix' ? 1 : b === 'appendix' ? -1 : Number(a) - Number(b));
const lessonCards = lesson => CARDS.filter(card => (card.lessons || [card.lesson]).map(String).includes(String(lesson)));
export const DECKS = Object.fromEntries([
  ...lessonIds.map(lesson => {
    const label = lesson === 'appendix' ? '巻末付録｜必修単語3600' : (LESSON_LABELS[lesson] || `第${lesson}課`);
    const cards = lessonCards(lesson);
    return [
      [`lesson${lesson}`, { label, cards }],
      [`vocab${lesson}`, { label: `${label}｜単語`, cards: cards.filter(card => card.type === 'word') }]
    ];
  }).flat(),
  ['review', { label: '要復習', cards: [] }],
  ['all', { label: '収録分すべて', cards: CARDS }]
]);
