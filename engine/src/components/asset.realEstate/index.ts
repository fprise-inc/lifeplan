// 住まい以外の不動産（不動産の器のうち中身 property を入れたもの）の評価額・家賃収入・経費・不動産所得・売却（0028）。
// - 評価額: 器の時価（asOf の時点の土地と建物の合計）を土地の割合（property.landShare → 前提 realEstateValuation.landShare → 目安 0.3。目安を
//   使ったら知らせ N_DEFAULT_USED）で分け、持ち家と同じ決まり（0025 の2。sdk の landBuildingValuer）で、土地は上昇率（器の valueGrowth →
//   前提 landGrowth → 物価上昇率）、建物は構造の耐用年数で定額で減らす。建った年の省略は取得の年（取得も無ければ時価の時点の年＝新築）
// - 家賃収入（cf.income.other.rental）: 貸している月ごとに、満室時の家賃（月額）×(1−空室率)。家賃は貸し始めの年（計算基準年より前なら
//   計算基準年）の額で、その後の年は家賃の変化率で動かす（省略は0）
// - 経費（cf.expense.other.realEstate）: 年額（持っている間。12か月に分ける。変化率の省略は0）と、受け取る家賃×割合（管理委託料など）の合計
// - 不動産所得（年ごと。名義の人。tax.totalIncome が合計所得金額に入れる）＝家賃収入−経費（貸している月の分）−減価償却費−借入の利息
//   - 減価償却費: 建物の取得価額（取得価額×(1−土地の割合)）×定額法の償却率（1÷耐用年数を小数3桁に切り上げ）。耐用年数は法定（木造22・
//     軽量鉄骨19・重量鉄骨34・鉄筋コンクリート47年）、中古（建った年が取得の年より前）は簡便法（経過年数を年で数え、全部過ぎていれば法定×0.2、
//     一部なら法定−経過＋経過×0.2。端数は切り捨て、2年未満は2年）。貸し始め（取得の月が後ならその月）から貸している月数で月割りし、
//     帳簿の残りが1円になるまで。取得の入力が無ければ減価償却費を入れない（知らせ N_INPUT_REQUIRED）
//   - 借入の利息: この不動産を指す負債（debt.property）の年ごとの利息（debt.schedule）の、貸している月数の分。土地の取得のための分（借入額の
//     うち建物の取得価額を超える分の割合。借入は建物から先に充てたとみなす）を landInterest として添える（損失のときに引けない分。tax.totalIncome）
// - 売却（property.sale）: その月に、売却価格（省略はその年の評価額）から売却の費用（割合 sale.costRate → 前提 saleCostRate → 目安 0.04）を
//   引いた手取りを、名義の人の一時金の収入（cf.income.lumpSum.realEstateSale）にする。売った年の年末には持っていない。貸すのは前の月まで。
//   譲渡所得の税は tax.realEstateSale（改訂5）。借入の残りは、売ったときにローンを返す（sale.repayLoan。省略は返す）なら debt.schedule が売る月に返す
// - 段階と例外の年（改訂2。0040）: 家賃（月ごと）と経費の年額（年ごと）に、元の額の代わりに段の額（割合の段は元の額×割合）を使い、
//   同じ変化率をそのまま重ねる（家賃は貸し始めの年〔計算基準年より前なら計算基準年〕から、経費は計算基準年からの年数）。例外の年は、その年だけ
//   例外の額（元の額と同じ基準。変化率は重ねる。0円はその年に受け取らない・払わない）。家賃に対する割合の経費は、受け取る家賃に掛ける
// - 改訂3（0039）: 持ち始める時点（property.holdFrom。相続・贈与で受け取る不動産）。その月から評価額（その年の年末から）・家賃収入・経費・
//   減価償却に入れる。受け取るときの支払いは無い（買うなら住まいの購入か出るお金の行で入れる）。時価は asOf の時点の額で、上昇率で動かす
// - 改訂4（0080。お金の欄）: どれも任意の欄で、入れなければ今までと同じ結果
//   - 取得価額の内訳（acquisition.parts: 土地・建物・建物附属設備）: 入れたら土地の割合より優先して取得価額を分ける（減価償却・土地の利息の分）。
//     評価額の土地の割合は、入れた土地の割合 → 内訳の土地の割合 → 前提 → 目安の順。建物附属設備は別の耐用年数（acquisition.equipmentLife。
//     省略は法定15年で、中古は建物と同じ経過年数の簡便法）の定額法で、建物と同じく貸し始めから月割り・1円まで
//   - 取得時の諸費用（acquisition.costs）: 建物と建物附属設備の分（取得価額の比で分け、円未満切り捨て）を償却の基に足す（税の上は取得価額に
//     含める扱い）。土地の分は償却しない。自己資金（acquisition.equity）は計算に使わない（分析の数字のために持つ）
//   - 家賃以外の月の収入（rental.commonFee 共益費・parking 駐車場・otherMonthly その他）: 家賃と同じ空室の割合・変化率で、段階・例外の年は
//     当てない。家賃に対する割合の経費は、家賃とこれらの合計に掛ける。礼金・更新料の年あたりの見込み（rental.keyMoney）は12か月に分けて
//     貸している月に受け取る（空室の割合は掛けない。変化率は家賃と同じ。割合の経費は掛けない）
//   - 経費の費目（expenses.items）: 1つでも入れたら、年額（expenses.annual）の代わりにその合計を年額にする（段階・例外の年・変化率はその合計に当てる）
//   - 大きな修繕（repairs）: その月に一時の支出（cf.expense.other.realEstate、計算式ID asset.realEstate.repair）。貸している月なら、全額を
//     その年の経費にする（資本的支出として償却する扱いはしない。知らせ N_ASSUMED realEstate.repairExpensed）
//   - 民泊・宿（lodging）: 売上は「1泊の単価×稼働率×営業日数」（salesBy night）か「月の売上の見込み」（rental.monthly）。住宅宿泊事業は
//     営業日数を年180日までにする（超えたら知らせ N_LIMIT_APPLIED）。空室の割合・家賃以外の月の収入・礼金は使わない。仲介サイトの手数料
//     （lodging.platformRate）は家賃に対する割合の経費（運営代行など）に足す。売上が年1,000万円を超えても消費税は計算しない
//     （知らせ N_NOT_SUPPORTED realEstate.consumptionTax）
// - 改訂5・約束の版 1.1（0081。税と出口）: どれも任意の欄・任意の出力で、売却の予定と民泊・宿の無い物件の結果は同じ
//   - 民泊・宿の所得の区分（lodging.incomeKind。省略は営業の形から: 旅館業は事業所得、住宅宿泊事業・特区民泊・営業の形なしは雑所得）を
//     出力の incomeKind に出す（不動産所得なら出さない）。内訳の計算（減価償却・利息）は同じ。事業所得なら個人事業税は計算しない
//     （知らせ N_NOT_SUPPORTED realEstate.businessTax）。今までの「不動産所得として計算」の知らせ（realEstate.lodgingIncome）はやめた
//   - 事業的規模の目安に数える室数・棟数（units）: 不動産所得の物件で、区分マンションは1室、一棟アパート・一棟マンション・店舗/事務所・
//     民泊・宿は戸数（省略は1）室、戸建ては1棟。駐車場・貸している土地・種類なしは数えない（数えるものが無ければ出さない。
//     tax.totalIncome が名義の人ごとに足す）
//   - 売却の譲渡所得の内訳: 取得費＝取得価額（内訳があれば内訳の合計）＋取得時の諸費用−建物と建物附属設備の減価償却の累計（売る前の月まで）。
//     概算取得費（売却価格×incomeTax.landBuilding.estimatedCostRate）のほうが大きければそれ。取得の入力が無ければ概算取得費（知らせ
//     N_ASSUMED realEstate.saleEstimatedCost）で、所有期間は長期とみなす（知らせ N_ASSUMED realEstate.saleHoldingLong）。
//     所有期間は、取得の年が売った年の（holdingYears＋1）年前以前なら長期（売った年の1月1日に5年を超える。月の端数は年で数えると同じ）。
//     貸していない期間（取得から貸し始めまで・貸し終わりから売るまでが12か月以上、または貸していない物件）の建物の減価（非業務用の償却）は
//     引かない（知らせ N_NOT_SUPPORTED realEstate.saleNonBusinessPeriod。0028 の未対応のまま）
// - 改訂6・約束の版 1.2（分析の数字の材料。計算は変えない）: 任意の出力 cash（計算基準年から、持っている年ごとの、表に載る月〔計算基準月から〕の
//   貸している月数・満室のときの収入〔家賃と家賃以外の月の収入の空室を見込む前の額。礼金・更新料は入れない。民泊・宿は「1泊の単価×営業日数」
//   で売上を入れたときだけ、稼働率100%の売上〕・受け取った収入〔家賃収入の行と同じ〕・経費〔大きな修繕を除く〕・大きな修繕）と facts（取得価額の
//   合計・取得時の諸費用・自己資金、建った年、法定耐用年数、建物と建物附属設備の減価償却が終わる年〔表の期間の後でも数える〕、民泊・宿の
//   1泊の単価・稼働率・営業日数）。asset.realEstateAnalysis が読む
// - 改訂7・約束の版 1.3（建物の無い種類・帳簿価額・貸し続けたときの償却の終わり）:
//   - 種類（property.kind）が貸している土地（land）・駐車場（parking）なら、土地の割合の省略は 1（取得価額も評価額も全部土地。前提の土地の割合・
//     内訳の土地の割合・目安は使わず、目安の知らせ N_DEFAULT_USED も出さない）。建物の減価償却は無い。土地の割合・取得価額の内訳の建物を入れて
//     あれば、今までどおりその値で分ける（黙って変えない。画面が知らせる）。駐車場の舗装・機械式駐車設備などは、取得価額の内訳の建物附属設備
//     （acquisition.parts.equipment と equipmentLife）で償却する。facts.noBuilding は、建物の分が無い（評価額にも償却にも）とき true
//   - 年末の帳簿価額（years[].book。取得の入力があるときだけ）: 取得価額（内訳があれば内訳の合計）＋取得時の諸費用−その年の年末までの建物と
//     建物附属設備の減価償却の累計。分析の数字の含み益（評価額−帳簿価額）の材料
//   - 売る・貸し終わるまでに償却が終わらないとき、貸し続けたら終わる年（facts.depreciationEndIfContinued。終わる部分は null）
// 計算基準年の2年前から計算する（前の年の所得で決まる住民税・国民健康保険料のため。お金の動きは計算基準月から）
import {
  addMonths,
  addYen,
  boxValue,
  defineComponent,
  formatYm,
  landBuildingValuer,
  LAND_SHARE,
  monthIndex,
  RATE_ONE,
  RATE_ZERO,
  SALE_COST_RATE,
  subYen,
  stagedYen,
  yearOf,
  yen,
  type AccountInput,
  type BuildingStructure,
  type DebtInput,
  type DebtScheduleOutput,
  type Flow,
  type MonthIndex,
  type Rate,
  type RealEstateOutput,
  type RealEstateValuationSetting,
  type Yen,
} from "../../sdk/index.ts";

