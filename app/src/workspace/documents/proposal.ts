// 書類の候補の読み口（0148 の4）: AI接続口の道具の答え・架空の見本は、どれもここを通して
// 読み取りの記録（候補の受け皿）にする。届いた答えは信用しない（0015・0016）:
// - 読めるのは保険証券・ご契約内容のお知らせ・設計書（docType insurancePolicy）の、保険の契約の欄（insurance.）の候補（0159）と、
//   固定資産税の課税明細書（propertyTaxStatement）・路線価図（routePriceMap）の、相続税の試算の不動産ごとの欄（plan.inheritanceTax の lands）の候補（0235）。
//   ほかの書類の答えは読まずに理由を出す（ほかの書類は、欄の「?」の一言を見て打つ）
// - 土地・建物の書類の値は land.ts の決まりで整える（地積は小数2桁まで・価格は円の整数・課税標準額や税額の見出しの候補は読まない・
//   路線価図の記号「250C」は、評価の入れ方・路線価〔円〕・借地権割合に分ける）。路線価図はページ（図の番号）を残さない
// - 形を確かめ、知らない欄は捨てる。入力項目ID は登録簿にあるものだけ。大きさの上限を超える分は読まない
// - 個人番号などの番号は、候補に入る前に落とす（privacy.ts）。落とした数だけ残す
// - 文字（元の場所の文字・添え書き・文字の値）は伏せ字の後の文字として持ち、画面では文字のまま出す（HTML にしない・指示として読まない）
// - ここでは世帯の値を変えない。承認は確かめの画面（apply.ts）
//
// 答えの形（document-candidates@1）:
// { contract, docType, asOf?, holder?, objects?: [{key, kind, source?, confidence?}],
//   values: [{item, at?, member?, object?, newObject?, value, unreadable?, period?, source?, confidence?, note?}],
//   references?: [{label, amount, row?, year?, source?}] }
import { ITEM_LABELS } from "../../generated/labels.ts";
import { cleanText, cleanValue, isNumberField, isPersonalNumberValue } from "./privacy.ts";
import { LAND_OBJECT_KIND, LEASEHOLD_RATIOS, NOT_VALUE_WORDS, PLACE_FIELD_WORDS, landAtOk, maskPlace, maskPlaceSource, normalizeArea, normalizeYen, parseRouteMark } from "./land.ts";
import { DOC_TYPES, LAND_AT, LAND_ITEM, LIMITS, PROPOSAL_CONTRACT, READABLE_ITEM_PREFIX, isLandDoc, type CandidateTarget, type CandidateValue, type Confidence, type DocCandidate, type DocObject, type DocReference, type DocSource, type DocType, type DocumentReading, type Via } from "./types.ts";
import { NEW_OBJECT_KINDS, objectKindFits } from "./objects.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ProposalContext {
  via: Via;
  /** 届いた日時（承認の日時と同じ形） */
  at: string;
  /** 乱数の ID を作る（記録・候補・照合の値に振る） */
  newId: () => string;
  reader?: { id: string; version: number };
  /** AI の名乗り（自己申告。AI接続口が受けた名前） */
  connector?: string;
  /** 続柄の鍵 → 構成員の ID（答えの holder〔書類の名義の続柄〕を記録の名義の人の初めの値にする。無ければ名義は FP が選ぶ） */
  members?: readonly { key: string; id: string }[];
}

export interface ProposalResult {
  /** 読めた記録（候補が1つも無ければ null） */
  reading: DocumentReading | null;
  /** 読まなかった所の理由（画面に出す。値・文字は入れない） */
  issues: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ROLE = /^(self|spouse|holder|child[1-9][0-9]?|other[1-9][0-9]?)$/u;
const AT_STEP = /^[A-Za-z0-9_-]{1,40}$/u;
const OBJECT_KEY = /^[A-Za-z0-9_-]{1,16}$/u;
const YM = /^[0-9]{4}-(0[1-9]|1[0-2])$/u;
const ROW = /^cf(\.[a-z][a-zA-Z0-9]*)+$/u;
const PATH = /^[A-Za-z0-9_./-]{1,120}$/u;
const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];

