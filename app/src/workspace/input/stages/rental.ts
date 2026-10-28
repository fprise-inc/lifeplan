// 収益不動産（0079）: 人に貸して家賃・地代を受け取っている不動産を、物件ごとに1つのまとまりで入れる。
// - 物件は不動産の器（accounts[] の kind realEstate）のうち、中身（property。0028）を持つもの。中身の無い不動産（評価額だけ）は貯蓄・運用の
//   「その他の資産」に残る。「＋ 物件を足す」は中身を持つ器を作るので、足せば最初から中身の欄（土地と建物・家賃収入・経費・売却・ローン）が出る
// - 物件を見分ける欄（物件名・種類・所在地・持分・権利・戸数・面積・メモ）は表示用で、計算には使わない（計算部品は読まない）
// - 欄のキーは貯蓄・運用の中にあったときのまま（`sav/<器の ID>/…`）。次回確かめるの印・読み替え表の当て先がそのまま当たる
// - 上の一覧表（rentalOverview）は入力から出せる数字だけ（評価額・ローン残高・空室を見込んだ後の月の家賃）
import type { Account, Debt, Household } from "../../../engine/types.ts";
import type { Address } from "../../store/readings.ts";
import { addMonths } from "../../levers.ts";
import { byId, field, plain, removeAction, resolveTimepoint, timepointField, yenBox, type FieldDef, type Finder, type GroupDef, type Option, type StageDef } from "../form.ts";
import { confirmedBox, mutate, newId, standardBox, type WorkingHousehold } from "../household.ts";
import { BUILDING_STRUCTURES, memberOptions, VALUATION_DEFAULTS } from "../labels.ts";
import { monthsBetween } from "../loanMath.ts";
import { stagedGroups } from "../staged.ts";
import { loanFields } from "./housing.ts";

const accounts = (h: Household) => h.accounts;
/** 欄の当て先（器の中の入力項目） */
const onAccount = (id: string, item: string, at: string[] = []) => (): Address => ({ target: { object: id }, item, at });
const withAddress = (f: FieldDef, a: () => Address): FieldDef => ({ ...f, address: a });

export const UNENTERED_PROPERTY_VALUE = "未入力（評価額を入れてください。0円で計算中）";
export const UNENTERED_RENT = "未入力（家賃を入れてください。0円で計算中）";

/** 収益不動産の物件（不動産の器のうち、中身を持つもの） */
export const isRentalProperty = (a: Pick<Account, "kind" | "property">): boolean => a.kind === "realEstate" && a.property !== undefined;
export const rentalProperties = (h: Household): Account[] => (h.accounts ?? []).filter(isRentalProperty);

/** 物件の種類（表示用） */
export const RENTAL_KINDS: Option[] = [
  { value: "condo", label: "区分マンション" },
  { value: "apartment", label: "一棟アパート" },
  { value: "mansion", label: "一棟マンション" },
  { value: "house", label: "戸建て" },
  { value: "commercial", label: "店舗/事務所" },
  { value: "parking", label: "駐車場" },
  { value: "land", label: "貸している土地" },
  { value: "lodging", label: "民泊・宿" },
];
/** 民泊・宿の知らせ（売上・経費の入れ方と所得の区分は後の版。今は家賃の欄に月の売上の見込みを入れる） */
export const LODGING_NOTE = "売上と経費の入れ方、所得の区分（雑所得・事業所得）は今後の版で対応します。今は家賃の欄に月の売上の見込みを入れてください";
/** 戸数を標準で聞く種類（一棟） */
const WHOLE_BUILDING = new Set(["apartment", "mansion"]);
const TENURES: Option[] = [
  { value: "ownership", label: "所有権" },
  { value: "leasehold", label: "借地権" },
];

const kindLabel = (a: Account): string | null => RENTAL_KINDS.find((o) => o.value === a.property?.kind)?.label ?? null;

