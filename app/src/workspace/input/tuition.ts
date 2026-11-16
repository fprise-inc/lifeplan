// 学校別の学費（マスタデータ master.education.tuition。0010 の3・7・9、0219）。今は国立大学の全校の入学料・授業料。
// - 正本は data/tuition/national.yaml（入学年度の区間ごとの額と、改定を在学生に当てるか）。画面には学校の一覧と一緒に配る（schools.data.js の tuition）
// - 学校・学部を選ぶと、その区分（学部・夜間主・大学院の課程など）の額を「入学年度×在学年次×費目×支払月」の行にして、段の school.rows に写す（0010 の9）。
//   計算エンジン（education.cost）は、子の入学年度の行があればその額のとおり、無ければ最も近い入学年度の行に教育費の上昇率を当てて推計する（知らせ N_ESTIMATED）
// - 確かめ待ち（status pendingReview）の区分は行を写さない（計算エンジンは国立大学の標準額〔国の省令の額〕で計算する）
// この部品は画面と道具（app/scripts/tuitionData.ts）の両方から読む。ほかの部品を読まない

export const TUITION_PACK_ID = "master.education.tuition";

/** 学費の区分（day 学部・evening 学部の夜間主コース・medDent 東京科学大学の医学部・歯学部・大学院の課程） */
export type TuitionPlanId = "day" | "evening" | "medDent" | "master" | "doctor" | "professional" | "law";
export const TUITION_PLAN_IDS: readonly TuitionPlanId[] = ["day", "evening", "medDent", "master", "doctor", "professional", "law"];

/** 区分の名前（画面の文） */
export const TUITION_PLAN_LABELS: Readonly<Record<TuitionPlanId, string>> = {
  day: "学部",
  evening: "学部の夜間主コース",
  medDent: "学部",
  master: "大学院の修士課程・博士前期課程",
  doctor: "大学院の博士課程・博士後期課程",
  professional: "専門職大学院",
  law: "法科大学院",
};

/** 区分ごとの行を作る在学年次の数（学部は6年制の学科、夜間主は5年の課程、博士は医・歯・薬・獣医の4年の課程まで。段の在学年数より後の行は計算エンジンが使わない） */
export const PLAN_GRADES: Readonly<Record<TuitionPlanId, number>> = { day: 6, evening: 5, medDent: 6, master: 2, doctor: 4, professional: 2, law: 3 };

/** 行を作る最も前の入学年度（今の在学生の計算に要る範囲。6年制の学部の6年生まで） */
export const FIRST_ENTRY_YEAR = 2021;

export interface TuitionRevision {
  /** 改定の始まりの年度（最初の区間は null = それより前から） */
  from: number | null;
  /** 改定を当てる人（newEntrants はその年度からの入学者・allStudents はその年度から在学生も）。額が前の区間と同じなら省く */
  appliesTo?: "newEntrants" | "allStudents";
  /** 入学料（null は年度別の記載が無い過去の入学者。行を作らない） */
  admission: number | null;
  /** 授業料の年額 */
  annual: number;
  /** 出典（sources の ID） */
  source: string;
  locator?: string;
}

export interface TuitionPlan {
  plan: TuitionPlanId;
  status: "reviewed" | "pendingReview";
  /** 額が公式に出ている最も先の入学年度 */
  latestEntryYear: number;
  revisions: TuitionRevision[];
  note?: string;
}

export interface TuitionSource {
  url: string;
  title: string;
  retrievedAt: string;
  sha256?: string;
}

export interface SchoolTuitionData {
  school: string;
  /** 案内にある在学中の改定の注記（inSchoolRevisionApplies・other・none） */
  general?: string;
  plans: TuitionPlan[];
  sources: Record<string, TuitionSource>;
}

/** 段に写す行（engine.input の schoolTuition の rows） */
export interface TuitionRow {
  entryYear: number;
  grade: number;
  item: "tuition.admission" | "tuition.annual";
  monthOffset: number;
  amount: number;
}

/** その入学年度の人に当たる区間（改定の始まりの年度まで入学年度で見る。allStudents の改定は払う年度で見る） */
function revisionFor(plan: Pick<TuitionPlan, "revisions">, entryYear: number, fiscalYear: number): TuitionRevision {
  let hit = plan.revisions[0] as TuitionRevision;
  for (const r of plan.revisions.slice(1)) {
    const from = r.from ?? Number.NEGATIVE_INFINITY;
    const applies = r.appliesTo === "allStudents" ? from <= fiscalYear : from <= entryYear;
    if (applies) hit = r;
  }
  return hit;
}

