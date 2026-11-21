// 段階と例外の年の欄（0040。エンジンの側は engine/src/sdk/stages.ts）。物の中の額の欄（家賃・修繕費・固定資産税・周期的な支出・不動産の家賃と経費）
// と、器の利回り・資産配分の段階を、どのカードでも同じ形で入れる:
// - 段: 「いつから」（時点の部品。0038）・額か今の額に対する割合・「ここから○年かけて次の段へ」。段の数に上限は無い
// - 例外の年: 年・その年の額（0円はその年に払わない・受け取らない）
// 段・例外の要素は ID を持ち（0035 の5）、欄は ID で要素を探す（番号で探すと、足す・外すで別の段に当たる）。
// 欄の当て先（0036 の2）は、物（向き先）・入力項目ID・その値の中の場所（並びの要素は ID）
import type { Household, Member, Timepoint } from "../../engine/types.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { field, getPath, plain, removeAction, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type Level, type StageTableRow } from "./form.ts";
import { mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "./household.ts";
import { ASSET_CLASSES, WORDS } from "./labels.ts";
import { formatYen, type YenBasis } from "./units.ts";
import { rowAt } from "./rows.ts";
import type { Address, Target } from "../store/readings.ts";
import { RETURN_RANGE, STAGE_RATIO_RANGE } from "./rateRanges.ts";

type Obj = Record<string, unknown>;
const LEVEL: Level = "detail";

/** 並びの置き場所: 物から並びまでの道と、当て先の入力項目ID・その値の中の並びまでの道 */
export interface ListPlace {
  /** 物（find が返す物）から並びまでの道（例 ["rent", "stages"]） */
  path: readonly string[];
  /** 当て先の入力項目ID（例 residence.rent・periodicExpense.stages） */
  item: string;
  /** 入力項目ID の値の中の並びまでの道（例 ["stages"]。並びそのものが入力項目ID なら []） */
  at: readonly string[];
}

export interface StagedSpec {
  /** 欄のキーの頭（例 housing/res/<ID>/rent） */
  key: string;
  /** 物（向き先）を探す */
  find: Finder;
  /** 当て先の向き先 */
  target: Target;
  stages: ListPlace;
  exceptions: ListPlace;
  /** 額の期間（月額・年額・1回の額） */
  basis: YenBasis;
  /** 欄の名前の頭（例 「家賃」） */
  what: string;
  /** 元の額（段を足すときの初めの値） */
  base: (h: Household) => number | null;
  /** 年齢で入れるときの既定の人 */
  ageOf?: (h: Household) => Member | undefined;
  /** 年ごとの物（固定資産税・経費の年額・利回り）: 段の時点の属する年から変わる */
  yearly?: boolean;
  /** 入るお金か出るお金か（0円の例外の年の説明「受け取りません」「払いません」に使う） */
  flow: "in" | "out";
  /** 変化のまとまりを描く所（行の額の近く。GroupDef の placeIn） */
  place?: GroupDef["placeIn"];
  /** 段を外した後に呼ぶ（推定の段を外したことを覚えるなど。0112） */
  onRemoveStage?: (h: Household, id: string) => void;
  /** 推定から入った変化を1つの表にまとめるときの、要約に添える中身（例: 「新築の軽減の終わり・3年ごとの評価替え」） */
  autoWhat?: string;
  /**
   * 推定から入った段階か（段階の ID で見分ける。0238）。推定のままの段階（今の額に対する割合が推定のまま）に加えて、これが true を返す段階も
   * 推定の変化の表の行にする（割合を確かめた後・手で直した後も、1件ずつの枠に開かない）。渡さなければ、表の行は推定のままの段階だけ
   */
  estimateStage?: (id: string) => boolean;
}

const listAt = (o: Obj | undefined, path: readonly string[]): Obj[] => (getPath(o, path) as Obj[] | undefined) ?? [];
const elementFinder = (find: Finder, path: readonly string[], id: string): Finder => (h, w) => listAt(find(h, w), path).find((x) => x.id === id);
const addressOf = (target: Target, place: ListPlace, id: string, tail: string[]): Address => ({ target, item: place.item, at: [...place.at, id, ...tail] });

/** 並びに要素を足す（入れ物が無ければ作る） */
function pushTo(target: Obj, path: readonly string[], el: Obj): void {
  let cur = target;
  for (const k of path.slice(0, -1)) {
    if (cur[k] === null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k] as Obj;
  }
  const last = path[path.length - 1] as string;
  ((cur[last] ??= []) as Obj[]).push(el);
}

/** 並びから要素を外す（空になったら並びも外す） */
function dropFrom(target: Obj | undefined, path: readonly string[], id: string): void {
  if (target === undefined) return;
  const parent = getPath(target, path.slice(0, -1)) as Obj | undefined;
  const last = path[path.length - 1] as string;
  if (parent === undefined || !Array.isArray(parent[last])) return;
  const rest = (parent[last] as Obj[]).filter((x) => x.id !== id);
  if (rest.length === 0) delete parent[last];
  else parent[last] = rest;
}

/** 段の時点を年月に解いた順（解けない段は後ろ） */
function stageOrder(h: Household, list: readonly Obj[]): Obj[] {
  return [...list].sort((a, b) => (resolveTimepoint(h, a.at as Timepoint) ?? "9999-99").localeCompare(resolveTimepoint(h, b.at as Timepoint) ?? "9999-99"));
}

/** 次に足す段の時点（いちばん後の段の1年後。段が無ければ計算の基準の月の1年後） */
function nextStageAt(wh: WorkingHousehold, list: readonly Obj[]): Timepoint {
  const h = wh.request.input.household;
  const last = stageOrder(h, list)
    .map((s) => resolveTimepoint(h, s.at as Timepoint))
    .filter((x): x is string => x !== null)
    .at(-1);
  const from = last ?? wh.request.input.baseMonth;
  const [y, m] = from.split("-").map(Number) as [number, number];
  return { at: `${y + 1}-${String(m).padStart(2, "0")}` };
}

/** 次に足す例外の年（いちばん後の例外の翌年。無ければ計算の基準の年の翌年） */
const nextYear = (wh: WorkingHousehold, list: readonly Obj[]): number => Math.max(Number(wh.request.input.baseMonth.slice(0, 4)), ...list.map((e) => Number(e.year))) + 1;

const RAMP_HELP = "段階の時点から1年ごとに、次の段階の額へ同じ幅で近づけます。届いた後は次の段階の時点までその額のまま。入れなければ、この段階のまま次の段階の時点で変わります";

/** 「ここから○年かけて次の段へ」の欄（次の段がある段だけ） */
function rampField(key: string, item: string, find: Finder, address: Address): FieldDef {
  return { ...plain({ key, item, label: "ここから次の段階まで何年かけて移すか", level: LEVEL, kind: "int", suffix: "年", min: 1, max: 50, find, path: ["rampYears"], optional: true, help: RAMP_HELP }), address: () => address };
}

/** 段の「いつから」の欄 */
function atField(spec: { key: string; ageOf?: (h: Household) => Member | undefined; yearly?: boolean }, key: string, item: string, find: Finder, address: Address): FieldDef {
  return {
    ...timepointField({
      key,
      item,
      label: spec.yearly === true ? "いつから（その年から）" : "いつから",
      level: LEVEL,
      find,
      path: ["at"],
      ...(spec.ageOf !== undefined ? { ageOf: spec.ageOf } : {}),
      ...(spec.yearly === true ? { help: "年ごとの額なので、この時点の年から変わります" } : {}),
    }),
    address: () => address,
  };
}

// ---- 変化（0040 の 2026-10-29 の追記）: 段と例外の年を、画面では1つの「＋ ○○の変化」から足す ----
// 世帯ファイルの形は変えない（段 stages と例外の年 exceptions の2つの並びのまま。少しずつ移す段と割合の段を表すため。0044 の 2026-10-29 の追記）。
// ボタンを押すと「この年だけ」（例外の年）か「この月から先」（段。年ごとの物は「この年から先」）を選び、選んだ後は今までの段・例外の年の欄が出る。
// 足した変化は時期の順に並べ（例外の年はその年の1月、段は「いつから」の年月。同じ月なら段を先に。時期の解けない段は後ろ）、行の額の近くに置く（placeIn）

/** 「この年だけ」の選択肢の名前 */
export const ONLY_YEAR = "この年だけ";
/** 「この月から先」の選択肢の名前（年ごとの物は「この年から先」） */
export const fromNowOn = (yearly: boolean): string => (yearly ? "この年から先" : "この月から先");

/** 「＋ ○○の変化」のボタンの「?」（この年だけとこの月から先の違い） */
export function changeHelp(o: { yearly: boolean; only: string; from: string }): string {
  return `「${ONLY_YEAR}」は${o.only}。「${fromNowOn(o.yearly)}」は${o.from}。何回でも足せます`;
}

type Change = { kind: "stage"; el: Obj; n: number } | { kind: "except"; el: Obj };

/** 段と例外の年を、時期の順に1つに並べる（段の番号 n は段の中の順。次の段まで何年かけて移すかの欄に使う） */
function changeOrder(h: Household, stages: readonly Obj[], exceptions: readonly Obj[]): Change[] {
  const keyed: { at: string; rank: number; c: Change }[] = [
    ...stages.map((el, n) => ({ at: resolveTimepoint(h, el.at as Timepoint) ?? "9999-99", rank: 0, c: { kind: "stage", el, n } as Change })),
    ...exceptions.map((el) => ({ at: `${String(el.year)}-01`, rank: 1, c: { kind: "except", el } as Change })),
  ];
  // 同じ並びの中の順（段は時点の順・例外は年の順）は崩さない（安定な並べ替え）
  return keyed.sort((a, b) => a.at.localeCompare(b.at) || a.rank - b.rank).map((x) => x.c);
}

/** 0円の例外の年の言い方 */
const zeroWord = (flow: "in" | "out"): string => (flow === "in" ? "受け取りません" : "払いません");

/** 段の見出しの時期（「2027年10月」、年ごとの物は「2027年」。解けなければ null） */
function stageWhen(h: Household, at: unknown, yearly: boolean): string | null {
  const ym = resolveTimepoint(h, at as Timepoint);
  if (ym === null) return null;
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return yearly ? `${y}年` : `${y}年${m}月`;
}

/** 段の見出し（「月額の変化（2027年10月から先）」） */
const stageTitle = (h: Household, what: string, at: unknown, yearly: boolean): string => {
  const w = stageWhen(h, at, yearly);
  return `${what}の変化（${w === null ? fromNowOn(yearly) : `${w}から先`}）`;
};
/** 例外の年の見出し（「月額の変化（2028年だけ）」） */
const exceptTitle = (what: string, year: unknown): string => `${what}の変化（${String(year)}年だけ）`;

/** 額の変化のまとまり（変化ごとに1つと、足すボタンのまとまり。どれも place のまとまりの中に描く） */
export function stagedGroups(wh: WorkingHousehold, spec: StagedSpec): GroupDef[] {
  const h = wh.request.input.household;
  const obj = spec.find(h, wh);
  if (obj === undefined) return [];
  const yearly = spec.yearly === true;
  const stages = stageOrder(h, listAt(obj, spec.stages.path));
  const exceptions = [...listAt(obj, spec.exceptions.path)].sort((a, b) => Number(a.year) - Number(b.year));
  const placeIn = spec.place !== undefined ? { placeIn: spec.place } : {};
  const groups: GroupDef[] = [];
  /** 段階1つの欄とボタン（1件ずつの枠と、推定の変化の表の行で同じ物を使う。row は表の行の名前「2030年から」） */
  const stageParts = (s: Obj, n: number, row?: string): StageParts => {
    const id = String(s.id);
    const k = `${spec.key}/stage/${id}`;
    const find = elementFinder(spec.find, spec.stages.path, id);
    const ad = (tail: string[]) => addressOf(spec.target, spec.stages, id, tail);
    const byRatio = s.amount === undefined && s.ratio !== undefined;
    /** 額か割合の欄の元の名前（1件ずつの枠での名前） */
    const name = byRatio ? `${spec.what}（今の額に対する割合）` : `${spec.what}（この段階から）`;
    const fields: FieldDef[] = [
      atField(spec, `${k}/at`, spec.stages.item, find, ad(["at"])),
      {
        ...field({
          key: `${k}/mode`,
          item: spec.stages.item,
          label: "入れ方",
          level: LEVEL,
          kind: "select",
          segmented: true,
          options: [
            { value: "amount", label: "額で" },
            { value: "ratio", label: "今の額に対する割合で" },
          ],
          structural: true,
          get: (w) => {
            const x = find(w.request.input.household, w);
            return { value: x === undefined ? null : x.amount === undefined && x.ratio !== undefined ? "ratio" : "amount" };
          },
          set: (w, v) =>
            mutate(w, (hh, req) => {
              const x = find(hh, { ...w, request: req });
              if (x === undefined) return;
              if (v === "ratio") {
                delete x.amount;
                x.ratio ??= "1";
              } else if (v === "amount") {
                delete x.ratio;
                x.amount ??= standardBox(spec.base(hh) ?? 0, "元の額と同じ（この段階の額を入れてください）");
              }
            }),
        }),
        address: () => ad([]),
      },
      byRatio
        ? {
            ...plain({
              key: `${k}/ratio`,
              item: spec.stages.item,
              label: row ?? name,
              level: LEVEL,
              kind: "pct",
              ...STAGE_RATIO_RANGE,
              find,
              path: ["ratio"],
              // 表の行は、年の下にその年からの額の目安（今の額に割合をかけた額）
              ...(row !== undefined
                ? {
                    hint: (v: unknown, w: WorkingHousehold) => {
                      const base = spec.base(w.request.input.household);
                      return base === null || typeof v !== "string" ? null : yenAbout(spec.basis, base * Number(v));
                    },
                  }
                : {}),
            }),
            address: () => ad(["ratio"]),
          }
        : { ...yenBox({ key: `${k}/amount`, item: spec.stages.item, label: row ?? name, level: LEVEL, basis: spec.basis, find, path: ["amount"], help: "今の価格で入れます（変動率はこの額にもそのまま掛けます）" }), address: () => ad(["amount"]) },
    ];
    return {
      key: k,
      id,
      name,
      at: fields[0] as FieldDef,
      mode: fields[1] as FieldDef,
      value: fields[2] as FieldDef,
      ramp: n < stages.length - 1 ? rampField(`${k}/ramp`, spec.stages.item, find, ad(["rampYears"])) : null,
      remove: removeAction(`${k}/remove`, WORDS.remove, LEVEL, (hh, w) => {
        dropFrom(spec.find(hh, w), spec.stages.path, id);
        spec.onRemoveStage?.(hh, id);
      }),
    };
  };
  const stageGroup = (s: Obj, n: number): GroupDef => {
    const p = stageParts(s, n);
    return { key: p.key, title: stageTitle(h, spec.what, s.at, yearly), level: LEVEL, ...placeIn, fields: [p.at, p.mode, p.value, ...(p.ramp !== null ? [p.ramp] : [])], actions: [p.remove] };
  };
  const exceptGroup = (e: Obj): GroupDef => {
    const id = String(e.id);
    const k = `${spec.key}/except/${id}`;
    const find = elementFinder(spec.find, spec.exceptions.path, id);
    const ad = (tail: string[]) => addressOf(spec.target, spec.exceptions, id, tail);
    return {
      key: k,
      title: exceptTitle(spec.what, e.year),
      level: LEVEL,
      ...placeIn,
      fields: [
        { ...plain({ key: `${k}/year`, item: spec.exceptions.item, label: "年", level: LEVEL, kind: "int", suffix: "年", min: 1900, max: 2200, find, path: ["year"] }), address: () => ad(["year"]) },
        { ...yenBox({ key: `${k}/amount`, item: spec.exceptions.item, label: `その年の${spec.what}`, level: LEVEL, basis: spec.basis, find, path: ["amount"], help: `今の価格で入れます。0円はその年に${zeroWord(spec.flow)}` }), address: () => ad(["amount"]) },
      ],
      actions: [removeAction(`${k}/remove`, WORDS.remove, LEVEL, (hh, w) => dropFrom(spec.find(hh, w), spec.exceptions.path, id))],
    };
  };
  // 推定から入った変化は、1つの表にまとめる（何件でも。0238）: 閉じた形（要約の1行と開くボタン）から始め、開くと1年1行。
  // 割合が推定のままの年も、「この値にする」で確かめた年も、手で直した年も、同じ表の行のまま（前は確かめる・直すたびに1件ずつの枠に開いて、縦にとても長くなった）。
  // 自分で足した変化・例外の年は、今までどおり1件ずつの枠
  const input = wh.request.input as unknown as Obj;
  /** 推定のままの段階（今の額に対する割合が推定のまま） */
  const isAuto = (el: Obj): boolean => {
    if (el.amount !== undefined || el.ratio === undefined) return false;
    const row = rowAt(input, addressOf(spec.target, spec.stages, String(el.id), ["ratio"]));
    return row?.state === "estimated" && row.origin.kind === "auto";
  };
  /** 推定から入った段階（推定のままか、ID で見分けられる段階） */
  const fromEstimate = (el: Obj): boolean => isAuto(el) || spec.estimateStage?.(String(el.id)) === true;
  const inTable = stages.map((el, n) => ({ el, n })).filter((x) => fromEstimate(x.el));
  if (inTable.length > 0) {
    groups.push(
      tableGroup(
        wh,
        spec,
        inTable.map((x) => {
          const when = stageWhen(h, x.el.at, yearly);
          return { el: x.el, auto: isAuto(x.el), parts: stageParts(x.el, x.n, when !== null ? `${when}から` : fromNowOn(yearly)) };
        }),
        placeIn,
      ),
    );
  }
  for (const c of changeOrder(h, stages, exceptions)) {
    if (c.kind === "stage" && fromEstimate(c.el)) continue;
    groups.push(c.kind === "stage" ? stageGroup(c.el, c.n) : exceptGroup(c.el));
  }
  const choice = {
    key: `${spec.key}/addChange`,
    label: `＋ ${spec.what}の変化`,
    help: changeHelp({
      yearly,
      only: `、その年（1〜12月）だけ別の額にします（0円ならその年は${zeroWord(spec.flow)}）`,
      from: `、${yearly ? "その年" : "その月"}から後ずっと別の額にします（額か、今の額に対する割合で。次の変化まで何年かけて移すかも入れられます）`,
    }),
  };
  const actions: ActionDef[] = [
    {
      key: `${spec.key}/addException`,
      label: ONLY_YEAR,
      level: LEVEL,
      choice,
      run: (w) =>
        mutate(w, (hh, req) => {
          const w2 = { ...w, request: req };
          const t = spec.find(hh, w2);
          if (t === undefined) return;
          pushTo(t, spec.exceptions.path, { id: newId(), year: nextYear(w2, listAt(t, spec.exceptions.path)), amount: standardBox(0, presetBasis("その年だけ0円")) });
        }),
    },
    {
      key: `${spec.key}/addStage`,
      label: fromNowOn(yearly),
      level: LEVEL,
      choice,
      run: (w) =>
        mutate(w, (hh, req) => {
          const w2 = { ...w, request: req };
          const t = spec.find(hh, w2);
          if (t === undefined) return;
          pushTo(t, spec.stages.path, { id: newId(), at: nextStageAt(w2, listAt(t, spec.stages.path)), amount: standardBox(spec.base(hh) ?? 0, "元の額と同じ（この段階の額を入れてください）") });
        }),
    },
  ];
  groups.push({ key: `${spec.key}/staged`, level: LEVEL, ...placeIn, fields: [], actions });
  return groups;
}

/** 額の目安の書き方（「年約16.6万円」。千円に丸める） */
function yenAbout(basis: YenBasis, value: number): string {
  const yen = Math.round(value / 1000) * 1000;
  return `${basis === "monthly" ? "月" : basis === "annual" ? "年" : ""}約${formatYen(yen, yen >= 10000 ? "man" : "yen")}${yen >= 10000 ? "万円" : "円"}`;
}

/** 段階1つの欄とボタン（stagedGroups の stageParts） */
interface StageParts {
  key: string;
  id: string;
  /** 額か割合の欄の元の名前 */
  name: string;
  at: FieldDef;
  mode: FieldDef;
  value: FieldDef;
  /** 「何年かけて移すか」の欄（後に段階が続くときだけ） */
  ramp: FieldDef | null;
  remove: ActionDef;
}

/** 推定のままの行の「詳しく」に出す一言（「いつから」「何年かけて移すか」を出さない訳と、直すときの道筋） */
export const AUTO_ROW_NOTE = "推定のままの年は、「いつから」と「何年かけて移すか」を出しません（推定し直すと元に戻るため）。直すときは、先にこの年の割合を直すか「この値にする」で確かめます";

/**
 * 推定から入った変化の表（GroupDef.table。描くのは StageTable.tsx。0238）。行は1年1行で、行の欄は「2033年から」の割合（額に切り替えた年は額）。
 * 行の「詳しく」の欄は、推定のままの年は「入れ方」だけ（「いつから」「何年かけて移すか」は、推定し直すと元に戻るので出さない）、
 * 確かめた年・直した年は「いつから・入れ方・何年かけて移すか」。欄のキー・書く先は1件ずつの枠のときと同じ（見せ方だけで、世帯の値は変えない）
 */
function tableGroup(wh: WorkingHousehold, spec: StagedSpec, stageRows: readonly { el: Obj; auto: boolean; parts: StageParts }[], placeIn: { placeIn?: GroupDef["placeIn"] }): GroupDef {
  const h = wh.request.input.household;
  const yearly = spec.yearly === true;
  const years = stageRows.map((r) => resolveTimepoint(h, r.el.at as Timepoint)?.slice(0, 4)).filter((y): y is string => y !== undefined);
  const firstYear = years[0];
  const lastYear = years[years.length - 1];
  const span = firstYear === undefined || lastYear === undefined ? "" : firstYear === lastYear ? `${firstYear}年・` : `${firstYear}〜${lastYear}年・`;
  const k = `${spec.key}/autoStages`;
  const what = `${spec.autoWhat !== undefined ? `${spec.autoWhat}・` : ""}${span}${String(stageRows.length)}件`;
  const base = spec.base(h);
  /** その年からの額の目安（額で入れた年は、入れた額そのまま） */
  const endOf = (el: Obj | undefined): string | null => {
    if (el === undefined) return null;
    const when = stageWhen(h, el.at, yearly);
    if (when === null) return null;
    if (el.amount !== undefined) {
      const v = (el.amount as { value?: unknown }).value;
      return typeof v === "number" ? `${when}から ${yenAbout(spec.basis, v).replace("約", "")}` : null;
    }
    return base === null || typeof el.ratio !== "string" ? null : `${when}から ${yenAbout(spec.basis, base * Number(el.ratio))}`;
  };
  const first = endOf(stageRows[0]?.el);
  const last = stageRows.length > 1 ? endOf(stageRows[stageRows.length - 1]?.el) : null;
  const autos = stageRows.filter((r) => r.auto);
  const removeAuto =
    autos.length > 0
      ? removeAction(`${k}/remove`, `推定のままの${String(autos.length)}件を外す`, LEVEL, (hh, w) => {
          for (const r of autos) {
            dropFrom(spec.find(hh, w), spec.stages.path, r.parts.id);
            spec.onRemoveStage?.(hh, r.parts.id);
          }
        })
      : null;
  const rows: StageTableRow[] = stageRows.map((r) => ({
    id: r.parts.id,
    label: r.parts.value.label,
    value: r.parts.value,
    name: r.parts.name,
    estimated: r.auto,
    // 推定のままの年は、推定し直すたびに年と移し方が推定の形に戻るので、「いつから」「何年かけて移すか」を出さない（値はそのまま持つ）
    detail: r.auto ? [r.parts.mode] : [r.parts.at, r.parts.mode, ...(r.parts.ramp !== null ? [r.parts.ramp] : [])],
    remove: r.parts.remove,
    ramp: !r.auto && typeof r.el.rampYears === "number" ? `${String(r.el.rampYears)}年かけて移す` : null,
    note: r.auto ? AUTO_ROW_NOTE : null,
  }));
  return {
    key: k,
    title: `${spec.what}の推定の変化（${what}）`,
    note: "推定から入った変化を、年ごとの1つの表にまとめています。割合を直した後・「この値にする」で確かめた後も、表の行のまま残ります。\n行の「詳しく」を開くと、その年の入れ方を変える・その年の変化を外すことができます。確かめた年・直した年は「いつから」「何年かけて移すか」も直せます（推定のままの年は、推定し直すと元に戻るので出しません）",
    level: LEVEL,
    ...placeIn,
    // 欄の一覧（allFields）: 行の欄と、行の「詳しく」の欄（どの年の欄か分かるように、名前の頭に行の名前を添える）
    fields: rows.flatMap((r) => [r.value, ...r.detail.map((f) => ({ ...f, label: `${r.label}・${f.label}` }))]),
    actions: [...(removeAuto !== null ? [removeAuto] : []), ...rows.map((r) => r.remove)],
    table: {
      name: `${spec.what}の推定の変化`,
      what,
      ends: first === null ? null : last === null ? first : `${first} → ${last}`,
      lead: `今の${spec.what}に対する割合です（年の下は、その年からの額の目安）。直したい年だけ直します`,
      estimated: autos.length,
      rows,
      removeAuto,
    },
  };
}

/** 変化の数の札（簡易で見せる。「月額の変化 2件」。0 なら null） */
export function stagedBadge(obj: Obj | undefined, stages: readonly string[], exceptions: readonly string[], what: string): string | null {
  const n = listAt(obj, stages).length + listAt(obj, exceptions).length;
  return n === 0 ? null : `${what}の変化 ${n}件`;
}

// ---- 器の利回りと資産配分の段階 ----

type Mix = { assetClass: string; share: string }[];

/** 器の利回りの段階と例外の年（口座ごと。器の利回りの段か、資産の配分の段） */
export function returnStageGroups(wh: WorkingHousehold, o: { key: string; find: Finder; accountId: string; name: string; ageOf?: (h: Household) => Member | undefined; rate: (h: Household) => string | null }): GroupDef[] {
  const h = wh.request.input.household;
  const acc = o.find(h, wh);
  if (acc === undefined) return [];
  const target: Target = { object: o.accountId };
  const stagesPlace: ListPlace = { path: ["returnStages"], item: "account.returnStages", at: [] };
  const excPlace: ListPlace = { path: ["returnExceptions"], item: "account.returnExceptions", at: [] };
  const stages = stageOrder(h, listAt(acc, stagesPlace.path));
  const exceptions = [...listAt(acc, excPlace.path)].sort((a, b) => Number(a.year) - Number(b.year));
  const groups: GroupDef[] = [];
  const what = `${o.name}の利回り`;
  const stageGroups = (s: Obj, n: number): void => {
    const id = String(s.id);
    const k = `${o.key}/rstage/${id}`;
    const find = elementFinder(o.find, stagesPlace.path, id);
    const ad = (tail: string[]) => addressOf(target, stagesPlace, id, tail);
    const byMix = s.assetMix !== undefined;
    const fields: FieldDef[] = [
      atField({ key: k, yearly: true, ...(o.ageOf !== undefined ? { ageOf: o.ageOf } : {}) }, `${k}/at`, stagesPlace.item, find, ad(["at"])),
      {
        ...field({
          key: `${k}/mode`,
          item: stagesPlace.item,
          label: "入れ方",
          level: LEVEL,
          kind: "select",
          segmented: true,
          options: [
            { value: "rate", label: "利回りで" },
            { value: "mix", label: "資産の配分で" },
          ],
          structural: true,
          get: (w) => {
            const x = find(w.request.input.household, w);
            return { value: x === undefined ? null : x.assetMix !== undefined ? "mix" : "rate" };
          },
          set: (w, v) =>
            mutate(w, (hh) => {
              const x = find(hh, w);
              if (x === undefined) return;
              if (v === "mix") {
                delete x.expectedReturn;
                x.assetMix ??= [{ assetClass: "equity.global", share: "0.5" }, { assetClass: "bond.global", share: "0.5" }];
              } else if (v === "rate") {
                delete x.assetMix;
                x.expectedReturn ??= o.rate(hh) ?? "0.03";
              }
            }),
        }),
        address: () => ad([]),
      },
    ];
    if (!byMix) fields.push({ ...plain({ key: `${k}/rate`, item: stagesPlace.item, label: "利回り（年・この段階から）", level: LEVEL, kind: "pct", ...RETURN_RANGE, find, path: ["expectedReturn"] }), address: () => ad(["expectedReturn"]) });
    if (n < stages.length - 1) fields.push(rampField(`${k}/ramp`, stagesPlace.item, find, ad(["rampYears"])));
    groups.push({
      key: k,
      title: stageTitle(h, what, s.at, true),
      level: LEVEL,
      ...(byMix ? { note: "資産の配分の段階では、前提条件の資産の種類ごとの利回りで計算します（運用の費用はこの後に引きます）" } : {}),
      fields,
      actions: [removeAction(`${k}/remove`, WORDS.remove, LEVEL, (hh, w) => dropFrom(o.find(hh, w), stagesPlace.path, id))],
    });
    if (byMix) groups.push(mixRowsGroup(`${k}/mix`, `${stageTitle(h, what, s.at, true)}の資産の配分`, stagesPlace.item, find, ["assetMix"], ad(["assetMix"]), (s.assetMix as Mix).length));
  };
  const exceptGroup = (e: Obj): void => {
    const id = String(e.id);
    const k = `${o.key}/rexcept/${id}`;
    const find = elementFinder(o.find, excPlace.path, id);
    const ad = (tail: string[]) => addressOf(target, excPlace, id, tail);
    groups.push({
      key: k,
      title: exceptTitle(what, e.year),
      level: LEVEL,
      fields: [
        { ...plain({ key: `${k}/year`, item: excPlace.item, label: "年", level: LEVEL, kind: "int", suffix: "年", min: 1900, max: 2200, find, path: ["year"] }), address: () => ad(["year"]) },
        { ...plain({ key: `${k}/rate`, item: excPlace.item, label: "その年の利回り（年）", level: LEVEL, kind: "pct", ...RETURN_RANGE, find, path: ["expectedReturn"], help: "マイナスも入れられます（運用の費用はこの後に引きます）" }), address: () => ad(["expectedReturn"]) },
      ],
      actions: [removeAction(`${k}/remove`, WORDS.remove, LEVEL, (hh, w) => dropFrom(o.find(hh, w), excPlace.path, id))],
    });
  };
  for (const c of changeOrder(h, stages, exceptions)) {
    if (c.kind === "stage") stageGroups(c.el, c.n);
    else exceptGroup(c.el);
  }
  const choice = {
    key: `${o.key}/addReturnChange`,
    label: `＋ ${what}の変化`,
    help: changeHelp({ yearly: true, only: "、その年（1〜12月）だけ別の利回りにします（マイナスも入れられます）", from: "、その年から後ずっと別の利回りか資産の配分にします（次の変化まで何年かけて移すかも入れられます）" }),
  };
  groups.push({
    key: `${o.key}/rstaged`,
    level: LEVEL,
    fields: [],
    actions: [
      {
        key: `${o.key}/addReturnException`,
        label: ONLY_YEAR,
        level: LEVEL,
        choice,
        run: (w) =>
          mutate(w, (hh, req) => {
            const w2 = { ...w, request: req };
            const t = o.find(hh, w2);
            if (t === undefined) return;
            pushTo(t, excPlace.path, { id: newId(), year: nextYear(w2, listAt(t, excPlace.path)), expectedReturn: "0" });
          }),
      },
      {
        key: `${o.key}/addReturnStage`,
        label: fromNowOn(true),
        level: LEVEL,
        choice,
        run: (w) =>
          mutate(w, (hh, req) => {
            const w2 = { ...w, request: req };
            const t = o.find(hh, w2);
            if (t === undefined) return;
            pushTo(t, stagesPlace.path, { id: newId(), at: nextStageAt(w2, listAt(t, stagesPlace.path)), expectedReturn: o.rate(hh) ?? "0.03" });
          }),
      },
    ],
  });
  return groups;
}

/** 段の中の資産の配分の行（ID を持たない並び。0035 の5 で、入力項目の値の全体を差分の1件で変える） */
function mixRowsGroup(key: string, title: string, item: string, findOwner: Finder, mixPath: readonly string[], address: Address, rows: number): GroupDef {
  const mixOf = (o: Obj | undefined) => getPath(o, mixPath) as Mix | undefined;
  const mixField = (j: number, what: "assetClass" | "share", label: string, kind: "select" | "pct"): FieldDef => ({
    ...plain({
      key: `${key}/${j}/${what}`,
      item,
      label,
      level: LEVEL,
      kind,
      ...(kind === "select" ? { options: ASSET_CLASSES } : {}),
      find: (h, w) => (getPath(findOwner(h, w), [...mixPath, String(j)]) as Obj | undefined) ?? undefined,
      path: [what],
    }),
    address: () => address,
  });
  const fields: FieldDef[] = [];
  for (let j = 0; j < rows; j++) fields.push(mixField(j, "assetClass", `資産の種類 ${j + 1}`, "select"), mixField(j, "share", `割合 ${j + 1}`, "pct"));
  return {
    key,
    title,
    level: LEVEL,
    note: "割合の合計を1（100%）にします",
    fields,
    actions: [
      { key: `${key}/addRow`, label: "＋ 資産の種類", level: LEVEL, run: (w) => mutate(w, (h, req) => void mixOf(findOwner(h, { ...w, request: req }))?.push({ assetClass: "cash.deposit", share: "0" })) },
      ...(rows > 1
        ? [
            {
              key: `${key}/removeRow`,
              label: "最後の資産の種類を外す",
              level: LEVEL,
              danger: true,
              run: (w: WorkingHousehold) =>
                mutate(w, (h, req) => {
                  const m = mixOf(findOwner(h, { ...w, request: req }));
                  if (m !== undefined && m.length > 1) m.pop();
                }),
            },
          ]
        : []),
    ],
  };
}

/** 資産配分の入れ方の、共通の配分の段階（前提 assumptions.investment.allocation.stages） */
export function allocationStageGroups(wh: WorkingHousehold, o: { ageOf?: (h: Household) => Member | undefined }): GroupDef[] {
  const inv = (wh.request.input as unknown as { assumptions: { investment?: { allocation?: { mix: Mix; stages?: Obj[] } } } }).assumptions.investment;
  const alloc = inv?.allocation;
  if (alloc === undefined) return [];
  // 前提の中の物（世帯の外）。書くときは複製した要求（w.request）から探す
  const findAlloc: Finder = (_h, w) => getPath((w.request.input as unknown as { assumptions: Obj }).assumptions, ["investment", "allocation"]) as Obj | undefined;
  const target: Target = { plan: "assumptions" };
  const place: ListPlace = { path: ["stages"], item: "assumptions.investment", at: ["allocation", "stages"] };
  const h = wh.request.input.household;
  const stages = stageOrder(h, alloc.stages ?? []);
  const groups: GroupDef[] = [];
  stages.forEach((s, n) => {
    const id = String(s.id);
    const k = `sav/alloc/stage/${id}`;
    const find = elementFinder(findAlloc, place.path, id);
    const ad = (tail: string[]) => addressOf(target, place, id, tail);
    const fields: FieldDef[] = [atField({ key: k, yearly: true, ...(o.ageOf !== undefined ? { ageOf: o.ageOf } : {}) }, `${k}/at`, place.item, find, ad(["at"]))];
    if (n < stages.length - 1) fields.push(rampField(`${k}/ramp`, place.item, find, ad(["rampYears"])));
    groups.push({
      key: k,
      title: `資産配分の段階 ${n + 1}`,
      level: LEVEL,
      fields,
      actions: [{ key: `${k}/remove`, label: "この段階を外す", level: LEVEL, danger: true, run: (w) => mutate(w, (hh, req) => dropFrom(findAlloc(hh, { ...w, request: req }), place.path, id)) }],
    });
    groups.push(mixRowsGroup(`${k}/mix`, `資産配分の段階 ${n + 1} の割合`, place.item, find, ["mix"], ad(["mix"]), (s.mix as Mix).length));
  });
  groups.push({
    key: "sav/alloc/staged",
    level: LEVEL,
    note: stages.length === 0 ? "年齢・時期で資産の割合を変えるとき（「55歳から株を減らす」など）は、資産配分の段階を足します。段階の時点の年から、運用する口座すべてで使います" : `資産配分 ${stages.length}段階`,
    fields: [],
    actions: [
      {
        key: "sav/alloc/addStage",
        label: "＋ 資産配分の段階",
        level: LEVEL,
        run: (w) =>
          mutate(w, (_h, req) => {
            const a = getPath((req.input as unknown as { assumptions: Obj }).assumptions, ["investment", "allocation"]) as { mix: Mix; stages?: Obj[] } | undefined;
            if (a === undefined) return;
            (a.stages ??= []).push({ id: newId(), at: nextStageAt({ ...w, request: req }, a.stages), mix: structuredClone(a.mix) });
          }),
      },
    ],
  });
  return groups;
}
