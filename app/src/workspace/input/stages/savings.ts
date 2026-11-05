// 8. 貯蓄・運用: 口座・資産の種類ごとの残高（時価）と名義、毎月の積立。取得価額・資産配分・時点・運用の費用・引き出せない期間は詳細で。
// お金の行き先（取り崩す順番・取り崩さない口座・決済口座・預金に残しておく額）は詳細の区画（取り崩す順番の並べ替えは画面の部品。SavingsPanel）
import type { Account, Household } from "../../../engine/types.ts";
import type { Address } from "../../store/readings.ts";
import { ageAt, ageReachedMonth } from "../../levers.ts";
import { byId, field, getPath, plain, removeAction, resolveTimepoint, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { confirmedBox, mutate, newId, standardBox, type WorkingHousehold } from "../household.ts";
import { putRow } from "../rows.ts";
import { ACCOUNT_KINDS, ASSET_CLASSES, BUILDING_STRUCTURES, HELD_ESTATE_OPTIONS, HELD_SALE_TAXATION, heldEstateSubtypeOf, memberLabel, memberOptions, OTHER_ASSET_OPTIONS, otherAssetSubtypeOf, VALUATION_DEFAULTS } from "../labels.ts";
import { addMonths } from "../../levers.ts";
import { dropHeldCostRows, heldCostRow, heldEstateCostEstimate, heldEstateTaxInputs, newHeldCostRow, startsHeldEstateCost } from "../heldEstateTax.ts";
import { isRentalProperty, UNENTERED_RENT } from "./rental.ts";
import { accountName, UNENTERED_BALANCE, defaultPayoutAge, editPayout, INVEST_KINDS, methodOf, payoutAgeOf, rateOf, reservePreset, setSettlement, settlementOf, setStopAge, stopAgeOf, stopEstimateOf } from "../savings/model.ts";
import { allocationStageGroups, returnStageGroups } from "../staged.ts";
import { FEE_RANGE, RETURN_RANGE } from "../rateRanges.ts";
import { ASSET_SUBTYPES, executiveMembers } from "../officer.ts";

const accounts = (h: Household) => h.accounts;
const UNENTERED_VALUE = "未入力（評価額を入れてください。0円で計算中）";
/** 欄の当て先（口座の中の入力項目） */
const onAccount = (id: string, item: string, at: string[] = []) => (): Address => ({ target: { object: id }, item, at });
const withAddress = (f: FieldDef, a: () => Address): FieldDef => ({ ...f, address: a });
const WITH_COST = new Set(["taxable", "nisa", "legacyNisa", "juniorNisa", "childNisa", "cryptoAsset"]);
/**
 * 暗号資産のまとまりの説明（0122・0124）。金融資産に入れ、2028年からの申告分離課税で取り崩す（2027年までと雑所得の物は取り崩さない）
 */
const CRYPTO_NOTE =
  "取引所・ウォレットにある暗号資産の、今の円の評価額を入れます。金融資産の合計に入り、お金が足りなくなった年は課税口座の次に取り崩します（順番は「お金の行き先」で変えられます）。令和8年度税制改正で、国内の登録業者で売る暗号資産の利益は2028年1月からの取引で申告分離課税（約20%）になる見込みなので、2028年からは取り崩した利益にその税をかけます。2027年までは今の雑所得（ほかの所得と合わせた税）のままで、この計算ではその税を出せないので取り崩しません（足りない分は資金の不足に出ます）。2027年までに売る予定は、売る額を入るお金の行（課税の扱いは「雑所得（その他）」、取得費に買った額）で入れ、売る分をこの残高から外します（二重に数えないため）";
/** 暗号資産を売ったときの税の扱い（0124） */
const CRYPTO_TAXATION = [
  { value: "separate", label: "申告分離課税（2028年から）" },
  { value: "miscellaneous", label: "雑所得（取り崩さない）" },
];
const CRYPTO_TAXATION_HELP =
  "2028年1月からは、金融商品取引業者の登録簿に載る暗号資産（特定暗号資産）を国内の登録業者で売った利益が申告分離課税（所得税15%・復興特別所得税・住民税5%で約20.315%）になる見込みです（令和8年度税制改正。制度の値は確認待ち）。取り崩した額のうち利益（売った額−取得価額の割合の分）にこの税をかけ、損失は翌年から3年まで繰り越して、同じ人の暗号資産の利益から引きます（ほかの所得・株式などとは通算しません）。税は売った年に引きます（実際は翌年の確定申告）。この利益は国民健康保険料などの所得には入れていません。海外の取引所や個人の間で売る物、登録簿に載らない暗号資産は今までどおり雑所得（総合課税）なので、「雑所得」を選ぶと取り崩しに使いません（売る予定は入るお金の行の「雑所得（その他）」で入れます）";
/** 金融資産でない器（不動産・その他の資産）。評価額と増減率だけを入れる */
const NON_FINANCIAL = new Set(["realEstate", "otherAsset"]);

/**
 * 貸していない不動産（土地・別荘など。評価額だけ）・その他の資産（貴金属・暗号資産・会員権など）: 評価額・時点・増減率。
 * その他の資産は中身（細目 subtype。0120）を選べる。細目は表示とバランスシートの行の名前だけで、計算には使わない。
 * 貸している不動産（中身 property を持つ不動産の器）は「収益不動産」の項目で入れる（0079。stages/rental.ts）
 */
function otherAssetGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  const estate = a.kind === "realEstate";
  // 自社株（出資額）・会社への貸付金（役員として働く人の家計の側。0105）: 種類は「その他の資産」のまま、細目で名前と説明を変える
  const sub = a.kind === "otherAsset" && a.subtype !== undefined && Object.hasOwn(ASSET_SUBTYPES, a.subtype) ? ASSET_SUBTYPES[a.subtype as keyof typeof ASSET_SUBTYPES] : undefined;
  // 中身（貴金属・暗号資産など。0120）: その他の資産だけ。細目の無いものは「その他」
  const kindOf = a.kind === "otherAsset" && sub === undefined ? otherAssetSubtypeOf(a.subtype) : null;
  // 貸していない不動産の中身（土地・別荘・空き家など。0123）
  const estateKind = estate ? heldEstateSubtypeOf(a.subtype) : null;
  // 中身・評価額・時点を直したら、毎年の費用の目安を入れる（行が無いか推定のままのとき。0123）
  const costs = (f: FieldDef): FieldDef => (estate ? startsHeldEstateCost(f, a.id) : f);
  const fields: FieldDef[] = [
    // 種類を変えたら、中身の細目・毎年の費用の行・税の扱いを外す（細目は種類ごと）
    plain({
      key: `${k}/kind`,
      item: "account.kind",
      label: "種類",
      level: "simple",
      kind: "select",
      options: ACCOUNT_KINDS,
      find,
      path: ["kind"],
      structural: true,
      after: (h, t, v) => {
        if (v === a.kind) return;
        delete t.subtype;
        // 持ち始める時点・建物の建った年と構造は貸していない不動産だけ（0123 の追記 2026-11-05）
        if (v !== "realEstate") for (const key of ["holdFrom", "builtYear", "structure"]) delete t[key];
        dropHeldCostRows(h, a.id);
        const sale = t.sale as { taxation?: string } | undefined;
        if (sale !== undefined) delete sale.taxation;
        // 暗号資産（金融資産の器。0122）へ変えたら、評価額の増減率を器の利回りへ移す（暗号資産は増減率を読まない）。売る予定は持たない
        if (v === "cryptoAsset") {
          delete t.sale;
          delete t.acquiredAt;
          if (t.valueGrowth !== undefined) {
            t.expectedReturn ??= t.valueGrowth;
            delete t.valueGrowth;
          }
        }
      },
    }),
    ...(a.kind === "otherAsset" && sub === undefined
      ? [plain({ key: `${k}/subtype`, item: "account.subtype", label: "中身", level: "simple", kind: "select", options: OTHER_ASSET_OPTIONS, find, path: ["subtype"], fallback: "other", structural: true, help: kindOf?.note ?? "資産と負債のタブ・提案書のバランスシートで、中身ごとの行に分けて見せます（同じ中身はまとめます）。売る予定の税の扱いの既定も中身で決めます" })]
      : []),
    ...(estate
      ? [costs(plain({ key: `${k}/subtype`, item: "account.subtype", label: "中身", level: "simple", kind: "select", options: HELD_ESTATE_OPTIONS, find, path: ["subtype"], fallback: "other", structural: true, help: estateKind?.note ?? "土地・別荘・空き家を選ぶと、毎年かかる費用（固定資産税・都市計画税）の目安を入れます。計算は中身で変わりません" }))]
      : []),
    plain({ key: `${k}/owner`, item: "account.owner", label: "名義", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["owner"] }),
    costs(yenBox({ key: `${k}/value`, item: "account.marketValue", label: a.subtype === "ownCompanyShares" ? "出資額（払い込んだ額）" : a.subtype === "loanToCompany" ? "今の貸付金の残り" : "今の評価額", level: "simple", basis: "once", find, path: ["marketValue"] })),
    // 開いても欄が1つだけになるので、標準でも出す
    costs(plain({ key: `${k}/asOf`, item: "account.asOf", label: "評価額の時点", level: "simple", kind: "ym", find, path: ["asOf"] })),
    // 持ち始める時点（貸していない不動産。これから相続・購入する土地・別荘など。収益不動産・持ち家と同じ。0123 の追記 2026-11-05）
    ...(estate
      ? [
          costs(
            timepointField({
              key: `${k}/holdFrom`,
              item: "account.holdFrom",
              label: "持ち始める時点",
              level: "detail",
              find,
              path: ["holdFrom"],
              optional: true,
              absentWhenEmpty: true,
              nullText: "今から持っている",
              help: "これから相続・購入する土地・別荘などの、持ち始める月です。その月から評価額（その年の年末から）・毎年かかる費用に入れます。受け取るときの支払いはありません（買うなら、購入の支払いを出るお金で入れます）。相続税の目安にも、その時点から入ります。評価額は「評価額の時点」の額から増減率で動かします",
              ...(wh.request.input.household.members.some((m) => m.id === a.owner) ? { ageOf: (h: Household) => h.members.find((m) => m.id === a.owner) } : {}),
            }),
          ),
        ]
      : []),
    // 建物の構造と建った年（空き家・別荘。固定資産税の目安で、建物を古くなった分だけ下げる。0123 の追記 2026-11-05）
    ...(estate && (a.subtype === "villa" || a.subtype === "vacantHouse")
      ? [
          // 推定のままの毎年の費用は、入力を直すたびに入れ直す（refreshEstimates）ので、ここでは包まない
          plain({ key: `${k}/builtYear`, item: "account.builtYear", label: "建物が建った年", level: "simple", kind: "int", suffix: "年", min: 1900, max: 2200, find, path: ["builtYear"], optional: true, help: "固定資産税の目安で、建物を古くなった分だけ下げます（3年ごとの評価替えで、新築の評価額の20%まで）。入れなければ、古くなった分を下げずに目安を出します" }),
          plain({ key: `${k}/structure`, item: "account.structure", label: "建物の構造", level: "detail", kind: "select", options: BUILDING_STRUCTURES, find, path: ["structure"], optional: true, fallback: "wood", help: "固定資産税の目安で、建物の評価額が下がる年数に使います（木造・軽量鉄骨造は30年、重量鉄骨造・鉄筋コンクリート造は60年で下限まで）" }),
        ]
      : []),
    plain({
      key: `${k}/growth`,
      item: "account.valueGrowth",
      label: "評価額の増減率（年）",
      level: "simple",
      kind: "pct",
      ...RETURN_RANGE,
      find,
      path: ["valueGrowth"],
      optional: true,
      help: estate ? "入れなければ前提条件の不動産の利回り（入れていなければ0）。マイナスも入れられます" : "入れなければ0（評価額のまま）。値下がりするものはマイナスで入れます",
    }),
  ];
  if (estate) fields.push(heldCostField(wh, a));
  // 細目のある資産は種類を変えない（名前が細目で決まるため）・増減させない（出資額・貸付金の残りのまま）
  if (sub !== undefined) for (const key of [`${k}/growth`, `${k}/kind`]) fields.splice(fields.findIndex((f) => f.key === key), 1);
  const actions: ActionDef[] = [
    removeAction(`${k}/remove`, "外す", "simple", (h) => {
      h.accounts = (h.accounts ?? []).filter((x) => x.id !== a.id);
      for (const d of h.debts ?? []) if (d.property === a.id) delete d.property;
      dropHeldCostRows(h, a.id);
    }),
  ];
  // 貸している不動産なら、収益不動産へ移す（中身を持たせる。家賃は未入力の印で始める）
  if (estate)
    actions.unshift({
      key: `${k}/toRental`,
      label: "収益不動産へ移す",
      level: "simple",
      help: "人に貸している物件なら、収益不動産の項目へ移します。家賃収入・経費・ローン・売却と、建物の減価償却を入れられるようになります（評価額と名義はそのまま）",
      run: (w) =>
        mutate(w, (h) => {
          const x = (h.accounts ?? []).find((y) => y.id === a.id);
          if (x !== undefined) moveToRental(h, x);
        }),
    });
  const groups: GroupDef[] = [
    {
      key: k,
      title: `${estate ? (estateKind?.short ?? "貸していない不動産") : (sub?.label ?? kindOf?.short ?? "その他の資産")}（${memberLabel(wh, a.owner)}）`,
      ...(estate ? { note: "評価額だけで持つ不動産（貸していない土地・別荘など）です。人に貸している物件は「収益不動産」で入れます（「収益不動産へ移す」で移せます）" } : sub !== undefined ? { note: sub.note } : {}),
      level: "simple",
      // 「▸ 続きを見る」の文（詳細の欄: 持ち始める時点・建物の構造。0078 の追記 2026-11-01）
      ...(estate ? { moreLabel: a.subtype === "villa" || a.subtype === "vacantHouse" ? "持ち始める時点・建物の構造を入れる" : "持ち始める時点を入れる" } : {}),
      fields,
      actions,
    },
  ];
  // 売る予定（役員の細目〔出資額・貸付金〕は売らない。0123）
  if (sub === undefined) groups.push(saleGroup(wh, a));
  return groups;
}

