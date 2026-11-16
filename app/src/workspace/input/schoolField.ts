// 子ども・教育の学校の行の「学校名」の欄と「学部・学科」の欄（0010 の2・9、0217）。
// - 学校名は打つたびに候補が絞られる部分一致の検索（schools.ts）。候補の一番上はいつも「学校未定（平均で計算）」
// - 選んだ学校は段の school に学校コードで持つ（{school, unit, rows, source}）。学費の実データ（国立大学の全校。0219）のある学校は、選んだ学部・
//   課程の「入学年度×在学年次×費目×支払月」の行を rows に写し、エンジンはその額で計算する。無い学校は rows が空で、今までどおり平均で計算する。
//   選んだ学校の国立・公立・私立に、段の公立・私立の欄を合わせる
// - 欄の横に学費の出どころ（大学の公式の学費の案内・入学年度）を出す。実データの無い学校は使っている平均（統計名と年度）、確かめ待ちの国立大学は標準額で補ったこと
// - 学部・学科の一覧のある学校は学部・学科の欄を出し、選ぶと部局ID・その区分の行・修業年数を段に入れる
// - 段に合わない学校は選べない。廃止した学校のコードは黙って書き換えず、移行先があれば「移行先の学校にする」を出す
// - ヒアリングシートの自由記述の学校名（取り込みの記録の回答に元の文字のまま残っている）は、学校未定の欄に出し、候補を探す言葉にする
import type { EducationStage, Household, Member } from "../../engine/types.ts";
import { field, type FieldDef, type Finder, type SearchItem } from "./form.ts";
import { mutate, type WorkingHousehold } from "./household.ts";
import { stagePeriod, stageStatistic, stageYears } from "./educationCost.ts";
import { currentSchool, departmentOf, departmentsOf, loadSchoolList, SCHOOL_KIND_LABELS, schoolDetail, schoolFits, schoolListNow, schoolOfStage, searchSchools, sectorForSchool, stageHasSchools, tuitionPlanFor, type School, type SchoolHit } from "./schools.ts";
import { firstYearOfRows, revisionSource, TUITION_PLAN_LABELS, type TuitionRow } from "./tuition.ts";

type Obj = Record<string, unknown>;

/** 学校未定の選択肢 */
export const UNDECIDED: SearchItem = { value: "", label: "学校未定（平均で計算）", sub: "公立・私立と系統・通い方の平均で計算します" };

const SECTOR_WORD: Readonly<Record<string, string>> = { national: "国立", public: "公立", private: "私立", international: "インターナショナルスクール" };
const VIA_WORD = { name: "", kana: "読み", abbr: "略称", variant: "別の表記", former: "旧校名" } as const;

const itemOf = (h: SchoolHit): SearchItem => ({ value: h.school.code, label: h.school.name, sub: schoolDetail(h.school), ...(h.via !== "name" ? { note: `${VIA_WORD[h.via]}: ${h.text}` } : {}) });

/**
 * ヒアリングシートで受けた、この子の「考えている学校名」（自由記述。取り込みの記録の回答の元の文字）。新しい取り込みから見る。
 * シートの何番目の子かは、取り込みと同じ数え方（生年月の入った子を順に、世帯の子の並びに当てる）で読む
 */
export function hearingSchoolText(wh: WorkingHousehold, childId: string): string | null {
  const children = wh.request.input.household.members.filter((m) => m.kind === "child");
  const at = children.findIndex((m) => m.id === childId);
  if (at < 0) return null;
  const imports = wh.hearing?.imports ?? [];
  for (let k = imports.length - 1; k >= 0; k--) {
    const answers = imports[k]?.answers ?? [];
    const withBirth = answers.filter((a) => a.key === "hs.family.child.birthYearMonth" && a.status === "value").map((a) => a.index ?? 1).sort((x, y) => x - y);
    const n = withBirth[at];
    if (n === undefined) continue;
    const a = answers.find((x) => x.key === "hs.education.school" && (x.index ?? 1) === n && x.status === "value");
    const raw = a?.raw;
    const t = raw === undefined || raw.kind === "bool" ? "" : raw.text.trim();
    if (t !== "") return t;
  }
  return null;
}

