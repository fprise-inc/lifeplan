// 提案書の PDF の材料を作る（作業の層）: 主画面の案（現状・帯の案・保存していない変更）と表示の設定から、帳票に要る計算の要求を並べ、
// 本体の正の計算（0005 の2。画面側の先出しの結果は使わない）の結果から ProposalBundle を組み立て、report/ の部品で帳票の入力にする。
// - 「現状」はいつも A案（入力の値）。「提案」は FP が選んだ帯の案（既定は主画面で選んでいる案）
// - 目標の年齢は表示の設定の「○歳時点」、比較のページの基準は主画面の基準の案（主画面の比較の表と同じ数字）
// - 宛名は材料に入れない（本体が出力の PDF に重ねるだけ。0009 の3・0012）
// - 推定の値: 提案書には「一部は統計の平均で補っています」とだけ書く。どの欄が推定かは FP 向けの画面（提案書のタブ・入力のカード）だけで示す
import { buildProposalInput, CHAPTERS, DEFAULT_LAYOUT, type ChapterId, type ProposalBundle, type ProposalInput, type ReportLayout, type Run } from "../../../../report/src/index.ts";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { adults, baseRequest, defaultYear, occursMonth, scenarioRequest, scenarios, survivorOf } from "../contingency/requests.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { inputItems } from "../input/items.ts";
import { hasAdvisoryFee } from "../levers.ts";
import { CURRENT } from "../plans/band.ts";
import type { Catalog } from "../plans/items.ts";
import { applyValues, changesOfValues, type Values } from "../plans/plans.ts";

export const DEFAULT_CHAPTERS: readonly ChapterId[] = CHAPTERS.map((c) => c.id);

export interface ReportChoice {
  /** 提案にする案（帯の案の ID。現状は選べない） */
  proposal: string;
  /** 比較のページに載せる枠（現状 CURRENT と案の ID。帯の並び） */
  compare: string[];
  /** 比較の基準（主画面の基準の案） */
  base: string;
  chapters: readonly ChapterId[];
  /** 目標の年齢（表示の設定の「○歳時点」） */
  targetAge: number;
  /** 作成日（YYYY-MM-DD） */
  issuedOn: string;
  /** 担当（FP・事務所の表示名。任意。保存しない） */
  preparedBy: string;
  /** 帳票の組み方（紙の向き・キャッシュフロー表の載せ方。省略は標準） */
  layout?: ReportLayout;
}

export { DEFAULT_LAYOUT };

export interface ReportContext {
  wh: WorkingHousehold;
  catalog: Catalog;
  /** 案の今の中身（保存していない変更を含む。主画面と同じ） */
  valuesOf: (id: string) => Values;
  /** 帯の文字と名前 */
  letterOf: (id: string) => { letter: string; name: string };
}

/** 運用の前提の変更（打ち手ごとの効果で最後にまとめ、「運用の前提の変更を除いた効果」を出す） */
export const isInvestmentKey = (k: string): boolean => k.startsWith("mix:") || /^field:assume\/(investmentReturn|assetReturns)/.test(k);

interface Plan {
  /** 計算の要求（枠の名前 → 要求） */
  requests: Record<string, EngineRequest>;
  /** 正の計算の結果から ProposalBundle を作る */
  bundle: (results: Readonly<Record<string, PreviewResult>>) => ProposalBundle;
}

const ymText = (s: string) => `${Number(s.slice(0, 4))}年${Number(s.slice(5, 7))}月`;

/** 打ち手を1件ずつ足す順: ふつうの打ち手（項目の一覧の順）→ FP顧問料 → 運用の前提の変更 */
function stepOrder(values: Values, cat: Catalog): string[] {
  const keys = cat.items.map((it) => it.key).filter((k) => Object.hasOwn(values, k));
  const rank = (k: string) => (isInvestmentKey(k) ? 2 : k === "lever:fee" ? 1 : 0);
  return keys.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).map((x) => x.k);
}

