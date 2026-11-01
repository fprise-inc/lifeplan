// 基本生活費のカードの「毎年の黒字のうち、貯金に回る割合」（0031。前提の assumptions.surplusSaving）。
// 貯まらない分は使ってしまうお金（ゆとりの支出）なので、生活費の欄に置く（前提条件は FP の側の設定で、顧客と一緒に見る所ではないため。0031 の追記）。
// - 目安から選ぶ: ずっと同じ・子育て中と子の独立後で分ける・退職の前後で分ける（期間はこの世帯の末子の独立・退職の時点で入る）
// - カスタム（自由に組む）: 「本人の○歳から○%」の組を足す（最大4つ）。目安の区切りの後でカスタムを選ぶと、区切りを年齢の形にして自分で直せるようにする（0100 の追記）
// - 上限（年○万円まで）・控えから見た実際の割合の提案（欄のキー living/surplus/ratio。surplusSuggest.ts）も同じ所に
import type { Timepoint } from "../../../engine/types.ts";
import { ageAt, parseYm } from "../../levers.ts";
import { applyPreset, presetOf, presetPoints, PRESET_RATIOS, setSurplus, surplusOf, yearOfTimepoint, type SurplusPreset } from "../../surplus.ts";
import { field, resolveTimepoint, type ActionDef, type FieldDef, type GroupDef, type SectionDef } from "../form.ts";
import type { WorkingHousehold } from "../household.ts";
import { readLine } from "../readLines.ts";
import { memberLabel } from "../labels.ts";
import { accountName, settlementOf } from "../savings/model.ts";

const ITEM = "assumptions.surplusSaving";
/** 期間を変える組の数の上限 */
const MAX_CHANGES = 4;
const withReq = (wh: WorkingHousehold, request: WorkingHousehold["request"]): WorkingHousehold => ({ ...wh, request });
const pctText = (r: string) => `${Math.round(Number(r) * 100)}%`;

/** 目安のボタンの名前 */
export const PRESET_LABELS: Readonly<Record<SurplusPreset, string>> = {
  same: "ずっと同じ",
  children: "子育て中と子の独立後で分ける",
  retirement: "退職の前後で分ける",
};

/** 目安ごとの、はじめの期間と区切りの後の期間の呼び方 */
const PERIOD_NAMES: Readonly<Record<"children" | "retirement", { before: string; after: string }>> = {
  children: { before: "末子の独立まで", after: "末子の独立の後" },
  retirement: { before: "退職まで", after: "退職の後" },
};

/** 期間の区切りの後の組に添える説明 */
const AFTER_NOTES: Readonly<Record<"children" | "retirement", string>> = {
  children: "子の独立の後は教育費が無くなり、黒字が増えやすい時期です。そのうち貯金に回る割合を入れます。",
  retirement:
    "退職の後は、年金だけでは赤字になる年が多くなります。この割合が効くのは、働く収入や年金が多くて黒字になる年だけです（貯金を取り崩す予定の年は除きます）。",
};

