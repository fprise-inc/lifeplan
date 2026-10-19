// 案（0008 の5 のプランの層の「提案」）: 現状からの差分だけを持つ。保存できる案の数に上限は付けない。
// - 案は土台（別の案）を持てる。案の中身＝土台の中身に、自分の差分を重ねたもの
// - 入力（現状）を直すと、全部の案に反映される（差分を新しい現状に当て直す）
// - 差分の向き先が無くなった（missing）・差分を作った時点の値（before）と今の現状が違う（changed）ときは「要確認」
// - 「この案を現状に反映する」は、案の差分を入力（現状）に取り込む
// 保存はまだファイルにしない（世帯ファイル 0011 の中の、世帯データの proposals に入る形で、画面の中で持つ）
import type { EngineRequest } from "../../engine/types.ts";
import { man } from "../../presentation/format.ts";
import { newId, type WorkingHousehold } from "../input/household.ts";
import { applyAdvisoryFee, applyLevers, LEVER_KEYS, type LeverValues } from "../levers.ts";
import type { MixPart } from "./allocation.ts";
import { pctText } from "./decimal.ts";
import { reemploymentFor, type Catalog, type DiffTarget, type ItemValue, type MovableItem, type RateShift } from "./items.ts";

/** 動かした値（動かす項目のキー → 値）。現状と同じ値の項目は持たない（土台が動かした項目を現状に戻すときは持つ） */
export type Values = Record<string, ItemValue>;

interface ValueBox {
  value: ItemValue;
  state: "confirmed";
  origin: { kind: "manual" };
}

/** 差分（0008 の5 の共通の形）。key は画面の側の「動かす項目」のキーで、当て方を決める */
export interface PlanDiff {
  id: string;
  key: string;
  target: DiffTarget;
  item: string;
  op: "set";
  value: ValueBox;
  /** 差分を作った時点の現状の値（現状が変わったら「要確認」） */
  before: ValueBox;
  enabled: boolean;
  /** 出どころ（0008 の2）: 手で動かした値か、AIからの候補を FP が承認して入れた値か */
  origin: DiffOrigin;
  /** 外から来た値（AI）は、FP が承認した記録を持つ（0008 の2） */
  approval?: { by: "fp"; at: string; candidate: string };
  note: string | null;
}

/** 差分の出どころ。`ai` の `ref` は候補の ID、`connector` は AI のアプリが名乗った名前（自己申告） */
export type DiffOrigin = { kind: "manual" } | { kind: "ai"; ref: string; connector: string | null };

/** 案（0008 の5 の proposals の1件） */
export interface Proposal {
  id: string;
  /** 例: 「B案 借入を500万円減らす」 */
  name: string;
  /** 作った日時（ISO 8601） */
  createdAt: string;
  updatedAt: string;
  /** 土台の案（null は現状） */
  base: string | null;
  /** 印（まとめ。フォルダの代わり） */
  tags: string[];
  diffs: PlanDiff[];
  /** 現状に反映した日時 */
  reflectedAt?: string;
  /** AIからの候補を FP がプランとして保存したもの（候補の ID） */
  source?: { kind: "ai"; candidate: string };
}

const box = (value: ItemValue): ValueBox => ({ value, state: "confirmed", origin: { kind: "manual" } });

export function findPlan(list: readonly Proposal[], id: string | null): Proposal | undefined {
  return id === null ? undefined : list.find((p) => p.id === id);
}

/** 案の差分の一覧（土台から順に重ねた結果）。キー → 差分と、その差分を持つ案 */
export function effectiveDiffs(list: readonly Proposal[], id: string | null): Map<string, { diff: PlanDiff; owner: string }> {
  const chain: Proposal[] = [];
  const seen = new Set<string>();
  let cur = findPlan(list, id);
  while (cur !== undefined && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = findPlan(list, cur.base);
  }
  const out = new Map<string, { diff: PlanDiff; owner: string }>();
  for (const p of chain) for (const d of p.diffs) if (d.enabled) out.set(d.key, { diff: d, owner: p.id });
  return out;
}

/** 案の中身（動かした値） */
export function effectiveValues(list: readonly Proposal[], id: string | null): Values {
  const out: Values = {};
  for (const [k, { diff }] of effectiveDiffs(list, id)) out[k] = diff.value.value;
  return out;
}

