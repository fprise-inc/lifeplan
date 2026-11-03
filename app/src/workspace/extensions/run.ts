// 拡張の束の差し込み口を呼ぶ所（作業の層。0114 の5〜7）。
// - 見せ方の差し込み口（view.balance・report.chapter）の関数に、自分の入力欄の値と reads に書いた値（balance.now）だけを写して渡す
// - view.balance の返した値に、鍵（束の id）と入力欄（宣言と今の値から作る）を足して、資産と負債のタブの見るもの（BsCustomViewModel）にする
// - 有効にする条件: 公式の拡張は機能を有効にするコード（0110）と事務所の設定の印、世帯の条件（activation.households）
// - 計算の要求・計算の結果には触れない（束の値は計算の要求の外。0114 の4）
import type { BalanceView, ExtColumn, ExtInput, ExtValue, HouseholdNow } from "../../../../report/src/index.ts";
import type { BsCustomColumn, BsCustomViewModel, BsYearModel } from "../../presentation/model.ts";
import type { Household } from "../../engine/types.ts";
import { hasExecutive } from "../input/officer.ts";
import type { FeatureId, FeatureStatus } from "../office/featureCodes.ts";
import { featureOn } from "../office/featureCodes.ts";
import type { OfficeFeatures } from "../office/settings.ts";
import { fieldModel, formModel, withFieldText } from "./fields.ts";
import type { LoadedExtension } from "./manifest.ts";

/** 世帯ごとの束の値（入力欄の key → 値） */
export type ExtValues = Record<string, ExtValue>;

/** 資産と負債のタブの今の年（BsYearModel）を、束に渡す家計の側（HouseholdNow）にする（提案書の章も同じ） */
export function householdNow(y: BsYearModel): HouseholdNow {
  return {
    at: { year: y.year, lines: y.lines.map((l) => ({ key: l.key, label: l.label, group: l.group, amount: l.amount })), totalAssets: y.totalAssets, totalLiabilities: y.totalLiabilities, netWorth: y.netWorth, financial: y.financial, shortfall: y.shortfall },
    monthly: Math.round((y.living + y.loanPay) / 12),
    guarantee: y.guarantee,
  };
}

/** 世帯の条件に合うか */
export const fitsHousehold = (x: LoadedExtension, h: Household): boolean => (x.manifest.activation?.households ?? "all") !== "executive" || hasExecutive(h);

/** 公式の拡張のコードの機能（無ければ null） */
export const featureOf = (x: LoadedExtension): FeatureId | null => (x.official ? ((x.manifest.activation?.feature as FeatureId | undefined) ?? null) : null);

/**
 * 今使える束。公式の拡張は「コードで有効」かつ「事務所の設定の印」かつ「世帯の条件」のときだけ（0110・0114 の7）。
 * コードの要らない束（段2 の FP の束）は承認で有効になるので、ここに来た時点で使える
 */
export function activeExtensions(all: readonly LoadedExtension[], o: { features: FeatureStatus; office: OfficeFeatures; household: Household | null }): LoadedExtension[] {
  if (o.household === null) return [];
  const h = o.household;
  return all.filter((x) => {
    const f = featureOf(x);
    if (f !== null && (!featureOn(o.features, f) || o.office[f] !== true)) return false;
    return fitsHousehold(x, h);
  });
}

/** 束に渡す値（自分の入力欄の値と、reads に書いた値だけ。写しを渡す） */
export function extInput(x: LoadedExtension, values: ExtValues | undefined, now: HouseholdNow | null): ExtInput {
  const input: ExtInput = { values: Object.fromEntries(x.fields.map((d) => [d.key, values?.[d.key] ?? null])) };
  if ((x.manifest.reads ?? []).includes("balance.now") && now !== null) input.balance = { now };
  return structuredClone(input);
}

/** 束が今の世帯に値を持っているか（入力欄のどれかに値がある） */
export const hasValues = (x: LoadedExtension, values: ExtValues | undefined): boolean => x.fields.some((d) => values?.[d.key] !== undefined);

function yearOf(c: ExtColumn["at"]): BsYearModel {
  return {
    year: c.year,
    age: null,
    members: "",
    fact: true,
    lines: c.lines.map((l) => ({ key: l.key, label: l.label, group: l.group, amount: l.amount })),
    totalAssets: c.totalAssets,
    totalLiabilities: c.totalLiabilities,
    netWorth: c.netWorth,
    financial: c.financial,
    shortfall: c.shortfall,
    living: 0,
    loanPay: 0,
    guarantee: 0,
    events: [],
    notes: {},
    ...(c.netParts !== undefined ? { netParts: c.netParts.map((p) => ({ key: p.key, label: p.label, amount: p.amount })) } : {}),
  };
}

