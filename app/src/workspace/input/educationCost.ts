// 子ども・教育のカードで見せる統計の平均の額と、段の在学の期間（0062）。計算エンジンの education.cost と同じ統計・同じ決まりで、
// 計算基準年の額（今の値段）を出す。画面は配布の制度データのパックを待たずに出すので、統計はビルドの前の写し（hearing/src/statistics.generated.ts）から読む。
// 学校給食費の負担軽減・教育費の上昇率・修学支援は入れない（見せるのは「統計の平均」の年額だけ）
import type { EducationStage, Member } from "../../engine/types.ts";
import { masterAmount, masterValue } from "../../../../hearing/src/statistics.ts";
import { schoolEntryYear } from "../present.ts";

const S = "education.statistics";
const K12 = new Set(["kindergarten", "elementary", "juniorHigh", "highSchool"]);
/** 段の始まりの年齢（エンジンの START_AGE と同じ） */
const START_AGE: Readonly<Record<string, number>> = { kindergarten: 3, elementary: 6, juniorHigh: 12, highSchool: 15, university: 18, juniorCollege: 18, vocational: 18 };
/** 在学年数の標準（エンジンの YEARS と同じ。医歯系の大学は6年） */
const YEARS: Readonly<Record<string, number>> = { kindergarten: 3, elementary: 6, juniorHigh: 3, highSchool: 3, university: 4, juniorCollege: 2, vocational: 2 };

export const isK12 = (stage: string): boolean => K12.has(stage);
export const isHigher = (stage: string): boolean => stage === "university" || stage === "juniorCollege" || stage === "vocational";

/** 段の在学年数（入れていなければ標準） */
export function stageYears(s: EducationStage): number {
  return s.years ?? (s.stage === "university" && s.field === "medical" ? 6 : (YEARS[s.stage] ?? 1));
}

/** 段の在学の期間（入学の年の4月〜卒業の年の3月。浪人の年数を足す）。生年月から決まらなければ null */
export function stagePeriod(child: Member, s: EducationStage): { from: string; to: string } | null {
  const age = START_AGE[s.stage];
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
  /** 根拠の文 */
  basis: string;
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
      note: out === null ? "この区分は学校外活動費を学校の費用に含めて数えています" : null,
    };
  }
  if (s.stage === "vocational") return { annual: null, entrance: null, outOfSchool: null, basis: "専門学校の学費の統計の目安はまだありません", note: null };
  let ids: string[];
  let admission: string;
  let note: string | null = null;
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
  return { annual: sumOf(ids), entrance: masterAmount(admission), outOfSchool: null, basis: titles([...ids, admission]), note };
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