/** 物件の呼び方: 物件名、無ければ「物件1」「物件2」（収益不動産の中の並びの番号） */
export function rentalName(h: Household, a: Account): string {
  const name = a.property?.name?.trim();
  if (name !== undefined && name !== "") return name;
  const i = rentalProperties(h).findIndex((x) => x.id === a.id);
  return `物件${i < 0 ? 1 : i + 1}`;
}

/** 円を万円の文字に（1万円未満は小数1桁まで） */
function man(yen: number): string {
  const m = yen / 10000;
  if (Number.isInteger(m)) return m.toLocaleString("ja-JP");
  if (Math.abs(yen) < 1_000_000) return String(Math.round(m * 10) / 10);
  return Math.round(m).toLocaleString("ja-JP");
}

/** その物件のローン（負債の型で、debts[].property がその器を指すもの。0028） */
export const propertyLoans = (h: Household, id: string): Debt[] => (h.debts ?? []).filter((d) => d.property === id);

/**
 * ローンの今の残高（入力から出す目安）: 今の残高を入れていればその値。無ければ借入額と最初の金利・返済の方法・期間から、計算の基準の月の
 * 残高を出す（金利の段階・繰上返済・ボーナス返済は見ない。計算の結果の残高とは少し違うことがある）。これから借りるローンは0
 */
export function loanBalanceNow(h: Household, d: Debt, baseMonth: string): number {
  if (d.balance?.value != null) return d.balance.value;
  const start = resolveTimepoint(h, d.start);
  const n = d.repayment.termMonths;
  // これから借りるローン（借入の月が計算の基準の月より後）は、今の残高に入れない
  if (start !== null && start > baseMonth) return 0;
  const k = start === null ? 0 : Math.max(0, Math.min(n, monthsBetween(start, baseMonth)));
  if (k <= 0) return d.principal;
  if (k >= n) return 0;
  const r = Number(d.rateSchedule[0]?.rate ?? "0") / 12;
  if (d.repayment.method === "equalPrincipal") return Math.max(0, Math.round(d.principal * (1 - k / n)));
  if (r === 0) return Math.max(0, Math.round(d.principal * (1 - k / n)));
  const g = Math.pow(1 + r, k);
  const pay = (d.principal * r) / (1 - Math.pow(1 + r, -n));
  return Math.max(0, Math.round(d.principal * g - (pay * (g - 1)) / r));
}

/** 月の家賃（空室を見込んだ後。貸していなければ 0）。エンジンと同じく円未満を切り捨てる */
export function rentAfterVacancy(a: Account): number {
  const r = a.property?.rental;
  if (r === undefined) return 0;
  return Math.floor((r.monthly.value ?? 0) * (1 - Number(r.vacancyRate ?? "0")));
}

export interface RentalRow {
  id: string;
  name: string;
  kind: string | null;
  value: number;
  loan: number;
  rent: number;
}

/** 物件の一覧表（入力から出せる数字だけ。物件が無ければ null） */
export function rentalOverview(wh: WorkingHousehold): { rows: RentalRow[]; total: Omit<RentalRow, "id" | "name" | "kind"> } | null {
  const h = wh.request.input.household;
  const list = rentalProperties(h);
  if (list.length === 0) return null;
  const base = wh.request.input.baseMonth;
  const rows = list.map((a) => ({
    id: a.id,
    name: rentalName(h, a),
    kind: kindLabel(a),
    value: a.marketValue?.value ?? 0,
    loan: propertyLoans(h, a.id).reduce((s, d) => s + loanBalanceNow(h, d, base), 0),
    rent: rentAfterVacancy(a),
  }));
  const sum = (k: "value" | "loan" | "rent") => rows.reduce((s, r) => s + r[k], 0);
  return { rows, total: { value: sum("value"), loan: sum("loan"), rent: sum("rent") } };
}

