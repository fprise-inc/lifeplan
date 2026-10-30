// 子ども・教育のカードで見せる統計の平均の額と、段の在学の期間（0062）。計算エンジンの education.cost と同じ統計・同じ決まりで、
// 計算基準年の額（今の値段）を出す。画面は配布の制度データのパックを待たずに出すので、統計はビルドの前の写し（hearing/src/statistics.generated.ts）から読む。
// 学校給食費の負担軽減・教育費の上昇率・修学支援は入れない（見せるのは「統計の平均」の年額だけ）
import type { EducationStage, Member } from "../../engine/types.ts";
import { masterAmount, masterValue, regulationValue } from "../../../../hearing/src/statistics.ts";
import { schoolEntryYear } from "../present.ts";

const S = "education.statistics";
const K12 = new Set(["kindergarten", "elementary", "juniorHigh", "highSchool"]);
/** 段の始まりの年齢（エンジンの START_AGE と同じ） */
export const STAGE_START_AGE: Readonly<Record<string, number>> = { kindergarten: 3, elementary: 6, juniorHigh: 12, highSchool: 15, university: 18, juniorCollege: 18, vocational: 18, graduateMaster: 22, graduateDoctor: 24 };
/** 在学年数の標準（エンジンの YEARS と同じ。医歯系の大学は6年） */
const YEARS: Readonly<Record<string, number>> = { kindergarten: 3, elementary: 6, juniorHigh: 3, highSchool: 3, university: 4, juniorCollege: 2, vocational: 2, graduateMaster: 2, graduateDoctor: 3 };

export const isK12 = (stage: string): boolean => K12.has(stage);
export const isHigher = (stage: string): boolean => stage === "university" || stage === "juniorCollege" || stage === "vocational";
/** 大学院（修士・博士。0089） */
export const isGraduate = (stage: string): boolean => stage === "graduateMaster" || stage === "graduateDoctor";
/** 高校のあとの学校（大学・短大・専門学校・大学院）。通い方・浪人・受験・仕送り・入学金の欄を出す */
export const isTertiary = (stage: string): boolean => isHigher(stage) || isGraduate(stage);

/** 段の在学年数（入れていなければ標準） */
export function stageYears(s: EducationStage): number {
  return s.years ?? (s.stage === "university" && s.field === "medical" ? 6 : (YEARS[s.stage] ?? 1));
}

/** 段の在学の期間（入学の年の4月〜卒業の年の3月。浪人の年数を足す）。生年月から決まらなければ null */
export function stagePeriod(child: Member, s: EducationStage): { from: string; to: string } | null {
  const age = STAGE_START_AGE[s.stage];
  const elementary = schoolEntryYear(child.birth.birthYearMonth, child.birth.bornOnFirst, "elementary");
  if (age === undefined || elementary === null) return null;
  const entry = elementary + (age - 6) + (s.delayYears ?? 0);
  return { from: `${entry}-04`, to: `${entry + stageYears(s)}-03` };
}

/** 統計の平均の額（計算基準年の額）と、その根拠の文（統計の名前） */
export interface StageStatistic {
  /** 学校の費用の年額（幼〜高は学習費総額−学校外活動費、大学・短大は授業料＋施設設備費）。統計が無い（専門学校）なら null */
  annual: number | null;
  /** 入学金（大学・短大。幼〜高は統計に無いので null） */
  entrance: number | null;
  /** 学校外活動費の年額（幼〜高。学習費総額に含めて数える区分は null） */
  outOfSchool: number | null;
  /** 根拠の文（統計の値の名前を並べたもの。推定の行の根拠・「?」の中に出す） */
  basis: string;
  /** 学校の費用・学費の年額の短い根拠（欄の推定の印に出す。例:「統計の平均。授業料と施設設備費を足したもの（令和7年度入学者）」） */
  annualBasis: string;
  /** 入学金の短い根拠 */
  entranceBasis: string;
  /** 公立小学校の給食費の負担軽減（国の基準額まで）で引く年額（計算基準年の額。制度の値が無い年・公立小学校でなければ 0）。annual は引く前の額 */
  lunchRelief: number;
  /** 統計の取り方の注（公立の短大は私立の短大の平均で仮に計算 など） */
  note: string | null;
}

