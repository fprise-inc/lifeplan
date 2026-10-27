// 8. 貯蓄・運用: 口座・資産の種類ごとの残高（時価）と名義、毎月の積立。取得価額・資産配分・時点・運用の費用・引き出せない期間は詳細で。
// お金の行き先（取り崩す順番・取り崩さない口座・決済口座・預金に残しておく額）は詳細の区画（取り崩す順番の並べ替えは画面の部品。SavingsPanel）
import type { Account, Household } from "../../../engine/types.ts";
import type { Address } from "../../store/readings.ts";
import { addMonths, ageAt, ageReachedMonth } from "../../levers.ts";
import { byId, field, getPath, plain, removeAction, resolveTimepoint, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { confirmedBox, mutate, newId, standardBox, type WorkingHousehold } from "../household.ts";
import { putRow } from "../rows.ts";
import { ACCOUNT_KINDS, ASSET_CLASSES, BUILDING_STRUCTURES, memberLabel, memberOptions, VALUATION_DEFAULTS } from "../labels.ts";
import { loanFields } from "./housing.ts";
import { accountName, UNENTERED_BALANCE, defaultPayoutAge, editPayout, INVEST_KINDS, methodOf, payoutAgeOf, rateOf, reservePreset, setSettlement, settlementOf, setStopAge, stopAgeOf, stopEstimateOf } from "../savings/model.ts";
import { allocationStageGroups, returnStageGroups, stagedGroups } from "../staged.ts";

const accounts = (h: Household) => h.accounts;
const UNENTERED_VALUE = "未入力（評価額を入れてください。0円で計算中）";
/** 欄の当て先（口座の中の入力項目） */
const onAccount = (id: string, item: string, at: string[] = []) => (): Address => ({ target: { object: id }, item, at });
const withAddress = (f: FieldDef, a: () => Address): FieldDef => ({ ...f, address: a });
const WITH_COST = new Set(["taxable", "nisa", "legacyNisa", "juniorNisa", "childNisa"]);
/** 金融資産でない器（不動産・その他の資産）。評価額と増減率だけを入れる */
const NON_FINANCIAL = new Set(["realEstate", "otherAsset"]);

/** 不動産（住まい以外）・その他の資産（貴金属・美術品・貸付金など）: 評価額・時点・増減率。不動産は中身（土地と建物・家賃収入・経費・売却）も */
function otherAssetGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  const label = a.kind === "realEstate" ? "不動産（住まい以外）" : "その他の資産";
  const split = a.kind === "realEstate" && a.property !== undefined;
  const fields: FieldDef[] = [
    plain({ key: `${k}/kind`, item: "account.kind", label: "種類", level: "simple", kind: "select", options: ACCOUNT_KINDS, find, path: ["kind"], structural: true }),
    plain({ key: `${k}/owner`, item: "account.owner", label: "名義", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["owner"] }),
    yenBox({ key: `${k}/value`, item: "account.marketValue", label: split ? "今の評価額（土地と建物の合計）" : "今の評価額", level: "simple", basis: "once", find, path: ["marketValue"] }),
    plain({ key: `${k}/asOf`, item: "account.asOf", label: "評価額の時点", level: "detail", kind: "ym", find, path: ["asOf"] }),
    plain({
      key: `${k}/growth`,
      item: "account.valueGrowth",
      label: split ? "土地の評価額の増減率（年）" : "評価額の増減率（年）",
      level: "simple",
      kind: "pct",
      find,
      path: ["valueGrowth"],
      optional: true,
      help: split
        ? "空欄なら前提条件の土地の上昇率（入れていなければ物価上昇率）。建物は構造の耐用年数で減らします"
        : a.kind === "realEstate"
          ? "空欄なら前提条件の不動産の利回り（入れていなければ0）。マイナスも入れられます"
          : "空欄なら0（評価額のまま）。値下がりするものはマイナスで入れます",
    }),
  ];
  if (a.kind === "realEstate")
    fields.push(
      field({
        key: `${k}/split`,
        item: "account.property",
        label: "土地と建物に分ける（貸しているときの家賃収入・経費も入れる）",
        level: "simple",
        kind: "bool",
        structural: true,
        help: "分けると、建物は構造の耐用年数で減り、土地は残る見込みになります。貸しているなら、家賃収入・経費・減価償却を不動産所得として税の計算に入れます。これから相続・贈与で受け取る不動産の「持ち始める時点」も、分けると入れられます（詳細）",
        get: (w) => ({ value: (find(w.request.input.household, w) as Account | undefined)?.property !== undefined }),
        set: (w, v) =>
          mutate(w, (h) => {
            const x = find(h, w) as Account | undefined;
            if (x === undefined) return;
            if (v === true) x.property ??= {};
            else {
              delete x.property;
              for (const d of h.debts ?? []) if (d.property === x.id) delete d.property;
            }
          }),
      }),
    );
  const groups: GroupDef[] = [
    {
      key: k,
      title: `${label}（${memberLabel(wh, a.owner)}）`,
      level: "simple",
      fields,
      actions: [
        removeAction(`${k}/remove`, "外す", "simple", (h) => {
          h.accounts = (h.accounts ?? []).filter((x) => x.id !== a.id);
          for (const d of h.debts ?? []) if (d.property === a.id) delete d.property;
        }),
      ],
    },
  ];
  if (split) groups.push(...propertyGroups(wh, a, k));
  return groups;
}

