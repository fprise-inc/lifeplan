// 確かめの一覧（推定の一覧。0041）: 推定・書類待ち・未入力の所と確かめの注意を、カードごとに並べる。行から欄へ移れる（「開く」）。
// 並び（上から）: ① 未入力（0円で計算中）② まだ入れていない項目（入れ始める前の項目。警告にせず、見落としに気づける所として1か所にまとめる。0045 の追記）
// ③ 書類待ち（「書類で確かめる」にした欄。確かめる書類を添える）④ 確かめの注意（目安のボタンと同じ確定の値・ほかの入力と合わない値）
// ⑤ 計算の知らせ（現状の計算結果の知らせのうち、入力で直せるもの。0064）⑥ 推定（影響の大きい順）⑦ 確かさが申告・概算の確定の値（絞り込みで出す）
// - 1行は「カード › まとまり: 欄」・今の値・状態の印・根拠・出どころ（手で・ヒアリング・取り込み・AI）・確かさ（書類・申告・概算）と操作
// - 同じ値を2つの欄が見せる（今の働き方の欄と、働き方の期間の欄など）ときは、当て先で1行にまとめる
// - 一覧は世帯の物と欄の定義から毎回作る（保存しない）
import { officeNow } from "../office/current.ts";
import { pctText } from "../plans/decimal.ts";
import { sameRate } from "./units.ts";
import { allFields, type FieldDef, type Level } from "./form.ts";
import { fillAll, gapsOf, retirementNotices, type Gap } from "./fill.ts";
import type { NoticeRow } from "../engineNotices.ts";
import { noticeMeta } from "../engineNotices.ts";
import type { WorkingHousehold } from "./household.ts";
import { insuranceOverlapNotices } from "./insuranceView.ts";
import { ackOf, ackToday, setNoticeAck } from "./noticeAck.ts";
import { inputItems, itemStage } from "./items.ts";
import { holderOf, rowAt } from "./rows.ts";
import { applyStateOp, availableOps, confirmAll, fieldAddress, fieldStatus, type FieldStatus } from "./valueState.ts";
import { fieldValueText } from "../plans/planEdit.ts";

export type CheckKind = "missing" | "notStarted" | "unknown" | "notice" | "calc" | "estimated" | "certainty";

export const CHECK_KIND_LABELS: Readonly<Record<CheckKind, string>> = {
  missing: "未入力（0円で計算中）",
  notStarted: "まだ入れていない項目",
  unknown: "書類待ち",
  notice: "確かめの注意",
  calc: "計算の知らせ（入力で直せる所）",
  estimated: "推定",
  certainty: "確かさが申告・概算の値",
};

export const KIND_ORDER: readonly CheckKind[] = ["missing", "notStarted", "unknown", "notice", "calc", "estimated", "certainty"];

/** 絞り込みをしないときに出す種類（確かさの行は、確かさか種類で絞り込んだときだけ出す） */
export const DEFAULT_KINDS: readonly CheckKind[] = ["missing", "notStarted", "unknown", "notice", "calc", "estimated"];

/** 値の出どころ（値の箱・値の状態の行の origin.kind） */
export type OriginKind = "manual" | "hearing" | "import" | "ai" | "auto" | "override";

export const ORIGIN_LABELS: Readonly<Record<OriginKind, string>> = {
  manual: "手で入れた",
  hearing: "ヒアリング",
  import: "取り込み",
  ai: "AI",
  auto: "自動（推定）",
  override: "上書き",
};

/** 値の確かさ（どこで確かめたか。計算には使わない） */
export type Certainty = "document" | "declared" | "rough";

export const CERTAINTY_LABELS: Readonly<Record<Certainty, string>> = { document: "書類で確認", declared: "本人の申告", rough: "概算" };

/** 行で押せる操作（世帯を直す。推定で埋める・該当なし・確定・推定にする） */
export interface CheckAction {
  key: string;
  label: string;
  run: (wh: WorkingHousehold) => WorkingHousehold;
  title?: string;
}