/** 学費の実データが無い学校の1行（使っている平均の統計名と年度。educationCost.ts の根拠の短い文）。確かめ待ちの国立大学は標準額で補ったこと */
function averageText(st: EducationStage): string {
  const list = schoolListNow();
  const code = (st.school as { school?: unknown } | undefined)?.school;
  if (list !== null && typeof code === "string") {
    const t = tuitionPlanFor(list, code, (st.school as { unit?: string }).unit ?? code, st);
    if (t !== null && (t.plan === null || t.plan.status !== "reviewed")) {
      const what = t.plan === null ? `${TUITION_PLAN_LABELS[t.id]}の額はまだ学費データに無い` : `${TUITION_PLAN_LABELS[t.id]}の額は確かめ待ち`;
      const stat = stageStatistic(st);
      return `この大学の${what}ので、${stat?.annualBasis ?? "国立大学の標準額（国の省令の額）"}で補って計算しています`;
    }
  }
  const stat = stageStatistic(st);
  if (stat === null) return "学費の実データはまだ無いので、平均で計算しています";
  if (stat.annual === null) return `学費の実データはまだ無いので、学校の案内の額を入れてください（${stat.annualBasis}）`;
  return `学費の実データはまだ無いので、平均で計算しています（${stat.annualBasis}）`;
}

/** 段の学費データの行の説明（使っている入学年度の1年次の額・出どころ）。行が無ければ null */
export interface SchoolRowsInfo {
  /** 子の入学年度（生年月から決まらなければ null） */
  entryYear: number | null;
  /** 使っている行の入学年度 */
  ref: number;
  /** 子の入学年度の行が無い（ref の行をもとに計算エンジンが推計する） */
  estimated: boolean;
  annual: number;
  admission: number | null;
  /** 出どころの短い文（「東京大学の公式の学費の案内（2026-11-16 取得）」） */
  source: string;
  /** 欄の横に出す1行 */
  text: string;
}

export function schoolRowsInfo(st: EducationStage, child: Member | undefined): SchoolRowsInfo | null {
  const sc = st.school as { school?: unknown; unit?: unknown; rows?: unknown } | undefined;
  const rows = Array.isArray(sc?.rows) ? (sc.rows as TuitionRow[]) : [];
  if (rows.length === 0 || typeof sc?.school !== "string") return null;
  const period = child === undefined ? null : stagePeriod(child, st);
  const entryYear = period === null ? null : Number(period.from.slice(0, 4));
  const latest = Math.max(...rows.map((r) => r.entryYear));
  const first = firstYearOfRows(rows, entryYear ?? latest);
  if (first === null) return null;
  const list = schoolListNow();
  const name = list?.byCode.get(sc.school)?.name ?? "この学校";
  const t = list === null ? null : tuitionPlanFor(list, sc.school, typeof sc.unit === "string" ? sc.unit : sc.school, st);
  const src = t?.plan == null ? undefined : t.data.sources[revisionSource(t.plan, first.ref)];
  const source = src === undefined ? `${name}の学費データ` : `${name}の公式の学費の案内「${src.title}」（${src.retrievedAt} 取得）`;
  const estimated = entryYear !== null && entryYear !== first.ref;
  const yen = (v: number) => `${(v / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 2 })}万円`;
  const amounts = `授業料 年${yen(first.annual)}${first.admission !== null ? `・入学料 ${yen(first.admission)}` : ""}`;
  const when = !estimated
    ? `${first.ref}年度入学の額`
    : (entryYear as number) > first.ref
      ? `${first.ref}年度入学の額。${entryYear}年度入学の額はまだ出ていないので、この額を教育費の上昇率で伸ばして計算します`
      : `${first.ref}年度入学の額。${entryYear}年度入学の額は学費データに無いので、この額をもとに計算します`;
  return { entryYear, ref: first.ref, estimated, annual: first.annual, admission: first.admission, source, text: `学費は${source}で計算しています（${amounts}・${when}）` };
}

