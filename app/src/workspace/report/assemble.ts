// 提案書の PDF の材料を作る（作業の層）: 主画面の案（現状・帯の案・保存していない変更）と表示の設定から、帳票に要る計算の要求を並べ、
// 本体の正の計算（0005 の2。画面側の先出しの結果は使わない）の結果から ProposalBundle を組み立て、report/ の部品で帳票の入力にする。
// - 「現状」はいつも A案（入力の値）。「提案」は FP が選んだ帯の案（既定は主画面で選んでいる案）
// - 目標の年齢は表示の設定の「○歳時点」、比較のページの基準は主画面の基準の案（主画面の比較の表と同じ数字）
// - バランスシートの図の時点は、資産と負債のタブで並べている時点（表示の設定。この世帯で選んだ時点か既定の時点）を、提案のプランの年に解いたもの
//   （候補の鍵はそのプランの年。退職の年が違うプランなら、そのプランの退職の年）。画面の図と提案書の図を同じ時点にする（0027）
// - 会社と合わせたバランスシート（法人経営者向けの機能。0107）: 章を選んだときだけ、世帯の会社の入力と現状の今の年の家計のバランスシートを材料に入れる
// - 宛名は材料に入れない（本体が出力の PDF に重ねるだけ。0009 の3・0012）
// - 推定の値: 提案書には「一部は統計の平均で補っています」とだけ書く。どの欄が推定かは FP 向けの画面（提案書のタブ・入力のカード）だけで示す
// - 収益不動産のまとめ（0082）: 章を載せるときだけ、提案の世帯の物件ごとに、売る年だけを変えた写しの要求（report/src/rentalSale.ts の
//   saleVariants のうち今の予定でないもの。鍵は rentalSale:<物の ID>:<売り方の鍵>）を足す。今の予定の売り方は提案の計算を使う
import { buildProposalInput, CHAPTERS, DEFAULT_LAYOUT, isExtChapterId, saleVariantRequest, saleVariants, type ChapterId, type ProposalBundle, type ProposalInput, type ReportLayout, type Run, type SaleVariant } from "../../../../report/src/index.ts";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { withoutDreams } from "../../engine/moneyRows.ts";
import { adults, baseRequest, defaultYear, occursMonth, scenarioRequest, scenarios, survivorOf } from "../contingency/requests.ts";
import { premiseFor } from "../contingency/planPremise.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { inputItems } from "../input/items.ts";
import { hasAdvisoryFee } from "../levers.ts";
import { CURRENT } from "../plans/band.ts";
import type { Catalog } from "../plans/items.ts";
import { applyValues, changesOfValues, type Values } from "../plans/plans.ts";
import { METHODS, methodOf } from "../input/savings/model.ts";
import { rentalProperties } from "../input/stages/rental.ts";
import { resolveColumns } from "../../presentation/bsColumns.ts";
import type { BsColumn, BsPointKey, MoneyThreeSettings } from "../../presentation/model.ts";
import { BS_POINT_CHOICES, bsPlan, DEFAULT_BS_POINTS } from "../balanceTab.ts";
import { bandOf, donutYear, drawdownText, stressLabel, stressRequests, STRESS_KEYS } from "../invest/present.ts";
import { displayYears } from "../present.ts";
import { ageInYear, roles } from "../roles.ts";
import { chapterIdsOf, chapterMaterials, extensionChapters } from "../extensions/run.ts";
import { OFFICIAL_EXTENSIONS } from "../extensions/official.ts";
import type { LoadedExtension } from "../extensions/manifest.ts";

/** 最初に選んでおく章（公式の章のすべてと、同梱の束の章。束の章は今使えるときだけ一覧に出る。0114 の6） */
export const DEFAULT_CHAPTERS: readonly ChapterId[] = [...CHAPTERS.map((c) => c.id), ...extensionChapters(OFFICIAL_EXTENSIONS).map((c) => c.id)];

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
  /** 資産と負債のタブで時点を並べるときの既定の時点（表示の設定。省略は今・退職の年・75歳） */
  bsPoints?: readonly BsPointKey[];
  /** この世帯で選んだ並べる時点（表示の設定。null・省略は既定のまま） */
  bsColumns?: readonly BsColumn[] | null;
  /** お金の3つの分け方の何か月分・何年先まで・呼び方（資産と負債のタブの表示の設定。省略は既定。0032） */
  moneyThree?: MoneyThreeSettings;
}

/**
 * バランスシートの図の時点（資産と負債のタブの「時点を並べる」と同じ時点）を、そのプランの年に解く。
 * 候補の名前（今・退職の年・75歳 …）と年。年を直に選んだ時点は名前なし。同じ年は1つ
 */
