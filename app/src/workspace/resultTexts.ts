// 結果の画面の文（説明の一覧の `result:<タブ>/<名前>`。0212・0016 の 2026-11-13 の追記）: 結論の1文・その2行目・取り崩しの条件・
// グラフの注・結果のタブのポイント・万一のときのタブの結論の1文を、ここに1か所で書く。
// - 公式の文は差し込みの印（`{age}` など）つきの型で書き、数字・名前はいつも印に入れる（事務所の文にも、計算した値が入る）
// - 差し込む値は単位まで入れた文字（年齢「84歳」・年「2045年」・額「17万円」・率「4.0%」）。印を読み直さない（値は字のまま入る）
// - 太字は公式の文の段（`{ b: … }`）で決める。事務所の文では、公式の文で太字の段に入っていた印の値だけを太字にする
// - 事務所の文を当てるのは、承認したときに一覧にあった公式の文が、今の公式の文と同じときだけ（customTexts.ts の applyOfficeText と同じ決まり）
// - 文はただの文字。HTML として差し込まない（画面の部品は文字として描く）
// 一覧（app/scripts/textsCatalog.ts）はこの表から作る。文を足すときは表に1行足せばよく、id は一度出したら別の意味に使い回さない
import type { VerdictPart } from "../presentation/model.ts";
// 事務所の文の形だけを読む（customTexts.ts は画面の部品〔preact〕を読むので、値は読み込まない。AI接続口の JS に画面の部品を入れないため）
import type { OfficeTexts } from "./office/customTexts.ts";

/** 公式の文の段（文字か、太字の文字） */
export type ResultSeg = string | { readonly b: string };

export interface ResultTextDef {
  /** 説明の一覧の id（`result:<タブ>/<名前>`） */
  readonly id: string;
  /** 画面のどこの文か */
  readonly where: string;
  /** 公式の文（段の並び。つなげた物が一覧の公式の文） */
  readonly official: readonly ResultSeg[];
  /** 使える差し込みの印と意味 */
  readonly vars: Readonly<Record<string, string>>;
  /** 計算の値（年齢・年・額・率）が入る印。書き換えで落とすと、本体の検査が注意を出す */
  readonly numberVars: readonly string[];
  /** 消せる（文が無くても画面が成り立つ注だけ。結論の1文などは書き換えだけ） */
  readonly hideable?: boolean;
}

const PLAN = "選んだプランの名前（例: プランC）";
const BASE_PLAN = "基準のプランの名前（例: プランA）";
const YEAR = "年（例: 2045年。「年」まで入る）";