/** 段の学費データの行が、今の学校・学部・課程と学費データから作る行と同じか（違えば、学費データが新しくなったか、課程を変えた） */
function rowsCurrent(st: EducationStage): boolean | null {
  const list = schoolListNow();
  const sc = st.school as { school?: unknown; unit?: unknown; rows?: unknown } | undefined;
  if (list === null || typeof sc?.school !== "string") return null;
  const want = schoolOfStage(sc.school, list, typeof sc.unit === "string" ? sc.unit : sc.school, st) as unknown as { rows: unknown[] };
  return JSON.stringify(want.rows) === JSON.stringify(sc.rows ?? []);
}

/**
 * 学校名の欄。find はこの段、childOf は進路の子、after は公立・私立を学校に合わせたときの始末（前の推定の額を外す。education.ts の
 * dropStaleEstimates）
 */
export function schoolNameField(o: { key: string; find: Finder; childOf: (wh: WorkingHousehold) => string | undefined; after: (prev: EducationStage, next: EducationStage, wh: WorkingHousehold) => void }): FieldDef {
  const stageNow = (wh: WorkingHousehold) => o.find(wh.request.input.household, wh) as EducationStage | undefined;
  const codeOf = (wh: WorkingHousehold) => {
    const sc = stageNow(wh)?.school as { school?: unknown } | undefined;
    return typeof sc?.school === "string" ? sc.school : null;
  };
  const nameOf = (code: string) => {
    const s = schoolListNow()?.byCode.get(code);
    return s === undefined ? (schoolListNow() === null ? `学校コード ${code}` : `一覧に無い学校（学校コード ${code}）`) : s.name;
  };
  const refuse = (wh: WorkingHousehold, v: unknown): string | null => {
    if (typeof v !== "string" || v === "") return null;
    const list = schoolListNow();
    if (list === null) return "学校の一覧を読み込んでいます。少し待ってから選んでください";
    const st = stageNow(wh);
    const s = list.byCode.get(v);
    if (s === undefined) return "学校の一覧に無い学校コードです";
    if (st !== undefined && !schoolFits(s, st.stage, st.sector)) return `${s.name}（${SCHOOL_KIND_LABELS[s.kind] ?? s.kind}）は、この学校の行では選べません`;
    if (s.abolishedOn !== "") return `${s.name}は廃止された学校です`;
    return null;
  };
  return field({
    key: o.key,
    item: "goal.education",
    label: "学校名",
    level: "detail",
    kind: "select",
    options: [{ value: "", label: UNDECIDED.label }],
    help:
      "学校名・読み・略称・旧校名で探して選びます（打つたびに候補が絞られます）。同じ名前の学校は、都道府県・市区町村・国立公立私立で見分けます。" +
      "選んだ学校の国立・公立・私立に、公立・私立の欄を合わせます。国立大学は、大学の公式の学費の案内から取った入学料・授業料（入学年度ごと）で計算し、" +
      "出どころを欄の横に出します（学部・学科を選ぶと、夜間主コースなどの額と修業年数も合わせます）。ほかの学校は学費の実データがまだ無いので、" +
      "公立・私立と系統・通い方の平均で計算し、使っている平均を欄の横に出します。「学校未定（平均で計算）」を選ぶと、学校を外して平均で計算します。" +
      "学校の一覧は文部科学省の学校コード一覧（加工して作成）です",
    sideEffects: "選んだ学校に合わせて、公立・私立の欄を変え、国立大学は学費データの行を写します",
    search: {
      fixed: [UNDECIDED],
      placeholder: "学校名・略称・旧校名で探す",
      load: loadSchoolList,
      ready: () => schoolListNow() !== null,
      shown: (wh) => {
        const c = codeOf(wh);
        return c === null ? UNDECIDED.label : nameOf(c);
      },
      find: (wh, q) => {
        const list = schoolListNow();
        const st = stageNow(wh);
        if (list === null || st === undefined) return { items: [], total: 0 };
        const r = searchSchools(list, q, { stage: st.stage, sector: st.sector, limit: 30 });
        return { items: r.hits.map(itemOf), total: r.total };
      },
      initial: (wh) => {
        const child = o.childOf(wh);
        if (codeOf(wh) !== null || child === undefined) return null;
        const t = hearingSchoolText(wh, child);
        return t === null ? null : { title: `ヒアリングシートの学校名「${t}」の候補`, query: t };
      },
    },
    refuse,
    get: (wh) => {
      const st = stageNow(wh);
      const c = codeOf(wh);
      if (c === null || st === undefined) {
        const child = o.childOf(wh);
        const t = child === undefined ? null : hearingSchoolText(wh, child);
        return { value: "", hint: t === null ? null : `ヒアリングシートの学校名: ${t}` };
      }
      const list = schoolListNow();
      const value = c;
      const child = o.childOf(wh);
      const info = schoolRowsInfo(st, wh.request.input.household.members.find((m) => m.id === child));
      if (info !== null) {
        const s = list?.byCode.get(c);
        const hint = s === undefined ? info.text : `${schoolDetail(s)}。${info.text}`;
        if (rowsCurrent(st) === false)
          return { value, hint, warn: "学費データが新しくなったか、学部・学科・課程を変えたので、写した学費の行が今の学費データと違います", warnFix: { label: "学費の行を今の学費データにする", run: (w) => refreshRows(w) } };
        return { value, hint };
      }
      const avg = averageText(st);
      if (list === null) return { value, hint: avg };
      const s = list.byCode.get(c);
      if (s === undefined) return { value, hint: avg, warn: "学校の一覧に無い学校コードです。学校を選び直してください" };
      const detail = schoolDetail(s);
      if (s.abolishedOn !== "") {
        const now = currentSchool(list, c);
        return {
          value,
          hint: `${detail}。${avg}`,
          warn: now !== null ? `この学校は${s.abolishedOn.replaceAll("-", "/")}の時点で廃止され、${now.name}に移っています` : `この学校は${s.abolishedOn.replaceAll("-", "/")}の時点で廃止されています。学校を選び直してください`,
          warnFix: now !== null && schoolFits(now, st.stage, st.sector) ? { label: `${now.name}にする`, run: (w) => pick(w, now) } : null,
        };
      }
      if (!schoolFits(s, st.stage, st.sector)) return { value, hint: detail, warn: `${s.name}（${SCHOOL_KIND_LABELS[s.kind] ?? s.kind}）は、この学校の行に合いません。学校を選び直してください` };
      const want = sectorForSchool(st.stage, s, st.sector);
      const have = st.sector ?? "public";
      if (want !== have) return { value, hint: `${detail}。${avg}`, warn: `選んだ学校は${SECTOR_WORD[want] ?? want}ですが、公立・私立の欄は${SECTOR_WORD[have] ?? have}です（学費は${SECTOR_WORD[have] ?? have}の平均で計算中）` };
      return { value, hint: `${detail}。${avg}` };
    },
    set: (wh, v) => {
      if (typeof v !== "string") return wh;
      if (v === "") return clear(wh);
      if (refuse(wh, v) !== null) return wh;
      const s = schoolListNow()?.byCode.get(v);
      return s === undefined ? wh : pick(wh, s);
    },
  });

  function clear(wh: WorkingHousehold): WorkingHousehold {
    if (stageNow(wh)?.school === undefined) return wh;
    return mutate(wh, (h, req) => {
      const t = o.find(h, { ...wh, request: req }) as Obj | undefined;
      if (t !== undefined) delete t.school;
    });
  }

  function refreshRows(wh: WorkingHousehold): WorkingHousehold {
    const list = schoolListNow();
    const prev = stageNow(wh);
    const sc = prev?.school as { school?: unknown; unit?: unknown } | undefined;
    if (list === null || prev === undefined || typeof sc?.school !== "string") return wh;
    const code = sc.school;
    return mutate(wh, (h: Household, req) => {
      const t = o.find(h, { ...wh, request: req }) as Obj | undefined;
      if (t !== undefined) t.school = schoolOfStage(code, list, typeof sc.unit === "string" ? sc.unit : code, prev);
    });
  }

  function pick(wh: WorkingHousehold, s: School): WorkingHousehold {
    const list = schoolListNow();
    const prev = stageNow(wh);
    if (list === null || prev === undefined) return wh;
    return mutate(wh, (h: Household, req) => {
      const t = o.find(h, { ...wh, request: req }) as Obj | undefined;
      if (t === undefined) return;
      t.school = schoolOfStage(s.code, list, undefined, prev);
      const sector = sectorForSchool(prev.stage, s, prev.sector);
      if (sector !== (prev.sector ?? "public")) {
        t.sector = sector;
        o.after(prev, t as unknown as EducationStage, wh);
      }
    });
  }
}

