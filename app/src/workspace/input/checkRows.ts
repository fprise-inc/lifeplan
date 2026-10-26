// 確かめの一覧（推定の一覧。0041）: 推定・わからない・未入力の所と確かめの注意を、カードごとに並べる。行から欄へ移れる（「開く」）。
// 並び（上から）: ① 未入力（0円で計算中）② わからない ③ 確かめの注意（目安のボタンと同じ確定の値・ほかの入力と合わない値）④ 推定（影響の大きい順）
// - 同じ値を2つの欄が見せる（今の働き方の欄と、働き方の期間の欄など）ときは、当て先で1行にまとめる
// - 一覧は世帯の物と欄の定義から毎回作る（保存しない）
import { allFields, type FieldDef, type Level } from "./form.ts";
import { fillAll, gapsOf, retirementNotices, type Gap } from "./fill.ts";
import type { WorkingHousehold } from "./household.ts";
import { inputItems, itemStage } from "./items.ts";
import { holderOf } from "./rows.ts";
import { applyStateOp, confirmAll, fieldAddress, fieldStatus, type FieldStatus } from "./valueState.ts";

export type CheckKind = "missing" | "unknown" | "notice" | "estimated";

export const CHECK_KIND_LABELS: Readonly<Record<CheckKind, string>> = {
  missing: "未入力（0円で計算中）",
  unknown: "わからない",
  notice: "確かめの注意",
  estimated: "推定",
};

const KIND_ORDER: readonly CheckKind[] = ["missing", "unknown", "notice", "estimated"];

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
}

/**
 * 目安のボタンで入る値（今までのボタンは、印の無い確定の値で入れていた。0035 の11）。古い世帯でこの値のまま「記録の無い確定」の欄は、
 * 確かめの注意に「目安のボタンと同じ確定の値」として出す（値も状態も変えない。FP が確かめて「✓ この値で確定」か「推定にする」）
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

function gapRow(g: Gap, cardLabel: string): CheckRow {
  const actions: CheckAction[] = [];
  if (g.fill !== undefined) actions.push({ key: "fill", label: "推定で埋める", run: g.fill, ...(g.basis !== undefined ? { title: `推定: ${g.basis}` } : {}) });
  if (g.none !== undefined) actions.push({ key: "none", label: `該当なし${g.noneLabel !== undefined ? `（${g.noneLabel}）` : ""}`, run: g.none });
  return { id: `gap:${g.id}`, kind: "missing", card: g.card, cardLabel, label: g.label, detail: g.note, fieldKey: null, level: "simple", impact: 0, actions };
}

/** 確かめの一覧（並びは ①未入力 ②わからない ③確かめの注意 ④推定。同じ種類の中はカードの順。推定は影響の大きい順） */
export function checkList(wh: WorkingHousehold): CheckRow[] {
  const rows: CheckRow[] = [];
  const items = inputItems(wh);
  const labels = new Map(items.map((i) => [i.id, i.label]));
  for (const g of gapsOf(wh)) rows.push(gapRow(g, labels.get(g.card) ?? g.card));
  // 目安で自動で足した退職金（制度の無い勤め先もある）・公務員と役員の0円の額は、確かめの注意に（推定より上に出す。0057）
  for (const n of retirementNotices(wh)) rows.push({ id: `notice:${n.id}`, kind: "notice", card: "retirement", cardLabel: labels.get("retirement") ?? "退職金・企業年金", label: n.label, detail: n.detail, fieldKey: null, level: "simple", impact: 0, actions: n.actions });
  const seen = new Set<string>();
  items.forEach((item) => {
    const stage = itemStage(wh, item.id);
    if (stage === null) return;
    for (const section of stage.sections)
      for (const group of section.groups)
        for (const f of group.fields) {
          if (f.readOnly !== undefined) continue;
          const a = fieldAddress(f, wh);
          const id = a !== null ? JSON.stringify(a) : `key:${f.key}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const s = fieldStatus(f, wh);
          const level: Level = section.level === "detail" || group.level === "detail" || f.level === "detail" ? "detail" : "simple";
          const base = { card: item.id, cardLabel: item.label, label: labelOf(group.title ?? section.title, f), fieldKey: f.key, level };
          const st = f.get(wh);
          if (s.status === "missing") rows.push({ ...base, id: `field:${f.key}`, kind: "missing", detail: s.basis ?? "空欄（0円で計算しています）", impact: 0, actions: [] });
          else if (s.status === "unknown") rows.push({ ...base, id: `field:${f.key}`, kind: "unknown", detail: s.basis !== null ? `代わりの値: ${s.basis}` : "代わりの値で計算しています", impact: impactOf(f, wh), actions: [] });
          else if (s.status === "estimated")
            rows.push({ ...base, id: `field:${f.key}`, kind: "estimated", detail: s.basis, impact: impactOf(f, wh), actions: [{ key: "confirm", label: "✓ 確定", title: "この値のまま確定にします", run: (w) => applyStateOp(w, f, "confirm") }] });
          else if (isPresetCandidate(f, wh, s)) {
            const what = PRESET_VALUES[f.item as string]?.what ?? "目安";
            const std = asStandard(f, what);
            rows.push({
              ...base,
              id: `field:${f.key}`,
              kind: "notice",
              detail: `目安のボタンと同じ確定の値です（${what}）。この世帯の値か確かめてください`,
              impact: 0,
              actions: [{ key: "confirm", label: "✓ この値で確定", title: "確かめた値として確定にします", run: (w) => explicitConfirm(w, f, what) }, ...(std !== null ? [std] : [])],
            });
          } else if (st.warn != null) rows.push({ ...base, id: `field:${f.key}`, kind: "notice", detail: st.warn, impact: 0, actions: [] });
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

/** 推定の欄の全部（「推定をまとめて確定」の全部）。同じ値を見せる欄は1つに */
export function estimatedFields(wh: WorkingHousehold): FieldDef[] {
  const out: FieldDef[] = [];
  const seen = new Set<string>();
  for (const item of inputItems(wh)) {
    const stage = itemStage(wh, item.id);
    if (stage === null) continue;
    for (const f of allFields(stage)) {
      if (f.readOnly !== undefined) continue;
      const a = fieldAddress(f, wh);
      const id = a !== null ? JSON.stringify(a) : `key:${f.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (fieldStatus(f, wh).status === "estimated") out.push(f);
    }
  }
  return out;
}

/** 推定をまとめて確定（全部） */
export function confirmAllEstimates(wh: WorkingHousehold): { wh: WorkingHousehold; count: number } {
  return confirmAll(wh, estimatedFields(wh));
}

export { fillAll };

/** 種類ごとの数 */
export function checkCounts(rows: readonly CheckRow[]): Record<CheckKind, number> {
  const out: Record<CheckKind, number> = { missing: 0, unknown: 0, notice: 0, estimated: 0 };
  for (const r of rows) out[r.kind]++;
  return out;
}