export function balancePointsOf(req: EngineRequest, result: PreviewResult, columns: readonly BsColumn[] | null, defaults: readonly BsPointKey[]): { year: number; name: string | null }[] {
  const plan = bsPlan({ key: "report", letter: "", name: "", title: "", base: false, req, table: result.table });
  const out: { year: number; name: string | null }[] = [];
  for (const c of resolveColumns(plan, columns, defaults)) {
    const y = plan.years[c.index];
    if (y === undefined || out.some((o) => o.year === y.year)) continue;
    out.push({ year: y.year, name: c.point === null ? null : (BS_POINT_CHOICES.find((x) => x.key === c.point)?.label ?? null) });
  }
  return out;
}

export { DEFAULT_LAYOUT };

export interface ReportContext {
  wh: WorkingHousehold;
  catalog: Catalog;
  /** 案の今の中身（保存していない変更を含む。主画面と同じ） */
  valuesOf: (id: string) => Values;
  /** 帯の文字と名前 */
  letterOf: (id: string) => { letter: string; name: string };
  /** 今使える拡張の束（提案書の拡張の章の材料を作る。0114 の6。省略は無し） */
  extensions?: readonly LoadedExtension[];
  /** そのうち、見本の世帯でだけ見せている束の id（その束の章に見本の印を付ける。0197。省略は無し） */
  sampleExtensions?: ReadonlySet<string>;
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
  // 「今の契約だけ」（値が null・入れていない）は、現状の「現状にも入れる」の契約を入れている（0177）
  const feeOn = values["lever:fee"] === true || (values["lever:fee"] !== false && (current.input.household.advisoryFees ?? []).some((c) => c.enabled !== false));
  if (on.has("changes") && hasAdvisoryFee(current) && feeOn) requests.withoutFee = applyValues(wh, { ...values, "lever:fee": false }, cat);
  // ご家族の夢の要約の1文: 夢を全部外した提案（計算に入れた夢があるときだけ。0103）
  if (on.has("dreams")) {
    const nd = withoutDreams(proposal);
    if (nd !== proposal) requests.withoutDreams = nd;
  }