/** 住まい以外の不動産の中身: 土地と建物（構造・建った年・土地の割合・取得）、貸している（家賃・空室・変化率・期間）、経費、売却、ローン（0028） */
function propertyGroups(wh: WorkingHousehold, a: Account, k: string): GroupDef[] {
  const find = byId(accounts, a.id);
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
            label: "持ち始める時点（これから相続・贈与で受け取る不動産）",
            level: "detail",
            find: findP,
            path: ["holdFrom"],
            optional: true,
            absentWhenEmpty: true,
            nullText: "今から持っている",
            help: "その月から評価額（その年の年末から）・家賃収入・経費に入れます。受け取るときの支払いはありません（買うなら、購入の支払いを出るお金で入れます）。相続税の目安にも、その時点から入ります",
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
      label: "貸している（家賃収入がある）",
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
    title: "経費（管理費・修繕積立金・固定資産税・管理委託料など）",
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
  // この不動産のローン（負債の型。「住まい・ローン」の住宅ローン以外のローンと同じ欄）
  const loans = (wh.request.input.household.debts ?? []).filter((d) => d.property === a.id);
  for (const d of loans) groups.push({ key: `housing/debt/${d.id}`, title: "この不動産のローン", level: "simple", fields: loanFields(wh, d, `housing/debt/${d.id}`), actions: [removeAction(`housing/debt/${d.id}/remove`, "外す", "simple", (h) => void (h.debts = (h.debts ?? []).filter((x) => x.id !== d.id)))] });
  groups.push({
    key: `${kp}/loans`,
    level: "simple",
    ...(loans.length === 0 ? { note: "この不動産を買うために借りたローンがあれば足してください。利息を不動産所得の経費にします（返済は「住宅ローン以外のローン」として支出に入ります）" } : {}),
    fields: [],
    actions: [
      {
        key: `${kp}/addLoan`,
        label: "＋ この不動産のローン",
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

function accountGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  const firstContribution: Finder = (h, w) => (getPath(find(h, w), ["contributions", "0"]) as Record<string, unknown> | undefined) ?? undefined;
  const owner = wh.request.input.household.members.find((m) => m.id === a.owner);
  const fields: FieldDef[] = [
    plain({ key: `${k}/kind`, item: "account.kind", label: "種類", level: "simple", kind: "select", options: ACCOUNT_KINDS, find, path: ["kind"], structural: true }),
    // 預貯金の名義は詳細（NISA・iDeCo などは枠と税で名義が効くので標準。0078）
    plain({ key: `${k}/owner`, item: "account.owner", label: "名義", level: a.kind === "deposit" ? "detail" : "simple", kind: "select", options: memberOptions(wh), find, path: ["owner"] }),
    yenBox({ key: `${k}/value`, item: "account.marketValue", label: "今の残高（時価）", level: "simple", basis: "once", find, path: ["marketValue"] }),
    plain({ key: `${k}/asOf`, item: "account.asOf", label: "残高の時点", level: "detail", kind: "ym", find, path: ["asOf"] }),
  ];
  if (WITH_COST.has(a.kind)) fields.push(yenBox({ key: `${k}/cost`, item: "account.costBasis", label: "取得価額（元本）", level: "detail", basis: "once", find, path: ["costBasis"], optional: true, help: "空欄なら時価と同じ。NISA の枠・課税口座の税の計算に使います" }));
  fields.push(
    field({
      key: `${k}/monthly`,
      item: "account.contributions",
      label: "毎月の積立",
      level: "simple",
      kind: "yen",
      basis: "monthly",
      optional: true,
      help: a.kind === "nisa" ? "結果の対策「NISAの積立額」でも動かせます" : undefined,
      get: (w) => ({ value: (firstContribution(w.request.input.household, w)?.monthly as number | undefined) ?? null, ...(((find(w.request.input.household, w) as Account | undefined)?.contributions?.length ?? 0) > 1 ? { derived: "積立の期間が複数あります（最初の期間を見せています）" } : {}) }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as Account | undefined;
          if (x === undefined) return;
          x.contributions ??= [];
          if (v === null) {
            x.contributions.splice(0, 1);
            return;
          }
          const c0 = x.contributions[0];
          if (c0 !== undefined) c0.monthly = Number(v);
          // 終わりは空（退職の年まで・推定。0026）
          else x.contributions.push({ from: { at: w.request.input.baseMonth }, to: null, monthly: Number(v) });
        }),
    }),
  );
  if (a.kind !== "deposit" || a.expectedReturn !== undefined)
    fields.push(
      field({
        key: `${k}/rate`,
        item: "account.expectedReturn",
        label: "利回り（年）",
        level: "simple",
        kind: "pct",
        optional: true,
        help: "運用の費用（信託報酬など）を引いた後の利回りで入れます（詳細の「運用の費用」に費用を入れたときは、費用を引く前の利回りにします）。空欄なら資産の配分と前提条件の利回り",
        get: (w) => {
          const x = find(w.request.input.household, w) as Account | undefined;
          return { value: x?.expectedReturn ?? null, ...(x !== undefined && x.expectedReturn === undefined ? { hint: `空欄: 年${(Number(rateOf(w.request, x)) * 100).toFixed(1)}%` } : {}) };
        },
        set: (w, v) =>
          mutate(w, (h) => {
            const x = find(h, w) as Account | undefined;
            if (x === undefined) return;
            if (v === null) delete x.expectedReturn;
            else x.expectedReturn = String(v);
          }),
      }),
    );
  // 運用の費用（口座の入れ方の運用する口座。資産配分の入れ方は配分の信託報酬を使う）
  if (methodOf(wh.request) === "accounts" && INVEST_KINDS.has(a.kind))
    fields.push(
      withAddress(
        plain({ key: `${k}/fee`, item: "account.fee", label: "運用の費用（信託報酬など・年）", level: "detail", kind: "pct", find, path: ["fee"], optional: true, help: "ここに費用を入れると、上の利回りから費用を引いて計算します（そのときは上の利回りを費用を引く前の見込みにします）。空欄は0で、上の利回りを費用を引いた後の見込みとして使います（税は計算で引きます）" }),
        onAccount(a.id, "account.fee"),
      ),
    );
  if (DC_KIND.has(a.kind)) fields.push(...payoutFields(wh, a, k));
  if (a.kind === "smallBusinessMutualAid") fields.push(...mutualAidFields(wh, a, k));
  // 積立の終わり（口座ごと）: いちばん後の期間の終わり。NISA で成長投資枠の積立もあるときは枠ごとに終わりが違うので、積立の表の期間で直す
  const own = (a.contributions ?? []).filter((c) => c.payer !== "employer" || a.kind === "corporateDc");
  const oneTranche = new Set(own.map((c) => (c.tranche === "growth" ? "growth" : "tsumitate"))).size <= 1;
  if (own.length > 0 && oneTranche) {
    const lastContribution: Finder = (h, w) => {
      const list = ((find(h, w) as Account | undefined)?.contributions ?? []).filter((c) => c.payer !== "employer" || a.kind === "corporateDc");
      return list.reduce<(typeof list)[number] | undefined>((x, y) => (x === undefined || (resolveTimepoint(h, y.from) ?? "") >= (resolveTimepoint(h, x.from) ?? "") ? y : x), undefined) as Record<string, unknown> | undefined;
    };
    fields.push(timepointField({ key: `${k}/until`, item: "account.contributions", label: own.length > 1 ? "積立の終わり（最後の期間の最後の月）" : "積立の終わり（最後の月）", level: "detail", find: lastContribution, path: ["to"], startPath: ["from"], ageMeans: "before", optional: true, nullText: "退職の年まで（推定）", ...(owner !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === owner.id) } : {}) }));
  }
  // 引き出せない期間の終わり（その月まで取り崩さない）。iDeCo・企業型DC・小規模企業共済は受け取りの決まりで預金に入るので出さない
  if (!DC_KIND.has(a.kind) && a.kind !== "smallBusinessMutualAid")
    fields.push(
      withAddress(
        timepointField({
          key: `${k}/lock`,
          item: "account.withdrawalLockedUntil",
          label: "引き出せない期間の終わり（その月まで取り崩さない）",
          level: "detail",
          find,
          path: ["withdrawalLockedUntil"],
          optional: true,
          absentWhenEmpty: true,
          nullText: "いつでも引き出せる",
          help: "定期預金の満期・財形の払い出しの条件などで、その月まで取り崩しに使わない口座に入れます。ずっと取り崩さない口座は、お金の行き先の「取り崩さない」で決めます",
          ...(owner !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === owner.id) } : {}),
        }),
        onAccount(a.id, "account.withdrawalLockedUntil"),
      ),
    );
  const groups: GroupDef[] = [
    {
      key: k,
      title: `${ACCOUNT_KINDS.find((o) => o.value === a.kind)?.label ?? "口座"}（${memberLabel(wh, a.owner)}）`,
      level: "simple",
      fields,
      actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.accounts = (h.accounts ?? []).filter((x) => x.id !== a.id)))],
    },
  ];
  if (a.kind === "legacyNisa" || a.kind === "juniorNisa") groups.push(...lotGroups(a, k));
  (a.assetMix ?? []).forEach((_, j) => {
    const findMix: Finder = (h, w) => (getPath(find(h, w), ["assetMix", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
    groups.push({
      key: `${k}/mix/${j}`,
      title: `資産の配分 ${j + 1}`,
      level: "detail",
      fields: [
        plain({ key: `${k}/mix/${j}/class`, item: "account.assetMix", label: "資産の種類", level: "detail", kind: "select", options: ASSET_CLASSES, find: findMix, path: ["assetClass"] }),
        plain({ key: `${k}/mix/${j}/share`, item: "account.assetMix", label: "割合", level: "detail", kind: "pct", find: findMix, path: ["share"] }),
      ],
      actions: [
        removeAction(`${k}/mix/${j}/remove`, "外す", "detail", (h, w) => {
          const x = find(h, w) as Account | undefined;
          if (x?.assetMix === undefined) return;
          x.assetMix = x.assetMix.filter((__, n) => n !== j);
          if (x.assetMix.length === 0) delete x.assetMix;
        }),
      ],
    });
  });
  groups.push({
    key: `${k}/addMix`,
    level: "detail",
    note: (a.assetMix ?? []).length === 0 ? "資産の配分を入れないときは、預金・外貨預金は預金の利回り、ほかは前提条件の運用利回りで計算します" : undefined,
    fields: [],
    actions: [{ key: `${k}/addMixRow`, label: "＋ 資産の配分", level: "detail", run: (w) => mutate(w, (h) => void ((find(h, w) as Account).assetMix ??= []).push({ assetClass: "equity.global", share: (a.assetMix ?? []).length === 0 ? "1" : "0" })) }],
  });
  return groups;
}

const DC_KIND = new Set(["ideco", "corporateDc"]);
const PAYOUT_OPTIONS = [
  { value: "lumpSum", label: "一時金" },
  { value: "annuity", label: "年金" },
  { value: "mixed", label: "併用（一時金と年金）" },
];
const MUTUAL_AID_OPTIONS = [
  { value: "lumpSum", label: "一括" },
  { value: "annuity", label: "分割" },
  { value: "mixed", label: "併用（一括と分割）" },
];
const DEST_OPTIONS = [
  { value: "deposit", label: "預金に入れる" },
  { value: "invest", label: "運用を続ける（NISA・課税口座）" },
];

/** iDeCo・企業型DC の受け取り方・始める年齢・受け取ったお金の行き先（空欄は退職の年に一時金・推定。0026） */
function payoutFields(wh: WorkingHousehold, a: Account, k: string): FieldDef[] {
  const find = byId(accounts, a.id);
  const acc = (w: WorkingHousehold) => find(w.request.input.household, w) as Account | undefined;
  return [
    field({
      key: `${k}/payout`,
      item: "account.payout",
      label: "受け取り方",
      level: "simple",
      kind: "select",
      options: PAYOUT_OPTIONS,
      optional: true,
      structural: true,
      get: (w) => {
        const x = acc(w);
        return x?.payout === undefined ? { value: null, estimated: "空欄は退職の年に一時金で受け取る計算（推定）" } : { value: x.payout.method };
      },
      blankEstimate: () => "lumpSum",
      set: (w, v) => (v === null && acc(w)?.payout === undefined ? w : mutate(w, (h) => editPayout(h, find(h, w) as Account, { method: v === null || v === "" ? null : (v as "lumpSum" | "annuity" | "mixed") }))),
    }),
    field({
      key: `${k}/payoutAge`,
      item: "account.payout",
      label: "受け取りを始める年齢",
      level: "simple",
      kind: "int",
      suffix: "歳",
      min: 60,
      max: 75,
      optional: true,
      get: (w) => {
        const x = acc(w);
        if (x === undefined) return { value: null };
        const age = payoutAgeOf(w.request.input.household, x);
        if (age === null) return { value: null, estimated: `空欄は退職の年（${defaultPayoutAge(w.request, x)}歳。60〜65歳）`, hint: `${defaultPayoutAge(w.request, x)}歳（推定）` };
        const at = resolveTimepoint(w.request.input.household, x.payout?.start);
        const owner = w.request.input.household.members.find((m) => m.id === x.owner);
        const exact = owner === undefined || at === null || at === ageReachedMonth(owner, age);
        return exact ? { value: age } : { value: age, derived: `受け取りの始まりは ${at?.slice(0, 4)}年${Number(at?.slice(5))}月です。年齢を入れ直すと、その年齢に達する月からになります` };
      },
      set: (w, v) => (v === null && payoutAgeOf(w.request.input.household, acc(w) as Account) === null ? w : mutate(w, (h) => editPayout(h, find(h, w) as Account, { age: typeof v === "number" ? v : null }))),
      blankEstimate: (w) => {
        const x = acc(w);
        return x === undefined ? null : defaultPayoutAge(w.request, x);
      },
    }),
    field({
      key: `${k}/payoutDest`,
      item: "account.payout",
      label: "受け取ったお金",
      level: "detail",
      kind: "select",
      options: DEST_OPTIONS,
      get: (w) => ({ value: acc(w)?.payout?.destination ?? "deposit", implicit: acc(w)?.payout?.destination === undefined }),
      set: (w, v) => mutate(w, (h) => editPayout(h, find(h, w) as Account, { destination: v === "invest" ? "invest" : "deposit" })),
    }),
    ...payoutDetailFields(a, k, { years: "年金で受け取る年数", share: "一時金で受け取る割合（併用）", min: 5, max: 20 }),
    enrolledField(a, k, "加入者期間の始まり（年月）", "受け取りを始められる年齢の判定に使います（加入者等期間が10年に満たないと、60歳からは受け取れません）。空欄は残高の時点から"),
  ];
}

/** 受け取りの詳細の欄（年金・分割で受け取る年数、併用の一時金の割合）。受け取り方を選んでいるときだけ */
function payoutDetailFields(a: Account, k: string, o: { years: string; share: string; min: number; max: number; options?: { value: string; label: string }[] }): FieldDef[] {
  const find = byId(accounts, a.id);
  const method = a.payout?.method;
  const out: FieldDef[] = [];
  if (method === "annuity" || method === "mixed")
    out.push(
      withAddress(
        o.options !== undefined
          ? field({
              key: `${k}/payoutYears`,
              item: "account.payout",
              label: o.years,
              level: "detail",
              kind: "select",
              options: o.options,
              get: (w) => {
                const y = (find(w.request.input.household, w) as Account | undefined)?.payout?.annuityYears;
                return { value: String(y ?? 10), ...(y === undefined ? { implicit: true } : {}) };
              },
              set: (w, v) =>
                mutate(w, (h) => {
                  const x = find(h, w) as Account | undefined;
                  if (x?.payout === undefined) return;
                  if (v === null || v === "") delete x.payout.annuityYears;
                  else x.payout.annuityYears = Number(v);
                }),
            })
          : plain({ key: `${k}/payoutYears`, item: "account.payout", label: o.years, level: "detail", kind: "int", suffix: "年", min: o.min, max: o.max, find, path: ["payout", "annuityYears"], fallback: 10 }),
        onAccount(a.id, "account.payout", ["annuityYears"]),
      ),
    );
  if (method === "mixed")
    out.push(withAddress(plain({ key: `${k}/lumpShare`, item: "account.payout", label: o.share, level: "detail", kind: "pct", find, path: ["payout", "lumpShare"], fallback: "0.5", help: "残りを年金（分割）で受け取ります" }), onAccount(a.id, "account.payout", ["lumpShare"])));
  return out;
}

/** 加入の始まり（年月。iDeCo・企業型DC は受け取りを始められる年齢、小規模企業共済は一括の退職所得の勤続期間に使う） */
function enrolledField(a: Account, k: string, label: string, help: string): FieldDef {
  return withAddress(plain({ key: `${k}/enrolled`, item: "account.enrolledSince", label, level: "detail", kind: "ym", find: byId(accounts, a.id), path: ["enrolledSince"], optional: true, help }), onAccount(a.id, "account.enrolledSince"));
}

/**
 * 小規模企業共済の受け取り（0026。エンジンの account.mutualAid）: 受け取り方（一括・分割・併用）と受け取りの始まり。
 * 始まりが空なら受け取らずに残高のまま持つ（廃業・退職の時期を入れてもらう）
 */
function mutualAidFields(wh: WorkingHousehold, a: Account, k: string): FieldDef[] {
  const find = byId(accounts, a.id);
  const acc = (w: WorkingHousehold) => find(w.request.input.household, w) as Account | undefined;
  const owner = wh.request.input.household.members.find((m) => m.id === a.owner);
  const fields: FieldDef[] = [
    field({
      key: `${k}/payout`,
      item: "account.payout",
      label: "受け取り方",
      level: "simple",
      kind: "select",
      options: MUTUAL_AID_OPTIONS,
      optional: true,
      structural: true,
      get: (w) => ({ value: acc(w)?.payout?.method ?? null }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as Account | undefined;
          if (x === undefined) return;
          if (v === null || v === "") {
            delete x.payout;
            return;
          }
          editPayout(h, x, { method: v as "lumpSum" | "annuity" | "mixed" });
        }),
    }),
  ];
  if (a.payout !== undefined)
    fields.push(
      withAddress(
        timepointField({
          key: `${k}/payoutAt`,
          item: "account.payout",
          label: "受け取りを始める時期（廃業・退職など）",
          level: "simple",
          find,
          path: ["payout", "start"],
          optional: true,
          absentWhenEmpty: true,
          nullText: "受け取らない（残高のまま持つ）",
          ...(owner !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === owner.id) } : {}),
        }),
        onAccount(a.id, "account.payout", ["start"]),
      ),
      ...payoutDetailFields(a, k, { years: "分割で受け取る年数", share: "一括で受け取る割合（併用）", min: 10, max: 15, options: [{ value: "10", label: "10年" }, { value: "15", label: "15年" }] }),
    );
  fields.push(enrolledField(a, k, "加入した年月", "一括で受け取るときの退職所得の勤続期間（掛金を納めた期間の近似）に使います。空欄は残高の時点から"));
  return fields;
}