/** 減価償却の法定耐用年数（住宅用の建物。減価償却資産の耐用年数等に関する省令の別表第一） */
export const TAX_USEFUL_LIFE: Readonly<Record<BuildingStructure, number>> = { wood: 22, lightSteel: 19, steel: 34, rc: 47 };

/** 建物附属設備の法定耐用年数の既定（給排水・電気・ガスの設備など。減価償却資産の耐用年数等に関する省令の別表第一） */
export const EQUIPMENT_LIFE = 15;

/** 住宅宿泊事業の営業日数の上限（住宅宿泊事業法2条3項） */
export const PRIVATE_LODGING_DAYS = 180;

const HOLDING = "incomeTax.landBuilding.longTerm.holdingYears";
const ESTIMATED = "incomeTax.landBuilding.estimatedCostRate";

/** 民泊・宿の所得の区分（省略は営業の形から: 旅館業は事業所得、ほかは雑所得。0081） */
export function lodgingIncomeKind(l: { readonly business?: string; readonly incomeKind?: "miscellaneous" | "business" | "realEstate" }): "miscellaneous" | "business" | "realEstate" {
  return l.incomeKind ?? (l.business === "inn" ? "business" : "miscellaneous");
}

/** 事業的規模の目安に数える室数・棟数（種類と戸数から。駐車場・土地・種類なしは数えない。0081） */
export function scaleUnits(kind: string | undefined, units: number | undefined): { rooms: number; houses: number } {
  if (kind === "condo") return { rooms: 1, houses: 0 };
  if (kind === "house") return { rooms: 0, houses: 1 };
  if (kind === "apartment" || kind === "mansion" || kind === "commercial" || kind === "lodging") return { rooms: units ?? 1, houses: 0 };
  return { rooms: 0, houses: 0 };
}

