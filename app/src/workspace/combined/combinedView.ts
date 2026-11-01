// 会社と合わせたバランスシート（合算BS。法人の顧問向けの機能。0107）の見るもの（作業の層）。
// - 事務所の設定で「合算BS」を使うと決め、役員として働く人がいる世帯のときだけ、資産と負債のタブの見るもの（customViews。0027 の8）に足す
// - 値を作るのは report/src/combinedBs.ts の部品（提案書の章と同じ）。ここは BsCustomViewModel（提示用の値）と宣言型の入力欄にするだけ
// - 入力（会社の今のバランスシート・毎月の固定の支出・会社の段階・実力に直した額）は世帯ファイルの household.companyBs（計算の要求の外）
// - 副作用のない関数だけ: 後でカスタム層（0016）の計算部品に移すときは、この入出力のまま差し込み口に載せる
import { combinedBs, COMPANY_ASSETS, COMPANY_EQUITY, COMPANY_LIABILITIES, COMPANY_MONTHLY, COMPANY_STAGES, EMPTY_COMBINED_INPUT, hasCompanyAmounts, isEmptyCombinedInput, RESTATE_ITEMS, COMBINED_YEN_MAX, type CombinedBsInput, type CombinedColumn, type CombinedHousehold, type CompanyKey, type CompanyStage, type RestateKey } from "../../../../report/src/index.ts";
import type { BsCustomColumn, BsCustomField, BsCustomSection, BsCustomViewModel, BsYearModel, Yen } from "../../presentation/model.ts";
import { man } from "../../presentation/format.ts";

/** 見るものの鍵（#bsopen=combined で開く） */
export const COMBINED_VIEW_KEY = "combined";

const mn = (v: number) => `${man(v)}万円`;

/** 円 → 欄の文字（万円。端数は小数第2位まで） */
export function yenToManText(v: number | undefined | null): string {
  if (v === undefined || v === null) return "";
  return String(Number((v / 10000).toFixed(2)));
}

/** 欄の文字（万円）→ 円。空は null、読めない・範囲の外は undefined */
export function manTextToYen(text: string, negative = false): number | null | undefined {
  const t = text
    .trim()
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，、]/g, "")
    .replace(/万円?$/, "")
    .replace(/^[▲△−ー－]/, "-");
  if (t === "") return null;
  if (!/^-?\d{1,9}(\.\d{1,4})?$/.test(t)) return undefined;
  const v = Math.round(Number(t) * 10000);
  if (!negative && v < 0) return undefined;
  return Math.abs(v) <= COMBINED_YEN_MAX ? v : undefined;
}

/** 資産と負債のタブの今の年（BsYearModel）を、合算の部品の家計の側にする（提案書の材料も同じ） */
export function homeOf(y: BsYearModel): CombinedHousehold {
  return {
    at: { year: y.year, lines: y.lines.map((l) => ({ key: l.key, label: l.label, group: l.group, amount: l.amount })), totalAssets: y.totalAssets, totalLiabilities: y.totalLiabilities, netWorth: y.netWorth, financial: y.financial, shortfall: y.shortfall },
    monthly: Math.round((y.living + y.loanPay) / 12),
    guarantee: y.guarantee,
  };
}