const titles = (ids: readonly string[]): string => [...new Set(ids.map((id) => masterValue(id)?.title).filter((t): t is string => t !== undefined))].join("・");
const sumOf = (ids: readonly string[]): number | null => {
  let total = 0;
  for (const id of ids) {
    const v = masterAmount(id);
    if (v === null) return null;
    total += v;
  }
  return total;
};

/** 段の統計の平均（エンジンの education.cost と同じ値の選び方） */
export function stageStatistic(s: EducationStage): StageStatistic | null {
  const sector = s.sector ?? "public";
  if (s.stage === "nursery") return null;
  if (K12.has(s.stage)) {
    // インターナショナルスクールは統計の目安が無い（学校の費用は入れる。学校外活動費は私立の平均。0089）
    if (sector === "international") {
      const out = masterAmount(`${S}.${s.stage}.private.outOfSchool`);
      return { annual: null, entrance: null, outOfSchool: out, basis: INTERNATIONAL_MISSING, annualBasis: INTERNATIONAL_MISSING, entranceBasis: "入学金は学校の費用に含めて入れてください", lunchRelief: 0, note: INTERNATIONAL_NOTE };
    }
    const sec = sector === "private" ? "private" : "public";
    const totalId = `${S}.${s.stage}.${sec}.total`;
    const outId = `${S}.${s.stage}.${sec}.outOfSchool`;
    const total = masterAmount(totalId);
    const out = masterAmount(outId);
    if (total === null) return null;
    return {
      annual: out === null ? total : total - out,
      entrance: null,
      outOfSchool: out,
      basis: `文部科学省「子供の学習費調査」の平均（${titles(out === null ? [totalId] : [totalId, outId])}）`,
      annualBasis: out === null ? `統計の平均。塾・習い事なども含む学習費の総額（${K12_SOURCE}）` : `統計の平均。学校教育費と給食費を足したもの（${K12_SOURCE}）`,
      entranceBasis: "入学金は学校の費用に含めて数えています",
      lunchRelief: s.stage === "elementary" && sec === "public" ? lunchRelief() : 0,
      note: out === null ? "この区分は学校外活動費を学校の費用に含めて数えています" : null,
    };
  }
  if (s.stage === "vocational") return { annual: null, entrance: null, outOfSchool: null, basis: "専門学校の学費の統計の目安はまだありません", annualBasis: "専門学校の学費の統計の目安はまだありません", entranceBasis: "専門学校の入学金の統計の目安はまだありません", lunchRelief: 0, note: null };
  let ids: string[];
  let admission: string;
  let note: string | null = null;
  if (s.stage === "graduateMaster" || s.stage === "graduateDoctor") {
    const course = s.stage === "graduateMaster" ? "master" : "doctor";
    const x = sector === "private" ? "private" : sector === "national" ? "national" : "public";
    ids = x === "private" ? [`${S}.graduate.private.${course}.tuition`, `${S}.graduate.private.${course}.facility`] : [`${S}.graduate.${x}.tuition`];
    admission = x === "private" ? `${S}.graduate.private.${course}.admission` : `${S}.graduate.${x}.admission`;
    const year = x === "private" ? "令和7年度入学者" : x === "public" ? "2025年度" : "";
    const who = `${x === "private" ? "私立" : x === "national" ? "国立" : "公立"}大学の大学院${x === "private" ? `・${course === "master" ? "修士" : "博士"}` : ""}`;
    const annualBasis = x === "national" ? "国立大学の大学院の授業料の標準額（国の省令の額）" : ids.length > 1 ? `統計の平均。授業料と施設設備費を足したもの（${who}・${year}）` : `統計の平均の授業料（${who}・${year}）`;
    const entranceBasis = x === "national" ? "国立大学の大学院の入学料の標準額（国の省令の額）" : `統計の平均の入学料（${who}・${year}${x === "public" ? "・地域外" : ""}）`;
    return { annual: sumOf(ids), entrance: masterAmount(admission), outOfSchool: null, basis: titles([...ids, admission]), annualBasis, entranceBasis, lunchRelief: 0, note: null };
  }
  if (s.stage === "juniorCollege") {
    ids = [`${S}.juniorCollege.private.tuition`, `${S}.juniorCollege.private.facility`];
    admission = `${S}.juniorCollege.private.admission`;
    if (sector !== "private") note = "公立の短大の統計の目安はまだないので、私立の短大の平均で仮に計算しています";
  } else if (sector === "private") {
    const f = s.field === undefined || s.field === "other" ? "all" : s.field;
    ids = [`${S}.university.private.${f}.tuition`, `${S}.university.private.${f}.facility`];
    admission = `${S}.university.private.${f}.admission`;
  } else {
    ids = [`${S}.university.${sector}.tuition`];
    admission = `${S}.university.${sector}.admission`;
  }
  const year = yearLabel([...ids, admission]);
  const who = s.stage === "juniorCollege" ? "私立短大" : sector === "private" ? `私立大学・${FIELD_LABEL[s.field === undefined || s.field === "other" ? "all" : s.field] ?? "全体"}` : sector === "national" ? "国立大学" : "公立大学";
  const annualBasis =
    sector === "national" && s.stage === "university"
      ? "国立大学の授業料の標準額（国の省令の額）"
      : ids.length > 1
        ? `統計の平均。授業料と施設設備費を足したもの（${who}${year !== "" ? `・${year}` : ""}）`
        : `統計の平均の授業料（${who}${year !== "" ? `・${year}` : ""}）`;
  const entranceBasis = sector === "national" && s.stage === "university" ? "国立大学の入学料の標準額（国の省令の額）" : `統計の平均の入学料（${who}${year !== "" ? `・${year}` : ""}）`;
  return { annual: sumOf(ids), entrance: masterAmount(admission), outOfSchool: null, basis: titles([...ids, admission]), annualBasis, entranceBasis, lunchRelief: 0, note };
}