/** 入力項目ID が登録簿にあるか */
export const knownItem = (item: string): boolean => Object.hasOwn(ITEM_LABELS, item);

function readSource(v: unknown, count: { masked: number }): DocSource {
  if (!isObj(v)) return {};
  const out: DocSource = {};
  if (Number.isSafeInteger(v.page) && (v.page as number) >= 1 && (v.page as number) <= 999) out.page = v.page as number;
  if (typeof v.where === "string" && v.where.trim() !== "") {
    const c = cleanText(v.where, LIMITS.where);
    if (c.masked) count.masked++;
    if (c.text !== "") out.where = c.text;
  }
  if (typeof v.text === "string" && v.text.trim() !== "") {
    const c = cleanText(v.text, LIMITS.sourceText);
    if (c.masked) count.masked++;
    if (c.text !== "") out.text = c.text;
  }
  if (Array.isArray(v.box) && v.box.length === 4 && v.box.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1)) out.box = [v.box[0], v.box[1], v.box[2], v.box[3]] as [number, number, number, number];
  if (typeof v.path === "string" && PATH.test(v.path)) out.path = v.path;
  return out;
}

const readConfidence = (v: unknown): Confidence => (CONFIDENCES.includes(v as Confidence) ? (v as Confidence) : "low");

/** 値: 数（整数・有限）・文字（数の形はそのまま、ほかは伏せ字の後で200字まで）・真偽。読めなければ undefined */
function readValue(v: unknown, count: { masked: number }): CandidateValue | null | undefined {
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    if (v.trim() === "") return null;
    const c = cleanValue(v, LIMITS.textValue);
    if (c.masked) count.masked++;
    return c.text;
  }
  return undefined;
}

function readTarget(v: Obj, objectKeys: ReadonlySet<string>, docType: DocType): CandidateTarget | string {
  if (typeof v.item !== "string" || !knownItem(v.item)) return "登録簿に無い入力項目の候補";
  const land = isLandDoc(docType);
  if (!land && !v.item.startsWith(READABLE_ITEM_PREFIX)) return "保険の契約の欄でない候補（保険の書類で読めるのは保険の契約の欄だけです）";
  if (land && v.item !== LAND_ITEM) return "相続税の試算の土地・建物の欄でない候補（この書類で読めるのは土地・建物の欄だけです）";
  const t: CandidateTarget = { item: v.item };
  if (v.at !== undefined) {
    if (!Array.isArray(v.at) || v.at.length > 4 || !v.at.every((x) => typeof x === "string" && AT_STEP.test(x))) return "場所の書き方が違う候補";
    if (v.at.length > 0) t.at = v.at as string[];
  }
  if (land && !landAtOk(docType, t.at, LAND_AT[docType as keyof typeof LAND_AT])) return `この書類で読めない場所の候補（読めるのは ${LAND_AT[docType as keyof typeof LAND_AT].map((n) => `["lands", "${n}"]`).join("・")} だけです）`;
  if (v.newObject !== undefined) {
    if (typeof v.newObject !== "string" || !objectKeys.has(v.newObject)) return "新しい物の鍵が物の候補に無い候補";
    t.newObject = v.newObject;
  } else if (v.object !== undefined) {
    if (typeof v.object !== "string" || !UUID.test(v.object)) return "物の ID の書き方が違う候補";
    t.object = v.object;
  }
  // 土地・建物の欄は人の欄ではない（不動産ごとの欄。人は書かない）
  if (!land && v.member !== undefined && v.member !== null) {
    if (typeof v.member !== "string" || !(ROLE.test(v.member) || UUID.test(v.member))) return "人の書き方が違う候補";
    t.member = v.member;
  }
  return t;
}