/** 貸していない不動産の毎年の費用（固定資産税・管理費など）: 物の ID でつないだ出るお金の行の額（0123。heldEstateTax.ts） */
function heldCostField(wh: WorkingHousehold, a: Account): FieldDef {
  const k = `sav/${a.id}`;
  const row = heldCostRow(wh.request.input.household, a.id);
  const canEstimate = heldEstateTaxInputs(wh.request.input.household, a, wh.request.input.baseMonth, wh.request.input.assumptions?.realEstateValuation?.landShare, wh.request.input.assumptions?.assetReturns?.realEstate) !== null;
  const f = yenBox({
    key: `${k}/cost`,
    item: "periodicExpense.amount",
    label: "毎年かかる費用（固定資産税・管理費など）",
    level: "simple",
    basis: "annual",
    find: (h) => heldCostRow(h, a.id) as unknown as Record<string, unknown> | undefined,
    ensure: (h, w) => {
      const p = newHeldCostRow(a.id, w.request.input.baseMonth, { value: 0, state: "confirmed", origin: { kind: "manual" } });
      (h.periodicExpenses ??= []).push(p);
      return p as unknown as Record<string, unknown>;
    },
    path: ["amount"],
    optional: true,
    estimate: (_h, w) => heldEstateCostEstimate(w, a.id),
    help: `年額です。毎年払い、売る予定を入れたら売る月から払いません（額は伸ばしません）。${canEstimate ? "空にすると固定資産税・都市計画税の目安（評価額と中身から出した額。管理費などは含みません）に戻ります。管理費・管理委託・草刈りなどがあれば足した額を入れます" : "中身で土地・別荘・空き家を選ぶと、固定資産税・都市計画税の目安が入ります"}`,
  });
  // 空にして目安も出ない行は外す（額の無い行を残さない）
  const tidy = (w: WorkingHousehold): WorkingHousehold =>
    mutate(w, (h) => {
      const p = heldCostRow(h, a.id);
      if (p !== undefined && (p.amount === undefined || p.amount.value === null || p.amount.value === undefined)) dropHeldCostRows(h, a.id);
    });
  return {
    ...f,
    ...(row !== undefined ? { address: () => ({ target: { object: row.id }, item: "periodicExpense.amount", at: [] }) } : {}),
    set: (w, v) => tidy(f.set(w, v)),
    ...(f.write !== undefined ? { write: (w: WorkingHousehold, v: Parameters<FieldDef["set"]>[1]) => tidy(f.write!(w, v)) } : {}),
    ...(f.boxed !== undefined ? { boxed: { ...f.boxed, write: (w: WorkingHousehold, box: Record<string, unknown> | undefined) => tidy(f.boxed!.write(w, box)) } } : {}),
  };
}