/** 物件を1件足す（中身つきの不動産の器。評価額と家賃は「未入力（0円で計算中）」の印で始める） */
export function addRentalProperty(wh: WorkingHousehold, id: () => string = newId): WorkingHousehold {
  return mutate(wh, (h) => {
    const self = h.members.find((m) => m.kind === "self") ?? h.members[0];
    if (self === undefined) return;
    (h.accounts ??= []).push({
      id: id(),
      kind: "realEstate",
      owner: self.id,
      marketValue: standardBox(0, UNENTERED_PROPERTY_VALUE),
      asOf: wh.request.input.baseMonth,
      contributions: [],
      property: { rental: { monthly: standardBox(0, UNENTERED_RENT) } },
    });
  });
}

/** 物件の見出しと、物件を見分ける欄・名義・評価額 */
function headGroup(wh: WorkingHousehold, a: Account): GroupDef {
  const h = wh.request.input.household;
  const find = byId(accounts, a.id);
  const findP: Finder = (hh, w) => (find(hh, w) as Account | undefined)?.property as Record<string, unknown> | undefined;
  const k = `sav/${a.id}`;
  const kp = `${k}/property`;
  const p = a.property ?? {};
  const whole = p.kind !== undefined && WHOLE_BUILDING.has(p.kind);
  const shareField = withAddress(
    plain({ key: `${kp}/share`, item: "account.property", label: "持分", level: "detail", kind: "pct", find: findP, path: ["share"], optional: true, help: "共有名義のとき、名義の人の持分です（例: 2分の1なら 50%）。空欄は全部（単独の名義）" }),
    onAccount(a.id, "account.property", ["share"]),
  );
  const kindBase = withAddress(
    plain({ key: `${kp}/kind`, item: "account.property", label: "種類", level: "simple", kind: "select", options: RENTAL_KINDS, find: findP, path: ["kind"], optional: true, help: `表示用です（計算には使いません）。民泊・宿は、${LODGING_NOTE}` }),
    onAccount(a.id, "account.property", ["kind"]),
  );
  const kindField: FieldDef = { ...kindBase, get: (w) => { const s = kindBase.get(w); return s.value === "lodging" ? { ...s, warn: LODGING_NOTE } : s; } };
  const fields: FieldDef[] = [
    withAddress(
      plain({ key: `${kp}/name`, item: "account.property.name", label: "物件名", level: "simple", kind: "text", find: findP, path: ["name"], optional: true, help: "空欄なら「物件1」「物件2」と呼びます。お客さまの呼び方（「○○のアパート」など）で入れると見分けやすくなります" }),
      onAccount(a.id, "account.property.name"),
    ),
    kindField,
    plain({ key: `${k}/owner`, item: "account.owner", label: "名義", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["owner"] }),
    yenBox({ key: `${k}/value`, item: "account.marketValue", label: "今の評価額（土地と建物の合計）", level: "simple", basis: "once", find, path: ["marketValue"] }),
    plain({ key: `${k}/asOf`, item: "account.asOf", label: "評価額の時点", level: "detail", kind: "ym", find, path: ["asOf"] }),
    plain({
      key: `${k}/growth`,
      item: "account.valueGrowth",
      label: "土地の評価額の増減率（年）",
      level: "simple",
      kind: "pct",
      find,
      path: ["valueGrowth"],
      optional: true,
      help: "空欄なら前提条件の土地の上昇率（入れていなければ物価上昇率）。建物は構造の耐用年数で減らします",
    }),
    withAddress(plain({ key: `${kp}/location`, item: "account.property.location", label: "所在地", level: "detail", kind: "text", find: findP, path: ["location"], optional: true, help: "都道府県・市区町村まで（例: 埼玉県さいたま市）。番地は入れません" }), onAccount(a.id, "account.property.location")),
    {
      ...shareField,
      get: (w) => {
        const s = shareField.get(w);
        const v = typeof s.value === "string" ? Number(s.value) : null;
        return v !== null && v < 1 ? { ...s, warn: "計算はまだ全部を名義の人の分として扱います（評価額・家賃・経費・ローンは物件全体の額で入れてください）" } : s;
      },
    },
    withAddress(plain({ key: `${kp}/tenure`, item: "account.property", label: "権利", level: "detail", kind: "select", options: TENURES, find: findP, path: ["tenure"], optional: true }), onAccount(a.id, "account.property", ["tenure"])),
    withAddress(plain({ key: `${kp}/units`, item: "account.property", label: "戸数", level: whole ? "simple" : "detail", kind: "int", suffix: "戸", min: 1, max: 9999, find: findP, path: ["units"], optional: true, help: "一棟のときの部屋の数です。空室は、家賃収入の「空室を見込む割合」で入れます" }), onAccount(a.id, "account.property", ["units"])),
    withAddress(plain({ key: `${kp}/landArea`, item: "account.property", label: "土地の面積", level: "detail", kind: "decimal", suffix: "㎡", find: findP, path: ["area", "land"], optional: true }), onAccount(a.id, "account.property", ["area", "land"])),
    withAddress(plain({ key: `${kp}/floorArea`, item: "account.property", label: "建物の延べ床面積", level: "detail", kind: "decimal", suffix: "㎡", find: findP, path: ["area", "floor"], optional: true }), onAccount(a.id, "account.property", ["area", "floor"])),
    withAddress(plain({ key: `${kp}/memo`, item: "account.property.memo", label: "メモ", level: "detail", kind: "text", find: findP, path: ["memo"], optional: true, help: "物件について FP が覚えておくこと（管理会社・修繕の予定など）。計算には使いません" }), onAccount(a.id, "account.property.memo")),
  ];
  const kl = kindLabel(a);
  return {
    key: k,
    title: `${rentalName(h, a)}（${[kl, `評価額 ${man(a.marketValue?.value ?? 0)}万円`].filter((x) => x !== null).join("・")}）`,
    ...(p.kind === "lodging" ? { note: `民泊・宿: ${LODGING_NOTE}` } : {}),
    level: "simple",
    fields,
    actions: [
      removeAction(`${k}/remove`, "外す", "simple", (hh) => {
        hh.accounts = (hh.accounts ?? []).filter((x) => x.id !== a.id);
        for (const d of hh.debts ?? []) if (d.property === a.id) delete d.property;
      }),
    ],
  };
}