/** 動かした値を現状に当てて、計算の要求を作る（現状は変えない）。今の一覧に無い項目（向き先が消えたもの）は当てない */
export function applyValues(wh: WorkingHousehold, values: Values, cat: Catalog): EngineRequest {
  let w = wh;
  for (const it of cat.items) if (it.phase === "field" && Object.hasOwn(values, it.key)) w = it.apply(w, values[it.key] ?? null);
  const lv: Partial<LeverValues> = {};
  for (const k of LEVER_KEYS) {
    const v = values[`lever:${k}`];
    if (typeof v === "number" && cat.byKey.has(`lever:${k}`)) lv[k] = v;
  }
  const r = reemploymentFor(wh, cat.selfId);
  let req = Object.keys(lv).length > 0 ? applyLevers(w.request, cat.selfId, lv, r !== undefined ? { reemployment: r } : {}) : w.request;
  const fee = values["lever:fee"];
  if (typeof fee === "boolean" && cat.byKey.has("lever:fee")) req = applyAdvisoryFee(req, fee);
  return req;
}

/** 項目の今の値（動かした値があればそれ、無ければ現状） */
export function valueOf(item: MovableItem, values: Values, wh: WorkingHousehold): ItemValue {
  return Object.hasOwn(values, item.key) ? (values[item.key] ?? null) : item.read(wh);
}

/**
 * 動かした値を整える: 一覧に無い項目を外し、現状と同じ値の項目を外す（土台が動かした項目は、現状に戻した値として残す）
 */
export function normalizeValues(values: Values, baseValues: Values, wh: WorkingHousehold, cat: Catalog): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(values)) {
    const it = cat.byKey.get(k);
    if (it === undefined) continue;
    if (!Object.hasOwn(baseValues, k) && it.same(v, it.read(wh))) continue;
    out[k] = v;
  }
  return out;
}

export function sameValues(a: Values, b: Values, cat: Catalog): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (Object.hasOwn(a, k) !== Object.hasOwn(b, k)) return false;
    const it = cat.byKey.get(k);
    const x = a[k] ?? null;
    const y = b[k] ?? null;
    if (!(it !== undefined ? it.same(x, y) : JSON.stringify(x) === JSON.stringify(y))) return false;
  }
  return true;
}

/** 案の自分の差分を作る: 土台の中身と違う値だけ。前と同じキー・同じ値の差分は ID と before を引き継ぐ */
function ownDiffs(values: Values, baseValues: Values, wh: WorkingHousehold, cat: Catalog, prev: readonly PlanDiff[]): PlanDiff[] {
  const out: PlanDiff[] = [];
  for (const [k, v] of Object.entries(values)) {
    const it = cat.byKey.get(k);
    if (it === undefined) continue;
    if (Object.hasOwn(baseValues, k) ? it.same(v, baseValues[k] ?? null) : it.same(v, it.read(wh))) continue;
    const old = prev.find((d) => d.key === k);
    out.push({
      id: old?.id ?? newId(),
      key: k,
      target: it.target,
      item: it.item,
      op: "set",
      value: box(v),
      before: old !== undefined ? old.before : box(it.read(wh)),
      enabled: true,
      // 前と同じ値のままの差分は、出どころ（AIの候補を承認したものなど）を引き継ぐ。動かした差分は手で動かした値になる
      ...(old !== undefined && it.same(old.value.value, v) ? { origin: old.origin, ...(old.approval !== undefined ? { approval: old.approval } : {}) } : { origin: { kind: "manual" as const } }),
      note: null,
    });
  }
  return out;
}

export interface SaveInput {
  name: string;
  tags?: string[];
  /** 土台の案（null は現状） */
  base: string | null;
  values: Values;
  now: string;
}

/** 新しい案として保存する。戻り値は新しい世帯と案の ID */
export function savePlan(wh: WorkingHousehold, cat: Catalog, input: SaveInput): { wh: WorkingHousehold; id: string } {
  const id = newId();
  const baseValues = effectiveValues(wh.proposals, input.base);
  const p: Proposal = { id, name: input.name.trim() || "名前のないプラン", createdAt: input.now, updatedAt: input.now, base: input.base, tags: input.tags ?? [], diffs: ownDiffs(input.values, baseValues, wh, cat, []) };
  return { wh: { ...wh, proposals: [...wh.proposals, p] }, id };
}

/** 開いている案を上書きする */
export function overwritePlan(wh: WorkingHousehold, cat: Catalog, id: string, values: Values, now: string): WorkingHousehold {
  return {
    ...wh,
    proposals: wh.proposals.map((p) => (p.id === id ? { ...p, updatedAt: now, diffs: ownDiffs(values, effectiveValues(wh.proposals, p.base), wh, cat, p.diffs) } : p)),
  };
}

export function renamePlan(wh: WorkingHousehold, id: string, name: string, tags: string[]): WorkingHousehold {
  return { ...wh, proposals: wh.proposals.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, tags } : p)) };
}