export interface CheckRow {
  id: string;
  kind: CheckKind;
  /** カードの ID と名前 */
  card: string;
  cardLabel: string;
  /** 例: 「本人の今の働き方: 年収（税込み・賞与を除く）」 */
  label: string;
  /** 根拠・今の扱い（「推定: 賃金構造基本統計調査…」「0円で計算しています」） */
  detail: string | null;
  /** 移る欄のキー（物の行は null。カードを開くだけ） */
  fieldKey: string | null;
  /** 移る欄の段（詳細の欄なら、開くときに詳細にする） */
  level: Level;
  /** 推定の並びに使う影響の大きさ（年額×年数のおおよその円） */
  impact: number;
  actions: CheckAction[];
  /** 今の値（言葉で。物の行・知らせの行は null） */
  value?: string | null;
  /** 値の出どころ（わからなければ null） */
  origin?: OriginKind | null;
  /** 値の確かさ（印が無く、出どころから決まらなければ null） */
  certainty?: Certainty | null;
  /** 欄の当て先の物・構成員の ID（プランで足した物の行を見分ける） */
  holder?: string | null;
  /**
   * 書類待ちの行だけ: 確かめる書類（欄の定義の docCheck）・書類の持ち主（docFor か当て先の物）・欄の名前（まとまりの名前を付けない）。
   * 書類のお願いの一覧（docRequests.ts）が、書類と持ち主ごとにまとめるのに使う（0102）
   */
  doc?: { name: string; holder: string | null; field: string };
}

/**
 * 目安のボタンで入る値（今までのボタンは、印の無い確定の値で入れていた。0035 の11）。古い世帯でこの値のまま「記録の無い確定」の欄は、
 * 確かめの注意に「目安のボタンと同じ確定の値」として出す（値も状態も変えない。FP が確かめて「この値にする」か「推定にする」）
 */
export const PRESET_VALUES: Readonly<Record<string, { values: readonly { value: number; label?: string }[]; what: string }>> = {
  "residence.rent": { values: [{ value: 80000 }], what: "家賃 月8万円" },
  "residence.propertyTax": { values: [{ value: 120000 }], what: "固定資産税・都市計画税 年12万円" },
  "residence.maintenance": { values: [{ value: 15000 }], what: "修繕費・管理費 月1.5万円" },
  // 一時的支出・n年ごとの支出は、ボタンが入れた名前のままのときだけ
  "periodicExpense.amount": { values: [{ value: 500000, label: "一時的支出" }, { value: 300000, label: "家電の買い替え" }], what: "一時的支出 50万円・家電の買い替え 30万円" },
  "debt.principal": { values: [{ value: 30000000 }], what: "住宅ローンの借入額 3,000万円" },
  "insurance.premium": { values: [{ value: 5000 }], what: "保険料 月5,000円" },
  // 0055 の前の「＋ 保険契約」「＋ 保障」のボタンが入れた値（死亡保険金 1,000万円・特約の入院日額 5,000円）
  "insurance.coverages": { values: [{ value: 10000000 }, { value: 5000 }], what: "死亡保険金 1,000万円・入院日額 5,000円" },
};

/** 目安のボタンと同じ確定の値か（FP が明示に確定した値・外から来た値・数でない欄は除く） */
export function isPresetCandidate(f: FieldDef, wh: WorkingHousehold, s: FieldStatus = fieldStatus(f, wh)): boolean {
  if (s.status !== "confirmed" || s.explicit || s.approved || f.item === null || f.kind !== "yen") return false;
  const p = PRESET_VALUES[f.item];
  const v = f.get(wh).value;
  if (p === undefined || typeof v !== "number") return false;
  const a = fieldAddress(f, wh);
  const owner = a === null ? undefined : holderOf(wh.request.input as unknown as Record<string, unknown>, a.target);
  return p.values.some((x) => x.value === v && (x.label === undefined || owner?.label === x.label));
}

/** 推定の値の影響の大きさ（年額×残りの年数。1回の額はその額） */
function impactOf(f: FieldDef, wh: WorkingHousehold): number {
  const v = f.get(wh).value;
  if (f.kind !== "yen" || typeof v !== "number") return 0;
  const years = Math.max(1, wh.request.input.endYear - Number(wh.request.input.baseMonth.slice(0, 4)) + 1);
  if (f.basis === "monthly") return v * 12 * years;
  if (f.basis === "annual") return v * years;
  return v;
}