const DEFS = [
  // ---- 結果のタブの結論の1文（グラフが資産の推移でないとき。present.ts の resultVerdict）----
  {
    id: "result:main/verdict",
    where: "結果のタブの結論の1文（選んだプランが基準のプランと違うとき。例「プランBは100歳まで足ります」）",
    official: [{ b: "{plan}" }, "は", { b: "{status}" }],
    vars: {
      plan: PLAN,
      status: "選んだプランで足りるか・いつ尽きるかの文（result:main/lasts・result:main/lastsToEnd・result:main/runsOut の文が入る）",
    },
    numberVars: ["status"],
  },
  {
    id: "result:main/verdictSame",
    where: "結果のタブの結論の1文（選んだプランが基準のプランのとき。例「プランA（基準）：77歳で資産が尽きます」）",
    official: [{ b: "{plan}（基準）" }, "：", { b: "{status}" }],
    vars: {
      plan: PLAN,
      status: "足りるか・いつ尽きるかの文（result:main/lasts・result:main/lastsToEnd・result:main/runsOut の文が入る）",
    },
    numberVars: ["status"],
  },
  {
    id: "result:main/verdictBase",
    where: "結果のタブの結論の2行目（基準のプランで足りるか・いつ尽きるか。例「プランA（基準）は80歳で資産が尽きます」）",
    official: ["{basePlan}（基準）は{baseStatus}"],
    vars: {
      basePlan: BASE_PLAN,
      baseStatus: "基準のプランで足りるか・いつ尽きるかの文（result:main/lasts・result:main/lastsToEnd・result:main/runsOut の文が入る）",
    },
    numberVars: ["baseStatus"],
  },
  {
    id: "result:main/lasts",
    where: "結果のタブの結論の1文の後半（表の最後の年まで資産が尽きないとき）",
    official: ["{age}まで足ります"],
    vars: { age: "表の最後の年のご本人の年齢（例: 100歳。「歳」まで入る）" },
    numberVars: ["age"],
  },
  {
    id: "result:main/lastsToEnd",
    where: "結果のタブの結論の1文の後半（資産が尽きず、最後の年の年齢が分からないとき）",
    official: ["最後まで足ります"],
    vars: {},
    numberVars: [],
  },
  {
    id: "result:main/runsOut",
    where: "結果のタブの結論の1文の後半（資産が尽きるとき）",
    official: ["{age}で資産が尽きます"],
    vars: { age: "資産が尽きる年のご本人の年齢（例: 77歳。「歳」まで入る）" },
    numberVars: ["age"],
  },

  // ---- 結果のタブの結論の1文（グラフが資産の推移のとき。invest/present.ts の investVerdict・drawdownText）----
  {
    id: "result:invest/verdict",
    where: "結果のタブの資産の推移の結論の1文（選んだプランが基準のプランと違うとき。例「プランCでは、金融資産は 84歳 まで持ちます」）",
    official: ["{plan}では、金融資産は ", { b: "{age}" }, " まで持ちます"],
    vars: {
      plan: PLAN,
      age: "金融資産を持てる最後の年のご本人の年齢（例: 84歳。「歳」まで入る。計算できないときは —）",
    },
    numberVars: ["age"],
  },
  {
    id: "result:invest/verdictSame",
    where: "結果のタブの資産の推移の結論の1文（選んだプランが基準のプランのとき。例「金融資産は 99歳 まで持ちます」）",
    official: ["金融資産は ", { b: "{age}" }, " まで持ちます"],
    vars: {
      age: "金融資産を持てる最後の年のご本人の年齢（例: 99歳。「歳」まで入る。計算できないときは —）",
    },
    numberVars: ["age"],
  },
  {
    id: "result:invest/verdictBase",
    where: "結果のタブの資産の推移の結論の2行目の、基準のプランの年齢（取り崩しの条件の後ろに「／」で続く。例「プランA（基準）は54歳まで」）",
    official: ["{basePlan}（基準）は{baseAge}まで"],
    vars: {
      basePlan: BASE_PLAN,
      baseAge: "基準のプランで金融資産を持てる最後の年のご本人の年齢（例: 54歳。「歳」まで入る）",
    },
    numberVars: ["baseAge"],
  },
  {
    id: "result:invest/conditionNone",
    where: "結果のタブの資産の推移の結論の2行目の、取り崩しの条件（取り崩しの予定を入れていないとき。提案書の資産運用の条件は公式の文のまま）",
    official: ["取り崩しの予定を入れず、足りない年だけ取り崩す場合"],
    vars: {},
    numberVars: [],
  },
  {
    id: "result:invest/conditionFixed",
    where: "結果のタブの資産の推移の結論の2行目の、取り崩しの条件（毎月決まった額を取り崩すとき。例「65歳から毎月17万円ずつ取り崩す場合」）",
    official: ["{age}から毎月{amount}ずつ取り崩す場合"],
    vars: {
      age: "取り崩しを始めるご本人の年齢（例: 65歳。「歳」まで入る）",
      amount: "毎月の取り崩し額（例: 17万円。「万円」まで入る）",
    },
    numberVars: ["age", "amount"],
  },
  {
    id: "result:invest/conditionRate",
    where: "結果のタブの資産の推移の結論の2行目の、取り崩しの条件（毎年決まった率で取り崩すとき。例「65歳から毎年4.0%ずつ取り崩す場合」）",
    official: ["{age}から毎年{rate}ずつ取り崩す場合"],
    vars: {
      age: "取り崩しを始めるご本人の年齢（例: 65歳。「歳」まで入る）",
      rate: "毎年の取り崩し率（例: 4.0%。「%」まで入る）",
    },
    numberVars: ["age", "rate"],
  },
  {
    id: "result:invest/holdNone",
    where: "結果のタブの資産の推移の、運用の期間の帯の「据え置く」の下の文（取り崩しの予定を入れていないとき。例「65歳〜（足りない年だけ取り崩す）」）",
    official: ["{age}〜（足りない年だけ取り崩す）"],
    vars: { age: "積立をやめるご本人の年齢（例: 65歳。「歳」まで入る）" },
    numberVars: ["age"],
  },
  {
    id: "result:invest/stressLasts",
    where: "結果のタブの資産の推移の「相場が下がった場合を重ねる」の一覧の、線ごとの右の文（例「82歳まで持つ」）",
    official: ["{age}まで持つ"],
    vars: {
      age: "その線で金融資産を持てる最後の年のご本人の年齢（例: 82歳。「歳」まで入る）",
    },
    numberVars: ["age"],
  },
  {
    id: "result:invest/stressNote",
    where: "結果のタブの資産の推移の「相場が下がった場合を重ねる」の一覧の最後の注",
    official: ["行き過ぎた予測ではなく、よくある下がり方で計算した目安です。線を押すと外せます"],
    vars: {},
    numberVars: [],
    hideable: true,
  },
  {
    id: "result:invest/donutPinned",
    where: "結果のタブの資産の推移のグラフの下の「資産の内訳」の注（グラフで年を固定しているとき）",
    official: ["グラフで固定した年の内訳です（もう一度押すと外れます）"],
    vars: {},
    numberVars: [],
    hideable: true,
  },
  {
    id: "result:invest/donutHint",
    where: "結果のタブの資産の推移のグラフの下の「資産の内訳」の注（年を固定していないとき）",
    official: ["グラフで年を押して固定すると、その年の内訳になります（いまは取り崩しを始める年）"],
    vars: {},
    numberVars: [],
    hideable: true,
  },

  // ---- 結果のタブのポイント（tools/fpTools.ts の insights）----
  {
    id: "result:main/pointDeposit",
    where: "結果のタブの「ポイント」の「預金が少なくなる年」の文",
    official: ["{year}に預金が生活費の{months}分（{need}）を下回ります（{deposit}）"],
    vars: {
      year: YEAR,
      months: "生活費の何か月分か（例: 6か月。資産と負債のタブのお金の3つの分け方の設定）",
      need: "その月数分の生活費（例: 180万円。「万円」まで入る）",
      deposit: "その年の預金（例: 120万円。「万円」まで入る）",
    },
    numberVars: ["year", "months", "need", "deposit"],
  },
  {
    id: "result:main/pointDeficit",
    where: "結果のタブの「ポイント」の「赤字が続く」の文",
    official: ["{from}から{to}まで{years}続けて年間収支が赤字です"],
    vars: {
      from: "赤字が始まる年（例: 2040年）",
      to: "赤字が終わる年（例: 2045年）",
      years: "続く年数（例: 6年）",
    },
    numberVars: ["from", "to", "years"],
  },
  {
    id: "result:main/pointEduCare",
    where: "結果のタブの「ポイント」の「教育と介護が重なる」の文（重なるのが1年のとき）",
    official: ["{year}、教育費と介護の費用が同じ年にかかります"],
    vars: { year: YEAR },
    numberVars: ["year"],
  },
  {
    id: "result:main/pointEduCareYears",
    where: "結果のタブの「ポイント」の「教育と介護が重なる」の文（重なるのが2年以上のとき）",
    official: ["{year}から{years}、教育費と介護の費用が同じ年にかかります"],
    vars: {
      year: "重なる最初の年（例: 2045年）",
      years: "重なる年数（例: 3年）",
    },
    numberVars: ["year", "years"],
  },
  {
    id: "result:main/pointNisa",
    where: "結果のタブの「ポイント」の「NISA の枠を使い切る年」の文（ご本人・配偶者のとき）",
    official: ["{year}に{person}のNISA の生涯の投資枠を使い切ります（その後の積立は課税口座で計算します）"],
    vars: { year: YEAR, person: "人の呼び方（ご本人・配偶者）" },
    numberVars: ["year"],
  },
  {
    id: "result:main/pointNisaNoPerson",
    where: "結果のタブの「ポイント」の「NISA の枠を使い切る年」の文（ご本人・配偶者のほかの人のとき）",
    official: ["{year}にNISA の生涯の投資枠を使い切ります（その後の積立は課税口座で計算します）"],
    vars: { year: YEAR },
    numberVars: ["year"],
  },
  {
    id: "result:main/pointInheritanceTax",
    where: "結果のタブの「ポイント」の「相続税がかかる見込み」の文",
    official: ["いま亡くなったときの相続税の目安は{amount}です（相続・贈与の項目）"],
    vars: { amount: "相続税の目安（例: 320万円。「万円」まで入る）" },
    numberVars: ["amount"],
  },

  // ---- 万一のときのタブの結論の1文（contingency/present.ts の scenarioModel・protectionChart）----
  {
    id: "result:contingency/lasts",
    where: "万一のときのタブの資産の推移の結論の1文（万一のときも資産が尽きないとき）",
    official: ["{event}も、", { b: "資産は最後まで尽きません" }],
    vars: { event: "万一の場面の文（例: ご本人が2035年に亡くなった場合）" },
    numberVars: ["event"],
  },
  {
    id: "result:contingency/runsOut",
    where: "万一のときのタブの資産の推移の結論の1文（万一のときに資産が尽き、万一なしでは尽きないとき）",
    official: ["{event}、資産は ", { b: "{year}（{person}{age}）に尽きます" }, "（万一なしは尽きません）"],
    vars: {
      event: "万一の場面の文（例: ご本人が2035年に亡くなった場合）",
      year: "資産が尽きる年（例: 2058年）",
      person: "年齢を見る人の呼び方（亡くなる場面では残る人。例: 配偶者）",
      age: "その年のその人の年齢（例: 82歳。「歳」まで入る）",
    },
    numberVars: ["event", "year", "age"],
  },
  {
    id: "result:contingency/runsOutBoth",
    where: "万一のときのタブの資産の推移の結論の1文（万一のときも万一なしでも資産が尽きるとき）",
    official: ["{event}、資産は ", { b: "{year}（{person}{age}）に尽きます" }, "（万一なしは{noneYear}）"],
    vars: {
      event: "万一の場面の文（例: ご本人が2035年に亡くなった場合）",
      year: "資産が尽きる年（例: 2058年）",
      person: "年齢を見る人の呼び方（亡くなる場面では残る人。例: 配偶者）",
      age: "その年のその人の年齢（例: 82歳。「歳」まで入る）",
      noneYear: "万一なしで資産が尽きる年（例: 2066年）",
    },
    numberVars: ["event", "year", "age", "noneYear"],
  },
  {
    id: "result:contingency/protectionShort",
    where: "万一のときのタブの必要保障額の推移の結論の1文（保障が足りない年があるとき）",
    official: ["{event}、", { b: "保障の不足は最大{amount}（{year}）" }],
    vars: {
      event: "万一の場面の文（例: ご本人が亡くなった場合）",
      amount: "いちばん大きい不足（例: 1,200万円。「万円」まで入る）",
      year: "その年（例: 2030年）",
    },
    numberVars: ["event", "amount", "year"],
  },
  {
    id: "result:contingency/protectionEnough",
    where: "万一のときのタブの必要保障額の推移の結論の1文（保障が足りているとき）",
    official: ["{event}、", { b: "保障は足りています" }],
    vars: { event: "万一の場面の文（例: ご本人が亡くなった場合）" },
    numberVars: ["event"],
  },
] as const satisfies readonly ResultTextDef[];

