// 欄ごとの効き目のテスト（fieldEffect.ts）の一覧: 記録だけの欄・直す待ちの欄・見本で条件がそろわない欄。
// 欄は「形」（入力項目と欄のキー。物の ID と並びの番号を * にした物。例 work:work/*/postSalary）で書く。末尾の「/**」は、その下の欄の全部。
// 直す待ちの行は、直したまとまりが消す（消し忘れると「直ったのに一覧に残っている」でテストが落ちる）
import type { StageId } from "../../src/workspace/input/form.ts";

export interface ShapeRule {
  shape: string;
  why: string;
}

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** 欄の形: 入力項目の ID と、欄のキーの物の ID・並びの番号を * にした物 */
export function fieldShape(stage: StageId, key: string): string {
  return `${stage}:${key.replace(ID, "*").replace(/\/\d+(?=\/|$)/g, "/*")}`;
}

export function shapeMatches(r: ShapeRule, shape: string): boolean {
  return r.shape.endsWith("/**") ? shape.startsWith(r.shape.slice(0, -2)) : shape === r.shape;
}

/** 記録だけの欄（計算に使わない。動かしても結果が変わらないことを確かめる）。理由の多くはエンジンの入力の形（engine/schemas/engine.input.json）の説明のとおり */
export const RECORD_ONLY: readonly ShapeRule[] = [
  { shape: "retirement:retirement/*/label", why: "名前（表示用）" },
  { shape: "education:edu/*/lesson/*/label", why: "塾・習い事の行の名前（表示用）" },
  { shape: "education:edu/*/lesson/*/kind", why: "塾・習い事の行の種類（表示と既定の名前だけ）" },
  { shape: "insurance:ins/*/label", why: "契約の表示名（表示用）" },
  { shape: "events:ev/*/label", why: "行の名前（表示用）" },
  { shape: "events:ev/*/priority", why: "優先度（表示と「確実な分だけ」の見方だけ。計算には使わない）" },
  { shape: "housing:housing/debt/*/label", why: "ローンの名前（表示用）" },
  { shape: "housing:housing/res/*/style", why: "建て方（表示と推定の元だけ）" },
  { shape: "housing:housing/debt/*/credit/newBuild", why: "新築か中古か（表示と推定の元だけ）" },
  { shape: "rental:housing/debt/*/label", why: "借入先（表示用）" },
  { shape: "rental:sav/*/property/name", why: "物件名（表示用）" },
  { shape: "rental:sav/*/property/location", why: "所在地（表示用）" },
  { shape: "rental:sav/*/property/memo", why: "メモ（表示用）" },
  { shape: "rental:sav/*/property/tenure", why: "権利（表示用）" },
  { shape: "rental:sav/*/property/landArea", why: "土地の面積（表示用）" },
  { shape: "rental:sav/*/property/floorArea", why: "建物の延べ床面積（表示用）" },
  { shape: "rental:sav/*/property/repair/*/label", why: "修繕の中身（表示用）" },
  { shape: "rental:sav/*/property/equity", why: "自己資金（収益不動産のタブの分析の数字だけ。キャッシュフロー表には使わない）" },
  { shape: "rental:sav/*/property/share", why: "持分（計算にはまだ使わない＝全部を名義の人の分として扱う、と決めてある）" },
  { shape: "savings:sav/*/subtype", why: "その他の資産の中身（表示用）" },
  { shape: "housing:housing/debt/*/subtype", why: "ほかのローンの種類（表示と、欄の既定・完済の推定の言い方に使う。計算エンジンは読まない）" },
  { shape: "savings:sav/*/asOf", why: "残高の時点（記録だけ。残高は計算の基準の月の前の月末の値として扱う）" },
  { shape: "inheritance:inherit/legacy/amount", why: "遺したい額（表の最後の年の金融資産と比べて見せるだけ）" },
  { shape: "work:work/*/officer/guarantee", why: "会社の借入の連帯保証の額（資産と負債のタブで図の外に見せるだけ）" },
  { shape: "living:living/*/stage/*/mode", why: "段階の額の入れ方（割合で／月額で）の切り替え。同じ額のまま書き直す" },
  { shape: "living:living/*/stage/*/label", why: "段階の節目の名前（時期は「いつから」で決まる）" },
  // 親の介護と相続の見本（2026-11-07 に足した見本）で、はじめてたどった欄
  { shape: "care:ev/*/label", why: "お金の行の名前（表示用）" },
  { shape: "care:ev/*/priority", why: "優先度（表示と「確実な分だけ」の見方だけ。計算には使わない）" },
  { shape: "inheritance:in/*/label", why: "入るお金の行の名前（表示用）" },
  { shape: "inheritance:ev/*/label", why: "出るお金の行の名前（表示用）" },
  { shape: "inheritance:ev/*/priority", why: "優先度（表示と「確実な分だけ」の見方だけ。計算には使わない）" },
];