/** インターナショナルスクールの未入力（0089） */
export const INTERNATIONAL_MISSING = "未入力（インターナショナルスクールの学費の統計の目安はありません。学校の費用の年額を入れるまで0円で計算中）";
const INTERNATIONAL_NOTE = "インターナショナルスクールの多くは学校教育法第1条の学校ではなく（各種学校・無認可）、高校の就学支援金は計算しません（令和8年4月から外国人学校は対象外）。第1条の学校なら「私立」で入れてください";

/** 幼稚園〜高校の統計の出典の短い名前 */
const K12_SOURCE = "文部科学省「子供の学習費調査」令和5年度";
const FIELD_LABEL: Readonly<Record<string, string>> = { all: "全体", humanities: "文科系", science: "理科系", medical: "医歯系" };
/** 値の名前から年度の部分（「令和7年度入学者」「令和5年度」）を取り出す */
function yearLabel(ids: readonly string[]): string {
  for (const id of ids) {
    const m = /(令和\d+年度(?:入学者)?)/.exec(masterValue(id)?.title ?? "");
    if (m !== null) return m[1] as string;
  }
  return "";
}

/**
 * 公立小学校の給食費の負担軽減で学校の費用から引く年額（計算エンジンの education.cost の schoolLunchRelief と同じ: 統計の学校給食費と、
 * 国の基準額×月数の小さい方。計算基準年の値）。制度の値が無ければ 0
 */
function lunchRelief(): number {
  const lunch = masterAmount(`${S}.elementary.public.schoolLunch`);
  const monthly = regulationValue("educationSupport.schoolLunch.elementary.public.monthly", null);
  const months = regulationValue("educationSupport.schoolLunch.months", null);
  if (lunch === null || typeof monthly !== "number" || typeof months !== "number") return 0;
  return Math.min(lunch, monthly * months);
}

/** 自宅外の仕送り（年額）と初期費用の統計の平均 */
export function boardingStatistic(): { annual: number | null; initial: number | null; basis: string } {
  const a = `${S}.boarding.annual`;
  const i = `${S}.boarding.initial`;
  return { annual: masterAmount(a), initial: masterAmount(i), basis: titles([a, i]) };
}

/** 「年約 52.4万円」の形 */
export function manText(yen: number): string {
  const man = Math.round(yen / 1000) / 10;
  return `${man.toLocaleString("ja-JP")}万円`;
}