const ORIGINS = new Set<string>(Object.keys(ORIGIN_LABELS));
const CERTAINTIES = new Set<string>(Object.keys(CERTAINTY_LABELS));
const isObjV = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 欄の値の出どころと確かさ: 値の箱か値の状態の行から読む（仮の印は自動）。確かさの印が無ければ出どころから決める
 * （取り込み → 書類で確認、ヒアリング → 本人の申告。手で入れた値は決めない）
 */
export function valueMeta(f: FieldDef, wh: WorkingHousehold): { origin: OriginKind | null; certainty: Certainty | null } {
  let meta: Record<string, unknown> | undefined;
  if (f.boxed !== undefined) {
    const b = f.boxed.read(wh);
    if (isObjV(b) && isObjV(b.origin)) meta = b;
  }
  if (meta === undefined && wh.assumed[f.key] !== undefined) return { origin: "auto", certainty: null };
  if (meta === undefined) {
    const a = fieldAddress(f, wh);
    const row = a === null ? undefined : rowAt(wh.request.input as unknown as Record<string, unknown>, a);
    if (row !== undefined) meta = row as unknown as Record<string, unknown>;
  }
  if (meta === undefined) return { origin: null, certainty: null };
  const o = isObjV(meta.origin) && typeof meta.origin.kind === "string" && ORIGINS.has(meta.origin.kind) ? (meta.origin.kind as OriginKind) : null;
  const c = typeof meta.certainty === "string" && CERTAINTIES.has(meta.certainty) ? (meta.certainty as Certainty) : o === "import" ? "document" : o === "hearing" ? "declared" : null;
  return { origin: o, certainty: c };
}

/** 書類待ちの行の文: 確かめる書類（欄の定義の docCheck）と、それまで使う代わりの値（0041 の追記 2026-10-31） */
function unknownDetail(f: FieldDef, s: FieldStatus): string {
  const sub = s.basis !== null ? `代わりの値: ${s.basis}` : "代わりの値で計算しています";
  return f.docCheck !== undefined ? `${f.docCheck}で確かめる（${sub}）` : sub;
}

/** 欄の見出し（まとまりの名前: 欄の名前） */
const labelOf = (where: string | undefined, f: FieldDef) => (where !== undefined && where !== f.label ? `${where}: ${f.label}` : f.label);

/** 推定にする（目安のボタンと同じ確定の値を、推定の印に戻す。値は変えない） */
function asStandard(f: FieldDef, what: string): CheckAction | null {
  if (f.boxed === undefined) return null;
  return {
    key: "standard",
    label: "推定にする",
    title: "値はそのままで「推定」の印にします（あとで確かめる）",
    run: (w) => {
      const b = f.boxed?.read(w) as { value?: unknown } | undefined;
      if (b === undefined || typeof b.value !== "number") return w;
      return f.boxed?.write(w, { value: b.value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: `目安のボタンの値（${what}）` } }) ?? w;
    },
  };
}

function gapRow(g: Gap, cardLabel: string, notStarted: boolean): CheckRow {
  const actions: CheckAction[] = [];
  if (g.fill !== undefined) actions.push({ key: "fill", label: "推定で埋める", run: g.fill, ...(g.basis !== undefined ? { title: `推定: ${g.basis}` } : {}) });
  if (g.none !== undefined) actions.push({ key: "none", label: `該当なし${g.noneLabel !== undefined ? `（${g.noneLabel}）` : ""}`, run: g.none });
  return { id: `gap:${g.id}`, kind: notStarted ? "notStarted" : "missing", card: g.card, cardLabel, label: g.label, detail: g.note, fieldKey: null, level: "simple", impact: 0, actions };
}

/** 入っていない物の無い、まだ入れていない項目の1行（開くだけ） */
const NOT_STARTED_DETAIL = "まだ何も入れていません（入れるまでは、この項目のお金を無しで計算しています）";

/**
 * 確かめの一覧（並びは ①未入力 ②書類待ち ③確かめの注意 ④計算の知らせ ⑤推定。同じ種類の中はカードの順。推定は影響の大きい順）。
 * notices は現状の計算結果の知らせ（engineNotices.ts の行）。入るカードを持つものだけを出す（開くだけ。行の操作は無い）
 */