/**
 * 直す待ちの一覧: 計算に使うはずなのに、今は動かしても結果が変わらない欄（形で決まる物。世帯を決めて見る物は field-effect-a.test.ts の it.fails）。直したまとまりがこの行を消す
 * （消し忘れると「直す待ちの一覧の欄は、まだ効かない」のテストが落ちる）
 */
export const NOT_EFFECTIVE_YET: readonly ShapeRule[] = [
];

/** この点検（欄を1つずつ動かし、キャッシュフロー表・相続税の目安・ご本人の死亡の万一を見る）では効き目を見られない欄。効く条件か見え方を書く */
export const NOT_OBSERVED: readonly ShapeRule[] = [
  { shape: "care:family/*/outside/of", why: "誰の家族か（ご本人の親か配偶者の親か）は、呼び方と、ご本人・配偶者が亡くなった後の相続の相手の見え方に使う。見本の親は同じ呼び方の人が1人ずつで、相続の行は相手を決めてある" },
  { shape: "inheritance:in/*/counterparty", why: "受け取る相続の相手は、推定のままの時期を相手の亡くなる見込みに合わせるとき（0135）と、二人とも亡くなった後の相続人の見え方に使う。見本の相続は時期を確定で入れてある" },
  { shape: "inheritance:ev/*/counterparty", why: "あげる贈与の相手は、贈与税（基礎控除を超える年）と相続税の生前の贈与の加算に効く。見本の贈与は年50万円で基礎控除の中" },
  { shape: "inheritance:ev/*/gift/purpose", why: "贈与の使い道（住宅資金の非課税など）は、贈与税がかかる額のときだけ効く（見本の贈与は基礎控除の中）" },
  { shape: "inheritance:ev/*/gift/method", why: "課税の方法（暦年・相続時精算）は、贈与税がかかる額か相続時精算課税の加算のときだけ効く（見本の贈与は基礎控除の中で、相続の目安の年より前に終わる）" },
  { shape: "assumptions:ev/fee/*/rec/monthly", why: "「現状にも入れる」を外した FP顧問料（提案の側の契約）は、プランの結果にだけ効く（この点検は現状の結果を見る）" },
  { shape: "fee:ev/fee/*/rec/monthly", why: "「現状にも入れる」を外した FP顧問料（提案の側の契約）は、プランの結果にだけ効く（この点検は現状の結果を見る）" },
  { shape: "savings:sav/*/mix/*/share", why: "口座の資産の配分の割合は、配分に資産の種類が2つ以上あるときだけ（1つだけの配分はその種類の利回りで、割合によらない）" },
  { shape: "work:work/period/*/size", why: "勤め先の従業員数は、パートなどの社会保険の加入の境目をまたぐときだけ" },
  { shape: "work:work/period/*/corpDb", why: "勤め先の企業年金の有無は、iDeCo の掛金の上限だけ" },
  { shape: "work:work/period/*/endsWith", why: "辞め方は、辞めた後に失業給付を受け取る人だけ" },
  { shape: "work:work/period/*/continuationClaim", why: "高年齢雇用継続給付は、60〜64歳で賃金が大きく下がる人だけ" },
  { shape: "retirement:retirement/*/disability", why: "障害者になったことによる退職は、退職所得の税がかかる額のときだけ" },
  { shape: "pension:pension/*/months/qualifying", why: "受給資格期間の月数は、受給資格の境目（10年）の近くだけ" },
  { shape: "education:edu/*/scholar/*/type", why: "子が返す奨学金は世帯の収支に入れない（世帯で返すときだけ効く）" },
  { shape: "education:edu/*/scholar/*/rate", why: "子が返す奨学金は世帯の収支に入れない" },
  { shape: "education:edu/*/scholar/*/term", why: "子が返す奨学金は世帯の収支に入れない" },
  { shape: "education:edu/*/scholar/*/repay", why: "子が返す奨学金は世帯の収支に入れない" },
  { shape: "education:edu/*/gift/*/priority", why: "優先度は「確実な分だけ」の見方だけ" },
  { shape: "education:edu/*/gift/*/tax", why: "贈与税の課税の方法は、非課税の枠を超える援助のときだけ" },
  { shape: "education:edu/*/gift/*/exempt", why: "非課税の扱いは、非課税の枠を超える援助のときだけ" },
  { shape: "housing:housing/res/*/purchase/gift/*/exempt", why: "住宅取得等資金の非課税は、非課税の枠を超える援助のときだけ" },
  { shape: "housing:housing/res/*/ownerShare", why: "共有の持ち家の持分は、相続税がかかる世帯の「いま亡くなったら」だけ" },
  { shape: "housing:housing/debt/*/principal", why: "借入額は、入れ方が「今の残高から」のローンでは使わない" },
  { shape: "car:housing/debt/*/principal", why: "借入額は、入れ方が「今の残高から」のローンでは使わない" },
  { shape: "rental:housing/debt/*/rateType", why: "金利の種類は、金利の見込みが「今の金利のまま」では効かない" },
  { shape: "car:housing/debt/*/rateType", why: "金利の種類は、金利の見込みが「今の金利のまま」では効かない" },
  { shape: "housing:housing/debt/*/refinance/*/rateType", why: "借り換えの新しい金利の種類は、5年ルール・125%ルール・変動金利の上乗せ（ストレステスト）が効くときだけ" },
  { shape: "housing:housing/debt/*/cap125", why: "125%ルールは、金利が上がる見込みのときだけ" },
  { shape: "housing:housing/debt/*/rateCutPeriod", why: "当初の金利の引き下げの期間は、引き下げ幅と組で効く" },
  { shape: "housing:housing/debt/*/clHigh", why: "団信の特約は、就業不能・病気の想定だけ" },
  { shape: "housing:housing/debt/*/clIncapacity", why: "団信の特約は、就業不能・病気の想定だけ" },
  { shape: "housing:housing/debt/*/clDisease", why: "団信の特約は、就業不能・病気の想定だけ" },
  { shape: "housing:housing/debt/*/clJoint", why: "夫婦連生の団信は、配偶者の死亡・就業不能の想定だけ" },
  { shape: "insurance:ins/*/waiver", why: "払込免除は、就業不能・病気の想定だけ" },
  { shape: "insurance:ins/*/cov/*/maxDays", why: "入院の限度日数は、病気の想定だけ" },
  { shape: "insurance:ins/*/cov/*/minimumMonths", why: "最低保証の月数は、保障の終わりの近くで亡くなる想定だけ" },
  { shape: "savings:sav/*/lock", why: "引き出せない期間の終わりは、その期間に取り崩しが要るときだけ" },
  { shape: "rental:sav/*/property/carry/**", why: "減価償却の引き継ぎは、引き継ぐ年と数字を組で入れたときだけ" },
  { shape: "rental:rental/taxReturn/*/blueDeduction", why: "青色申告特別控除の55万円・65万円は、事業的規模か事業所得があるときだけ" },
  { shape: "inheritance:inherit/tax/unassignedShare", why: "名義を入れていない財産があるときだけ" },
  { shape: "inheritance:inherit/tax/override/contingency/*", why: "万一のタブの相続税の目安だけ" },
  { shape: "assumptions:assume/investmentReturn", why: "自分の利回りも資産の配分も無い口座があるときだけ" },
  { shape: "assumptions:assume/realEstate/landShare", why: "物件ごとの土地の割合が無い持ち家・物件があるときだけ" },
  { shape: "assumptions:assume/realEstate/life/lightSteel", why: "その構造の持ち家があるときだけ" },
  { shape: "assumptions:assume/realEstate/life/steel", why: "その構造の持ち家があるときだけ" },
  { shape: "assumptions:assume/realEstate/life/rc", why: "その構造の持ち家があるときだけ" },
  { shape: "assumptions:assume/realEstate/saleCost", why: "住まいを売る予定があるときだけ" },
  { shape: "assumptions:ev/fee/*/rec/on/kinds", why: "FP顧問料の、その種類の万一の場面だけ" },
  { shape: "fee:ev/fee/*/rec/on/kinds", why: "FP顧問料の、その種類の万一の場面だけ" },
  { shape: "housing:housing/debt/*/credit", why: "住宅の種類（控除）は、残高が一般の住宅の限度額より多いときだけ" },
  { shape: "housing:housing/debt/*/credit/child", why: "子育て世帯・若者夫婦世帯の上乗せは、その年に入居したときだけ" },
  { shape: "rental:sav/*/property/kind", why: "物件の種類は、推定の元と事業的規模の目安（青色申告特別控除の上限）だけ" },
  { shape: "rental:sav/*/property/units", why: "戸数は、事業的規模の目安（青色申告特別控除の上限）だけ" },
  { shape: "care:family/*/birth", why: "世帯の外の家族の生年月は、亡くなる見込み・介護の時期を年齢の形で持つときだけ" },
  { shape: "care:family/*/sex", why: "世帯の外の家族の性別は、亡くなる見込みの推定（推定のままのとき）だけ" },
  { shape: "care:family/*/allowance", why: "仕送りの欄は支出に入らない（扶養の判定だけ）" },
  { shape: "care:ev/care/*/on/mode", why: "介護の万一のときの扱いは、介護を払っている間にご本人が亡くなる想定だけ" },
];