export type ResultTextId = (typeof DEFS)[number]["id"];

/** 結果の画面の文の表（一覧を作るビルドの段とテストが読む） */
export const RESULT_TEXTS: readonly ResultTextDef[] = DEFS;

const BY_ID: ReadonlyMap<string, ResultTextDef> = new Map(RESULT_TEXTS.map((d) => [d.id, d]));

const segText = (s: ResultSeg): string => (typeof s === "string" ? s : s.b);

/** 一覧に載せる公式の文（段をつなげた物。差し込みの印つき） */
export const resultOfficialText = (d: ResultTextDef): string => d.official.map(segText).join("");

/** 差し込む値（印の名前 → 単位まで入れた文字） */
export type ResultValues = Readonly<Record<string, string>>;

/** 文を、字と差し込みの印に分ける（`{{`・`}}` は字の `{`・`}`。形の崩れた括弧は字のまま） */
function tokens(template: string): ({ lit: string } | { mark: string })[] {
  const out: ({ lit: string } | { mark: string })[] = [];
  let lit = "";
  for (let i = 0; i < template.length; i++) {
    const c = template[i] as string;
    const next = template[i + 1];
    if ((c === "{" && next === "{") || (c === "}" && next === "}")) {
      lit += c;
      i++;
      continue;
    }
    if (c === "{") {
      const end = template.indexOf("}", i);
      const name = end < 0 ? null : template.slice(i + 1, end);
      if (name !== null && /^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
        if (lit !== "") out.push({ lit });
        lit = "";
        out.push({ mark: name });
        i = end;
        continue;
      }
    }
    lit += c;
  }
  if (lit !== "") out.push({ lit });
  return out;
}