export function checkList(wh: WorkingHousehold, notices: readonly NoticeRow[] = []): CheckRow[] {
  const rows: CheckRow[] = [];
  const items = inputItems(wh);
  const labels = new Map(items.map((i) => [i.id, i.label]));
  // まだ入れていない項目（items.ts の startedOf）の入っていない物は、警告でなく「まだ入れていない項目」に。入っていない物の無い項目も1行で並べる
  const notStarted = new Set(items.filter((i) => i.status === "empty").map((i) => i.id));
  // 入力のホームに出していない入力項目（世帯の選び方で非表示・値が入っていない。itemChoice.ts）の「まだ入れていない」の行は出さない（今までどおり推定か「無し」で計算する）
  const hidden = new Set(items.filter((i) => i.hidden).map((i) => i.id));
  const gaps = gapsOf(wh).filter((g) => !(hidden.has(g.card) && notStarted.has(g.card)));
  for (const g of gaps) rows.push(gapRow(g, labels.get(g.card) ?? g.card, notStarted.has(g.card)));
  for (const i of items)
    if (notStarted.has(i.id) && !hidden.has(i.id) && !gaps.some((g) => g.card === i.id))
      rows.push({ id: `notStarted:${i.id}`, kind: "notStarted", card: i.id, cardLabel: i.label, label: "まだ入れていません", detail: i.hint ?? NOT_STARTED_DETAIL, fieldKey: null, level: "simple", impact: 0, actions: [] });
  // 目安で自動で足した退職金（制度の無い勤め先もある）・公務員と役員の0円の額は、確かめの注意に（推定より上に出す。0057）
  for (const n of retirementNotices(wh)) rows.push({ id: `notice:${n.id}`, kind: "notice", card: "retirement", cardLabel: labels.get("retirement") ?? "退職金・企業年金", label: n.label, detail: n.detail, fieldKey: null, level: "simple", impact: 0, actions: n.actions });
  // 同じ方の医療保険・がん保険が2本以上（保障が重なっていないか。0055 の追記）。「確認した」の重なり（同じ契約の組み合わせ）は出さない（noticeAck.ts）
  for (const n of insuranceOverlapNotices(wh)) {
    if (ackOf(wh, n.id, n.of) !== null) continue;
    rows.push({
      id: `notice:${n.id}`,
      kind: "notice",
      card: "insurance",
      cardLabel: labels.get("insurance") ?? "保険",
      label: n.label,
      detail: n.detail,
      fieldKey: null,
      level: "simple",
      impact: 0,
      actions: [{ key: "ack", label: "確認した", title: ACK_TITLE, run: (w) => setNoticeAck(w, n.id, n.of, ackToday()) }],
    });
  }
  for (const n of notices) {
    if (n.card === null || !labels.has(n.card)) continue;
    const meta = noticeMeta(n);
    rows.push({ id: `calc:${n.key}`, kind: "calc", card: n.card, cardLabel: labels.get(n.card) ?? n.card, label: n.text, detail: meta.length > 0 ? meta.join("／") : null, fieldKey: null, level: "simple", impact: 0, actions: [] });
  }
  const seen = new Set<string>();
  items.forEach((item) => {
    const stage = itemStage(wh, item.id);
    if (stage === null) return;
    // 同じ当て先の欄が標準と詳細の両方にあるときは、標準の欄を行にする（どちらの入れ方でも出る欄に移れる。今の働き方と働き方 1・2…など）
    const entries = stage.sections.flatMap((section) => section.groups.flatMap((group) => group.fields.map((f) => ({ section, group, f }))));
    const isDetail = (e: (typeof entries)[number]) => e.section.level === "detail" || e.group.level === "detail" || e.f.level === "detail";
    for (const { section, group, f } of [...entries.filter((e) => !isDetail(e)), ...entries.filter(isDetail)]) {
      if (f.readOnly !== undefined) continue;
      const a = fieldAddress(f, wh);
      const id = a !== null ? JSON.stringify(a) : `key:${f.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const s = fieldStatus(f, wh);
      const level: Level = section.level === "detail" || group.level === "detail" || f.level === "detail" ? "detail" : "simple";
      const st = f.get(wh);
      const meta = valueMeta(f, wh);
      const t = a?.target;
      const holder = t === undefined ? null : "object" in t ? t.object : "member" in t ? t.member : null;
      const value = s.status === "missing" || s.status === "notApplicable" ? null : st.value === null || st.value === undefined ? null : fieldValueText(f, st.value, wh);
      const base = { card: item.id, cardLabel: item.label, label: labelOf(group.title ?? section.title, f), fieldKey: f.key, level, value, origin: meta.origin, certainty: meta.certainty, holder };
      if (s.status === "missing") rows.push({ ...base, id: `field:${f.key}`, kind: "missing", detail: s.basis ?? "空欄（0円で計算しています）", impact: 0, actions: [] });
      else if (s.status === "unknown")
        rows.push({ ...base, id: `field:${f.key}`, kind: "unknown", detail: unknownDetail(f, s), impact: impactOf(f, wh), actions: [], ...(f.docCheck !== undefined ? { doc: { name: f.docCheck, holder: f.docFor ?? holder, field: f.label } } : {}) });
      else if (s.status === "estimated" && officeNewer(f, wh) !== null) {
        // 事務所の既定値が、この世帯の推定の値と違う（作った後に事務所の値を変えた・事務所の値を決める前の世帯。0073）。値は変えない
        const v = officeNewer(f, wh) as string;
        rows.push({
          ...base,
          id: `field:${f.key}`,
          kind: "notice",
          detail: `事務所の新しい値があります（${pctText(v)}）。この世帯は今の推定の値（${s.basis ?? "推定"}）で計算しています`,
          impact: 0,
          actions: [{ key: "office", label: "事務所の値にする", title: "推定の印のまま、事務所の今の値にします", run: (w) => withOfficeValue(w, f, v) }],
        });
      } else if (s.status === "estimated" && f.quietEstimate === undefined)
        rows.push({ ...base, id: `field:${f.key}`, kind: "estimated", detail: s.basis, impact: impactOf(f, wh), actions: availableOps(f, wh, s).includes("confirm") ? [{ key: "confirm", label: "この値にする", title: "この値のまま確定にします", run: (w) => applyStateOp(w, f, "confirm") }] : [] });
      else if (isPresetCandidate(f, wh, s)) {
        const what = PRESET_VALUES[f.item as string]?.what ?? "目安";
        const std = asStandard(f, what);
        rows.push({
          ...base,
          id: `field:${f.key}`,
          kind: "notice",
          detail: `目安のボタンと同じ確定の値です（${what}）。この世帯の値か確かめてください`,
          impact: 0,
          actions: [{ key: "confirm", label: "この値にする", title: "確かめた値として確定にします", run: (w) => explicitConfirm(w, f, what) }, ...(std !== null ? [std] : [])],
        });
      } else if (st.warn != null) rows.push({ ...base, id: `field:${f.key}`, kind: "notice", detail: st.warn, impact: 0, actions: st.warnFix != null ? [{ key: "fix", label: st.warnFix.label, run: st.warnFix.run }] : [] });
      else if (s.status === "confirmed" && (meta.certainty === "declared" || meta.certainty === "rough") && value !== null)
        rows.push({ ...base, id: `field:${f.key}`, kind: "certainty", detail: `${CERTAINTY_LABELS[meta.certainty]}の値です${meta.origin !== null && meta.origin !== "manual" ? `（${ORIGIN_LABELS[meta.origin]}）` : ""}。書類で確かめるときの候補`, impact: impactOf(f, wh), actions: [] });
    }
  });
  const order = new Map(items.map((i, n) => [i.id, n]));
  return rows.sort((x, y) => {
    const k = KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind);
    if (k !== 0) return k;
    if (x.kind === "estimated" && x.impact !== y.impact) return y.impact - x.impact;
    return (order.get(x.card) ?? 99) - (order.get(y.card) ?? 99);
  });
}

const ACK_TITLE = "確かめ済みとして、この注意を出さないようにします（世帯に残ります。保険を足す・外すなどで重なりが変わると、また出ます）";

/**
 * 「確認した」で出さないようにしている確かめの注意（今も同じ中身の物だけ。中身が変わった印は当たらないので出ない）。
 * 確かめの一覧の絞り込み「確認した注意」に並べ、「また出す」で印を外す（世帯を直す。元に戻すで戻せる）
 */
export function ackedRows(wh: WorkingHousehold): CheckRow[] {
  const label = inputItems(wh).find((i) => i.id === "insurance")?.label ?? "保険";
  const out: CheckRow[] = [];
  for (const n of insuranceOverlapNotices(wh)) {
    const a = ackOf(wh, n.id, n.of);
    if (a === null) continue;
    out.push({
      id: `notice:${n.id}`,
      kind: "notice",
      card: "insurance",
      cardLabel: label,
      label: n.label,
      detail: `${a.on} に確認しました（${n.detail}）`,
      fieldKey: null,
      level: "simple",
      impact: 0,
      actions: [{ key: "unack", label: "また出す", title: "確かめの注意にまた出します", run: (w) => setNoticeAck(w, n.id, n.of, null) }],
    });
  }
  return out;
}

/** 前提条件の欄で、事務所の既定値がこの世帯の値と違うときの事務所の値（同じ・事務所の値が無い・前提条件の欄でないときは null） */
function officeNewer(f: FieldDef, wh: WorkingHousehold): string | null {
  const m = /^assume\/([a-zA-Z]+)$/.exec(f.key);
  const v = m === null ? undefined : officeNow().assumptions[m[1] as string];
  if (v === undefined) return null;
  const cur = f.get(wh).value;
  return typeof cur === "string" && sameRate(cur, v) ? null : v;
}

/** 事務所の値を推定の印で入れる（根拠「事務所の標準（年月）」） */
function withOfficeValue(wh: WorkingHousehold, f: FieldDef, v: string): WorkingHousehold {
  const next = f.set(wh, v);
  if (next === wh) return wh;
  return { ...next, assumed: { ...next.assumed, [f.key]: officeNow().basis } };
}

/** 目安のボタンと同じ値を、確かめた値として確定にする（根拠に「確かめた」を残し、記録の無い確定と見分ける） */
function explicitConfirm(wh: WorkingHousehold, f: FieldDef, what: string): WorkingHousehold {
  const basis = `目安のボタンと同じ値（${what}）を確かめた`;
  if (f.boxed !== undefined) {
    const b = f.boxed.read(wh) as { value?: unknown } | undefined;
    if (b === undefined || typeof b.value !== "number") return wh;
    return f.boxed.write(wh, { value: b.value, state: "confirmed", origin: { kind: "manual" }, estimate: { method: "standard", basis } });
  }
  // 箱でない値（借入額・保険料）: 推定の印にしてから確定にする（行に根拠が残る）
  const marked: WorkingHousehold = { ...wh, assumed: { ...wh.assumed, [f.key]: basis } };
  const next = applyStateOp(marked, f, "confirm");
  return next === marked ? wh : next;
}

/** 推定の欄の全部（「推定の値をまとめて使う」の全部。card を渡すとそのカードだけ）。同じ値を見せる欄は1つに */
export function estimatedFields(wh: WorkingHousehold, card?: string): FieldDef[] {
  const out: FieldDef[] = [];
  const seen = new Set<string>();
  for (const item of inputItems(wh)) {
    if (card !== undefined && item.id !== card) continue;
    const stage = itemStage(wh, item.id);
    if (stage === null) continue;
    for (const f of allFields(stage)) {
      if (f.readOnly !== undefined) continue;
      const a = fieldAddress(f, wh);
      const id = a !== null ? JSON.stringify(a) : `key:${f.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (fieldStatus(f, wh).status === "estimated" && f.quietEstimate === undefined) out.push(f);
    }
  }
  return out;
}

/** 推定の値をまとめて使う（全部か、card のカードだけ） */
export function confirmAllEstimates(wh: WorkingHousehold, card?: string): { wh: WorkingHousehold; count: number } {
  return confirmAll(wh, estimatedFields(wh, card));
}

export { fillAll };

/** 種類ごとの数 */
export function checkCounts(rows: readonly CheckRow[]): Record<CheckKind, number> {
  const out: Record<CheckKind, number> = { missing: 0, notStarted: 0, unknown: 0, notice: 0, calc: 0, estimated: 0, certainty: 0 };
  for (const r of rows) out[r.kind]++;
  return out;
}