function changeGroups(wh: WorkingHousehold, preset: SurplusPreset | "custom" | null): GroupDef[] {
  const req = wh.request;
  const self = req.input.household.members.find((m) => m.kind === "self");
  const changes = surplusOf(req)?.changes ?? [];
  return changes.map((c, i): GroupDef => {
    const edit = (w: WorkingHousehold, f: (x: (typeof changes)[number]) => (typeof changes)[number] | null) => {
      const cur = surplusOf(w.request) ?? {};
      const list = [...(cur.changes ?? [])];
      const old = list[i];
      if (old === undefined) return w;
      const next = f(old);
      if (next === null) list.splice(i, 1);
      else list[i] = next;
      return withReq(w, setSurplus(w.request, { ...cur, changes: list }));
    };
    const fromAge = (w: WorkingHousehold) => {
      const x = (surplusOf(w.request)?.changes ?? [])[i];
      if (x === undefined || self === undefined) return null;
      if (x.from.memberAge !== undefined && x.from.memberAge.member === self.id) return x.from.memberAge.years;
      const ym = resolveTimepoint(w.request.input.household, x.from);
      return ym === null ? null : ageAt(self, ym);
    };
    const named = preset === "children" || preset === "retirement" ? PERIOD_NAMES[preset] : null;
    const year = yearOfTimepoint(req, c.from) ?? (() => {
      const ym = resolveTimepoint(req.input.household, c.from);
      return ym === null ? null : parseYm(ym).y;
    })();
    const age = fromAge(wh);
    const when = [year !== null ? `${year}年から` : "", age !== null ? `ご本人${age}歳` : ""].filter((x) => x !== "").join("・");
    const ratioField = field({
      key: `living/surplus/change/${i}/ratio`,
      item: ITEM,
      label: named !== null ? `${named.after}の割合` : "この期間の割合",
      level: "simple",
      kind: "pct",
      // 0〜100%（計算エンジンの入力で 0〜1。外の値は計算が止まる）
      min: 0,
      max: 100,
      optional: true,
      get: (w) => ({ value: (surplusOf(w.request)?.changes ?? [])[i]?.ratio ?? null, hint: (surplusOf(w.request)?.changes ?? [])[i]?.ratio === undefined ? "空欄＝100%" : null }),
      set: (w, v) =>
        edit(w, (x) => {
          const { ratio: _r, ...rest } = x;
          void _r;
          return v === null ? rest : { ...rest, ratio: String(v) };
        }),
    });
    const ageField = field({
      key: `living/surplus/change/${i}/age`,
      item: ITEM,
      label: "本人の年齢（この年から）",
      level: named !== null ? "detail" : "simple",
      kind: "int",
      suffix: "歳から",
      min: 0,
      max: 110,
      get: (w) => {
        const x = (surplusOf(w.request)?.changes ?? [])[i];
        const derived =
          x === undefined || x.from.memberAge !== undefined
            ? null
            : named !== null
              ? "推定で入れた時点（年月）を年齢で見せています（書き換えると年齢の形になり、自分で組む形になります）"
              : "年月・できごとで決めた時点を年齢で見せています（書き換えると年齢の形になります）";
        return { value: fromAge(w), derived };
      },
      set: (w, v) => (v === null || self === undefined ? w : edit(w, (x) => ({ ...x, from: { memberAge: { member: self.id, years: Number(v), months: 0 } } }))),
    });
    const capField = field({
      key: `living/surplus/change/${i}/cap`,
      item: ITEM,
      label: "貯金に回る額の上限（年）",
      level: "detail",
      kind: "yen",
      basis: "annual",
      optional: true,
      get: (w) => ({ value: (surplusOf(w.request)?.changes ?? [])[i]?.cap ?? null }),
      set: (w, v) =>
        edit(w, (x) => {
          const { cap: _c, ...rest } = x;
          void _c;
          return v === null ? rest : { ...rest, cap: Number(v) };
        }),
    });
    const fields: FieldDef[] = named !== null ? [ratioField, ageField, capField] : [ageField, ratioField, capField];
    return {
      key: `living/surplus/change/${i}`,
      title: `${named !== null ? named.after : `期間を変える ${i + 1}`}${when !== "" ? `（${when}）` : ""}`,
      ...(preset === "children" || preset === "retirement" ? { note: AFTER_NOTES[preset] } : {}),
      level: "simple",
      fields,
      actions: named !== null ? [] : [{ key: `living/surplus/change/${i}/remove`, label: "外す", level: "simple", danger: true, run: (w) => edit(w, () => null) }],
    };
  });
}