/** 提案書に要る計算の要求と、結果から材料を組み立てる関数 */
export function planReport(ctx: ReportContext, choice: ReportChoice): Plan {
  const { wh, catalog: cat } = ctx;
  if (choice.proposal === CURRENT) throw new Error("E_REPORT_NO_PROPOSAL");
  const on = new Set(choice.chapters);
  const values = ctx.valuesOf(choice.proposal);
  const current = wh.request;
  const proposal = applyValues(wh, values, cat);
  const requests: Record<string, EngineRequest> = { current, proposal };

  // 変更点: 変える内容・打ち手ごとの効果・FP顧問料を除いた提案
  const changes = changesOfValues(values, wh, cat);
  const stepKeys = on.has("changes") ? stepOrder(values, cat).filter((k) => changes.some((c) => c.key === k)) : [];
  const steps: { key: string; label: string; investment: boolean }[] = [];
  const acc: Values = {};
  stepKeys.forEach((k, i) => {
    acc[k] = values[k] ?? null;
    const row = changes.find((c) => c.key === k);
    steps.push({ key: `step${i}`, label: row !== undefined ? `${row.label}（${row.from}→${row.to}）` : k, investment: isInvestmentKey(k) });
    // 最後の打ち手は提案と同じ要求（計算し直さない）
    if (i < stepKeys.length - 1) requests[`step${i}`] = applyValues(wh, { ...acc }, cat);
  });
  const feeOn = values["lever:fee"] === true || (values["lever:fee"] === undefined && (current.input.household.advisoryFees ?? []).some((c) => c.enabled !== false));
  if (on.has("changes") && hasAdvisoryFee(current) && feeOn) requests.withoutFee = applyValues(wh, { ...values, "lever:fee": false }, cat);

  // 万一: 提案の世帯で、大人ごとの死亡（遺族がいるとき）を計算基準年の翌年に。必要保障額は大人をまとめて1つの要求で
  const whP: WorkingHousehold = { ...wh, request: proposal };
  const deaths = on.has("contingency") ? scenarios(whP).filter((s) => s.kind === "death") : [];
  const year = defaultYear(proposal);
  deaths.forEach((s, i) => (requests[`death${i}`] = scenarioRequest(whP, s, year)));
  const grown = adults(proposal.input.household).map((a) => a.member.id);
  if (on.has("contingency") && grown.length > 0 && deaths.length > 0) {
    const p = baseRequest(proposal);
    const s = survivorOf(wh.contingency.survivor);
    p.input.protection = { members: grown, method: "accumulation", ...(s !== undefined ? { survivor: s } : {}), ...(wh.contingency.horizon !== undefined ? { horizon: { ...wh.contingency.horizon } } : {}) };
    requests.protection = p;
  }

  // 年金の受け取り開始の比較（本人。提案の年齢と、65歳・70歳のもう一方）
  const pensionItem = cat.byKey.get("lever:pensionAge");
  let deferral: { ages: number[] } | null = null;
  if (on.has("retirement") && pensionItem !== undefined) {
    const v = values["lever:pensionAge"];
    const now = typeof v === "number" ? v : (pensionItem.read(wh) as number | null);
    if (typeof now === "number") {
      const other = now < 70 ? 70 : 65;
      deferral = { ages: [now, other].sort((a, b) => a - b) };
      requests[`defer${other}`] = applyValues(wh, { ...values, "lever:pensionAge": other }, cat);
    }
  }

  // 比較のページ（現状と帯の案。2列以上のときだけ）
  const compare = on.has("comparison") ? choice.compare.filter((id, i, a) => a.indexOf(id) === i).slice(0, 6) : [];
  if (compare.length >= 2) for (const id of compare) if (id !== CURRENT && id !== choice.proposal) requests[`plan:${id}`] = applyValues(wh, ctx.valuesOf(id), cat);

  const bundle = (results: Readonly<Record<string, PreviewResult>>): ProposalBundle => {
    const run = (key: string): Run => {
      const r = results[key];
      if (r === undefined) throw new Error(`E_REPORT_MISSING:${key}`);
      return { request: requests[key], result: r } as unknown as Run;
    };
    const proposalRun = run("proposal");
    const b: ProposalBundle = {
      document: { issuedOn: choice.issuedOn, preparedBy: choice.preparedBy.trim() === "" ? null : choice.preparedBy.trim() },
      current: run("current"),
      proposal: proposalRun,
      targetAge: choice.targetAge,
      chapters: [...choice.chapters],
      layout: choice.layout ?? DEFAULT_LAYOUT,
      changes: changes.map((c) => ({ label: c.label, current: c.from, proposal: c.to })),
      estimated: estimatedCards(wh).length > 0,
    };
    if (steps.length > 0) b.steps = steps.map((s, i) => ({ label: s.label, investment: s.investment, run: i === steps.length - 1 ? proposalRun : run(s.key) }));
    if (requests.withoutFee !== undefined) b.proposalWithoutFee = run("withoutFee");
    if (deaths.length > 0) {
      const occurs = occursMonth(proposal, year);
      b.contingencies = deaths.map((s, i) => ({ title: `${s.who}が${ymText(occurs)}に亡くなった場合`, run: run(`death${i}`) }));
    }
    if (requests.protection !== undefined) b.protection = run("protection");
    if (deferral !== null) {
      const now = typeof values["lever:pensionAge"] === "number" ? (values["lever:pensionAge"] as number) : (pensionItem?.read(wh) as number);
      b.deferral = { memberKey: "self", options: deferral.ages.map((age) => ({ startAge: age, run: age === now ? proposalRun : run(`defer${age}`) })) };
    }
    if (compare.length >= 2) {
      b.comparison = {
        base: Math.max(0, compare.indexOf(choice.base)),
        plans: compare.map((id) => {
          const l = ctx.letterOf(id);
          return { letter: l.letter, name: l.name, run: id === CURRENT ? run("current") : id === choice.proposal ? proposalRun : run(`plan:${id}`) };
        }),
      };
    }
    return b;
  };
  return { requests, bundle };
}

/** 推定・仮の値の欄が残っている入力のカード（FP 向けの画面だけに出す。提案書には欄を書かない） */
export function estimatedCards(wh: WorkingHousehold): { label: string; count: number }[] {
  return inputItems(wh)
    .filter((i) => i.estimated > 0)
    .map((i) => ({ label: i.label, count: i.estimated }));
}

/** 材料から帳票の入力（JSON）を作る */
export function reportInput(bundle: ProposalBundle): ProposalInput {
  return buildProposalInput(bundle);
}

/** 今日（YYYY-MM-DD。画面の時計。帳票の作成日） */
export function today(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