/** 売る予定（貸していない不動産・その他の資産。0123）: 売る時期・売却価格・費用・税の扱い・取得価額・取得の年月 */
function saleGroup(wh: WorkingHousehold, a: Account): GroupDef {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}/sale`;
  const estate = a.kind === "realEstate";
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  const setting = wh.request.input.assumptions?.realEstateValuation;
  const help = estate
    ? "売ると、売却価格から売却の費用を引いた手取りが預金に入り、その年の年末から不動産は無くなります（毎年の費用も売る月から払いません）。譲渡所得の税（売った年の1月1日に所有期間が5年を超えれば長期で所得税15%・住民税5%、5年以下は短期で30%・9%。復興特別所得税などを含む）を、翌年3月の所得税と翌年度の住民税として計算します。取得費は取得価額（入っていなければ売却価格の5%）です"
    : "売ると、売却価格から売却の費用を引いた手取りが預金に入り、その年の年末から資産は無くなります。貴金属・美術品・会員権などは総合課税の譲渡所得（取得から5年を超えれば長期で2分の1、特別控除50万円）として、その年の所得税・翌年度の住民税に入れます。生活に使う家具・衣服や、1個（1組）30万円以下の貴金属・美術品は非課税です";
  const fields: FieldDef[] = [
    field({
      key: `${k}/on`,
      item: "account.sale",
      label: "売る予定がある",
      level: "simple",
      kind: "bool",
      structural: true,
      help,
      get: (w) => ({ value: (find(w.request.input.household, w) as Account | undefined)?.sale !== undefined }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as Account | undefined;
          if (x === undefined) return;
          if (v === true) x.sale ??= { at: { at: addMonths(w.request.input.baseMonth, 120) } };
          else delete x.sale;
        }),
    }),
  ];
  if (a.sale !== undefined) {
    fields.push(
      timepointField({ key: `${k}/at`, item: "account.sale", label: "売る時期", level: "simple", find, path: ["sale", "at"], ...ageOf }),
      plain({ key: `${k}/price`, item: "account.sale", label: "売却価格", level: "simple", kind: "yen", basis: "once", find, path: ["sale", "price"], optional: true, help: "入れなければ、売る年の年末の評価額（増減率で動かした額）で売るとみなします" }),
      plain({
        key: `${k}/costRate`,
        item: "account.sale",
        label: "売却の費用（売却価格に対する割合）",
        level: "detail",
        kind: "pct",
        find,
        path: ["sale", "costRate"],
        optional: true,
        fallback: estate ? (setting?.saleCostRate ?? VALUATION_DEFAULTS.saleCostRate) : "0",
        help: estate ? "仲介手数料・印紙税など。譲渡所得の計算では譲渡費用として引きます" : "買取の手数料など。入れなければ0。譲渡所得の計算では譲渡費用として引きます",
      }),
    );
    if (!estate)
      fields.push(
        plain({
          key: `${k}/taxation`,
          item: "account.sale",
          label: "売ったときの税",
          level: "simple",
          kind: "select",
          options: HELD_SALE_TAXATION,
          find,
          path: ["sale", "taxation"],
          optional: true,
          fallback: a.subtype === "securityDeposit" ? "nonTaxable" : "transfer",
          help: "入れなければ中身から決めます（敷金・保証金は非課税、ほかは譲渡所得）。家具・衣服など生活に使う物や、1個（1組）30万円以下の貴金属・美術品は非課税を選びます。金地金・会員権は値段によらず譲渡所得です",
        }),
      );
    const taxed = estate || (a.sale.taxation ?? (a.subtype === "securityDeposit" ? "nonTaxable" : "transfer")) !== "nonTaxable";
    if (taxed)
      fields.push(
        yenBox({ key: `${k}/cost`, item: "account.costBasis", label: "取得価額（買ったときの代金と諸費用）", level: "detail", basis: "once", find, path: ["costBasis"], optional: true, help: estate ? "購入の代金と仲介手数料・登記などの諸費用の合計。相続・贈与で受け取った物は、元の持ち主の取得価額です。入れなければ、売却価格の5%（概算取得費）で計算します" : "買ったときの代金と手数料の合計。相続・贈与で受け取った物は、元の持ち主の取得価額です。入れなければ、売却価格の5%（概算取得費）で計算します" }),
        plain({ key: `${k}/acquiredAt`, item: "account.acquiredAt", label: "取得の年月", level: "detail", kind: "ym", find, path: ["acquiredAt"], optional: true, help: estate ? "売った年の1月1日に5年を超えて持っていれば長期譲渡です。入れなければ長期とみなします。相続・贈与で受け取った物は、元の持ち主の取得の年月です" : "取得から売るまでが5年を超えれば長期譲渡（2分の1を課税）です。入れなければ長期とみなします。相続・贈与で受け取った物は、元の持ち主の取得の年月です" }),
      );
  }
  return { key: k, title: "売る予定", level: "simple", moreLabel: "売却の費用・取得価額を入れる", fields, actions: [] };
}

/** 貸していない不動産を収益不動産へ移す: 中身を持たせ、売る予定・取得・毎年の費用を中身の欄へ移す（0123） */
function moveToRental(h: Household, x: Account): void {
  const cost = heldCostRow(h, x.id);
  const p: NonNullable<Account["property"]> = x.property ?? { rental: { monthly: standardBox(0, UNENTERED_RENT) } };
  if (x.sale !== undefined) p.sale = { at: x.sale.at, ...(x.sale.price !== undefined ? { price: x.sale.price } : {}), ...(x.sale.costRate !== undefined ? { costRate: x.sale.costRate } : {}) };
  const basis = x.costBasis?.value;
  if (typeof basis === "number" && x.acquiredAt !== undefined) {
    p.acquisition = { price: basis, at: x.acquiredAt };
    delete x.costBasis;
  }
  if (cost !== undefined && typeof cost.amount.value === "number") p.expenses = { annual: cost.amount };
  // 持ち始める時点・建物の建った年と構造は、中身の欄へ移す（0123 の追記 2026-11-05）
  if (x.holdFrom !== undefined) p.holdFrom ??= x.holdFrom;
  if (x.builtYear !== undefined) p.builtYear ??= x.builtYear;
  if (x.structure !== undefined) p.structure ??= x.structure;
  x.property = p;
  delete x.sale;
  delete x.acquiredAt;
  delete x.subtype;
  delete x.holdFrom;
  delete x.builtYear;
  delete x.structure;
  dropHeldCostRows(h, x.id);
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
  if (WITH_COST.has(a.kind))
    fields.push(
      yenBox({
        key: `${k}/cost`,
        item: "account.costBasis",
        label: a.kind === "cryptoAsset" ? "取得価額（買った額の合計）" : "取得価額（元本）",
        level: "detail",
        basis: "once",
        find,
        path: ["costBasis"],
        optional: true,
        help:
          a.kind === "cryptoAsset"
            ? "今持っている暗号資産を買った額の合計（総平均法などで出した取得価額）です。入れなければ時価と同じ（今までの値上がりの分に税がかからない）とします。2028年からの取り崩しの利益の税の計算に使います"
            : "入れなければ時価と同じとします。NISA の枠・課税口座の税の計算に使います",
      }),
    );
  // 暗号資産を売ったときの税の扱い（0124）
  if (a.kind === "cryptoAsset")
    fields.push(plain({ key: `${k}/cryptoTax`, item: "account.cryptoTaxation", label: "売ったときの税", level: "detail", kind: "select", options: CRYPTO_TAXATION, find, path: ["cryptoTaxation"], optional: true, fallback: "separate", structural: true, help: CRYPTO_TAXATION_HELP }));
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
        ...RETURN_RANGE,
        optional: true,
        help:
          a.kind === "cryptoAsset"
            ? "1年あたりの評価額の増え方の見込みです。入れなければ0（今の評価額のまま）で計算します。値動きが大きいので、ふつうは入れずに見ます"
            : "1年あたりの見込みの利回りを、信託報酬などの費用を引いた後で入れます。入れなければ、資産の配分や前提条件の利回りで計算します（費用を別に入れる形は「詳細」で）",
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
        plain({ key: `${k}/fee`, item: "account.fee", label: "運用の費用（年）", level: "detail", kind: "pct", ...FEE_RANGE, find, path: ["fee"], optional: true, help: "信託報酬など。ここに費用を入れると、上の利回りから費用を引いて計算します（そのときは上の利回りを費用を引く前の見込みにします）。入れなければ0で、上の利回りを費用を引いた後の見込みとして使います（税は計算で引きます）" }),
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
    fields.push(timepointField({ key: `${k}/until`, item: "account.contributions", label: own.length > 1 ? "積立の終わり（最後の月）" : "積立の終わり（最後の月）", level: "detail", find: lastContribution, path: ["to"], startPath: ["from"], ageMeans: "before", optional: true, nullText: "退職の年まで（推定）", ...(owner !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === owner.id) } : {}) }));
  }
  // 引き出せない期間の終わり（その月まで取り崩さない）。iDeCo・企業型DC・小規模企業共済は受け取りの決まりで預金に入るので出さない。
  // 雑所得の暗号資産は取り崩さないので出さない（0124）
  if (!DC_KIND.has(a.kind) && a.kind !== "smallBusinessMutualAid" && !(a.kind === "cryptoAsset" && a.cryptoTaxation === "miscellaneous"))
    fields.push(
      withAddress(
        timepointField({
          key: `${k}/lock`,
          item: "account.withdrawalLockedUntil",
          label: "引き出せない期間の終わり",
          level: "detail",
          find,
          path: ["withdrawalLockedUntil"],
          optional: true,
          absentWhenEmpty: true,
          nullText: "いつでも引き出せる",
          help: "その月まで取り崩しません。定期預金の満期・財形の払い出しの条件などで、その月まで取り崩しに使わない口座に入れます。ずっと取り崩さない口座は、お金の行き先の「取り崩さない」で決めます",
          ...(owner !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === owner.id) } : {}),
        }),
        onAccount(a.id, "account.withdrawalLockedUntil"),
      ),
    );
  const groups: GroupDef[] = [
    {
      key: k,
      title: `${ACCOUNT_KINDS.find((o) => o.value === a.kind)?.label ?? "口座"}（${memberLabel(wh, a.owner)}）`,
      ...(a.kind === "cryptoAsset" ? { note: CRYPTO_NOTE } : {}),
      level: "simple",
      fields,
      actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.accounts = (h.accounts ?? []).filter((x) => x.id !== a.id)))],
    },
  ];
  if (a.kind === "legacyNisa" || a.kind === "juniorNisa") groups.push(...lotGroups(a, k));
  // 暗号資産は資産の配分を足さない（資産の種類の一覧に暗号資産が無い。利回りは上の欄で入れる。0122）。入っていれば今までどおり見せる
  if (a.kind === "cryptoAsset" && (a.assetMix ?? []).length === 0) return groups;
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
        return x?.payout === undefined ? { value: null, estimated: "退職の年に一時金で受け取る計算" } : { value: x.payout.method };
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
        if (age === null) return { value: null, estimated: `退職の年（${defaultPayoutAge(w.request, x)}歳。60〜65歳）`, hint: `${defaultPayoutAge(w.request, x)}歳（推定）` };
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
    ...payoutDetailFields(a, k, { years: "年金で受け取る年数", share: "一時金で受け取る割合", min: 5, max: 20 }),
    enrolledField(a, k, "加入者期間の始まり", "受け取りを始められる年齢の判定に使います（加入者等期間が10年に満たないと、60歳からは受け取れません）。入れなければ残高の時点から"),
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
          label: "受け取りを始める時期", help: "廃業・退職などで受け取りを始める月です",
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
      ...payoutDetailFields(a, k, { years: "分割で受け取る年数", share: "一括で受け取る割合", min: 10, max: 15, options: [{ value: "10", label: "10年" }, { value: "15", label: "15年" }] }),
    );
  fields.push(enrolledField(a, k, "加入した年月", "一括で受け取るときの退職所得の勤続期間（掛金を納めた期間の近似）に使います。入れなければ残高の時点から"));
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
      title: "まとめた金融資産",
      level: "simple",
      fields: [
        yenBox({ key: `${k}/value`, item: "account.marketValue", label: "金融資産の合計", level: "simple", basis: "once", find, path: ["marketValue"] }),
        plain({ key: `${k}/rate`, item: "account.expectedReturn", label: "平均の利回り（年）", level: "simple", kind: "pct", ...RETURN_RANGE, find, path: ["expectedReturn"], optional: true }),
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
        label: "積立をやめる年齢（ご本人）",
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
          if (e.retired) return { value: null, estimated: `退職の年はもう過ぎているので、${e.until}まで積み立てる計算`, hint: e.until === "最後" ? "最後まで（推定）" : `${e.age}歳（推定）` };
          return { value: null, estimated: `${e.until}まで積み立てる計算`, hint: `${e.age}歳（推定）` };
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
    title: "利回りの変化",
    note: "利回り（資産の配分）を、年齢・時期から先ずっと変えるとき（この年から先）や、特定の年だけ変えるとき（この年だけ）に使います。年の初めから変わり、運用の費用はこの後に引きます",
    level: "detail",
    groups,
    actions: [],
  };
}

/**
 * 貯蓄・運用の表の口座1つの「▸ 続きを見る」の文（0078 の追記 2026-11-01。SavingsPanel が表の行に出す）: 口座の種類で開く欄が違うので、
 * 種類ごとに代表の欄を書く。積立の終わりは、積立がある口座だけに出る（外貨預金は表に積立の欄が無い）。無ければ「続きを見る」のまま
 */
export function accountMoreLabel(a: Pick<Account, "kind" | "contributions">): string | undefined {
  switch (a.kind) {
    case "legacyNisa":
    case "juniorNisa":
      return "買付の年・資産の配分を入れる";
    case "nisa":
    case "childNisa":
    case "taxable":
    case "esop":
    case "ideco":
    case "corporateDc":
      return "運用の費用・資産の配分を入れる";
    case "deposit":
    case "zaikei":
      return (a.contributions ?? []).some((c) => c.payer !== "employer") ? "積立の終わり・配分などを入れる" : "残高の時点・配分などを入れる";
    case "fxDeposit":
    case "smallBusinessMutualAid":
      return "残高の時点・配分などを入れる";
    case "cryptoAsset":
      return (a.contributions ?? []).length > 0 ? "取得価額・売ったときの税・積立の終わりを入れる" : "取得価額・売ったときの税を入れる";
    default:
      return undefined;
  }
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
        help: "給与・年金が入り、生活費・ローンを払う預金。ここが足りなくなると、下の順番でほかの口座から取り崩します。入れなければ最初の預金",
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
  // 貸している不動産（中身を持つ不動産の器）は収益不動産の項目に出す（0079）
  const others = (h.accounts ?? []).filter((a) => NON_FINANCIAL.has(a.kind) && !isRentalProperty(a));
  // 役員として働く人がいれば、その他の資産に「自社株（出資額）」「会社への貸付金」を足せる（名義はその人。0105）
  const officer = executiveMembers(h)[0];
  const addOfficer = (subtype: keyof typeof ASSET_SUBTYPES): ActionDef => ({
    key: `sav/add/${subtype}`,
    label: `＋ ${ASSET_SUBTYPES[subtype].label}`,
    level: "simple",
    run: (w: WorkingHousehold) =>
      mutate(w, (hh) => {
        if (officer === undefined) return;
        (hh.accounts ??= []).push({ id: newId(), kind: "otherAsset", subtype, owner: officer.id, marketValue: standardBox(0, UNENTERED_VALUE), asOf: w.request.input.baseMonth, contributions: [] });
      }),
  });
  const add = (kind: string, label: string) => ({
    key: `sav/add/${kind}`,
    label: `＋ ${label}`,
    // 不動産・その他の資産を足すボタンは標準でも出す（0120）
    level: (MAIN_ADD_KINDS.has(kind) || NON_FINANCIAL.has(kind) ? "simple" : "detail") as "simple" | "detail",
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
    lead: "口座・資産の種類ごとの今の残高と、毎月の積立。貸していない不動産・貴金属などのその他の資産も。",
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
          add("corporateDc", "企業型DC"),
          add("fxDeposit", "外貨預金"),
          add("esop", "持株会"),
          add("cryptoAsset", "暗号資産"),
          add("smallBusinessMutualAid", "小規模企業共済"),
          add("legacyNisa", "旧NISA"),
          add("juniorNisa", "ジュニアNISA"),
          add("childNisa", "こどもNISA"),
        ],
      },
      {
        key: "sav/others",
        title: "その他の資産",
        note: `貸していない土地・別荘・空き家などの不動産と、貴金属・美術品や骨董品・会員権・敷金や保証金・事業用の資産など。資産と負債のタブ・提案書のバランスシートに、中身ごとの行で入ります（金融資産には入れず、取り崩しにも使いません。時価の下落にも当てません）。暗号資産は上の金融資産の「そのほか」の「暗号資産」で入れます。人に貸している不動産は「収益不動産」、住まいは「住まい・ローン」、車は「車」で入れます${officer !== undefined ? "。役員を務める会社の自社株（出資額）と、会社への貸付金もここで入れます（会社からの借入金は「住まい・ローン」のほかのローン）" : ""}`,
        // 無い世帯でも標準で出す（見出しと足すボタンだけ。0120）。説明は「?」の中
        level: "simple",
        groups: others.flatMap((a) => otherAssetGroups(wh, a)),
        actions: [add("realEstate", "貸していない不動産（土地・別荘など）"), add("otherAsset", "その他の資産（貴金属・会員権など）"), ...(officer !== undefined ? [addOfficer("ownCompanyShares"), addOfficer("loanToCompany")] : [])],
      },
      returnStagesSection(wh),
      ...(methodOf(wh.request) === "total" ? [] : [flowSection(wh)]),
    ],
  };
}