/** 建物の無い種類（貸している土地・駐車場）。土地の割合の省略を 1 にする（改訂7） */
export const isLandOnlyKind = (kind: string | undefined): boolean => kind === "land" || kind === "parking";

/** 中古の建物の耐用年数（簡便法。経過年数は年で数える） */
export function usedLife(life: number, elapsed: number): number {
  if (elapsed <= 0) return life;
  // 0.2 を掛けて端数を切り捨てる＝5で割って切り捨てる
  const y = elapsed >= life ? Math.floor(life / 5) : life - elapsed + Math.floor(elapsed / 5);
  return Math.max(2, y);
}

/** 定額法の償却率（1÷耐用年数を小数3桁に切り上げ。率の文字列） */
export function straightLineRate(life: number): string {
  const k = Math.ceil(1000 / life);
  return k >= 1000 ? "1" : `0.${String(k).padStart(3, "0")}`;
}

const RENT = "conv.realEstate.rent";
const DEP = "conv.realEstate.depreciation";
const VAL = "conv.asset.valuation";

const minM = (a: MonthIndex, b: MonthIndex): MonthIndex => (a < b ? a : b);
const maxM = (a: MonthIndex, b: MonthIndex): MonthIndex => (a > b ? a : b);

/** 年の中で lo〜hi（両端を含む）に入る月の数 */
function monthsIn(y: number, lo: MonthIndex, hi: MonthIndex): number {
  const a = Math.max(lo, monthIndex(y, 1));
  const b = Math.min(hi, monthIndex(y, 12));
  return b >= a ? b - a + 1 : 0;
}

