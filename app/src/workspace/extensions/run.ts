// 拡張の束の差し込み口を呼ぶ所（作業の層。0114 の5〜7）。
// - 見せ方の差し込み口（view.balance・report.chapter）の関数に、自分の入力欄の値と reads に書いた値（balance.now）だけを写して渡す
// - view.balance の返した値に、鍵（束の id）と入力欄（宣言と今の値から作る）を足して、資産と負債のタブの見るもの（BsCustomViewModel）にする
// - 有効にする条件: 公式の拡張は機能を有効にするコード（0110）と事務所の設定の印、世帯の条件（activation.households）
// - アプリの見本の世帯（架空。保存していないもの）では、コードが無くても公式の拡張を見せる（sampleExtensions。見本の印を付ける。0197）。
//   コードの無い FP にも見える文には、コードのことを書かない（0197 の追記）
// - 計算の要求・計算の結果には触れない（束の値は計算の要求の外。0114 の4）
import type { BalanceView, ExtColumn, ExtInput, ExtValue, HouseholdNow } from "../../../../report/src/index.ts";
import type { BsCustomColumn, BsCustomViewModel, BsYearModel } from "../../presentation/model.ts";
import type { Household } from "../../engine/types.ts";
import { hasExecutive } from "../input/officer.ts";
import type { FeatureId, FeatureStatus } from "../office/featureCodes.ts";
import { featureOn } from "../office/featureCodes.ts";
import type { OfficeFeatures } from "../office/settings.ts";
import { fieldModel, formModel, readExtValue, withFieldText } from "./fields.ts";
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

/**
 * 見本の世帯でだけ見せているときの案内（資産と負債のタブの見るもの。0197）。
 * コードの無い FP にも出るので、コード（0110）のことは書かない（コードの無い FP にはコードの存在を出さない。0197 の追記）
 */
export const SAMPLE_PREVIEW_TEXT = "見本の世帯でご覧いただいている機能です。数字を変えて試せます（見本は保存されないので、開き直せば元に戻ります）。";

/**
 * 見本の世帯から世帯・見本を作ったときの知らせ（値は写すが、作った世帯では見られない。0197）。
 * コードを持っていて事務所の設定の印を外している FP にだけ出す（コードの無い FP には出さない。会社の数字は黙って写す。0197 の追記）
 */
export const SAMPLE_SAVED_TEXT = "合算BS の会社の数字も写しました。この世帯で見るには、事務所の既定値の「法人経営者向けの機能」で印を付けてください";

/**
 * 見本から世帯・見本を作ったときに SAMPLE_SAVED_TEXT を出すか（0197）。見本で見せていた束に値があり、その束のコードが今使える
 * （印を外しているので見本として見せていた）ときだけ。コードの無い FP には出さない
 */
export function savedSampleNotice(all: readonly LoadedExtension[], o: { previews: ReadonlySet<string>; features: FeatureStatus; values: ExtValues | undefined }): boolean {
  return all.some((x) => {
    const f = featureOf(x);
    return o.previews.has(x.manifest.id) && f !== null && featureOn(o.features, f) && hasValues(x, o.values);
  });
}

/**
 * 見本の世帯でだけ見せる公式の拡張（0197）。アプリに入っている見本の世帯（すべて架空。保存していないもの）を開いているときだけ、
 * コード（0110）・事務所の設定の印が無くても、世帯の条件に合う公式の拡張を見せる。activeExtensions で使える束は含めない（ふつうに使える）。
 * appSample は「アプリの見本を、保存しないで開いている」こと（保存した世帯・FP が作った見本は false。お客さまの情報が入りうるため）。
 * activeExtensions（見本でない世帯の扱い）は変えない
 */
export function sampleExtensions(all: readonly LoadedExtension[], o: { features: FeatureStatus; office: OfficeFeatures; household: Household | null; appSample: boolean }): LoadedExtension[] {
  if (!o.appSample || o.household === null) return [];
  const h = o.household;
  const active = new Set(activeExtensions(all, o).map((x) => x.manifest.id));
  return all.filter((x) => featureOf(x) !== null && !active.has(x.manifest.id) && fitsHousehold(x, h));
}

/**
 * 見本の世帯に入れておく束の入力欄の値（catalog.ts の extValues）を、束の宣言で確かめて読む（宣言に合わない値・宣言の無いキーは捨てる。
 * 何も残らなければ undefined）。世帯ファイルを読むとき（store/body.ts）と同じ確かめ。0197
 */
export function demoExtValues(exts: readonly LoadedExtension[], raw: Readonly<Record<string, unknown>> | undefined): ExtValues | undefined {
  if (raw === undefined) return undefined;
  const out: ExtValues = {};
  for (const d of exts.flatMap((x) => x.fields)) {
    const v = readExtValue(d, raw[d.key]);
    if (v !== null) out[d.key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
export function extensionViews(exts: readonly LoadedExtension[], values: ExtValues | undefined, now: BsYearModel | undefined, samples: ReadonlySet<string> = new Set()): BsCustomViewModel[] {
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
      ...(samples.has(x.manifest.id) ? { sample: SAMPLE_PREVIEW_TEXT } : {}),
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

/** 提案書の拡張の章（FP が選ぶ一覧に足す）。samples の束（見本の世帯でだけ見せる束。0197）の章は、名前に「（見本）」を付ける */
export function extensionChapters(exts: readonly LoadedExtension[], samples: ReadonlySet<string> = new Set()): { id: `ext.${string}`; label: string }[] {
  return exts.flatMap((x) => x.manifest.provides.flatMap((p) => (p.extensionPoint === "report.chapter" && p.chapter !== undefined ? [{ id: p.chapter.id as `ext.${string}`, label: samples.has(x.manifest.id) ? `${p.chapter.label}（見本）` : p.chapter.label }] : [])));
}

/** 束の id の集まりから、その束の提案書の章の id（見本の印を付ける章。0197） */
export function chapterIdsOf(exts: readonly LoadedExtension[], ids: ReadonlySet<string>): string[] {
  return extensionChapters(exts.filter((x) => ids.has(x.manifest.id))).map((c) => c.id);
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