/** 自由に組むときの、足す組の始まり: 最後の組の5年後（無ければ本人の今の年齢＋10歳）。割合は 80% */
function nextChange(wh: WorkingHousehold): { from: Timepoint; ratio: string } | null {
  const req = wh.request;
  const self = req.input.household.members.find((m) => m.kind === "self");
  if (self === undefined) return null;
  const ages = (surplusOf(req)?.changes ?? []).map((c) => {
    if (c.from.memberAge !== undefined && c.from.memberAge.member === self.id) return c.from.memberAge.years;
    const ym = resolveTimepoint(req.input.household, c.from);
    return ym === null ? null : ageAt(self, ym);
  });
  const last = ages.filter((x): x is number => x !== null).sort((a, b) => a - b).at(-1);
  const age = last !== undefined ? last + 5 : ageAt(self, req.input.baseMonth) + 10;
  return { from: { memberAge: { member: self.id, years: age, months: 0 } }, ratio: "0.8" };
}

/**
 * カスタムにする: 期間の組の始まりを本人の年齢の形にする（目安の区切りの年月のままだと、また目安として読まれるため）。組が無ければ1つ足す。
 * 割合・上限・区切りの年は変えない（年齢は区切りの年月の本人の年齢）
 */
function toCustom(wh: WorkingHousehold): WorkingHousehold["request"] {
  const req = wh.request;
  if (presetOf(req) === "custom") return req;
  const self = req.input.household.members.find((m) => m.kind === "self");
  if (self === undefined) return req;
  const cur = surplusOf(req) ?? {};
  const changes = (cur.changes ?? []).map((c) => {
    if (c.from.memberAge !== undefined) return c;
    const ym = resolveTimepoint(req.input.household, c.from);
    if (ym === null) return c;
    // 区切りの年月と同じ月になるよう、年齢を年と月で（本人がその年齢になる月が区切りの月。1日生まれは前の月に年齢が上がる）
    const a = parseYm(ym);
    const b = parseYm(self.birth.birthYearMonth);
    const months = a.y * 12 + a.m - (b.y * 12 + b.m) + (self.birth.bornOnFirst ? 1 : 0);
    return months < 0 ? c : { ...c, from: { memberAge: { member: self.id, years: Math.floor(months / 12), months: months % 12 } } };
  });
  if (changes.length === 0) {
    const next = nextChange(wh);
    if (next === null) return req;
    changes.push(next);
  }
  return setSurplus(req, { ...cur, ...(cur.ratio === undefined ? { ratio: PRESET_RATIOS.same.before } : {}), changes });
}

/** 黒字の行き先（貯蓄・運用のカードの「収支が入る口座」） */
function destinationText(wh: WorkingHousehold): string {
  const h = wh.request.input.household;
  const a = settlementOf(h);
  return a === undefined ? "収支が入る口座（預金）" : `収支が入る口座: ${accountName(a, memberLabel(wh, a.owner))}`;
}