/** 案を外す。この案を土台にしていた案は、この案の差分を自分に写して、この案の土台に付け替える（中身は変わらない） */
export function deletePlan(wh: WorkingHousehold, id: string): WorkingHousehold {
  const gone = findPlan(wh.proposals, id);
  if (gone === undefined) return wh;
  const proposals = wh.proposals
    .filter((p) => p.id !== id)
    .map((p) => {
      if (p.base !== id) return p;
      const own = new Set(p.diffs.map((d) => d.key));
      return { ...p, base: gone.base, diffs: [...gone.diffs.filter((d) => !own.has(d.key)).map((d) => ({ ...d, id: newId() })), ...p.diffs] };
    });
  return { ...wh, proposals };
}

export type ReviewState = "ok" | "changed" | "missing";

export interface ChangeRow {
  key: string;
  label: string;
  /** 例: 「3,200万円」 */
  from: string;
  to: string;
  /** 土台の案から引き継いだ差分 */
  inherited: boolean;
  state: ReviewState;
  /** 要確認のときの説明 */
  reviewNote: string | null;
}

/** 案の「変えたこと」の一覧と要確認（現状に照らす） */
export function changesOf(list: readonly Proposal[], id: string, wh: WorkingHousehold, cat: Catalog): ChangeRow[] {
  const out: ChangeRow[] = [];
  for (const [k, { diff, owner }] of effectiveDiffs(list, id)) {
    const it = cat.byKey.get(k);
    const inherited = owner !== id;
    if (it === undefined) {
      out.push({ key: k, label: diff.item, from: "—", to: "—", inherited, state: "missing", reviewNote: "この差分が指していた物が、入力（現状）から無くなりました" });
      continue;
    }
    const now = it.read(wh);
    const changed = !it.same(diff.before.value, now);
    out.push({
      key: k,
      label: it.label,
      from: it.text(now),
      to: it.text(diff.value.value),
      inherited,
      state: changed ? "changed" : "ok",
      reviewNote: changed ? `入力（現状）が ${it.text(diff.before.value)}→${it.text(now)} に変わりました${it.same(diff.value.value, now) ? "（このプランと同じ値になりました）" : ""}` : null,
    });
  }
  return out;
}

/** 動かしている値の一覧（保存する前の案。主画面の「変えたこと」） */
export function changesOfValues(values: Values, wh: WorkingHousehold, cat: Catalog): ChangeRow[] {
  const out: ChangeRow[] = [];
  for (const it of cat.items) {
    if (!Object.hasOwn(values, it.key)) continue;
    const now = it.read(wh);
    const v = values[it.key] ?? null;
    if (it.same(v, now)) continue;
    out.push({ key: it.key, label: it.label, from: it.text(now), to: it.text(v), inherited: false, state: "ok", reviewNote: null });
  }
  return out;
}

export function reviewCount(list: readonly Proposal[], id: string, wh: WorkingHousehold, cat: Catalog): number {
  return changesOf(list, id, wh, cat).filter((c) => c.state !== "ok").length;
}

/** 要確認を確かめた: 差分を持つ案の before を今の現状の値にする */
export function acknowledge(wh: WorkingHousehold, cat: Catalog, id: string, key: string): WorkingHousehold {
  const e = effectiveDiffs(wh.proposals, id).get(key);
  const it = cat.byKey.get(key);
  if (e === undefined || it === undefined) return wh;
  const now = it.read(wh);
  return { ...wh, proposals: wh.proposals.map((p) => (p.id === e.owner ? { ...p, diffs: p.diffs.map((d) => (d.key === key ? { ...d, before: box(now) } : d)) } : p)) };
}

/** 案から差分を外す（土台から引き継いだ差分は、この案で現状に戻す差分を足す。向き先が無い差分は消す） */
export function dropChange(wh: WorkingHousehold, cat: Catalog, id: string, key: string): WorkingHousehold {
  const p = findPlan(wh.proposals, id);
  if (p === undefined) return wh;
  const own = p.diffs.some((d) => d.key === key);
  const it = cat.byKey.get(key);
  if (own || it === undefined) return { ...wh, proposals: wh.proposals.map((x) => (x.id === id ? { ...x, diffs: x.diffs.filter((d) => d.key !== key) } : x)) };
  const now = it.read(wh);
  const d: PlanDiff = { id: newId(), key, target: it.target, item: it.item, op: "set", value: box(now), before: box(now), enabled: true, origin: { kind: "manual" }, note: null };
  return { ...wh, proposals: wh.proposals.map((x) => (x.id === id ? { ...x, diffs: [...x.diffs, d] } : x)) };
}