/** 印を値に置き換える（値は字のまま。知らない印は空） */
function fill(template: string, values: ResultValues): string {
  return tokens(template)
    .map((t) => ("lit" in t ? t.lit : (values[t.mark] ?? "")))
    .join("");
}

/** 公式の文で太字の段に入っている印（事務所の文では、この印の値を太字にする） */
function strongMarks(d: ResultTextDef): Set<string> {
  const s = new Set<string>();
  for (const seg of d.official) if (typeof seg !== "string") for (const t of tokens(seg.b)) if ("mark" in t) s.add(t.mark);
  return s;
}

/** となりの同じ太さの部品をつなぐ */
function joinParts(parts: VerdictPart[]): VerdictPart[] {
  const out: VerdictPart[] = [];
  for (const p of parts) {
    if (p.text === "") continue;
    const last = out.at(-1);
    if (last !== undefined && (last.strong === true) === (p.strong === true)) out[out.length - 1] = { ...last, text: last.text + p.text };
    else out.push(p);
  }
  return out;
}

/** 結果の画面の文の当て方（公式の文か、承認した事務所の文） */
export interface Wording {
  /** 結論の1文などの部品（太字つき）。消す設定は当てない（結論の1文は消せない） */
  parts(id: ResultTextId, values?: ResultValues): VerdictPart[];
  /** 文（太字なし） */
  text(id: ResultTextId, values?: ResultValues): string;
  /** 消せる注（事務所の文で消したときは null） */
  note(id: ResultTextId, values?: ResultValues): string | null;
}

