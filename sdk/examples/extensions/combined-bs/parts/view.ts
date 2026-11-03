// 合算BS の見るもの（差し込み口 view.balance。約束の版 1。0114 の5）。
// - 資産と負債のタブの「見るもの」（0027 の8）に出す値を作る。アプリは、返した値に鍵と入力欄（fields/company.json の宣言と今の値）を足して描く
// - 値を作るのは combinedBs.ts の部品（提案書の章 chapter.ts と同じ）。ここは見せる形にするだけ
// - 入力欄の文字の読み方（万円・年月）はアプリが宣言から行う。ここは入力欄の値を受け取るだけ
import { man, type BalanceView, type ExtColumn, type ExtInput, type ExtSection } from "@lifeplan/sdk";
import { COMBINED_KEY, combinedBs, EMPTY_COMBINED_INPUT, hasCompanyAmounts, readCombinedInput, type CombinedColumn } from "./combinedBs.ts";

const mn = (v: number) => `${man(v)}万円`;

/** 円 → 欄の文字（万円。端数は小数第2位まで。アプリの入力欄と同じ書き方） */
const manText = (v: number) => String(Number((v / 10000).toFixed(2)));

/** 合算の1枚を図の1枚にする */
const col = (c: CombinedColumn, sub?: string): ExtColumn => ({
  name: c.name,
  at: {
    year: c.year,
    lines: c.lines.map((l) => ({ key: l.key, label: l.label, group: l.group, amount: l.amount })),
    totalAssets: c.totalAssets,
    totalLiabilities: c.totalLiabilities,
    netWorth: c.netWorth,
    financial: c.financial,
    shortfall: c.shortfall,
    ...(c.netParts !== undefined ? { netParts: c.netParts.map((p) => ({ key: p.key, label: p.label, amount: p.amount })) } : {}),
  },
  ...(sub !== undefined ? { sub } : {}),
});

const LEAD = "経営者個人（家計）と会社のバランスシートを並べ、間の貸し借りを相殺して1枚にします。会社の数字は試算表から入れ、先の年の見込みは作りません。家計の計算の結果は変わりません。";
const GROUPS: BalanceView["groups"] = {
  liquid: { name: "現預金・すぐ使えるお金", short: "現預金" },
  illiquid: { name: "そのほかの資産（換金しにくいもの）", short: "そのほかの資産" },
  debt: { name: "借入金など", short: "借入金など" },
};

/** 入力欄の差し込みの文（経営者の毎月の固定の支出を空欄にしたときに使う額） */
function hints(monthly: number): NonNullable<BalanceView["form"]>["hints"] {
  return { ownerMonthly: { placeholder: manText(monthly), help: `空欄は生活費＋ローン返済（月${mn(monthly)}）で見ます` } };
}

/**
 * 合算BS の見るもの。会社の数字が無ければ、入力欄を開いた形で、図の代わりに案内の文を出す
 */
export function balanceView(input: ExtInput): BalanceView {
  const c = readCombinedInput(input.values[COMBINED_KEY]) ?? EMPTY_COMBINED_INPUT;
  const h = input.balance?.now;
  if (h === undefined) return { lead: LEAD, groups: GROUPS, columns: [], note: "", empty: "家計のバランスシートを作れていないため、合算できません。" };
  if (!hasCompanyAmounts(c)) {
    return { lead: LEAD, groups: GROUPS, columns: [], note: "", empty: "会社のバランスシートの数字（試算表の主な科目）を入れると、2枚を並べて合算します。", form: { open: true, hints: hints(h.monthly) } };
  }
  const r = combinedBs(c, h);
  const asOf = r.asOfLabel ?? "基準日の入力なし";
  const ownerSub = `${h.at.year}年末（今の年。入力した値から）`;
  const coSub = `試算表（${asOf}）`;
  const steps: NonNullable<BalanceView["steps"]> = [
    { key: "side", label: "① 2枚を並べる", columns: [col(r.side[0], ownerSub), col(r.side[1], coSub)], note: "左が経営者個人（家計）、右が会社のバランスシートです。金融機関が融資のときに見るのも、まずこの2枚を並べた形です。" },
    { key: "netted", label: "② 貸し借りを相殺する", columns: [col(r.netted[0], ownerSub), col(r.netted[1], coSub)], note: "経営者と会社の間の貸し借り（下の4つの組）を、両側から消しました。相殺しても、合わせた財産の合計は変わりません。" },
    { key: "combined", label: "③ 足して1枚にする", columns: [col(r.side[0], ownerSub), col(r.side[1], coSub), col(r.combined, "相殺してから科目ごとに足した1枚")], note: "右の1枚が合算です。純資産は、会社の財産（剰余金）と個人の財産に分けて見ます。資本金は財産に数えません。" },
  ];
  const sections: ExtSection[] = [];
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
    field: "stage",
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
    lead: LEAD,
    groups: GROUPS,
    columns: steps[2]?.columns ?? [],
    note: "会社のバランスシートは入れた試算表の数字、家計は今の年の年末のバランスシートです（基準日がずれることがあります）。会社の先の年の見込みは作りません。",
    steps,
    scale: r.scale,
    notices: r.notices,
    sections,
    form: { open: false, hints: hints(h.monthly) },
  };
}