/** 合算の1枚を BsYearModel の形にする（今の年の事実として描く） */
function yearOf(c: CombinedColumn): BsYearModel {
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

const col = (c: CombinedColumn, sub?: string): BsCustomColumn => ({ name: c.name, at: yearOf(c), ...(sub !== undefined ? { sub } : {}) });

/** 会社の科目の欄 */
function amountField(k: CompanyKey, label: string, input: CombinedBsInput, help?: string): BsCustomField {
  return { id: `amount:${k}`, label, kind: "yen", unit: "万円", value: yenToManText(input.amounts[k]), ...(k === "retained" ? { negative: true } : {}), ...(help !== undefined ? { help } : {}) };
}

const HELP: Partial<Record<CompanyKey, string>> = {
  loanFromOwner: "試算表の役員借入金など（経営者から会社が借りているお金）",
  loanToOwner: "試算表の役員貸付金など",
  advanceToOwner: "会社が経営者のために立て替えた額",
  otherCapital: "経営者のほかに出資している人がいるときだけ",
  retained: "マイナス（▲）も入ります",
  monthlyLoanPay: "金融機関への元金と利息の返済",
};

/**
 * 合算BS の見るもの。input は世帯ファイルの入力（無ければ null）、home は資産と負債のタブの現状のプランの今の年。
 * 会社の数字が無ければ、入力欄を開いた形で、図の代わりに案内の文を出す
 */
export function combinedBsView(input: CombinedBsInput | null, home: BsYearModel): BsCustomViewModel {
  const c = input ?? EMPTY_COMBINED_INPUT;
  const h = homeOf(home);
  const form = combinedForm(c, h.monthly);
  const base: Omit<BsCustomViewModel, "columns" | "note"> = {
    key: COMBINED_VIEW_KEY,
    label: "合算BS（会社と合わせる）",
    lead: "経営者個人（家計）と会社のバランスシートを並べ、間の貸し借りを相殺して1枚にします。会社の数字は試算表から入れ、先の年の見込みは作りません。家計の計算の結果は変わりません。",
    groups: {
      liquid: { name: "現預金・すぐ使えるお金", short: "現預金" },
      illiquid: { name: "そのほかの資産（換金しにくいもの）", short: "そのほかの資産" },
      debt: { name: "借入金など", short: "借入金など" },
    },
  };
  if (!hasCompanyAmounts(c)) {
    return { ...base, columns: [], note: "", empty: "会社のバランスシートの数字（試算表の主な科目）を入れると、2枚を並べて合算します。", form: { ...form, open: true } };
  }
  const r = combinedBs(c, h);
  const asOf = r.asOfLabel ?? "基準日の入力なし";
  const ownerSub = `${home.year}年末（今の年。入力した値から）`;
  const coSub = `試算表（${asOf}）`;
  const steps: NonNullable<BsCustomViewModel["steps"]> = [
    { key: "side", label: "① 2枚を並べる", columns: [col(r.side[0], ownerSub), col(r.side[1], coSub)], note: "左が経営者個人（家計）、右が会社のバランスシートです。金融機関が融資のときに見るのも、まずこの2枚を並べた形です。" },
    { key: "netted", label: "② 貸し借りを相殺する", columns: [col(r.netted[0], ownerSub), col(r.netted[1], coSub)], note: "経営者と会社の間の貸し借り（下の4つの組）を、両側から消しました。相殺しても、合わせた財産の合計は変わりません。" },
    { key: "combined", label: "③ 足して1枚にする", columns: [col(r.side[0], ownerSub), col(r.side[1], coSub), col(r.combined, "相殺してから科目ごとに足した1枚")], note: "右の1枚が合算です。純資産は、会社の財産（剰余金）と個人の財産に分けて見ます。資本金は財産に数えません。" },
  ];
  const sections: BsCustomSection[] = [];
  sections.push({
    key: "pairs",
    title: "相殺した4つの組",
    note: "両側の額が合わないときは、会社の側の額に合わせて見ています（経営者の側の書き漏れとして直す考え方）。",
    table: {
      head: ["組", "経営者の側", "会社の側", ""],
      rows: r.pairs.map((p) => ({ cells: [p.label, `${p.ownerLabel} ${mn(p.owner)}`, `${p.companyLabel} ${mn(p.company)}`, Math.round(p.owner / 10000) === Math.round(p.company / 10000) ? (p.owner === 0 ? "なし" : "合っています") : `差 ${mn(Math.abs(p.owner - p.company))}`], ...(p.owner === 0 && p.company === 0 ? { tone: "muted" as const } : {}) })),
    },
  });
  sections.push({
    key: "net",
    title: "合算の純資産の内訳",
    table: {
      head: ["", "金額"],
      rows: [
        { cells: ["会社の財産（剰余金）", mn(r.netWorth.company)] },
        ...(r.netWorth.others !== 0 ? [{ cells: ["ほかの株主の出資", mn(r.netWorth.others)] }] : []),
        { cells: ["個人の財産", mn(r.netWorth.owner)] },
        { cells: ["合算の純資産", mn(r.netWorth.total)], tone: "total" as const },
      ],
    },
    ...(r.netWorth.total < 0 ? { note: "合算した資産より負債が多い状態です。会社と個人のどちらの側から整えるかを、一緒に確かめましょう。" } : {}),
  });
  sections.push({
    key: "months",
    title: "現預金は毎月の固定の支出の何か月分か",
    note: "目安は6か月分、できれば12か月分。会社の固定の支出は固定費（仕入は含めない）＋借入の返済、個人は生活費＋ローン返済（家賃収入で返す不動産のローンは除く）です。",
    table: {
      head: ["", "現預金", "毎月の固定の支出", "何か月分", ""],
      rows: r.indicators.map((x) => ({ cells: [x.label, mn(x.cash), x.monthly === null ? "—" : mn(x.monthly), x.months === null ? "—" : `${x.months.toFixed(1)}か月分`, x.text], ...(x.key === "total" ? { tone: "total" as const } : {}) })),
    },
  });
  sections.push({
    key: "stage",
    title: "会社の段階と、お金を厚くする口座の目安",
    field: { id: "stage", label: "会社の段階", kind: "choice", value: c.stage ?? "", options: [{ value: "", label: "選ばない" }, ...COMPANY_STAGES.map((s) => ({ value: s.key, label: s.label }))] },
    lines: r.stage === null ? ["段階を選ぶと、会社と個人のどちらの口座を優先するかの目安を1文で出します。"] : [`${r.stage.label}: ${r.stage.text}`],
  });
  if (r.restated.rows.length > 0) {
    sections.push({
      key: "restated",
      title: r.restated.used ? "実力に直した額（この額で並べています）" : "実力に直した額（入力の欄の「直した額で並べる」で使います）",
      table: { head: ["科目", "帳簿の額", "直した額"], rows: r.restated.rows.map((x) => ({ cells: [x.label, x.book === null ? "—" : mn(x.book), mn(x.adjusted)] })) },
      note: "直した額は FP が入れた額です。計算では直しません。",
    });
  }
  return {
    ...base,
    columns: steps[2]?.columns ?? [],
    note: "会社のバランスシートは入れた試算表の数字、家計は今の年の年末のバランスシートです（基準日がずれることがあります）。会社の先の年の見込みは作りません。",
    steps,
    scale: r.scale,
    notices: r.notices,
    sections,
    form,
  };
}

/** 入力欄（宣言型）。monthly は家計の生活費＋ローン返済の月額（経営者の毎月の固定の支出を空欄にしたときに使う） */
function combinedForm(c: CombinedBsInput, monthly: Yen): NonNullable<BsCustomViewModel["form"]> {
  return {
    title: "会社の数字を入れる",
    note: "会社の最新の試算表の主な科目を万円で入れます（空欄は0）。入れた数字は、この世帯のファイルの中の会社の区画に入り、家計の計算には使いません。",
    open: false,
    groups: [
      {
        title: "基準日と毎月の固定の支出",
        fields: [
          { id: "asOf", label: "基準日（試算表の月末）", kind: "month", value: c.asOf ?? "", placeholder: "2026-09" },
          ...COMPANY_MONTHLY.map((x) => amountField(x.key, x.label, c, HELP[x.key])),
          { id: "ownerMonthly", label: "経営者（家計）の毎月の固定の支出", kind: "yen", unit: "万円", value: yenToManText(c.ownerMonthly), placeholder: yenToManText(monthly), help: `空欄は生活費＋ローン返済（月${mn(monthly)}）で見ます` },
        ],
      },
      { title: "会社の資産", fields: COMPANY_ASSETS.map((x) => amountField(x.key, x.label, c, HELP[x.key])) },
      { title: "会社の負債", fields: COMPANY_LIABILITIES.map((x) => amountField(x.key, x.label, c, HELP[x.key])) },
      { title: "会社の純資産", fields: COMPANY_EQUITY.map((x) => amountField(x.key, x.label, c, HELP[x.key])) },
      {
        title: "実力に直す点検（任意）",
        note: "帳簿の数字はそのままで、実際に近い額を FP が入れます（入れた科目だけ）。経営者への貸付金は、合算では経営者の会社からの借入金と相殺するので、額は入れません。",
        fields: [
          ...RESTATE_ITEMS.filter((x) => x.amount).map((x): BsCustomField => ({ id: `restated:${x.key}`, label: `${x.label}（直した額）`, kind: "yen", unit: "万円", value: yenToManText(c.restated[x.key as RestateKey]), help: x.hint })),
          { id: "useRestated", label: "直した額で並べる", kind: "check", value: c.useRestated ? "1" : "" },
        ],
      },
    ],
  };
}

const COMPANY_KEY_SET = new Set<string>([...COMPANY_ASSETS, ...COMPANY_LIABILITIES, ...COMPANY_EQUITY, ...COMPANY_MONTHLY].map((x) => x.key));
const RESTATE_KEY_SET = new Set<string>(RESTATE_ITEMS.filter((x) => x.amount).map((x) => x.key));

/**
 * 欄を1つ変えた入力（読めない値は undefined＝変えない。全部空になれば null＝欄を持たない）
 */
export function withCombinedField(input: CombinedBsInput | null, id: string, text: string): CombinedBsInput | null | undefined {
  const c: CombinedBsInput = structuredClone(input ?? EMPTY_COMBINED_INPUT);
  const [kind, key] = id.split(":") as [string, string | undefined];
  if (kind === "amount" && key !== undefined && COMPANY_KEY_SET.has(key)) {
    const v = manTextToYen(text, key === "retained");
    if (v === undefined) return undefined;
    if (v === null) delete c.amounts[key as CompanyKey];
    else c.amounts[key as CompanyKey] = v;
  } else if (kind === "restated" && key !== undefined && RESTATE_KEY_SET.has(key)) {
    const v = manTextToYen(text);
    if (v === undefined) return undefined;
    if (v === null) delete c.restated[key as RestateKey];
    else c.restated[key as RestateKey] = v;
  } else if (kind === "ownerMonthly") {
    const v = manTextToYen(text);
    if (v === undefined) return undefined;
    c.ownerMonthly = v;
  } else if (kind === "asOf") {
    const t = text.trim().replace(/[/年.]/g, "-").replace(/月$/, "");
    const m = /^(\d{4})-(\d{1,2})$/.exec(t);
    if (t === "") c.asOf = null;
    else if (m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12) c.asOf = `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
    else return undefined;
  } else if (kind === "stage") {
    c.stage = COMPANY_STAGES.some((s) => s.key === text) ? (text as CompanyStage) : null;
  } else if (kind === "useRestated") {
    c.useRestated = text === "1";
  } else return undefined;
  return isEmptyCombinedInput(c) ? null : c;
}