/**
 * この案を現状に反映する: 案の中身（土台を含む）を入力（現状）に取り込む。反映した案は差分が無くなり（現状と同じ）、土台を外す。
 * ほかの案は差分のまま残り、現状が変わった項目は「要確認」になる
 */
export function reflectPlan(wh: WorkingHousehold, cat: Catalog, id: string, now: string): WorkingHousehold {
  const values = effectiveValues(wh.proposals, id);
  const request = applyValues(wh, values, cat);
  return { ...wh, request, proposals: wh.proposals.map((p) => (p.id === id ? { ...p, base: null, diffs: [], reflectedAt: now, updatedAt: now } : p)) };
}

// ---- プランの名前 ----

const LETTERS = "BCDEFGHIJKLMNOPQRSTUVWXYZ";

/** プランの呼び名（例: 「プランB」） */
export const planLabel = (letter: string): string => `プラン${letter}`;

/** 名前の頭のプランの文字（「プランB」。以前の「B案」も読む） */
export const HEAD = /^(?:プラン([A-Z])|([A-Z])案)(?:\s+|$)/;

/** 名前の中の以前の呼び方「B案」を「プランB」に直す（例: 「プランB＋金利が上がる」。英大文字の後の「案」だけ） */
export function modernPlanName(name: string): string {
  return name.replace(/([A-Z])案/g, "プラン$1");
}

/** 名前の頭のプランの文字（後ろに空白が無くてもよい。無ければ undefined） */
export function headLetter(name: string): string | undefined {
  const m = /^(?:プラン([A-Z])|([A-Z])案)/.exec(name);
  return m === null ? undefined : (m[1] ?? m[2]);
}

function phrase(it: MovableItem, v: ItemValue, now: ItemValue): string {
  if (it.key.endsWith(":prepay") && typeof v === "number") return `借入を${man(v)}万円減らす`;
  if (typeof v === "number" && typeof now === "number" && (it.control.kind === "range" || (it.control.kind === "field" && it.control.field.kind === "yen") || it.key === "lever:livingMonthly" || it.key === "lever:nisaMonthly")) {
    const d = v - now;
    return `${it.short}を${man(Math.abs(d))}万円${d < 0 ? "減らす" : "増やす"}`;
  }
  if (it.key === "lever:retireAge" && typeof v === "number") return `${v}歳まで働く`;
  if (it.key === "lever:pensionAge" && typeof v === "number") return `年金を${v}歳から`;
  if (it.key === "lever:fee") return v === true ? "FP顧問料を入れる" : "FP顧問料を入れない";
  if (it.control.kind === "rate" && typeof v === "string") return `金利${pctText(v)}`;
  if (it.control.kind === "shift") {
    const s = v as RateShift | null;
    return s === null ? "金利が上がらない" : `金利が${Number(s.from.slice(0, 4))}年から+${pctText(s.add)}`;
  }
  if (it.control.kind === "mix") {
    const eq = Array.isArray(v) ? (v as MixPart[]).filter((m) => m.assetClass.startsWith("equity.")).reduce((s, m) => s + Math.round(Number(m.share) * 100), 0) : 0;
    return `株式${eq}%の配分`;
  }
  return `${it.short}を${it.text(v)}に`;
}

/**
 * プランの名前の例（例: 「プランB 借入を500万円減らす」）。土台のプランがあれば、土台から変えたことで名前を作る。
 * 足した項目（借入・金利・配分など）を、対策の固定の項目より先に使う
 */
export function suggestName(list: readonly Proposal[], values: Values, wh: WorkingHousehold, cat: Catalog, base: string | null = null): string {
  const used = new Set(list.map((p) => headLetter(p.name)).filter((x): x is string => x !== undefined));
  const letter = [...LETTERS].find((l) => !used.has(l)) ?? String(list.length + 2);
  const baseValues = effectiveValues(list, base);
  const ref = (it: MovableItem) => (Object.hasOwn(baseValues, it.key) ? (baseValues[it.key] ?? null) : it.read(wh));
  const rows = cat.items.filter((it) => Object.hasOwn(values, it.key) && !it.same(values[it.key] ?? null, ref(it))).sort((a, b) => Number(a.builtin) - Number(b.builtin));
  const first = rows[0];
  const baseLetter = headLetter(findPlan(list, base)?.name ?? "");
  const head = baseLetter !== undefined ? `${planLabel(letter)} ${planLabel(baseLetter)}＋` : `${planLabel(letter)} `;
  if (first === undefined) return planLabel(letter);
  const p = phrase(first, values[first.key] ?? null, ref(first));
  return `${head}${p}${rows.length > 1 ? ` ほか${rows.length - 1}件` : ""}`;
}