  // 万一: 提案の世帯で、大人ごとの死亡（遺族がいるとき）を計算基準年の翌年に。必要保障額は大人をまとめて1つの要求で。
  // 前提は提案のプランの前提（共通の前提にそのプランの上書きを当てたもの。万一のタブでそのプランを見たときと同じ。0071・0168）
  const premise = premiseFor(wh, choice.proposal);
  const whP: WorkingHousehold = { ...wh, contingency: premise, request: proposal };
  const deaths = on.has("contingency") ? scenarios(whP).filter((s) => s.kind === "death") : [];
  const year = defaultYear(proposal);
  deaths.forEach((s, i) => (requests[`death${i}`] = scenarioRequest(whP, s, year)));
  const grown = adults(proposal.input.household).map((a) => a.member.id);
  if (on.has("contingency") && grown.length > 0 && deaths.length > 0) {
    const p = baseRequest(proposal);
    const s = survivorOf(premise.survivor);
    // 出し方も、そのプランの前提（万一のタブで逆算の方式を選んだプランは逆算の方式。0168 の追記）
    const how = premise.protection?.method === "reverse" ? { method: "reverse" as const, ...(premise.protection.reverseUntilAge !== undefined ? { reverseUntilAge: premise.protection.reverseUntilAge } : {}) } : { method: "accumulation" as const };
    p.input.protection = { members: grown, ...how, ...(s !== undefined ? { survivor: s } : {}), ...(premise.horizon !== undefined ? { horizon: { ...premise.horizon } } : {}) };
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

  // 資産運用の計画・相場が下がった場合（0026）: 金融資産の器があるときだけ。相場が下がった場合は提案に3つの型を重ねた計算
  const invested = (proposal.input.household.accounts ?? []).some((a) => a.kind !== "realEstate" && a.kind !== "otherAsset" && a.kind !== "insurance");
  const investOn = invested && (on.has("investment") || on.has("marketDrop"));
  if (invested && on.has("marketDrop")) {
    const sr = stressRequests(proposal);
    for (const k of STRESS_KEYS) requests[`stress:${k}`] = sr[k];
  }

  // 比較のページ（現状と帯の案。2列以上のときだけ）
  const compare = on.has("comparison") ? choice.compare.filter((id, i, a) => a.indexOf(id) === i).slice(0, 6) : [];
  if (compare.length >= 2) for (const id of compare) if (id !== CURRENT && id !== choice.proposal) requests[`plan:${id}`] = applyValues(wh, ctx.valuesOf(id), cat);

  // 収益不動産のまとめ: 物件ごとの売る年を変えた比べ（今の予定は提案の計算）
  type ReportRequest = Parameters<typeof saleVariants>[0];
  const rentalSale: { object: string; variants: { variant: SaleVariant; key: string | null }[] }[] = [];
  if (on.has("rental")) {
    const r = proposal as unknown as ReportRequest;
    for (const a of rentalProperties(proposal.input.household)) {
      const variants = saleVariants(r, a.id);
      if (variants.length === 0) continue;
      rentalSale.push({
        object: a.id,
        variants: variants.map((v) => {
          if (v.current) return { variant: v, key: null };
          const key = `rentalSale:${a.id}:${v.key}`;
          requests[key] = saleVariantRequest(r, a.id, v) as unknown as EngineRequest;
          return { variant: v, key };
        }),
      });
    }
  }

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
    if (choice.moneyThree !== undefined) b.moneyThree = { ...choice.moneyThree };
    // 提案書の拡張の章（0114 の6。合算BS など）: 今使える束の章を選んだときだけ、束の関数（report.chapter）で材料を作る。材料の無い章は持たない。
    // 家計の側は資産と負債のタブと同じ（現状の今の年）
    if ((ctx.extensions ?? []).length > 0 && [...on].some(isExtChapterId)) {
      const home = bsPlan({ key: "current", letter: "", name: "", title: "", base: true, req: current, table: (results.current as PreviewResult).table }).years[0];
      const ext = chapterMaterials(ctx.extensions ?? [], wh.extValues, home, on);
      if (Object.keys(ext).length > 0) b.extensions = ext;
      // 見本の世帯でだけ載せる章（コードが無くても見本として載せた章。帳票が「見本」の印を付ける。0197）
      const samples = chapterIdsOf(ctx.extensions ?? [], ctx.sampleExtensions ?? new Set()).filter((id) => ext[id] !== undefined);
      if (samples.length > 0) b.extensionSamples = samples;
    }
    if (on.has("cashflow")) b.balancePoints = balancePointsOf(proposal, results.proposal as PreviewResult, choice.bsColumns ?? null, choice.bsPoints ?? DEFAULT_BS_POINTS);
    if (steps.length > 0) b.steps = steps.map((s, i) => ({ label: s.label, investment: s.investment, run: i === steps.length - 1 ? proposalRun : run(s.key) }));
    if (requests.withoutFee !== undefined) b.proposalWithoutFee = run("withoutFee");
    if (requests.withoutDreams !== undefined) b.proposalWithoutDreams = run("withoutDreams");
    if (deaths.length > 0) {
      const occurs = occursMonth(proposal, year);
      b.contingencies = deaths.map((s, i) => ({ title: `${s.who}が${ymText(occurs)}に亡くなった場合`, run: run(`death${i}`) }));
    }
    if (requests.protection !== undefined) b.protection = run("protection");
    if (deferral !== null) {
      const now = typeof values["lever:pensionAge"] === "number" ? (values["lever:pensionAge"] as number) : (pensionItem?.read(wh) as number);
      b.deferral = { memberKey: "self", options: deferral.ages.map((age) => ({ startAge: age, run: age === now ? proposalRun : run(`defer${age}`) })) };
    }
    if (investOn) {
      const years = displayYears(proposal);
      const self = roles(proposal).find((r) => r.key === "self");
      const band = bandOf(proposal, years.map((y) => (self === undefined ? null : ageInYear(self.member, y))));
      const yearAt = (i: number | null) => (i === null ? null : (years[i] ?? null));
      b.investment = {
        method: METHODS.find((m) => m.id === methodOf(proposal))?.label ?? "口座",
        condition: drawdownText(proposal),
        periods: {
          accumText: band?.accumText ?? "",
          holdText: band?.holdText ?? "",
          holdSub: band?.holdSub ?? "",
          wdText: band?.wdText ?? "",
          wdSub: band?.wdSub ?? "",
          accumEnd: band === null ? null : yearAt(band.accumEnd),
          wdStart: band === null ? null : yearAt(band.wdStart),
          steps: (band?.steps ?? []).flatMap((x) => (years[x.at] === undefined ? [] : [{ year: years[x.at] as number, label: x.label }])),
          estimated: band?.estimated ?? false,
        },
        donutYear: donutYear(proposal, years),
        ...(on.has("marketDrop") ? { stress: STRESS_KEYS.map((k) => ({ label: stressLabel(proposal, k), run: run(`stress:${k}`) })) } : {}),
      };
    }
    if (rentalSale.length > 0) b.rentalSale = rentalSale.map((x) => ({ object: x.object, variants: x.variants.map((v) => ({ variant: v.variant, run: v.key === null ? proposalRun : run(v.key) })) }));
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
