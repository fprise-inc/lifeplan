// 子が返す貸与の奨学金（0104）の書き添えの文（提案書の前提の注と、アプリの結果の画面の目標の区画で同じ物を使う）:
// - 子が返す奨学金の返済は、世帯の収支・負債に入れない（エンジンの要約 childScholarships に、子・最初の月の返済額・返す期間・表の期間の中の合計）
// - 在学中に受け取る奨学金は、学費に使う入るお金として世帯の収支に入っている（ここでは書かない）

/** エンジンの要約の childScholarships の1件 */
export interface ChildScholarship {
  object: string;
  member: string;
  principal: number;
  monthly: number;
  from: string;
  to: string;
  total: number;
}

/** エンジンの要約から、子が返す奨学金の一覧（無ければ空） */
export function childScholarshipsOf(summary: unknown): ChildScholarship[] {
  const list = (
    summary as { childScholarships?: ChildScholarship[] } | null | undefined
  )?.childScholarships;
  return Array.isArray(list) ? list : [];
}

const ymText = (ym: string): string =>
  `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
/** 月々の額（万円・小数1桁。1万円未満は千円単位の円） */
const monthlyText = (yen: number): string =>
  yen >= 10000
    ? `約${(Math.round(yen / 1000) / 10).toLocaleString("ja-JP")}万円`
    : `約${(Math.round(yen / 1000) * 1000).toLocaleString("ja-JP")}円`;
const totalText = (yen: number): string =>
  `約${Math.round(yen / 10000).toLocaleString("ja-JP")}万円`;

/**
 * 子が返す奨学金の書き添え（子ごとに1文）。例: 「第2子の奨学金の返済（2038年10月〜2053年9月・月々約1.4万円・合計約257万円）は、第2子が返すので世帯の収支に入れていません」。
 * 1人に2件以上あれば、期間は最初から最後まで、月々の額は最初の月の合計、合計は足した額。labelOf は子の呼び方（第1子など）
 */
/** 書き添えの文に入れる値（単位まで入れた文字） */
export interface ChildScholarshipNoteValues {
  child: string;
  from: string;
  to: string;
  monthly: string;
  total: string;
}

export function childScholarshipNotes(
  summary: unknown,
  labelOf: (member: string) => string,
  /** 文の作り方（アプリの結果の画面で事務所の文を当てるとき。省略は公式の文。0212 の追記） */
  text: (v: ChildScholarshipNoteValues) => string = (v) =>
    `${v.child}の奨学金の返済（${v.from}〜${v.to}・月々${v.monthly}・合計${v.total}）は、${v.child}が返すので世帯の収支に入れていません`,
): string[] {
  const byChild = new Map<string, ChildScholarship[]>();
  for (const c of childScholarshipsOf(summary))
    byChild.set(c.member, [...(byChild.get(c.member) ?? []), c]);
  return [...byChild.entries()].map(([member, list]) => {
    const from = list.map((c) => c.from).sort()[0] as string;
    const to = list
      .map((c) => c.to)
      .sort()
      .at(-1) as string;
    const monthly = list
      .filter((c) => c.from === from)
      .reduce((s, c) => s + c.monthly, 0);
    const total = list.reduce((s, c) => s + c.total, 0);
    return text({
      child: labelOf(member),
      from: ymText(from),
      to: ymText(to),
      monthly: monthlyText(monthly),
      total: totalText(total),
    });
  });
}