/** 物件の中身: 土地と建物（構造・建った年・土地の割合・取得）、貸している（家賃・空室・変化率・期間）、経費、売却、ローン（0028） */
function propertyGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  const p = a.property ?? {};
  const setting = wh.request.input.assumptions?.realEstateValuation;
  const asOf = a.asOf ?? wh.request.input.baseMonth;
  const self = wh.request.input.household.members.find((m) => m.id === a.owner);
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  const kp = `${k}/property`;
  // 中身（property）の中の欄は、中身を起点に読み書きする（欄を空にしても中身ごとは消えない）
  const findP: Finder = (h, w) => (find(h, w) as Account | undefined)?.property as Record<string, unknown> | undefined;
  const ensureProp = (h: Household, w: WorkingHousehold) => {
    const x = find(h, w) as Account | undefined;
    return x === undefined ? undefined : ((x.property ??= {}) as Record<string, unknown>);
  };
  const acquisitionYear = p.acquisition?.at !== undefined ? Number(p.acquisition.at.slice(0, 4)) : null;
  const groups: GroupDef[] = [
    {
      key: `${kp}/building`,
      title: "土地と建物",
      level: "simple",
      fields: [
        // 持ち始める時点（0039。相続・贈与で受け取る家。その月から評価額・家賃収入・経費に入れ、受け取るときの支払いは無い）
        withAddress(
          timepointField({
            key: `${kp}/holdFrom`,
            item: "account.property",
            label: "持ち始める時点",
            level: "detail",
            find: findP,
            path: ["holdFrom"],
            optional: true,
            absentWhenEmpty: true,
            nullText: "今から持っている",
            help: "これから相続・贈与で受け取る不動産の、持ち始める月です。その月から評価額（その年の年末から）・家賃収入・経費に入れます。受け取るときの支払いはありません（買うなら、購入の支払いを出るお金で入れます）。相続税の目安にも、その時点から入ります",
            ...ageOf,
          }),
          onAccount(a.id, "account.property", ["holdFrom"]),
        ),
        plain({ key: `${kp}/structure`, item: "account.property", label: "建物の構造", level: "simple", kind: "select", options: BUILDING_STRUCTURES, find: findP, path: ["structure"], optional: true, fallback: "wood", help: "評価額の建物の部分を耐用年数（木造22年・軽量鉄骨19年・重量鉄骨34年・鉄筋コンクリート47年）で減らします。減価償却の耐用年数にも使います" }),
        plain({ key: `${kp}/builtYear`, item: "account.property", label: "建物が建った年", level: "simple", kind: "int", suffix: "年", min: 1900, max: 2200, find: findP, path: ["builtYear"], optional: true, fallback: acquisitionYear ?? Number(asOf.slice(0, 4)), help: "空欄なら取得の年（取得が空欄なら評価額の時点の年）に新築とみなします" }),
        plain({ key: `${kp}/landShare`, item: "account.property", label: "土地の割合", level: "simple", kind: "pct", find: findP, path: ["landShare"], optional: true, fallback: setting?.landShare ?? VALUATION_DEFAULTS.landShare, help: "評価額と取得価額を土地と建物に分けます。マンションは土地の割合が小さめです" }),
        plain({
          key: `${kp}/acqPrice`,
          item: "account.property",
          label: "取得価額（土地と建物の合計）",
          level: "simple",
          kind: "yen",
          basis: "once",
          find: findP,
          path: ["acquisition", "price"],
          optional: true,
          help: "減価償却費（建物の分）の計算に使います。空欄なら減価償却費を入れません",
          after: (h, _t, v, w) => {
            const x = find(h, w) as Account | undefined;
            if (x?.property === undefined) return;
            if (v === null) delete x.property.acquisition;
            else if (x.property.acquisition !== undefined) x.property.acquisition.at ??= asOf;
          },
        }),
        plain({
          key: `${kp}/acqAt`,
          item: "account.property",
          label: "取得の年月",
          level: "simple",
          kind: "ym",
          find: findP,
          path: ["acquisition", "at"],
          optional: true,
          help: "取得価額といっしょに入れます",
          after: (h, _t, v, w) => {
            const x = find(h, w) as Account | undefined;
            if (x?.property?.acquisition === undefined) return;
            if (v === null || x.property.acquisition.price === undefined) delete x.property.acquisition;
          },
        }),
      ],
      actions: [],
    },
  ];
  // 貸している（家賃収入）
  const rentFields: FieldDef[] = [
    field({
      key: `${kp}/rented`,
      item: "account.property",
      label: "貸している",
      help: "家賃・地代を受け取っているときに入れます（今は空いていて、これから貸すときも）",
      level: "simple",
      kind: "bool",
      structural: true,
      get: (w) => ({ value: (find(w.request.input.household, w) as Account | undefined)?.property?.rental !== undefined }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = ensureProp(h, w);
          if (x === undefined) return;
          if (v === true) x.rental ??= { monthly: confirmedBox(0) };
          else delete x.rental;
        }),
    }),
  ];
  if (p.rental !== undefined)
    rentFields.push(
      yenBox({ key: `${kp}/rent`, item: "account.property", label: "家賃（月額・空室を見込む前）", level: "simple", basis: "monthly", find: findP, path: ["rental", "monthly"] }),
      plain({ key: `${kp}/vacancy`, item: "account.property", label: "空室を見込む割合", level: "simple", kind: "pct", find: findP, path: ["rental", "vacancyRate"], optional: true, fallback: "0", help: "例: 1年のうち平均して半月空くなら 4%。受け取る家賃＝家賃×(1−この割合)" }),
      plain({ key: `${kp}/rentGrowth`, item: "account.property", label: "家賃の変化率（年）", level: "detail", kind: "pct", find: findP, path: ["rental", "growth"], optional: true, fallback: "0", help: "古くなって家賃が下がる見込みはマイナスで入れます" }),
      timepointField({ key: `${kp}/rentFrom`, item: "account.property", label: "貸し始め", level: "detail", find: findP, path: ["rental", "from"], mode: "ym", optional: true, absentWhenEmpty: true, nullText: p.acquisition !== undefined ? "取得の月から" : "前から貸している", ...ageOf }),
      timepointField({ key: `${kp}/rentTo`, item: "account.property", label: "貸し終わり", level: "detail", find: findP, path: ["rental", "to"], startPath: ["rental", "from"], optional: true, absentWhenEmpty: true, nullText: p.sale !== undefined ? "売るまで" : "最後まで", ...ageOf }),
    );
  groups.push({ key: `${kp}/rental`, title: "家賃収入", level: "simple", ...(p.rental !== undefined && p.acquisition === undefined ? { note: "取得価額と取得の年月を入れると、減価償却費を引いた不動産所得で税を計算します" } : {}), fields: rentFields, actions: [] });
  // 家賃と経費の年額の段階・例外の年（0040。詳細）
  const staged = (part: "rental" | "expenses", what: string, basis: "monthly" | "annual", value: (x: Account) => number | null, yearly = false): GroupDef[] =>
    stagedGroups(wh, {
      key: `${kp}/${part}`,
      find,
      target: { object: a.id },
      stages: { path: ["property", part, "stages"], item: "account.property", at: [part, "stages"] },
      exceptions: { path: ["property", part, "exceptions"], item: "account.property", at: [part, "exceptions"] },
      basis,
      what,
      base: (h) => {
        const x = (h.accounts ?? []).find((y) => y.id === a.id);
        return x === undefined ? null : value(x);
      },
      ...ageOf,
      ...(yearly ? { yearly: true } : {}),
    });
  if (p.rental !== undefined) groups.push(...staged("rental", "家賃", "monthly", (x) => x.property?.rental?.monthly.value ?? null));
  // 経費
  groups.push({
    key: `${kp}/expenses`,
    title: "経費",
    level: "simple",
    fields: [
      yenBox({ key: `${kp}/expAnnual`, item: "account.property", label: "年額（持っている間）", level: "simple", basis: "annual", find: findP, path: ["expenses", "annual"], optional: true, help: "管理費・修繕積立金・固定資産税・保険料など、毎年かかる額の合計" }),
      plain({ key: `${kp}/expRate`, item: "account.property", label: "家賃に対する割合", level: "simple", kind: "pct", find: findP, path: ["expenses", "rate"], optional: true, help: "管理委託料など、受け取る家賃に比例する経費（例: 5%）" }),
      plain({ key: `${kp}/expGrowth`, item: "account.property", label: "年額の変化率（年）", level: "detail", kind: "pct", find: findP, path: ["expenses", "growth"], optional: true, fallback: "0", help: "修繕積立金の値上がりなど" }),
    ],
    actions: [],
  });
  if (p.expenses !== undefined) groups.push(...staged("expenses", "経費の年額", "annual", (x) => x.property?.expenses?.annual?.value ?? null, true));
  // 売却の予定
  const saleFields: FieldDef[] = [
    field({
      key: `${kp}/sell`,
      item: "account.property",
      label: "売る予定がある",
      level: "simple",
      kind: "bool",
      structural: true,
      help: "売ると、売却価格から売却の費用を引いた手取りが預金に入り、その年から不動産は無くなります。譲渡所得の税は計算しません",
      get: (w) => ({ value: (find(w.request.input.household, w) as Account | undefined)?.property?.sale !== undefined }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = ensureProp(h, w);
          if (x === undefined) return;
          if (v === true) x.sale ??= { at: { at: addMonths(w.request.input.baseMonth, 120) } };
          else delete x.sale;
        }),
    }),
  ];
  if (p.sale !== undefined)
    saleFields.push(
      timepointField({ key: `${kp}/saleAt`, item: "account.property", label: "売る時期", level: "simple", find: findP, path: ["sale", "at"], ...ageOf }),
      plain({ key: `${kp}/salePrice`, item: "account.property", label: "売却価格", level: "simple", kind: "yen", basis: "once", find: findP, path: ["sale", "price"], optional: true, help: "空欄ならその年の評価額で売るとみなします" }),
      plain({ key: `${kp}/saleCost`, item: "account.property", label: "売却の費用（売却価格に対する割合）", level: "detail", kind: "pct", find: findP, path: ["sale", "costRate"], optional: true, fallback: setting?.saleCostRate ?? VALUATION_DEFAULTS.saleCostRate, help: "仲介手数料・印紙税など。ローンが残るときは、売る月の繰上返済で返します" }),
    );
  groups.push({ key: `${kp}/sale`, title: "売却", level: "detail", fields: saleFields, actions: [] });
  // この物件のローン（負債の型。「住まい・ローン」の住宅ローン以外のローンと同じ欄）
  const loans = propertyLoans(wh.request.input.household, a.id);
  for (const d of loans) groups.push({ key: `housing/debt/${d.id}`, title: "この物件のローン", level: "simple", fields: loanFields(wh, d, `housing/debt/${d.id}`), actions: [removeAction(`housing/debt/${d.id}/remove`, "外す", "simple", (h) => void (h.debts = (h.debts ?? []).filter((x) => x.id !== d.id)))] });
  groups.push({
    key: `${kp}/loans`,
    level: "simple",
    ...(loans.length === 0 ? { note: "この物件を買うために借りたローンがあれば足してください。利息を不動産所得の経費にします（返済は「住宅ローン以外のローン」として支出に入ります）" } : {}),
    fields: [],
    actions: [
      {
        key: `${kp}/addLoan`,
        label: "＋ この物件のローン",
        level: "simple",
        run: (w) =>
          mutate(w, (h) => {
            const start = (find(h, w) as Account | undefined)?.property?.acquisition?.at ?? w.request.input.baseMonth;
            (h.debts ??= []).push({
              id: newId(),
              kind: "other",
              property: a.id,
              debtors: [{ member: a.owner, role: "primary" }],
              principal: 20000000,
              start: { at: start },
              rateSchedule: [{ from: { at: start }, type: "fixed", rate: "0.02" }],
              repayment: { method: "equalPayment", termMonths: 300 },
            });
          }),
      },
    ],
  });
  return groups;
}