/** 入学年度 entryYear の人が年度 fiscalYear に払う授業料の年額 */
export function annualFor(plan: Pick<TuitionPlan, "revisions">, entryYear: number, fiscalYear: number): number {
  return revisionFor(plan, entryYear, fiscalYear).annual;
}

/** 入学年度 entryYear の人の1年次の授業料の出典（sources の ID） */
export function revisionSource(plan: Pick<TuitionPlan, "revisions">, entryYear: number): string {
  return revisionFor(plan, entryYear, entryYear).source;
}

/** 入学年度 entryYear の人の入学料（年度別の記載が無ければ null）と、その出典 */
export function admissionFor(plan: Pick<TuitionPlan, "revisions">, entryYear: number): { amount: number | null; source: string } {
  let hit = plan.revisions[0] as TuitionRevision;
  for (const r of plan.revisions.slice(1)) if ((r.from ?? Number.NEGATIVE_INFINITY) <= entryYear && r.admission !== null) hit = r;
  return { amount: hit.admission, source: hit.source };
}

/**
 * 区分の額を「入学年度×在学年次×費目×支払月」の行にする（0010 の3）。入学年度は FIRST_ENTRY_YEAR から latestEntryYear まで、
 * 在学年次は grades（省略は区分の PLAN_GRADES）まで。授業料は年次の始まりの月（4月）と6か月後（10月）に半分ずつ、入学料は入学の前の月（3月）
 */
export function tuitionRows(plan: TuitionPlan, grades: number = PLAN_GRADES[plan.plan]): TuitionRow[] {
  const rows: TuitionRow[] = [];
  for (let e = FIRST_ENTRY_YEAR; e <= plan.latestEntryYear; e++) {
    const adm = admissionFor(plan, e).amount;
    if (adm !== null) rows.push({ entryYear: e, grade: 1, item: "tuition.admission", monthOffset: -1, amount: adm });
    for (let g = 1; g <= grades; g++) {
      const annual = annualFor(plan, e, e + g - 1);
      const first = Math.floor(annual / 2);
      rows.push({ entryYear: e, grade: g, item: "tuition.annual", monthOffset: 0, amount: first }, { entryYear: e, grade: g, item: "tuition.annual", monthOffset: 6, amount: annual - first });
    }
  }
  return rows;
}

/** 段の学校の段（university・graduateMaster など）と系統から、大学院の課程の区分（学部の段は null） */
export function graduatePlanOf(stage: string, field?: string): TuitionPlanId | null {
  if (stage === "graduateMaster") return "master";
  if (stage === "graduateDoctor") return "doctor";
  if (stage === "graduateProfessional") return field === "law" ? "law" : "professional";
  return null;
}

/** 学校の区分（無ければ null） */
export function planOf(data: SchoolTuitionData | undefined, plan: TuitionPlanId): TuitionPlan | null {
  return data?.plans.find((p) => p.plan === plan) ?? null;
}

/** 行の中で、入学年度 entryYear に当てる入学年度（その年度の行があればその年度、無ければその前で最も近い年度、それも無ければ最初の年度。計算エンジンと同じ） */
export function refEntryYear(rows: readonly Pick<TuitionRow, "entryYear">[], entryYear: number): number | null {
  const years = [...new Set(rows.map((r) => r.entryYear))].sort((a, b) => a - b);
  if (years.length === 0) return null;
  if (years.includes(entryYear)) return entryYear;
  return years.filter((y) => y <= entryYear).at(-1) ?? (years[0] as number);
}

/** 行の、ある入学年度の1年次の授業料の年額と入学料（今の値段。教育費の上昇率は入れない） */
export function firstYearOfRows(rows: readonly TuitionRow[], entryYear: number): { ref: number; annual: number; admission: number | null } | null {
  const ref = refEntryYear(rows, entryYear);
  if (ref === null) return null;
  const annual = rows.filter((r) => r.entryYear === ref && r.grade === 1 && r.item === "tuition.annual").reduce((s, r) => s + r.amount, 0);
  const adm = rows.find((r) => r.entryYear === ref && r.item === "tuition.admission");
  return { ref, annual, admission: adm === undefined ? null : adm.amount };
}