/** 旧NISA・ジュニアNISA の買付の年ごとの内訳（非課税期間が終わった年の年末に課税口座へ移す。空なら全部を残高の時点の年に買ったとみなす） */
function lotGroups(a: Account, k: string): GroupDef[] {
  const find = byId(accounts, a.id);
  const lots = (a.lots as { vintageYear: number; regime: string; costBasis: number; marketValue: number }[] | undefined) ?? [];
  const regimes = a.kind === "juniorNisa" ? [{ value: "junior", label: "ジュニアNISA" }] : [{ value: "general", label: "一般NISA" }, { value: "tsumitate", label: "つみたてNISA" }];
  const groups: GroupDef[] = lots.map((_, j) => {
    const findLot: Finder = (h, w) => (getPath(find(h, w), ["lots", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
    return {
      key: `${k}/lot/${j}`,
      title: `買付の年 ${j + 1}`,
      level: "detail",
      fields: [
        plain({ key: `${k}/lot/${j}/year`, item: "account.lots", label: "買った年", level: "detail", kind: "int", suffix: "年", min: 2014, max: 2023, find: findLot, path: ["vintageYear"] }),
        plain({ key: `${k}/lot/${j}/regime`, item: "account.lots", label: "制度", level: "detail", kind: "select", options: regimes, find: findLot, path: ["regime"] }),
        plain({ key: `${k}/lot/${j}/cost`, item: "account.lots", label: "取得価額", level: "detail", kind: "yen", basis: "once", find: findLot, path: ["costBasis"] }),
        plain({ key: `${k}/lot/${j}/value`, item: "account.lots", label: "時価", level: "detail", kind: "yen", basis: "once", find: findLot, path: ["marketValue"] }),
      ],
      actions: [
        removeAction(`${k}/lot/${j}/remove`, "外す", "detail", (h, w) => {
          const x = find(h, w) as Account | undefined;
          const list = (x?.lots as unknown[] | undefined) ?? [];
          if (x === undefined) return;
          const next = list.filter((__, n) => n !== j);
          if (next.length === 0) delete x.lots;
          else x.lots = next;
        }),
      ],
    };
  });
  const year = Number(a.asOf?.slice(0, 4) ?? "2023");
  groups.push({
    key: `${k}/addLot`,
    level: "detail",
    note: lots.length === 0 ? "買付の年ごとの内訳が無いときは、全部を残高の時点の年に買ったとみなして、非課税期間の終わりを決めます" : "内訳の時価・取得価額の合計を、口座の残高・取得価額にそろえてください",
    fields: [],
    actions: [
      {
        key: `${k}/addLotRow`,
        label: "＋ 買付の年の内訳",
        level: "detail",
        run: (w) =>
          mutate(w, (h) => {
            const x = find(h, w) as Account | undefined;
            if (x === undefined) return;
            const list = ((x.lots as unknown[] | undefined) ?? []).slice();
            list.push({ vintageYear: Math.min(2023, year), regime: a.kind === "juniorNisa" ? "junior" : "general", costBasis: 0, marketValue: 0 });
            x.lots = list;
          }),
      },
    ],
  });
  return groups;
}

/** まとめた金融資産（合計の入れ方・まだ口座に分けていない分）: 合計の残高と平均の利回り */
function pooledGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  return [
    {
      key: k,
      title: "まとめた金融資産（合計の入れ方）",
      level: "simple",
      fields: [
        yenBox({ key: `${k}/value`, item: "account.marketValue", label: "金融資産の合計", level: "simple", basis: "once", find, path: ["marketValue"] }),
        plain({ key: `${k}/rate`, item: "account.expectedReturn", label: "平均の利回り（年）", level: "simple", kind: "pct", find, path: ["expectedReturn"], optional: true }),
        withAddress(plain({ key: `${k}/uninvested`, item: "account.uninvested", label: "運用しない分", level: "detail", kind: "yen", basis: "once", find, path: ["uninvested"], optional: true }), onAccount(a.id, "account.uninvested")),
      ],
      actions: [],
    },
  ];
}

/** 運用の期間: 積立をやめる年齢（空欄は退職の年まで・推定。0026） */
function periodGroup(wh: WorkingHousehold): GroupDef {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  const stop = stopAgeOf(h);
  const now = self === undefined ? null : ageAt(self, wh.request.input.baseMonth);
  // 積立をやめる年齢が今の年齢以下: 積立は1か月も計算に入らない
  const past = stop !== null && now !== null && stop <= now;
  return {
    key: "sav/period",
    title: "運用の期間",
    ...(past ? { note: `積立をやめる年齢（${stop}歳）が今の年齢（${now}歳）以下なので、積立は計算に入っていません。続けるなら、今より後の年齢を入れるか空欄にしてください` } : {}),
    level: "simple",
    fields: [
      field({
        key: "sav/stopAge",
        item: "account.contributions",
        label: "積立をやめる年齢（本人）",
        // 空欄は退職の月まで（推定）でほぼ当たるので詳細（0078）
        level: "detail",
        kind: "int",
        suffix: "歳",
        min: 20,
        max: 90,
        optional: true,
        get: (w) => {
          const h = w.request.input.household;
          const age = stopAgeOf(h);
          if (age !== null) return { value: age };
          const e = stopEstimateOf(w.request);
          if (e.retired) return { value: null, estimated: `退職の年はもう過ぎているので、空欄は${e.until}まで積み立てる計算`, hint: e.until === "最後" ? "最後まで（推定）" : `${e.age}歳（推定）` };
          return { value: null, estimated: `空欄は${e.until}まで積み立てる計算`, hint: `${e.age}歳（推定）` };
        },
        set: (w, v) => (v === null && stopAgeOf(w.request.input.household) === null ? w : mutate(w, (h, req) => setStopAge(h, req.input.baseMonth, typeof v === "number" ? v : null))),
        // 空欄の推定は「口座ごとに持ち主の退職の年まで」の決まりで、年齢を書くと全部の積立を本人の年齢にそろえる（結果が変わる）ので、
        // 推定の値を書く確定はしない（blankEstimate を持たない。「この値にする」と「推定の値をまとめて使う」の数に入らない）
        sideEffects: "すべての積立（iDeCo・企業型DC を除く）の最後の期間の終わりを、この年齢にそろえます",
      }),
    ],
    actions: [],
  };
}

/**
 * 利回りの段階・例外の年（0040。詳細）: 口座ごとの利回りの段階（利回りか資産の配分）と例外の年。資産配分の入れ方では、運用する口座は
 * 共通の資産配分の段階（口座ごとの段階は計算に使わない）、運用しない口座（預金など）は口座ごと
 */
export function returnStagesSection(wh: WorkingHousehold): SectionDef {
  const h = wh.request.input.household;
  const method = methodOf(wh.request);
  const self = h.members.find((m) => m.kind === "self");
  const list = (h.accounts ?? []).filter((a) => !NON_FINANCIAL.has(a.kind) && a.kind !== "insurance" && (method === "total" ? a.kind === "pooled" : a.kind !== "pooled") && !(method === "allocation" && INVEST_KINDS.has(a.kind)));
  const groups: GroupDef[] = [];
  if (method === "allocation") groups.push(...allocationStageGroups(wh, self !== undefined ? { ageOf: (hh: Household) => hh.members.find((m) => m.id === self.id) } : {}));
  for (const a of list) {
    const owner = h.members.find((m) => m.id === a.owner);
    groups.push(
      ...returnStageGroups(wh, {
        key: `sav/${a.id}`,
        find: byId(accounts, a.id),
        accountId: a.id,
        name: `${a.kind === "pooled" ? "金融資産の合計" : (ACCOUNT_KINDS.find((o) => o.value === a.kind)?.label ?? "口座")}（${memberLabel(wh, a.owner)}）`,
        ...(owner !== undefined ? { ageOf: (hh: Household) => hh.members.find((m) => m.id === owner.id) } : {}),
        rate: (hh) => {
          const x = (hh.accounts ?? []).find((y) => y.id === a.id);
          return x === undefined ? null : rateOf({ ...wh.request, input: { ...wh.request.input, household: hh } }, x);
        },
      }),
    );
  }
  return {
    key: "sav/returns",
    title: "利回りの段階・例外の年",
    note: "利回り（資産の配分）を年齢・時期で変えるとき、特定の年だけ変えるときに使います。段の時点の属する年から変わり、運用の費用はこの後に引きます",
    level: "detail",
    groups,
    actions: [],
  };
}

/** 「＋ 口座を足す」の主な4つ（簡易）。ほかは「そのほか」（SavingsPanel が簡易からも開ける） */
export const MAIN_ADD_KINDS: ReadonlySet<string> = new Set(["deposit", "nisa", "ideco", "taxable"]);
/** お子さまの名義で作る器 */
const CHILD_KINDS: ReadonlySet<string> = new Set(["childNisa", "juniorNisa"]);

/** 預金に残しておく額（エンジンの assumptions.withdrawal.minimumDeposit。決済口座の年末の残高がこれを下回ると、ほかの口座から取り崩す） */
const MIN_ADDRESS = (): Address => ({ target: { plan: "assumptions" }, item: "assumptions.withdrawal", at: ["minimumDeposit"] });
function writeMinimum(w: WorkingHousehold, v: number | null, basis: string | null): WorkingHousehold {
  return mutate(w, (_h, req) => {
    const a = (req.input.assumptions ??= { investmentReturn: { default: "0.01" } });
    const wd = { ...(a.withdrawal ?? {}) };
    if (v === null || v <= 0) delete wd.minimumDeposit;
    else wd.minimumDeposit = Math.round(v);
    if (Object.keys(wd).length === 0) delete a.withdrawal;
    else a.withdrawal = wd;
    // 目安のボタンで入れた額は、根拠つきの推定の行にする（打った額は行を外す。0041）
    putRow(req.input as unknown as Record<string, unknown>, MIN_ADDRESS(), basis !== null && v !== null && v > 0 ? { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis } } : undefined);
  });
}

/** 区画「お金の行き先」の欄（取り崩す順番の並べ替えと「取り崩さない」は画面の部品で描く。SavingsPanel の FlowSection） */
export function flowSection(wh: WorkingHousehold): SectionDef {
  const h = wh.request.input.household;
  const deposits = (h.accounts ?? []).filter((a) => a.kind === "deposit");
  const own = (id: string) => memberLabel(wh, (h.accounts ?? []).find((a) => a.id === id)?.owner ?? "");
  const fields: FieldDef[] = [];
  if (deposits.length > 1)
    fields.push(
      field({
        key: "sav/settlement",
        item: "account.settlement",
        label: "収支が入る口座（決済口座）",
        level: "detail",
        kind: "select",
        options: deposits.map((a, i) => ({ value: a.id, label: `${accountName(a, own(a.id))}${deposits.filter((x) => x.owner === a.owner).length > 1 ? ` ${i + 1}` : ""}` })),
        help: "給与・年金が入り、生活費・ローンを払う預金。ここが足りなくなると、下の順番でほかの口座から取り崩します。空欄なら最初の預金",
        get: (w) => {
          const st = settlementOf(w.request.input.household);
          return { value: st?.id ?? null, ...(st?.settlement !== true ? { implicit: true } : {}) };
        },
        set: (w, v) => (typeof v === "string" && v !== "" ? mutate(w, (hh) => setSettlement(hh, v)) : w),
      }),
    );
  const min = wh.request.input.assumptions?.withdrawal?.minimumDeposit;
  fields.push({
    ...field({
      key: "sav/withdraw/min",
      item: "assumptions.withdrawal",
      label: "預金に残しておく額",
      level: "detail",
      kind: "yen",
      basis: "once",
      help: "収支が入る口座の年末の残高がこの額を下回ると、上の順番でほかの口座から取り崩します。その年の年末の額です（今の値段ではありません）。0円なら、預金を使い切ってからほかの口座を取り崩します。手を付けたくないお金があれば入れます",
      get: (w) => {
        const v = w.request.input.assumptions?.withdrawal?.minimumDeposit;
        return { value: v ?? 0, ...(v === undefined ? { implicit: true } : {}) };
      },
      set: (w, v) => writeMinimum(w, typeof v === "number" ? v : null, null),
    }),
    address: MIN_ADDRESS,
  });
  const preset = (months: 6 | 12): ActionDef | null => {
    const p = reservePreset(h, months);
    if (p === null) return null;
    return { key: `sav/withdraw/min/preset${months}`, label: `目安: 生活費の${months === 6 ? "6か月分" : "1年分"}（${(p.value / 10000).toLocaleString("ja-JP")}万円）`, level: "detail", pressed: min === p.value, title: "押した時の基本生活費から額を出します（後で生活費を変えても、この額は変わりません）", run: (w) => writeMinimum(w, p.value, p.basis) };
  };
  return {
    key: "sav/flow",
    title: "お金の行き先",
    level: "detail",
    groups: [{ key: "sav/flow/main", level: "detail", fields, actions: [preset(6), preset(12)].filter((x): x is ActionDef => x !== null) }],
    actions: [],
  };
}

export function savingsStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  const child = h.members.find((m) => m.kind === "child" && m.outside === undefined);
  const add = (kind: string, label: string) => ({
    key: `sav/add/${kind}`,
    label: `＋ ${label}`,
    level: (MAIN_ADD_KINDS.has(kind) ? "simple" : "detail") as "simple" | "detail",
    run: (w: WorkingHousehold) =>
      mutate(w, (hh) => {
        if (self === undefined) return;
        const owner = CHILD_KINDS.has(kind) && child !== undefined ? child.id : self.id;
        // 残高は「未入力（0円で計算中）」の印で始める（打つと確定。0041）
        const a: Account = { id: newId(), kind, owner, marketValue: standardBox(0, NON_FINANCIAL.has(kind) ? UNENTERED_VALUE : UNENTERED_BALANCE), asOf: w.request.input.baseMonth, contributions: [] };
        if (kind === "nisa" || kind === "taxable" || kind === "childNisa") {
          a.costBasis = confirmedBox(0);
          a.assetMix = [{ assetClass: "equity.global", share: "1" }];
        }
        (hh.accounts ??= []).push(a);
      }),
  });
  return {
    id: "savings",
    label: "貯蓄・運用",
    lead: "口座・資産の種類ごとの今の残高と、毎月の積立。",
    sections: [
      {
        key: "sav/accounts",
        title: "金融資産",
        level: "simple",
        groups: [
          ...(h.accounts ?? []).filter((a) => !NON_FINANCIAL.has(a.kind) && a.kind !== "pooled").flatMap((a) => accountGroups(wh, a)),
          ...(h.accounts ?? []).filter((a) => a.kind === "pooled").flatMap((a) => pooledGroups(wh, a)),
          ...((h.accounts ?? []).some((a) => !NON_FINANCIAL.has(a.kind) && (a.contributions ?? []).length > 0) ? [periodGroup(wh)] : []),
        ],
        actions: [
          add("deposit", "預貯金"),
          add("nisa", "NISA"),
          add("ideco", "iDeCo"),
          add("taxable", "課税口座"),
          add("zaikei", "財形貯蓄"),
          add("corporateDc", "企業型DC（会社の確定拠出年金）"),
          add("fxDeposit", "外貨預金"),
          add("esop", "持株会"),
          add("smallBusinessMutualAid", "小規模企業共済"),
          add("legacyNisa", "旧NISA（2023年までの一般・つみたて）"),
          add("juniorNisa", "ジュニアNISA"),
          add("childNisa", "こどもNISA"),
        ],
      },
      {
        key: "sav/others",
        title: "不動産（住まい以外）・その他の資産",
        note: "資産と負債の推移・提案書のバランスシートに入ります（金融資産には入れず、取り崩しにも使いません）。住まいは「住まい・ローン」で、車は「車」で入れます",
        level: (h.accounts ?? []).some((a) => NON_FINANCIAL.has(a.kind)) ? "simple" : "detail",
        groups: (h.accounts ?? []).filter((a) => NON_FINANCIAL.has(a.kind)).flatMap((a) => otherAssetGroups(wh, a)),
        actions: [add("realEstate", "不動産（住まい以外）"), add("otherAsset", "その他の資産")],
      },
      returnStagesSection(wh),
      ...(methodOf(wh.request) === "total" ? [] : [flowSection(wh)]),
    ],
  };
}