/** 土地・建物の書類の候補の値を整える（0235）。1つの候補から何件かの候補になることがある（路線価図の記号）。読めなければ理由 */
function landCandidates(c: DocCandidate, where: string | undefined): DocCandidate[] | string {
  const name = c.target.at?.[1];
  // 添え書きは記録に残す形（NFKC・長さの上限。世帯ファイルから読み戻しても変わらない形）にする
  const note = (n: string) => cleanText(c.note === undefined ? n : `${n}（${c.note}）`, LIMITS.note).text;
  if (name === "area" || name === "fixedValue" || name === "buildingValue") {
    if (where !== undefined && NOT_VALUE_WORDS.test(where.normalize("NFKC"))) return "課税標準額・税額の候補（相続税の評価には「価格」〔固定資産税評価額〕を使います）";
    if (c.value === null) return [c];
    if (name === "area") {
      const a = normalizeArea(c.value);
      if (a === null) return "地積として読めない候補（㎡の数で書いてください）";
      return [{ ...c, value: a.text, ...(a.truncated ? { note: note("小数3桁目から切り捨てました") } : {}) }];
    }
    const y = normalizeYen(c.value);
    if (y === null) return "価格として読めない候補（円の整数で書いてください）";
    // 価格（固定資産税評価額）はその年度の時点の額（期間は1回の額・時点の額）。0円（非課税の土地など）は、まとめての承認に入れない
    return [{ ...c, value: y, period: "once", ...(y === 0 ? { note: note("価格が0円です（非課税の土地など）。確かめてください"), confidence: c.confidence === "high" ? "medium" : c.confidence } : {}) }];
  }
  // 路線価図の記号: 評価の入れ方（路線価×面積）・路線価（円）・借地権割合（記号）に分ける。読めなければ路線価と借地権割合を読めなかった欄にする
  if (typeof c.value === "number" || typeof c.value === "boolean") return "路線価は、路線価図の記号のまま文字で書いてください（例「250C」。数は千円単位）";
  const at = (n: string) => ["lands", n];
  const method: DocCandidate = { ...c, target: { ...c.target, at: at("method") }, value: "routePrice", note: note("路線価図を読んだので、土地の評価の入れ方を路線価×面積にします") };
  delete method.unreadable;
  const mark = c.value === null ? null : parseRouteMark(c.value);
  if (mark === null) {
    const why = c.value === null ? undefined : note("路線価図の記号として読めませんでした。路線価図を見て「直す」で入れてください");
    const blank = (n: string): DocCandidate => ({ ...c, target: { ...c.target, at: at(n) }, value: null, unreadable: true, confidence: "low", ...(why !== undefined ? { note: why } : {}) });
    return [method, blank("routePrice"), blank("leaseholdRatio")];
  }
  const shown = `路線価図の「${String(mark.yen / 1000)}${mark.ratio ?? ""}」`;
  const out: DocCandidate[] = [method, { ...c, target: { ...c.target, at: at("routePrice") }, value: mark.yen, period: "once", note: note(`${shown}を、1平方メートルあたり${mark.yen.toLocaleString("ja-JP")}円（千円単位の数×1,000円）として読みました`) }];
  if (mark.ratio !== null) out.push({ ...c, target: { ...c.target, at: at("leaseholdRatio") }, value: mark.ratio, note: note(`${shown}の記号 ${mark.ratio} は、借地権割合 ${String(LEASEHOLD_RATIOS[mark.ratio])}% です`) });
  else out.push({ ...c, target: { ...c.target, at: at("leaseholdRatio") }, value: null, unreadable: true, confidence: "low", note: note("借地権割合の記号（A〜G）を読めませんでした") });
  return out;
}

/**
 * 届いた答え（JSON の値）を読み取りの記録にする。形の合わない所は読まずに理由を issues に入れる。
 * 候補（値・新しい物・照合の値）が1つも残らなければ reading は null
 */
