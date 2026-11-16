// 子ども・教育の学校の行の「学校名」の欄と「学部・学科」の欄（0010 の2・9、0217）。
// - 学校名は打つたびに候補が絞られる部分一致の検索（schools.ts）。候補の一番上はいつも「学校未定（平均で計算）」
// - 選んだ学校は段の school に学校コードで持つ（{school, unit, rows: [], source}。学費の実データの行はまだ無いので rows は空で、エンジンは
//   今までどおり進路の型の平均で計算する）。選んだ学校の国立・公立・私立に、段の公立・私立の欄を合わせる
// - 学費の実データが無い学校は、使っている平均（統計名と年度）を欄の横に出す
// - 段に合わない学校は選べない。廃止した学校のコードは黙って書き換えず、移行先があれば「移行先の学校にする」を出す
// - ヒアリングシートの自由記述の学校名（取り込みの記録の回答に元の文字のまま残っている）は、学校未定の欄に出し、候補を探す言葉にする
import type { EducationStage, Household } from "../../engine/types.ts";
import { field, type FieldDef, type Finder, type SearchItem } from "./form.ts";
import { mutate, type WorkingHousehold } from "./household.ts";
import { stageStatistic } from "./educationCost.ts";
import { currentSchool, departmentsOf, loadSchoolList, SCHOOL_KIND_LABELS, schoolDetail, schoolFits, schoolListNow, schoolOfStage, searchSchools, sectorForSchool, stageHasSchools, type School, type SchoolHit } from "./schools.ts";

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

/** 学費の実データが無い学校の1行（使っている平均の統計名と年度。educationCost.ts の根拠の短い文） */
function averageText(st: EducationStage): string {
  const stat = stageStatistic(st);
  if (stat === null) return "学費の実データはまだ無いので、平均で計算しています";
  if (stat.annual === null) return `学費の実データはまだ無いので、学校の案内の額を入れてください（${stat.annualBasis}）`;
  return `学費の実データはまだ無いので、平均で計算しています（${stat.annualBasis}）`;
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
      "選んだ学校の国立・公立・私立に、公立・私立の欄を合わせます。学校の学費の実データはまだ入っていないので、選んでも学費は公立・私立と系統・通い方の平均で計算し、" +
      "使っている平均を欄の横に出します。「学校未定（平均で計算）」を選ぶと、学校を外して平均で計算します。" +
      "学校の一覧は文部科学省の学校コード一覧（加工して作成）です",
    sideEffects: "選んだ学校に合わせて、公立・私立の欄を変えます",
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
      const sc = st.school as { rows?: unknown[] } | undefined;
      const rows = Array.isArray(sc?.rows) ? sc.rows : [];
      const value = c;
      if (rows.length > 0) return { value, hint: "この学校の学費データで計算しています" };
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

  function pick(wh: WorkingHousehold, s: School): WorkingHousehold {
    const list = schoolListNow();
    const prev = stageNow(wh);
    if (list === null || prev === undefined) return wh;
    return mutate(wh, (h: Household, req) => {
      const t = o.find(h, { ...wh, request: req }) as Obj | undefined;
      if (t === undefined) return;
      t.school = schoolOfStage(s.code, list);
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

/** 段の学校の学部・学科の一覧があれば、その欄（一覧が無ければ null）。学校名の欄の後ろに置く */
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
    options: [{ value: "", label: "学部・学科を決めない（学校の平均で計算）" }, ...deps.map((d) => ({ value: `${code}/${d.id}`, label: d.name }))],
    help: "選んだ学校の学部・学科です。決めなければ、学校の平均で計算します",
    get: (wh) => {
      const u = (stageNow(wh)?.school as { unit?: unknown } | undefined)?.unit;
      return { value: typeof u === "string" && u !== code ? u : "" };
    },
    set: (wh, v) =>
      mutate(wh, (h, req) => {
        const t = o.find(h, { ...wh, request: req }) as Obj | undefined;
        const sc = t?.school as Obj | undefined;
        if (sc === undefined || sc.school !== code) return;
        sc.unit = typeof v === "string" && v !== "" ? v : code;
      }),
  });
}
