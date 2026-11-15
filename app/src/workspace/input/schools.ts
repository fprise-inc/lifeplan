// 学校の一覧と探し方（0010 の2・0217）。子ども・教育の学校名の欄が使う。
// - 一覧は文部科学省の学校コード一覧から作ったもの（data/schools。src/generated/schools.data.js を遅れて読む。画面の初めの読み込みに入れない）
// - 主キーは学校コード（13桁）。名前はキーにしない。廃止した学校は、移行先（successor）をたどって今の学校にする
// - 探し方: 打つたびに候補が絞られる部分一致。学校名・読み・略称・旧校名のどれでも引ける。全角半角・カタカナひらがな・旧字体の揺れはそろえて比較する
// - 学校の段（幼稚園〜大学院）ごとに選べる学校種を決め、段に合わない学校は候補に出さず、選べない
import type { EducationStage } from "../../engine/types.ts";

/** 画面に配る形（app/scripts/schoolList.ts の buildSchoolBundle と同じ） */
export interface SchoolBundle {
  pack: string;
  version: string;
  edition: string;
  cities: string[];
  /** [学校コード, 学校名, 市区町村の番号, 読み, 廃止の日, 移行先]（後ろの空の値は省く） */
  schools: (string | number)[][];
  /** [学校コード, 別名, 種類（abbr 略称・former 旧校名・variant 別の表記）] */
  aliases: [string, string, string][];
  /** 学部・学科（学校コード → 部局の並び）。第2段で入れる（今は無い） */
  departments?: Record<string, SchoolDepartment[]>;
}

/** 学部・学科（0010 の2: 学校コード＋自前の固定ID。部局IDは使い回さない） */
export interface SchoolDepartment {
  /** 部局ID（d001 など） */
  id: string;
  name: string;
  /** 修業年数 */
  years?: number;
}

export interface School {
  code: string;
  name: string;
  /** 学校種の記号（A1 幼稚園 … H2 各種学校） */
  kind: string;
  /** 都道府県番号（01〜47） */
  pref: string;
  /** 設置区分（1 国立・2 公立・3 私立） */
  sector: string;
  city: string;
  kana: string;
  abolishedOn: string;
  successor: string;
}

export type HitVia = "name" | "kana" | "abbr" | "variant" | "former";

export interface SchoolHit {
  school: School;
  /** 何で引いたか（学校名でなければ、その別名を候補に添える） */
  via: HitVia;
  text: string;
}

interface IndexEntry {
  key: string;
  code: string;
  via: HitVia;
  text: string;
}

export interface SchoolList {
  pack: string;
  version: string;
  edition: string;
  byCode: ReadonlyMap<string, School>;
  index: readonly IndexEntry[];
  departments: Readonly<Record<string, SchoolDepartment[]>>;
}

export const SCHOOL_PACK_ID = "master.education.schools";

export const SCHOOL_KIND_LABELS: Readonly<Record<string, string>> = {
  A1: "幼稚園",
  A2: "認定こども園",
  B1: "小学校",
  C1: "中学校",
  C2: "義務教育学校",
  D1: "高校",
  D2: "中等教育学校",
  E1: "特別支援学校",
  F1: "大学",
  F2: "短大",
  G1: "高専",
  H1: "専修学校",
  H2: "各種学校",
};

const PREFS = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県",
  "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県",
  "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];
export const prefName = (pref: string): string => PREFS[Number(pref) - 1] ?? "";
const SECTOR_LABELS: Readonly<Record<string, string>> = { "1": "国立", "2": "公立", "3": "私立" };

/**
 * 学校の段ごとに選べる学校種（学校コードの1〜2桁目）。特別支援学校は幼稚部〜高等部があるので幼稚園〜高校の段で選べる。
 * 義務教育学校は小学校・中学校、中等教育学校は中学校・高校の段。専門学校の段は専修学校と各種学校。
 * インターナショナルスクール（幼稚園〜高校の段）は各種学校も選べる（多くは各種学校）。保育園の段は学校コードが無いので欄を出さない
 */
const STAGE_KINDS: Readonly<Record<string, readonly string[]>> = {
  kindergarten: ["A1", "A2", "E1"],
  elementary: ["B1", "C2", "E1"],
  juniorHigh: ["C1", "C2", "D2", "E1"],
  highSchool: ["D1", "D2", "E1"],
  kosen: ["G1"],
  university: ["F1"],
  juniorCollege: ["F2"],
  vocational: ["H1", "H2"],
  graduateMaster: ["F1"],
  graduateDoctor: ["F1"],
  graduateProfessional: ["F1"],
};

/** その段（と公立・私立の欄）で選べる学校種 */
export function kindsFor(stage: string, sector?: string): readonly string[] {
  const k = STAGE_KINDS[stage] ?? [];
  return sector === "international" && ["kindergarten", "elementary", "juniorHigh", "highSchool"].includes(stage) ? [...k, "H2"] : k;
}

export const stageHasSchools = (stage: string): boolean => (STAGE_KINDS[stage] ?? []).length > 0;