export function readProposal(raw: unknown, ctx: ProposalContext): ProposalResult {
  const issues: string[] = [];
  if (!isObj(raw)) return { reading: null, issues: ["答えの形が違います（{ … } の形の JSON ではありません）"] };
  if (raw.contract !== PROPOSAL_CONTRACT) return { reading: null, issues: [`答えの形の名前（contract）が「${PROPOSAL_CONTRACT}」ではありません`] };
  const count = { masked: 0, dropped: 0 };
  if (!DOC_TYPES.some((d) => d.value === raw.docType))
    return {
      reading: null,
      issues: ["読めるのは保険証券・ご契約内容のお知らせ・設計書（docType は insurancePolicy）・固定資産税の課税明細書（propertyTaxStatement）・路線価図（routePriceMap）だけです。ほかの書類は、書類を見て入力の欄に打ってください（欄の「?」に書類のどこを見るかがあります）"],
    };
  const docType = raw.docType as DocType;
  const land = isLandDoc(docType);
  // 新しい物の候補
  const objects: DocObject[] = [];
  const keys = new Set<string>();
  const rawObjects = Array.isArray(raw.objects) ? raw.objects : [];
  if (rawObjects.length > LIMITS.objects) issues.push(`新しい物の候補が多すぎるので、先の${LIMITS.objects}件だけ読みました`);
  for (const o of rawObjects.slice(0, LIMITS.objects)) {
    if (!isObj(o) || typeof o.key !== "string" || !OBJECT_KEY.test(o.key) || keys.has(o.key)) {
      issues.push("鍵の無い・重なった新しい物の候補");
      continue;
    }
    if (typeof o.kind !== "string" || NEW_OBJECT_KINDS[o.kind] === undefined || !objectKindFits(docType, o.kind)) {
      issues.push(land ? `この書類で読めない種類の物の候補（土地・建物の書類の物は ${LAND_OBJECT_KIND} だけです）` : "作れない種類の新しい物の候補");
      continue;
    }
    keys.add(o.key);
    const source = readSource(o.source, count);
    if (land) {
      count.masked += maskPlaceSource(source);
      if (docType === "routePriceMap") delete source.page;
    }
    objects.push({ key: o.key, kind: o.kind, source, confidence: readConfidence(o.confidence), status: "pending" });
  }
  // 値の候補
  const candidates: DocCandidate[] = [];
  const rawValues = Array.isArray(raw.values) ? raw.values : [];
  if (rawValues.length > LIMITS.candidates) issues.push(`値の候補が多すぎるので、先の${LIMITS.candidates}件だけ読みました`);
  for (const v of rawValues.slice(0, LIMITS.candidates)) {
    if (!isObj(v)) {
      issues.push("形の違う値の候補");
      continue;
    }
    // 番号の欄・番号らしい値は、候補ごと落とす（中身は持たない）
    const where = isObj(v.source) && typeof v.source.where === "string" ? v.source.where : undefined;
    if (isNumberField(where) || isPersonalNumberValue(v.value)) {
      count.dropped++;
      continue;
    }
    const target = readTarget(v, keys, docType);
    if (typeof target === "string") {
      issues.push(target);
      continue;
    }
    const value = readValue(v.value, count);
    if (value === undefined) {
      issues.push("値の形が違う候補");
      continue;
    }
    const unreadable = v.unreadable === true || value === null;
    const c: DocCandidate = {
      id: ctx.newId(),
      target,
      value: unreadable ? null : value,
      source: readSource(v.source, count),
      confidence: readConfidence(v.confidence),
      status: "pending",
    };
    if (unreadable) c.unreadable = true;
    if (v.period === "monthly" || v.period === "annual" || v.period === "once") c.period = v.period;
    if (typeof v.note === "string" && v.note.trim() !== "") {
      const n = cleanText(v.note, LIMITS.note);
      if (n.masked) count.masked++;
      if (n.text !== "") c.note = n.text;
    }
    // 路線価図は、ページ（図の番号）を残さない（場所の手がかりになるため）
    if (docType === "routePriceMap") delete c.source.page;
    if (land) {
      // 所有者・納税義務者・所在・地番などの見出しの候補は読まずに落とす。文字の中の所在・地番らしい所は伏せる（0235）
      if (where !== undefined && PLACE_FIELD_WORDS.test(where.normalize("NFKC"))) {
        count.dropped++;
        continue;
      }
      count.masked += maskPlaceSource(c.source);
      if (c.note !== undefined) {
        const m = maskPlace(c.note);
        if (m.masked) {
          c.note = m.text;
          count.masked++;
        }
      }
      if (typeof c.value === "string") {
        const m = maskPlace(c.value);
        if (m.masked) {
          count.dropped++;
          continue;
        }
      }
      const made = landCandidates(c, where);
      if (typeof made === "string") {
        issues.push(made);
        continue;
      }
      made.forEach((m, i) => candidates.push({ ...m, id: i === 0 ? c.id : ctx.newId(), source: { ...m.source } }));
      continue;
    }
    candidates.push(c);
  }
  // 照合だけの値
  const references: DocReference[] = [];
  const rawRefs = Array.isArray(raw.references) ? raw.references : [];
  for (const r of rawRefs.slice(0, LIMITS.references)) {
    if (!isObj(r) || typeof r.label !== "string" || !Number.isSafeInteger(r.amount)) {
      issues.push("形の違う照合の値");
      continue;
    }
    if (isNumberField(r.label) || isPersonalNumberValue(r.amount)) {
      count.dropped++;
      continue;
    }
    if (land && PLACE_FIELD_WORDS.test(r.label.normalize("NFKC"))) {
      count.dropped++;
      continue;
    }
    const label = cleanText(r.label, LIMITS.label);
    if (label.masked) count.masked++;
    if (land) {
      const m = maskPlace(label.text);
      if (m.masked) {
        label.text = m.text;
        count.masked++;
      }
    }
    if (label.text === "") continue;
    const ref: DocReference = { id: ctx.newId(), label: label.text, amount: r.amount as number, source: readSource(r.source, count) };
    if (land) {
      count.masked += maskPlaceSource(ref.source);
      if (docType === "routePriceMap") delete ref.source.page;
    }
    if (typeof r.row === "string" && ROW.test(r.row)) ref.row = r.row;
    if (Number.isSafeInteger(r.year) && (r.year as number) >= 1900 && (r.year as number) <= 2200) ref.year = r.year as number;
    references.push(ref);
  }
  if (rawRefs.length > LIMITS.references) issues.push(`照合の値が多すぎるので、先の${LIMITS.references}件だけ読みました`);
  // 値の候補の無い新しい物は作らない（足しても中身が空になる）
  const used = new Set(candidates.flatMap((c) => (c.target.newObject !== undefined ? [c.target.newObject] : [])));
  const kept = objects.filter((o) => used.has(o.key));
  if (kept.length < objects.length) issues.push("値の候補の無い新しい物の候補は読みませんでした");
  if (candidates.length === 0 && references.length === 0) return { reading: null, issues: [...issues, "読める候補がありませんでした"] };
  const reading: DocumentReading = {
    id: ctx.newId(),
    kind: "document",
    docType,
    at: ctx.at,
    via: ctx.via,
    objects: kept,
    candidates,
    references,
    dropped: count.dropped + count.masked,
  };
  if (ctx.reader !== undefined) reading.reader = { id: ctx.reader.id, version: ctx.reader.version };
  if (ctx.connector !== undefined) {
    const c = cleanText(ctx.connector, LIMITS.connector);
    if (c.text !== "") reading.ai = { connector: c.text };
  }
  if (typeof raw.asOf === "string" && YM.test(raw.asOf)) reading.asOf = raw.asOf;
  const holder = typeof raw.holder === "string" ? ctx.members?.find((m) => m.key === raw.holder || m.id === raw.holder)?.id : undefined;
  if (holder !== undefined) reading.holder = holder;
  return { reading, issues: [...new Set(issues)] };
}