const column = (c: ExtColumn): BsCustomColumn => ({ name: c.name, at: yearOf(c.at), ...(c.sub !== undefined ? { sub: c.sub } : {}) });

/**
 * 資産と負債のタブの見るもの（差し込み口 view.balance）。now は現状のプランの今の年（無ければ見るものを作らない）
 */
export function extensionViews(exts: readonly LoadedExtension[], values: ExtValues | undefined, now: BsYearModel | undefined): BsCustomViewModel[] {
  if (now === undefined) return [];
  const home = householdNow(now);
  const out: BsCustomViewModel[] = [];
  for (const x of exts) {
    const p = x.manifest.provides.find((q) => q.extensionPoint === "view.balance");
    const fn = p === undefined ? undefined : x.parts[p.export];
    if (p === undefined || fn === undefined) continue;
    const v = fn(extInput(x, values, home)) as BalanceView;
    const decl = x.fields[0];
    const value = decl === undefined ? null : (values?.[decl.key] ?? null);
    const fieldOf = (id: string) => {
      for (const d of x.fields) {
        const f = d.fields.find((q) => q.id === id);
        if (f !== undefined) return fieldModel(f, values?.[d.key] ?? null, v.form?.hints?.[id]);
      }
      return undefined;
    };
    out.push({
      key: x.manifest.id,
      label: p.label ?? x.manifest.name,
      columns: v.columns.map(column),
      note: v.note,
      ...(v.lead !== undefined ? { lead: v.lead } : {}),
      ...(v.steps !== undefined ? { steps: v.steps.map((s) => ({ key: s.key, label: s.label, columns: s.columns.map(column), note: s.note })) } : {}),
      ...(v.scale !== undefined ? { scale: v.scale } : {}),
      ...(v.groups !== undefined ? { groups: v.groups } : {}),
      ...(v.notices !== undefined ? { notices: v.notices } : {}),
      ...(v.sections !== undefined
        ? {
            sections: v.sections.map(({ field, ...s }) => {
              const f = field === undefined ? undefined : fieldOf(field);
              return { ...s, ...(f !== undefined ? { field: f } : {}) };
            }),
          }
        : {}),
      ...(v.form !== undefined && decl !== undefined ? { form: formModel(decl, value, v.form) } : {}),
      ...(v.empty !== undefined ? { empty: v.empty } : {}),
    });
  }
  return out;
}

/**
 * 見るものの入力欄を1つ変えた値（view は見るものの鍵＝束の id）。読めない文字・知らない欄は undefined（変えない）。
 * key は入力欄の値の置き場所、value は新しい値（全部空なら null）
 */
export function extensionFieldEdit(exts: readonly LoadedExtension[], values: ExtValues | undefined, view: string, id: string, text: string): { key: string; value: ExtValue | null } | undefined {
  const x = exts.find((e) => e.manifest.id === view);
  const d = x?.fields.find((q) => q.fields.some((f) => f.id === id));
  if (d === undefined) return undefined;
  const next = withFieldText(d, values?.[d.key] ?? null, id, text);
  return next === undefined ? undefined : { key: d.key, value: next };
}

/** 提案書の拡張の章（FP が選ぶ一覧に足す） */
export function extensionChapters(exts: readonly LoadedExtension[]): { id: `ext.${string}`; label: string }[] {
  return exts.flatMap((x) => x.manifest.provides.flatMap((p) => (p.extensionPoint === "report.chapter" && p.chapter !== undefined ? [{ id: p.chapter.id as `ext.${string}`, label: p.chapter.label }] : [])));
}

/** 提案書の拡張の章の材料（選んだ章だけ。関数が null を返した章は持たない） */
export function chapterMaterials(exts: readonly LoadedExtension[], values: ExtValues | undefined, now: BsYearModel | undefined, chosen: ReadonlySet<string>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (now === undefined) return out;
  const home = householdNow(now);
  for (const x of exts) {
    for (const p of x.manifest.provides) {
      if (p.extensionPoint !== "report.chapter" || p.chapter === undefined || !chosen.has(p.chapter.id)) continue;
      const fn = x.parts[p.export];
      const r = fn === undefined ? null : fn(extInput(x, values, home));
      if (typeof r === "object" && r !== null && !Array.isArray(r)) out[p.chapter.id] = r as Record<string, unknown>;
    }
  }
  return out;
}