// ---- 文字のそろえ方 ----

/** 学校名で使われる旧字体・異体字（検索のときだけ新字体にそろえる。一覧の名前は変えない） */
const VARIANTS: Readonly<Record<string, string>> = {
  藝: "芸", 學: "学", 國: "国", 澤: "沢", 濱: "浜", 邊: "辺", 邉: "辺", 齋: "斎", 齊: "斉", 髙: "高", 﨑: "崎", 嶋: "島", 廣: "広", 櫻: "桜",
  惠: "恵", 德: "徳", 會: "会", 實: "実", 應: "応", 龍: "竜", 榮: "栄", 眞: "真", 黑: "黒", 圓: "円", 豐: "豊", 禮: "礼", 靜: "静", 舘: "館",
  淺: "浅", 條: "条", 壽: "寿", 雙: "双", 臺: "台", 驛: "駅", 鐵: "鉄", 醫: "医", 藥: "薬", 專: "専", 經: "経", 樂: "楽", 聯: "連",
};

/**
 * 比較のためにそろえた文字（全角半角〔NFKC〕・大文字小文字・カタカナをひらがな・旧字体を新字体・「ヶ」を「け」、空白と中黒と記号の
 * ハイフン・点を外す）
 */
export function normalizeSchoolText(text: string): string {
  let s = text.normalize("NFKC").toLowerCase();
  s = s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  s = s.replace(/[ゖ]/g, "け").replace(/[ゕ]/g, "か");
  s = s.replace(/[\s・･\-‐‑–—―〜~.。、,()（）「」『』]/g, "");
  let out = "";
  for (const ch of s) out += VARIANTS[ch] ?? ch;
  return out;
}

// ---- 一覧を作る ----

export function makeSchoolList(b: SchoolBundle): SchoolList {
  const byCode = new Map<string, School>();
  for (const t of b.schools) {
    const code = String(t[0]);
    byCode.set(code, {
      code,
      name: String(t[1]),
      kind: code.slice(0, 2),
      pref: code.slice(2, 4),
      sector: code.slice(4, 5),
      city: b.cities[Number(t[2])] ?? "",
      kana: t[3] === undefined ? "" : String(t[3]),
      abolishedOn: t[4] === undefined ? "" : String(t[4]),
      successor: t[5] === undefined ? "" : String(t[5]),
    });
  }
  const list: SchoolList = { pack: b.pack, version: b.version, edition: b.edition, byCode, index: [], departments: b.departments ?? {} };
  const index: IndexEntry[] = [];
  for (const s of byCode.values()) {
    if (s.abolishedOn !== "") {
      // 廃止した学校は候補に出さない。移行先があれば、その名前を移行先の学校の旧校名にする（名前が同じなら移行先の名前で引ける）
      const now = currentSchool(list, s.code);
      if (now !== null && now.code !== s.code && normalizeSchoolText(now.name) !== normalizeSchoolText(s.name)) index.push({ key: normalizeSchoolText(s.name), code: now.code, via: "former", text: s.name });
      continue;
    }
    index.push({ key: normalizeSchoolText(s.name), code: s.code, via: "name", text: s.name });
    if (s.kana !== "") index.push({ key: normalizeSchoolText(s.kana), code: s.code, via: "kana", text: s.kana });
  }
  for (const [code, name, kind] of b.aliases) {
    const now = currentSchool(list, code);
    if (now === null) continue;
    index.push({ key: normalizeSchoolText(name), code: now.code, via: kind === "abbr" || kind === "former" || kind === "variant" ? kind : "variant", text: name });
  }
  return { ...list, index };
}

/**
 * 学校コードから今の学校（廃止していれば移行先をたどった先。移行先が無い・一覧に無い・循環するなら null）。廃止していなければその学校
 */
export function currentSchool(list: Pick<SchoolList, "byCode">, code: string): School | null {
  let s = list.byCode.get(code);
  const seen = new Set<string>();
  while (s !== undefined && s.abolishedOn !== "") {
    if (seen.has(s.code) || s.successor === "") return null;
    seen.add(s.code);
    s = list.byCode.get(s.successor);
  }
  return s ?? null;
}

// ---- 探す ----

const VIA_RANK: Readonly<Record<HitVia, number>> = { name: 0, kana: 1, abbr: 2, variant: 2, former: 3 };

/** 学校がその段（と公立・私立の欄）で選べるか */
export function schoolFits(s: Pick<School, "kind">, stage: string, sector?: string): boolean {
  return kindsFor(stage, sector).includes(s.kind);
}

/**
 * 打った文字で学校を探す（部分一致）。段に合う学校だけ、廃止していない学校だけ。同じ学校は1回（いちばん合う引き方で）。
 * 並びは、全部一致 → 前方一致 → 途中の一致、同じなら学校名 → 読み → 略称・別の表記 → 旧校名、名前の短い順、学校コードの順
 */