/**
 * 事務所の文（承認した中身から作った物）を当てる Wording を作る。当てるのは、承認したときの公式の文が今の公式の文と同じ行の
 * 書き換え（replace）と、消せる注の消す（hide）だけ（足す append は結果の画面の文の一覧の ops に無い）
 */
export function wordingOf(office: OfficeTexts): Wording {
  const officeOf = (d: ResultTextDef) => {
    const e = office.get(d.id);
    return e === undefined || e.official !== resultOfficialText(d) ? undefined : e;
  };
  const parts = (id: ResultTextId, values: ResultValues = {}): VerdictPart[] => {
    const d = BY_ID.get(id) as ResultTextDef;
    const e = officeOf(d);
    if (e !== undefined && e.do === "replace" && e.text !== null) {
      const strong = strongMarks(d);
      return joinParts(
        tokens(e.text).map((t) =>
          "lit" in t
            ? { text: t.lit }
            : {
                text: values[t.mark] ?? "",
                ...(strong.has(t.mark) ? { strong: true } : {}),
              },
        ),
      );
    }
    return d.official.map((s) => (typeof s === "string" ? { text: fill(s, values) } : { text: fill(s.b, values), strong: true }));
  };
  const text = (id: ResultTextId, values?: ResultValues): string =>
    parts(id, values)
      .map((p) => p.text)
      .join("");
  const note = (id: ResultTextId, values?: ResultValues): string | null => {
    const d = BY_ID.get(id) as ResultTextDef;
    const e = officeOf(d);
    return e !== undefined && e.do === "hide" && d.hideable === true ? null : text(id, values);
  };
  return { parts, text, note };
}

/** 公式の文だけ（事務所の文を当てない。提案書・持ち帰り用のレポート・テストの既定） */
export const OFFICIAL_WORDING: Wording = wordingOf(new Map());