/** 「毎年の黒字のうち、貯金に回る割合」の区画 */
export function surplusSection(wh: WorkingHousehold): SectionDef {
  const req = wh.request;
  const s = surplusOf(req);
  const preset = presetOf(req);
  const pts = presetPoints(req);
  const self = req.input.household.members.find((m) => m.kind === "self");
  const named = preset === "children" || preset === "retirement" ? PERIOD_NAMES[preset] : null;
  const firstChangeYear = named !== null ? yearOfTimepoint(req, s?.changes?.[0]?.from ?? {}) : null;

  const presetAction = (p: SurplusPreset): ActionDef | null => {
    if (p !== "same" && pts[p] === null) return null;
    const v = PRESET_RATIOS[p];
    const at = p === "same" ? null : pts[p];
    const atText = at === null ? "" : `（${parseYm(at).y}年${self !== undefined ? `・ご本人${ageAt(self, at)}歳` : ""}で区切る）`;
    return {
      key: `living/surplus/preset/${p}`,
      label: `${PRESET_LABELS[p]}${atText}`,
      level: "simple",
      pressed: preset === p,
      title: v.after === null ? `目安 ${pctText(v.before)}` : `目安 ${pctText(v.before)} → ${pctText(v.after)}`,
      run: (w) => withReq(w, applyPreset(w.request, p)),
    };
  };
  const presets = (["same", "children", "retirement"] as const).map(presetAction).filter((a): a is ActionDef => a !== null);
  // カスタム: 期間と割合を自分で組む（今の期間の組を、本人の年齢の形にして残す。組が無ければ1つ足す）
  presets.push({
    key: "living/surplus/preset/custom",
    label: "カスタム",
    level: "simple",
    pressed: preset === "custom",
    title: "期間（ご本人の年齢から）と割合を自分で組みます",
    run: (w) => withReq(w, toCustom(w)),
  });

  const ratioLabel = named !== null ? `${named.before}の割合${firstChangeYear !== null ? `（〜${firstChangeYear - 1}年）` : ""}` : preset === "custom" ? "はじめの割合" : "毎年の黒字のうち、貯金に回る割合";
  const main: GroupDef = {
    key: "living/surplus/fields",
    level: "simple",
    fields: [
      field({
        key: "living/surplus/ratio",
        item: ITEM,
        label: ratioLabel,
        level: "simple",
        kind: "pct",
        // 0〜100%（計算エンジンの入力で 0〜1。外の値は計算が止まる）
        min: 0,
        max: 100,
        optional: true,
        help: "空欄なら100%（黒字をすべて貯金に回す）で計算します。例えば60%なら、残りの4割は使ってしまうお金（ゆとりの支出）として支出に入れます。赤字の年、退職金などまとまったお金が入る年、貯金を取り崩す予定の年には当てはめません",
        get: (w) => ({ value: surplusOf(w.request)?.ratio ?? null, hint: surplusOf(w.request)?.ratio === undefined ? "空欄＝100%" : null }),
        set: (w, v) => {
          const cur = surplusOf(w.request) ?? {};
          const { ratio: _r, ...rest } = cur;
          void _r;
          return withReq(w, setSurplus(w.request, v === null ? rest : { ...rest, ratio: String(v) }));
        },
      }),
      field({
        key: "living/surplus/cap",
        item: ITEM,
        label: "貯金に回る額の上限（年）",
        level: "detail",
        kind: "yen",
        basis: "annual",
        optional: true,
        help: "割合の代わりに「年○万円までしか貯まらない」と決めるとき。割合と両方なら少ないほう",
        get: (w) => ({ value: surplusOf(w.request)?.cap ?? null }),
        set: (w, v) => {
          const cur = surplusOf(w.request) ?? {};
          const { cap: _c, ...rest } = cur;
          void _c;
          return withReq(w, setSurplus(w.request, v === null ? rest : { ...rest, cap: Number(v) }));
        },
      }),
      readLine("living/surplus/destination", "黒字の行き先", destinationText(wh), "貯蓄・運用"),
    ],
    actions: [],
  };
  const changes = s?.changes ?? [];
  const actions: ActionDef[] = [];
  if (changes.length < MAX_CHANGES)
    actions.push({
      key: "living/surplus/addChange",
      label: "＋ ご本人の年齢で期間を足す",
      level: "simple",
      run: (w) => {
        const next = nextChange(w);
        if (next === null) return w;
        const cur = surplusOf(w.request) ?? {};
        return withReq(w, setSurplus(w.request, { ...cur, changes: [...(cur.changes ?? []), next] }));
      },
    });
  if (s !== undefined) actions.push({ key: "living/surplus/clear", label: "外す", help: "黒字が全部貯金に回る計算に戻します", level: "simple", danger: true, run: (w) => withReq(w, setSurplus(w.request, undefined)) });
  return {
    key: "living/surplus",
    title: "毎年の黒字のうち、貯金に回る割合",
    note: "黒字の年でも、全部が貯金に回るとは限りません（外食や買い物などで、なんとなく使ってしまう分があるためです）。黒字のうち、実際に貯金に回るのは何割くらいかを入れてください。貯金に回らない分は「ゆとりの支出」として支出に入れて計算します。空欄のときは、黒字をすべて貯金に回して計算します。目安の割合は統計ではないので、実感に合わせて直してください",
    level: "simple",
    groups: [
      {
        key: "living/surplus/presets",
        level: "simple",
        fields: [],
        actions: presets,
      },
      main,
      ...changeGroups(wh, preset),
    ],
    actions,
  };
}