/** 段に学校名の欄を出すか（学校コードのある学校種の段だけ。保育園は無い） */
export const showsSchoolField = (stage: string): boolean => stageHasSchools(stage);

/**
 * 段の学校の学部・学科の一覧があれば、その欄（一覧が無ければ null）。学校名の欄の後ろに置く。選ぶと部局ID（<学校コード>/d001）を unit に入れ、
 * 学費データのある学校はその学部・学科の区分（夜間主コースなど）の行を写し直し、在学年数を修業年数に合わせる（標準と同じなら省く）
 */
export function departmentField(o: { key: string; find: Finder; code: string | null }): FieldDef | null {
  const list = schoolListNow();
  if (o.code === null || list === null) return null;
  const deps = departmentsOf(list, o.code);
  if (deps.length === 0) return null;
  const code = o.code;
  const stageNow = (wh: WorkingHousehold) => o.find(wh.request.input.household, wh) as EducationStage | undefined;
  return field({
    key: o.key,
    item: "goal.education",
    label: "学部・学科",
    level: "detail",
    kind: "select",
    options: [{ value: "", label: "学部・学科を決めない（学部の額で計算）" }, ...deps.map((d) => ({ value: `${code}/${d.id}`, label: d.years !== undefined && d.years !== 4 ? `${d.name}（${d.years}年）` : d.name }))],
    help: "選んだ大学の学部・学科です（大学の公式の学部の一覧から）。選ぶと、在学年数を修業年数（医学科・歯学科・薬学科・獣医学科は6年など）に合わせ、夜間主コースは夜間主の額で計算します。決めなければ学部の額で計算します",
    sideEffects: "在学年数を学部・学科の修業年数に合わせ、学費データの行を写し直します",
    get: (wh) => {
      const st = stageNow(wh);
      const u = (st?.school as { unit?: unknown } | undefined)?.unit;
      const value = typeof u === "string" && u !== code ? u : "";
      const d = value === "" ? undefined : departmentOf(list, value);
      if (value !== "" && d === undefined) return { value, warn: "学部・学科の一覧に無い部局です。選び直してください" };
      if (d?.years !== undefined && st !== undefined && stageYears(st) !== d.years) return { value, warn: `在学年数（${stageYears(st)}年）が、この学部・学科の修業年数（${d.years}年）と違います` };
      return { value };
    },
    set: (wh, v) =>
      mutate(wh, (h, req) => {
        const t = o.find(h, { ...wh, request: req }) as Obj | undefined;
        const sc = t?.school as Obj | undefined;
        if (t === undefined || sc === undefined || sc.school !== code) return;
        const unit = typeof v === "string" && v !== "" ? v : code;
        const st = t as unknown as EducationStage;
        const d = unit === code ? undefined : departmentOf(list, unit);
        if (d?.years !== undefined) {
          if (stageYears({ ...st, years: undefined }) === d.years) delete t.years;
          else t.years = d.years;
        }
        t.school = schoolOfStage(code, list, unit, st);
      }),
  });
}