export default defineComponent<Record<string, never>, RealEstateOutput>({
  id: "asset.realEstate",
  title: "住まい以外の不動産（評価額・家賃収入・経費・不動産所得・売却）",
  contract: "1.3",
  revision: 7,
  requires: { "debt.schedule": ">=1 <2" },
  params: [HOLDING, ESTIMATED],
  reads: ["account.kind", "account.owner", "account.marketValue", "account.asOf", "account.valueGrowth", "account.property", "debt.property", "debt.principal", "assumptions.inflation", "assumptions.realEstateValuation"],
  input: "empty.input",
  output: "asset.realEstate.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const calcStart = monthIndex(baseYear - 2, 1);
    const setting = ctx.setting<RealEstateValuationSetting>("realEstateValuation");
    const flows: Flow[] = [];
    const properties: RealEstateOutput["properties"][number][] = [];
    const debts = ctx.list<Pick<DebtInput, "id" | "property" | "principal">>("debt");
    for (const a of ctx.list<AccountInput>("account")) {
      const p = a.property;
      if (a.kind !== "realEstate" || p === undefined) continue;
      const owner = a.owner;
      const push = (m: MonthIndex, row: string, amount: Yen, formula: string) => {
        if (amount <= 0 || m < base || m > end) return;
        flows.push({ row, ym: formatYm(m), amount, accrualYear: yearOf(m), member: owner, object: a.id, formula });
      };
      // 評価額（土地と建物）
      const basis = boxValue(a.marketValue) ?? yen(0);
      const y0 = yearOf(ctx.time.resolve({ at: a.asOf }));
      const acqAt: MonthIndex | null = p.acquisition === undefined ? null : ctx.time.resolve({ at: p.acquisition.at });
      // 取得価額の内訳（入れたら土地の割合より優先して取得価額を分ける。評価額の土地の割合の省略にも使う）
      const parts = p.acquisition?.parts;
      const partLand = yen(parts?.land ?? 0);
      const partBuilding = yen(parts?.building ?? 0);
      const partEquipment = yen(parts?.equipment ?? 0);
      const partsTotal = partLand + partBuilding + partEquipment;
      const partsShare = parts !== undefined && partsTotal > 0 ? ctx.rate.toString(ctx.rate.div(ctx.rate.of(String(partLand)), ctx.rate.of(String(partsTotal)))) : undefined;
      // 建物の無い種類（貸している土地・駐車場）は、土地の割合の省略を 1 にする（改訂7）
      const landOnly = isLandOnlyKind(p.kind);
      const shareText = p.landShare ?? (landOnly ? "1" : (partsShare ?? setting?.landShare));
      if (shareText === undefined) ctx.notice("N_DEFAULT_USED", [a.id, "account.property.landShare"]);
      const share = shareText ?? String(ctx.estimate(LAND_SHARE));
      const noBuilding = landOnly && ctx.rate.compare(ctx.rate.of(share), RATE_ONE) >= 0 && partBuilding === 0;
      const structure = p.structure ?? "wood";
      const built = p.builtYear ?? (acqAt === null ? y0 : yearOf(acqAt));
      const growthOf = (y: number): Rate => (a.valueGrowth !== undefined ? ctx.rate.of(a.valueGrowth) : (ctx.assumptionIn("realEstateValuation", "landGrowth", y) ?? ctx.assumption("inflation", y, RATE_ZERO)));
      const valuer = landBuildingValuer(ctx, { basis, y0, share, structure, builtYear: built, setting, growthOf });
      const saleAt: MonthIndex | null = p.sale === undefined ? null : ctx.time.resolve(p.sale.at);
      const sold = saleAt !== null && saleAt <= end;
      // 持っている最後の月（売るならその前の月）
      const holdEnd: MonthIndex = sold && saleAt !== null ? addMonths(saleAt, -1) : end;
      // 持ち始める月（省略は前から持っている）
      const holdStart: MonthIndex | null = p.holdFrom === undefined ? null : ctx.time.resolve(p.holdFrom);
      const years: { year: number; land: Yen; building: Yen; value: Yen }[] = [];
      if (holdEnd >= base) {
        for (let y = baseYear; y <= endYear; y++) {
          if (monthIndex(y, 12) > holdEnd) break;
          if (holdStart !== null && monthIndex(y, 12) < holdStart) continue;
          const { land, building } = valuer.at(y);
          years.push({ year: y, land, building, value: addYen(land, building) });
        }
      }
      let sale: RealEstateOutput["properties"][number]["sale"] = null;
      if (sold && saleAt !== null && saleAt >= base) {
        const y = yearOf(saleAt);
        const lb = valuer.at(y);
        const value = addYen(lb.land, lb.building);
        const price = p.sale?.price ?? value;
        const costs = ctx.money.mulRate(price, ctx.rate.of(p.sale?.costRate ?? setting?.saleCostRate ?? String(ctx.estimate(SALE_COST_RATE))), VAL);
        const proceeds = yen(Math.max(0, price - costs));
        sale = { ym: formatYm(saleAt), value, price, costs, proceeds };
        if (proceeds > 0) flows.push({ row: "cf.income.lumpSum.realEstateSale", ym: formatYm(saleAt), amount: proceeds, accrualYear: y, member: owner, object: a.id, formula: "asset.realEstate.sale" });
      }

      // 貸している月（rFrom〜rTo。計算は計算基準年の2年前から）
      const r = p.rental;
      const lodging = p.lodging;
      const rFrom0: MonthIndex | null = r === undefined ? null : r.from !== undefined ? ctx.time.resolve(r.from) : (acqAt ?? calcStart);
      const rFrom: MonthIndex | null = rFrom0 !== null && holdStart !== null ? maxM(rFrom0, holdStart) : rFrom0;
      const rTo: MonthIndex | null = r === undefined ? null : r.to === undefined || r.to === null ? holdEnd : minM(ctx.time.resolve(r.to), holdEnd);
      const rented = (y: number) => (rFrom === null || rTo === null ? 0 : monthsIn(y, maxM(rFrom, calcStart), rTo));
      // 民泊・宿は空室の割合を使わない（稼働率で入れる）
      const keep = lodging !== undefined ? RATE_ONE : ctx.rate.sub(RATE_ONE, ctx.rate.of(r?.vacancyRate ?? "0"));
      const rentGrowth = ctx.rate.of(r?.growth ?? "0");
      const rentRef = rFrom === null ? baseYear : Math.max(yearOf(rFrom), baseYear);
      // 月の売上・家賃の元の額（民泊・宿の「1泊の単価×稼働率×営業日数」は、年の売上を12で割る。円未満切り捨て）
      let rent0 = r === undefined ? yen(0) : (boxValue(r.monthly) ?? yen(0));
      // 満室のときの月の収入の元の額（民泊・宿は「1泊の単価×営業日数」のときだけ。月の売上の見込みで入れたときは無い）
      let potential0: Yen | null = lodging === undefined ? null : yen(0);
      let lodgingFacts: { nightly: Yen; occupancy: string; days: number } | null = null;
      const incomeKind = lodging === undefined ? "realEstate" : lodgingIncomeKind(lodging);
      if (r !== undefined && incomeKind === "business") ctx.notice("N_NOT_SUPPORTED", [a.id, "realEstate.businessTax"]);
      if (r !== undefined && lodging !== undefined) {
        if (lodging.salesBy === "night") {
          const cap = lodging.business === "privateLodging" ? PRIVATE_LODGING_DAYS : 366;
          const days0 = lodging.days ?? (lodging.business === "privateLodging" ? PRIVATE_LODGING_DAYS : 365);
          if (days0 > cap) ctx.notice("N_LIMIT_APPLIED", [a.id, "realEstate.lodging.days"]);
          if (lodging.nightly === undefined || lodging.occupancy === undefined) ctx.notice("N_INPUT_REQUIRED", [a.id, "account.property.lodging"]);
          const perDay = ctx.money.mulRate(yen(lodging.nightly ?? 0), ctx.rate.of(lodging.occupancy ?? "0"), RENT);
          rent0 = ctx.money.mulRatio(perDay, Math.min(days0, cap), 12, RENT);
          // 稼働率100%の月の売上（分析の数字の「満室のときの収入」。損益分岐の稼働率の分母）
          potential0 = ctx.money.mulRatio(yen(lodging.nightly ?? 0), Math.min(days0, cap), 12, RENT);
          lodgingFacts = { nightly: yen(lodging.nightly ?? 0), occupancy: lodging.occupancy ?? "0", days: Math.min(days0, cap) };
        }
      }
      let rentMonthly = rent0;
      let rentYear = rentRef;
      const rentFor = (y: number): Yen => {
        while (rentYear < y) {
          rentYear++;
          if (ctx.rate.compare(rentGrowth, RATE_ZERO) !== 0) rentMonthly = addYen(rentMonthly, ctx.money.mulRate(rentMonthly, rentGrowth, RENT));
        }
        return rentMonthly;
      };
      const e = p.expenses;
      // 費目を1つでも入れたら、年額はその合計（年額の欄は使わない）
      const items = e?.items === undefined ? [] : Object.values(e.items).filter((v): v is Yen => typeof v === "number");
      const fixed0 = items.length > 0 ? items.reduce((s0, v) => addYen(s0, v), yen(0)) : e?.annual === undefined ? yen(0) : (boxValue(e.annual) ?? yen(0));
      // 家賃に対する割合の経費（管理委託料・運営代行）と、民泊・宿の仲介サイトの手数料
      const rateParts = [e?.rate, lodging?.platformRate].filter((x): x is string => x !== undefined);
      const expRate = rateParts.length === 0 ? null : rateParts.slice(1).reduce((acc, x) => ctx.rate.add(acc, ctx.rate.of(x)), ctx.rate.of(rateParts[0] as string));
      // 家賃以外の月の収入（共益費・駐車場・その他）と礼金・更新料の年あたりの見込み（民泊・宿は使わない）
      const extra0 = r === undefined || lodging !== undefined ? yen(0) : yen((r.commonFee ?? 0) + (r.parking ?? 0) + (r.otherMonthly ?? 0));
      const keyMoney0 = r === undefined || lodging !== undefined ? yen(0) : yen(r.keyMoney ?? 0);
      // 大きな修繕（月ごとの額）
      const repairs = new Map<MonthIndex, Yen>();
      for (const x of p.repairs ?? []) {
        if (x.amount <= 0) continue;
        const m = ctx.time.resolve(x.at);
        repairs.set(m, addYen(repairs.get(m) ?? yen(0), x.amount));
      }
      let repairExpensed = false;
      const expGrowth = ctx.rate.of(e?.growth ?? "0");
      let fixed = fixed0;
      let fixedYear = baseYear;
      const fixedFor = (y: number): Yen => {
        while (fixedYear < y) {
          fixedYear++;
          if (ctx.rate.compare(expGrowth, RATE_ZERO) !== 0) fixed = addYen(fixed, ctx.money.mulRate(fixed, expGrowth, RENT));
        }
        return fixed;
      };
      // 段階と例外の年（0040）: 元の基準の額ごとに、変化率を当てた額を覚えておく
      const rentStaged = r === undefined ? null : stagedYen(ctx, rent0, r, RENT);
      const fixedStaged = stagedYen(ctx, fixed0, e, RENT);
      const growMemo = (g: Rate) => {
        const memo = new Map<number, Yen[]>();
        return (amount: Yen, k: number): Yen => {
          let xs = memo.get(amount);
          if (xs === undefined) {
            xs = [amount];
            memo.set(amount, xs);
          }
          while (xs.length <= k) {
            const v = xs[xs.length - 1] as Yen;
            xs.push(ctx.rate.compare(g, RATE_ZERO) !== 0 ? addYen(v, ctx.money.mulRate(v, g, RENT)) : v);
          }
          return xs[Math.max(0, k)] as Yen;
        };
      };
      const rentUp = growMemo(rentGrowth);
      const fixedUp = growMemo(expGrowth);
      const rentByYear = new Map<number, Yen>();
      const expByYear = new Map<number, Yen>();
      // 分析の数字の材料（表に載る月〔計算基準月から〕の分。改訂6）
      const cash: NonNullable<RealEstateOutput["properties"][number]["cash"]>[number][] = [];
      const lodgingNight = lodging !== undefined && potential0 !== null && lodgingFacts !== null;
      for (let y = yearOf(calcStart); y <= endYear; y++) {
        const fixedAnnual = fixedStaged.plain ? fixedFor(y) : fixedUp(fixedStaged.inYear(y), y - baseYear);
        const fixedParts = fixed0 > 0 || fixedStaged.anyPositive ? ctx.money.allocate(fixedAnnual, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.flow.allocate", "last") : null;
        const rentPlain = rentStaged === null || rentStaged.plain;
        const monthlyRent = r !== undefined && rFrom !== null && rTo !== null && rentPlain ? ctx.money.mulRate(rentFor(Math.max(y, rentRef)), keep, RENT) : yen(0);
        // 段階のある家賃は月ごと（空室を見込んだ後の額）
        const rentOf = (m: MonthIndex): Yen => (rentPlain ? monthlyRent : ctx.money.mulRate(rentUp((rentStaged as NonNullable<typeof rentStaged>).at(m), Math.max(y, rentRef) - rentRef), keep, RENT));
        // 家賃以外の月の収入（空室を見込んだ後）と、礼金・更新料（12か月に分ける）。変化率は家賃と同じ年から
        const k = Math.max(y, rentRef) - rentRef;
        const extraM = extra0 > 0 ? ctx.money.mulRate(rentUp(extra0, k), keep, RENT) : yen(0);
        const keyParts = keyMoney0 > 0 ? ctx.money.allocate(rentUp(keyMoney0, k), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.flow.allocate", "last") : null;
        let rentSum = yen(0);
        let expSum = yen(0);
        const c = { months: 0, held: 0, gross: yen(0), rent: yen(0), expenses: yen(0), repairs: yen(0) };
        // 満室のときの月の収入（空室を見込む前。家賃以外の月の収入を含み、礼金・更新料は入れない）
        const grossOf = (m: MonthIndex): Yen => {
          if (lodging !== undefined) return lodgingNight ? rentUp(potential0 as Yen, k) : yen(0);
          const base0 = rentPlain ? rentFor(Math.max(y, rentRef)) : rentUp((rentStaged as NonNullable<typeof rentStaged>).at(m), Math.max(y, rentRef) - rentRef);
          return addYen(base0, extra0 > 0 ? rentUp(extra0, k) : yen(0));
        };
        for (let mo = 1; mo <= 12; mo++) {
          const m = monthIndex(y, mo);
          if (m > holdEnd) break;
          if (m < calcStart || (holdStart !== null && m < holdStart)) continue;
          const isRented = rFrom !== null && rTo !== null && m >= rFrom && m <= rTo;
          const inTable = m >= base && m <= end;
          if (inTable) {
            c.held++;
            if (isRented) {
              c.months++;
              c.gross = addYen(c.gross, grossOf(m));
            }
          }
          let exp = fixedParts === null ? yen(0) : (fixedParts[mo - 1] as Yen);
          // 割合の経費を掛ける収入（家賃と家賃以外の月の収入）と、掛けない収入（礼金・更新料）
          const rentM = isRented ? addYen(rentOf(m), extraM) : yen(0);
          const keyM = isRented && keyParts !== null ? (keyParts[mo - 1] as Yen) : yen(0);
          if (isRented && rentM + keyM > 0) {
            push(m, "cf.income.other.rental", addYen(rentM, keyM), "asset.realEstate.rent");
            rentSum = addYen(rentSum, addYen(rentM, keyM));
            if (inTable) c.rent = addYen(c.rent, addYen(rentM, keyM));
            if (expRate !== null && rentM > 0) exp = addYen(exp, ctx.money.mulRate(rentM, expRate, RENT));
          }
          push(m, "cf.expense.other.realEstate", exp, "asset.realEstate.expenses");
          if (inTable && exp > 0) c.expenses = addYen(c.expenses, exp);
          if (isRented) expSum = addYen(expSum, exp);
          // 大きな修繕（一時の支出。貸している月なら全額をその年の経費にする）
          const rep = repairs.get(m);
          if (rep !== undefined) {
            push(m, "cf.expense.other.realEstate", rep, "asset.realEstate.repair");
            if (inTable) c.repairs = addYen(c.repairs, rep);
            if (isRented) {
              expSum = addYen(expSum, rep);
              repairExpensed = true;
            }
          }
        }
        rentByYear.set(y, rentSum);
        expByYear.set(y, expSum);
        if (c.held > 0) cash.push({ year: y, months: c.months, gross: lodging !== undefined && !lodgingNight ? null : c.gross, rent: c.rent, expenses: c.expenses, repairs: c.repairs });
        if (lodging !== undefined && y >= baseYear && rentSum > 10_000_000) ctx.notice("N_NOT_SUPPORTED", [a.id, "realEstate.consumptionTax"]);
      }
      if (repairExpensed) ctx.notice("N_ASSUMED", [a.id, "realEstate.repairExpensed"]);

      // 減価償却費（貸している月数で月割り。帳簿の残りが1円になるまで）
      // 建物と建物附属設備を別の耐用年数で。取得時の諸費用の建物・建物附属設備の分は償却の基に足す
      const depByYear = new Map<number, Yen>();
      let buildingCost: Yen | null = null;
      // 減価償却が終わる年（帳簿の残りが1円になる年。表の期間の後でも、同じ年額で数える。改訂6）
      const depEnd: { building: number | null; equipment: number | null } = { building: null, equipment: null };
      // 売る・貸し終わるまでに終わらないとき、貸し続けたら終わる年（改訂7）
      const depEndIfContinued: { building: number | null; equipment: number | null } = { building: null, equipment: null };
      // 年ごとの減価償却費（計算基準年の2年前より前の年も。年末の帳簿価額の材料。改訂7）
      const depAll = new Map<number, Yen>();
      // 売る前の月までの償却の累計（譲渡所得の取得費から引く）
      let accumulated = yen(0);
      if (r !== undefined && p.acquisition !== undefined && acqAt !== null && rFrom !== null && rTo !== null) {
        const acq = p.acquisition;
        const price = acq.price;
        const building = parts !== undefined ? partBuilding : yen(price - ctx.money.mulRate(price, ctx.rate.of(share), VAL));
        const equipment = parts !== undefined ? partEquipment : yen(0);
        const total = parts !== undefined ? yen(partsTotal) : price;
        const costs = yen(acq.costs ?? 0);
        const costOf = (x: Yen): Yen => (costs > 0 && total > 0 && x > 0 ? ctx.money.mulRatio(costs, x, total, VAL) : yen(0));
        const buildingBase = addYen(building, costOf(building));
        const equipmentBase = addYen(equipment, costOf(equipment));
        buildingCost = addYen(buildingBase, equipmentBase);
        const elapsed = yearOf(acqAt) - built;
        const start = maxM(acqAt, rFrom);
        const depreciate = (base0: Yen, life: number, part: "building" | "equipment") => {
          const annual = ctx.money.mulRate(base0, ctx.rate.of(straightLineRate(life)), DEP);
          let book = base0;
          let last: number | null = null;
          for (let y = yearOf(start); y <= endYear && book > 1; y++) {
            const months = monthsIn(y, start, rTo);
            if (months === 0) continue;
            const d0 = months === 12 ? annual : ctx.money.mulRatio(annual, months, 12, DEP);
            const d = yen(Math.min(d0, book - 1));
            book = yen(book - d);
            if (d > 0) last = y;
            if (d > 0) depAll.set(y, addYen(depAll.get(y) ?? yen(0), d));
            if (y >= yearOf(calcStart)) depByYear.set(y, addYen(depByYear.get(y) ?? yen(0), d));
          }
          accumulated = addYen(accumulated, subYen(base0, book));
          // 表の最後の月まで貸していて、まだ残っていれば、その後も同じ年額で数える（売る・貸し終わるなら、そこで終わり）
          if (book > 1 && rTo >= end && annual > 0) {
            let b = book;
            let y = endYear;
            while (b > 1) {
              y++;
              b = yen(b - Math.min(annual, b - 1));
            }
            last = y;
          } else if (book > 1) {
            last = null;
            // 貸し終わり（売る前の月）の後も同じ年額で貸し続けたら終わる年（その年の残りの月は月割り）
            if (annual > 0 && rTo >= start) {
              let b = book;
              let y = yearOf(rTo);
              const rest = monthIndex(y, 12) - rTo;
              if (rest > 0) b = yen(b - Math.min(ctx.money.mulRatio(annual, rest, 12, DEP), b - 1));
              while (b > 1) {
                y++;
                b = yen(b - Math.min(annual, b - 1));
              }
              depEndIfContinued[part] = y;
            }
          }
          depEnd[part] = last;
        };
        if (buildingBase > 0) depreciate(buildingBase, usedLife(TAX_USEFUL_LIFE[structure], elapsed), "building");
        if (equipmentBase > 0) depreciate(equipmentBase, acq.equipmentLife ?? usedLife(EQUIPMENT_LIFE, elapsed), "equipment");
      } else if (r !== undefined) ctx.notice("N_INPUT_REQUIRED", [a.id, "account.property.acquisition"]);

      // 借入の利息（この不動産を指す負債。貸している月数の分）と、そのうち土地の取得のための分
      const intByYear = new Map<number, Yen>();
      const landIntByYear = new Map<number, Yen>();
      if (r !== undefined) {
        for (const d of debts) {
          if (d.property !== a.id) continue;
          const out = ctx.call<DebtScheduleOutput>("debt.schedule", { object: d.id });
          const landPart = buildingCost === null || d.principal <= 0 ? 0 : Math.max(0, d.principal - buildingCost);
          for (const x of out.interest ?? []) {
            const months = rented(x.year);
            if (months === 0 || x.amount <= 0) continue;
            const i = months === 12 ? x.amount : ctx.money.mulRatio(x.amount, months, 12, RENT);
            intByYear.set(x.year, addYen(intByYear.get(x.year) ?? yen(0), i));
            if (landPart > 0) landIntByYear.set(x.year, addYen(landIntByYear.get(x.year) ?? yen(0), ctx.money.mulRatio(i, Math.min(landPart, d.principal), d.principal, RENT)));
          }
        }
      }
      const income: RealEstateOutput["properties"][number]["income"][number][] = [];
      if (r !== undefined) {
        for (let y = yearOf(calcStart); y <= endYear; y++) {
          if (rented(y) === 0) continue;
          const rent = rentByYear.get(y) ?? yen(0);
          const expenses = expByYear.get(y) ?? yen(0);
          const depreciation = depByYear.get(y) ?? yen(0);
          const interest = intByYear.get(y) ?? yen(0);
          const landInterest = landIntByYear.get(y) ?? yen(0);
          income.push({ year: y, rent, expenses, depreciation, interest, landInterest, income: yen(rent - expenses - depreciation - interest) });
        }
      }
      // 売却の譲渡所得の内訳（0081）
      if (sale !== null && saleAt !== null) {
        const y = yearOf(saleAt);
        const at0 = ctx.at(monthIndex(y, 1));
        const estRate = at0.paramRate(ESTIMATED);
        const estimatedCost = estRate === null ? yen(0) : ctx.money.mulRate(sale.price, estRate, VAL);
        const acq = p.acquisition;
        let acquisitionCost = estimatedCost;
        let estimated = true;
        let term: "long" | "short" = "long";
        if (acq !== undefined && acqAt !== null) {
          const total = parts !== undefined ? yen(partsTotal) : acq.price;
          const actual = yen(Math.max(0, total + (acq.costs ?? 0) - accumulated));
          if (actual >= estimatedCost) {
            acquisitionCost = actual;
            estimated = false;
          }
          const years0 = at0.paramCount(HOLDING);
          if (years0 === null) ctx.notice("N_PARAM_MISSING", [HOLDING]);
          term = yearOf(acqAt) <= y - (years0 ?? 5) - 1 ? "long" : "short";
          // 貸していない期間が長い（非業務用の期間の償却は引いていない。0028 の未対応）
          const idle = r === undefined || rFrom === null || rTo === null || rFrom - acqAt >= 12 || holdEnd - rTo >= 12;
          if (idle) ctx.notice("N_NOT_SUPPORTED", [a.id, "realEstate.saleNonBusinessPeriod"]);
        } else {
          ctx.notice("N_ASSUMED", [a.id, "realEstate.saleEstimatedCost"]);
          ctx.notice("N_ASSUMED", [a.id, "realEstate.saleHoldingLong"]);
        }
        if (estRate === null) ctx.notice("N_PARAM_MISSING", [ESTIMATED]);
        const gain = yen(sale.price - acquisitionCost - sale.costs);
        sale = { ...sale, acquisitionCost, estimated, gain, term };
      }
      const u = r !== undefined && incomeKind === "realEstate" ? scaleUnits(p.kind, p.units) : null;
      const units = u !== null && u.rooms + u.houses > 0 ? u : null;
      const acqTotal = p.acquisition === undefined ? null : parts !== undefined ? yen(partsTotal) : p.acquisition.price;
      const facts: NonNullable<RealEstateOutput["properties"][number]["facts"]> = {
        acquisition: p.acquisition === undefined || acqTotal === null ? null : { total: acqTotal, costs: yen(p.acquisition.costs ?? 0), ...(p.acquisition.equity !== undefined ? { equity: yen(p.acquisition.equity) } : {}) },
        builtYear: built,
        legalLife: TAX_USEFUL_LIFE[structure],
        depreciationEnd: depEnd,
        ...(depEndIfContinued.building !== null || depEndIfContinued.equipment !== null ? { depreciationEndIfContinued: depEndIfContinued } : {}),
        ...(noBuilding ? { noBuilding: true } : {}),
        ...(lodgingFacts !== null ? { lodging: lodgingFacts } : {}),
      };
      // 年末の帳簿価額（取得価額＋取得時の諸費用−その年の年末までの償却の累計。取得の入力があるときだけ。改訂7）
      const bookBase = facts.acquisition === null ? null : addYen(facts.acquisition.total, facts.acquisition.costs);
      const booked =
        bookBase === null
          ? years
          : years.map((v) => {
              let acc = yen(0);
              for (const [yy, d] of depAll) if (yy <= v.year) acc = addYen(acc, d);
              return { ...v, book: subYen(bookBase, acc) };
            });
      properties.push({ object: a.id, owner, years: booked, income, sale, ...(incomeKind !== "realEstate" ? { incomeKind } : {}), ...(units !== null ? { units } : {}), cash, facts });
    }
    return { flows, properties };
  },
});