export function searchSchools(list: SchoolList, query: string, o: { stage: string; sector?: string; limit?: number }): { hits: SchoolHit[]; total: number } {
  const q = normalizeSchoolText(query);
  if (q === "") return { hits: [], total: 0 };
  const kinds = kindsFor(o.stage, o.sector);
  const best = new Map<string, { score: number; e: IndexEntry }>();
  for (const e of list.index) {
    if (!kinds.includes(e.code.slice(0, 2))) continue;
    const at = e.key.indexOf(q);
    if (at < 0) continue;
    const score = (e.key === q ? 0 : at === 0 ? 1 : 2) * 10 + VIA_RANK[e.via];
    const cur = best.get(e.code);
    if (cur === undefined || score < cur.score) best.set(e.code, { score, e });
  }
  const all = [...best.values()]
    .map(({ score, e }) => ({ score, hit: { school: list.byCode.get(e.code) as School, via: e.via, text: e.text } }))
    .sort((a, b) => a.score - b.score || a.hit.school.name.length - b.hit.school.name.length || (a.hit.school.code < b.hit.school.code ? -1 : 1));
  return { hits: all.slice(0, o.limit ?? 20).map((x) => x.hit), total: all.length };
}

/**
 * ヒアリングシートの自由記述の学校名の照合（0010 の9。FP が候補から選んで確定する。黙って決めない）。
 * 書いた文字そのままで探し、見つからなければ「第一志望」などの添え書き・括弧の中を外して探す
 */
export function matchSchoolText(list: SchoolList, text: string, o: { stage: string; sector?: string; limit?: number }): { hits: SchoolHit[]; total: number; query: string } {
  const tries = [text, text.replace(/[（(][^）)]*[）)]/g, ""), text.split(/[、,／/・\s]/)[0] ?? ""].map((t) => t.trim()).filter((t, i, a) => t !== "" && a.indexOf(t) === i);
  for (const t of tries) {
    const r = searchSchools(list, t, o);
    if (r.total > 0) return { ...r, query: t };
  }
  return { hits: [], total: 0, query: tries[0] ?? "" };
}

/** 候補の2行目（同じ名前の学校を見分ける: 都道府県・市区町村・国立公立私立・学校種） */
export function schoolDetail(s: School): string {
  return [`${prefName(s.pref)}${s.city}`, SECTOR_LABELS[s.sector] ?? "", SCHOOL_KIND_LABELS[s.kind] ?? ""].filter((x) => x !== "").join("・");
}

/** 選んだ学校の設置区分から、段の公立・私立の欄の値（その段に無い区分は近い物。インターナショナルスクールは変えない） */
export function sectorForSchool(stage: string, s: Pick<School, "sector" | "kind">, current: string | undefined): string {
  if (current === "international") return current;
  if (s.sector === "3") return "private";
  if (s.sector === "1" && !["kindergarten", "juniorCollege", "vocational"].includes(stage)) return "national";
  return "public";
}

/** 学部・学科の一覧（無ければ空。第2段で入れる） */
export function departmentsOf(list: SchoolList, code: string): readonly SchoolDepartment[] {
  return list.departments[code] ?? [];
}

/** 段に持たせる学校（0010 の9: 学校コードと部局ID。学費の実データの行は第2段で写す。行が無ければエンジンは平均で計算する） */
export function schoolOfStage(code: string, list: Pick<SchoolList, "version">, unit?: string): NonNullable<EducationStage["school"]> {
  return { school: code, unit: unit ?? code, rows: [], source: { pack: SCHOOL_PACK_ID, version: list.version } } as unknown as NonNullable<EducationStage["school"]>;
}

// ---- 遅れて読む ----

let loaded: SchoolList | null = null;
let loading: Promise<SchoolList> | null = null;
const listeners = new Set<() => void>();
/**
 * 一覧の読み方（画面が schoolLoader.ts で登録する）。ここで動的に読む書き方をしないのは、この部品を読む AI接続口の1つの JS（build-explain.ts）に、
 * 遅れて読む部品の仕組みを入れないため。登録していなければ一覧は読めない（学校名は学校コードのまま見せる）
 */
let loader: (() => Promise<SchoolBundle>) | null = null;
export function setSchoolLoader(fn: () => Promise<SchoolBundle>): void {
  loader = fn;
}

/** 読み込んだ一覧（まだなら null） */
export const schoolListNow = (): SchoolList | null => loaded;

/** 一覧を読む（1回だけ。読めたら知らせる） */
export function loadSchoolList(): Promise<SchoolList> {
  if (loaded !== null) return Promise.resolve(loaded);
  if (loader === null) return Promise.reject(new Error("学校の一覧の読み方が登録されていません"));
  loading ??= loader().then((bundle) => {
    loaded = makeSchoolList(bundle);
    for (const l of listeners) l();
    return loaded;
  });
  return loading;
}

/** 一覧が読めたときに呼ぶ（戻り値で外す） */
export function onSchoolListLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** テスト用: 一覧を差し替える（null で読み込む前に戻す） */
export function setSchoolListForTest(list: SchoolList | null): void {
  loaded = list;
  loading = list === null ? null : Promise.resolve(list);
}