/** 物件1件のまとまり（見出しの欄と中身） */
export function rentalGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  return [headGroup(wh, a), ...propertyGroups(wh, a)];
}

export const RENTAL_HELP =
  "人に貸して、家賃や地代を受け取っている不動産です（アパート・区分マンション・戸建て・店舗・駐車場・貸している土地など）。貸していない土地・別荘は『貯蓄・運用』のその他の資産に入れます";

export function rentalStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const list = rentalProperties(h);
  return {
    id: "rental",
    label: "収益不動産",
    lead: "貸している物件ごとの評価額・家賃・経費・ローン・売却の予定。",
    sections: [
      {
        key: "rental/properties",
        title: "物件",
        note: list.length === 0 ? `まだありません。${RENTAL_HELP}` : `${RENTAL_HELP}。物件の評価額は資産と負債の推移・提案書のバランスシートに入り、家賃収入から経費・減価償却費・ローンの利息を引いた不動産所得は税・社会保険料の計算に入ります`,
        level: "simple",
        groups: list.flatMap((a) => rentalGroups(wh, a)),
        actions: [{ key: "rental/add", label: "＋ 物件を足す", help: "評価額と家賃は未入力（0円で計算中）で始めます", level: "simple", run: (w) => addRentalProperty(w) }],
      },
    ],
  };
}
