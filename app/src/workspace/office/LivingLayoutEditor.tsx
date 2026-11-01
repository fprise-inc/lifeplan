// 事務所の既定値のパネルの区画「基本生活費の内訳の並べ方」（0109。office/livingLayout.ts）: 内訳（月額）の行の名前を変える・まとめる・隠す・分ける。
// 右（狭い画面では下）に、4人の世帯の平均の額で見え方を出す。編集中の値は読む前の形のまま持ち、保存・読み込みのときに readLivingLayout で整える
import { livingCategoryAverages } from "../../../../hearing/src/estimates.ts";
import { apportion, hiddenCategories, LIVING_LABEL_MAX, LIVING_PARTS_MAX, LIVING_PARTS_MIN, partShares, readLivingLayout, rowCategories, rowLabel, rowMembers, STANDARD_LIVING_LAYOUT, STANDARD_LIVING_NAMES, type LivingLayout, type LivingRow, type LivingRowCategory } from "./livingLayout.ts";
import { LIVING_CATEGORY_ORDER } from "../input/estimates.ts";

export interface LivingLayoutEditorProps {
  /** 今の並べ方（無ければ標準） */
  value: LivingLayout | undefined;
  /** 並べ方を変えた（標準に戻したら undefined） */
  onChange: (next: LivingLayout | undefined) => void;
}

/** 見え方の額に使う世帯の人数 */
const PREVIEW_SIZE = 4;

const man = (yen: number) => `${(Math.round(yen / 1000) / 10).toLocaleString("ja-JP")}万円`;
const rank = (c: LivingRowCategory) => (LIVING_CATEGORY_ORDER as readonly string[]).indexOf(c);
const nameOf = (r: LivingRow) => rowLabel(r);

/** 分けた行の割合の欄が、そろっていない（入れた欄があるのに、全部でない・合計が100でない） */
export function sharesProblem(r: LivingRow): string | null {
  if (r.kind !== "split") return null;
  const set = r.parts.filter((p) => p.share !== undefined);
  if (set.length === 0) return null;
  const sum = set.reduce((s, p) => s + (p.share ?? 0), 0);
  return set.length < r.parts.length || sum !== 100 ? `割合はどの行にも入れ、合計を100%にしてください（今は${sum}%。そろうまでは等分で見せます）` : null;
}

/** 見え方の行（名前・額・分けた行か） */
export function previewRows(layout: LivingLayout, size = PREVIEW_SIZE): { label: string; amount: number | null; sub: boolean; note?: string }[] {
  const avg = livingCategoryAverages(size)?.amounts as Record<string, number> | undefined;
  const of = (cs: readonly string[]) => (avg === undefined ? null : cs.reduce((s, c) => s + (avg[c] ?? 0), 0));
  const out: { label: string; amount: number | null; sub: boolean; note?: string }[] = [];
  for (const r of layout.rows) {
    const members = rowMembers(layout, r);
    const v = of(members);
    const own = rowCategories(r);
    const extra = members.filter((c) => !own.includes(c));
    const notes: string[] = [];
    if (r.kind === "group") notes.push(own.map((c) => STANDARD_LIVING_NAMES[c]).join("＋"));
    else if (rowLabel(r) !== STANDARD_LIVING_NAMES[r.category]) notes.push(STANDARD_LIVING_NAMES[r.category]);
    if (extra.length > 0) notes.push(`隠した${extra.map((c) => STANDARD_LIVING_NAMES[c]).join("・")}を含む`);
    out.push({ label: rowLabel(r), amount: v, sub: false, ...(notes.length > 0 ? { note: notes.join("・") } : {}) });
    if (r.kind === "split") {
      const parts = v === null ? null : apportion(v, partShares(r.parts));
      r.parts.forEach((p, i) => out.push({ label: p.label, amount: parts?.[i] ?? null, sub: true }));
    }
  }
  out.push({ label: "合計", amount: of(LIVING_CATEGORY_ORDER), sub: false });
  return out;
}

export function LivingLayoutEditor({ value, onChange }: LivingLayoutEditorProps) {
  const layout: LivingLayout = value ?? STANDARD_LIVING_LAYOUT;
  const rows = layout.rows;
  const hidden = hiddenCategories(layout);
  const put = (next: LivingRow[]) => {
    const l = { rows: next };
    onChange(readLivingLayout(l) === null ? undefined : l);
  };
  const setRow = (i: number, r: LivingRow) => put(rows.map((x, j) => (j === i ? r : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j] as LivingRow, next[i] as LivingRow];
    put(next);
  };
  const rename = (i: number, text: string) => {
    const r = rows[i];
    if (r === undefined) return;
    const t = text.slice(0, LIVING_LABEL_MAX);
    if (r.kind === "group") setRow(i, { ...r, label: t });
    else {
      const { label: _l, ...rest } = r;
      void _l;
      setRow(i, (t.trim() === "" ? rest : { ...rest, label: t }) as LivingRow);
    }
  };
  // 下の行とまとめる（どちらも分けた行でないとき）
  const merge = (i: number) => {
    const a = rows[i];
    const b = rows[i + 1];
    if (a === undefined || b === undefined || a.kind === "split" || b.kind === "split") return;
    const cats = [...rowCategories(a), ...rowCategories(b)];
    const label = a.kind === "group" ? a.label : `${nameOf(a)}・${nameOf(b)}`;
    put([...rows.slice(0, i), { kind: "group", label, categories: cats }, ...rows.slice(i + 2)]);
  };
  const ungroup = (i: number) => {
    const r = rows[i];
    if (r?.kind !== "group") return;
    put([...rows.slice(0, i), ...r.categories.map((category): LivingRow => ({ kind: "one", category })), ...rows.slice(i + 1)]);
  };
  const split = (i: number) => {
    const r = rows[i];
    if (r?.kind !== "one" || r.category === "other") return;
    const name = nameOf(r);
    setRow(i, { kind: "split", category: r.category, ...(r.label !== undefined ? { label: r.label } : {}), parts: [{ label: `${name} 1` }, { label: `${name} 2` }] });
  };
  const unsplit = (i: number) => {
    const r = rows[i];
    if (r?.kind !== "split") return;
    setRow(i, { kind: "one", category: r.category, ...(r.label !== undefined ? { label: r.label } : {}) });
  };
  const hide = (i: number) => put(rows.filter((_x, j) => j !== i));
  const unhide = (c: LivingRowCategory) => {
    const at = rows.findIndex((r) => rank(rowCategories(r)[0] as LivingRowCategory) > rank(c));
    const next = [...rows];
    next.splice(at < 0 ? next.length : at, 0, { kind: "one", category: c });
    put(next);
  };
  const setPart = (i: number, k: number, patch: { label?: string; share?: string }) => {
    const r = rows[i];
    if (r?.kind !== "split") return;
    const parts = r.parts.map((p, j) => {
      if (j !== k) return p;
      const label = patch.label !== undefined ? patch.label.slice(0, LIVING_LABEL_MAX) : p.label;
      if (patch.share === undefined) return { ...p, label };
      const t = patch.share.trim().replace(/[％%]$/, "");
      const n = /^\d{1,3}$/.test(t) ? Number(t) : NaN;
      return Number.isInteger(n) && n <= 100 ? { label, share: n } : { label };
    });
    setRow(i, { ...r, parts });
  };
  const addPart = (i: number) => {
    const r = rows[i];
    if (r?.kind !== "split" || r.parts.length >= LIVING_PARTS_MAX) return;
    setRow(i, { ...r, parts: [...r.parts.map((p) => ({ label: p.label })), { label: `${nameOf(r)} ${r.parts.length + 1}` }] });
  };
  const dropPart = (i: number, k: number) => {
    const r = rows[i];
    if (r?.kind !== "split" || r.parts.length <= LIVING_PARTS_MIN) return;
    setRow(i, { ...r, parts: r.parts.filter((_p, j) => j !== k).map((p) => ({ label: p.label })) });
  };
  const preview = previewRows(readLivingLayout(layout) ?? STANDARD_LIVING_LAYOUT);
  return (
    <section class="os-sec" aria-labelledby="os-living" data-office-living>
      <h3 id="os-living">基本生活費の内訳の並べ方</h3>
      <p class="pl-sub">
        基本生活費の入力項目の「内訳（月額）」に出す行です。名前を変える・まとめる（例: 水道・光熱費と通信費を「固定費」の1行に）・隠す・1つの内訳を分ける（例: 食費を自炊と外食に）ができます。どの世帯にもすぐ効きます。
        計算は10の内訳のまま、推定も同じで、並べ方を変えただけでは世帯の値も結果も変わりません。まとめた行に入れた額は、今の内訳の額の割合（どれも0円なら同じ人数の世帯の平均の割合）で分けて計算します。隠した内訳は「その他」の行に入れます。
      </p>
      <div class="os-lv">
        <ol class="os-lv-rows">
          {rows.map((r, i) => {
            const cats = rowCategories(r);
            const key = cats.join("+");
            const isOther = cats.includes("other");
            const problem = sharesProblem(r);
            return (
              <li key={key} class="os-lv-row" data-office-living-row={key}>
                <div class="os-lv-head">
                  <input
                    class="os-lv-name"
                    value={r.kind === "group" ? r.label : (r.label ?? "")}
                    placeholder={r.kind === "group" ? "まとめた行の名前" : STANDARD_LIVING_NAMES[r.category]}
                    maxLength={LIVING_LABEL_MAX}
                    aria-label={`${nameOf(r)}の行の名前`}
                    onInput={(e) => rename(i, (e.currentTarget as HTMLInputElement).value)}
                    data-office-living-name={key}
                  />
                  <span class="os-lv-btns">
                    <button type="button" class="link-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${nameOf(r)}を上へ`}>
                      ↑
                    </button>
                    <button type="button" class="link-btn" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`${nameOf(r)}を下へ`}>
                      ↓
                    </button>
                    {r.kind !== "split" && rows[i + 1] !== undefined && rows[i + 1]?.kind !== "split" ? (
                      <button type="button" class="link-btn" onClick={() => merge(i)} data-office-living-merge={key}>
                        下の行とまとめる
                      </button>
                    ) : null}
                    {r.kind === "group" ? (
                      <button type="button" class="link-btn" onClick={() => ungroup(i)} data-office-living-ungroup={key}>
                        まとめるのをやめる
                      </button>
                    ) : null}
                    {r.kind === "one" && !isOther ? (
                      <button type="button" class="link-btn" onClick={() => split(i)} data-office-living-split={key}>
                        分ける
                      </button>
                    ) : null}
                    {r.kind === "split" ? (
                      <button type="button" class="link-btn" onClick={() => unsplit(i)} data-office-living-unsplit={key}>
                        分けるのをやめる
                      </button>
                    ) : null}
                    {r.kind === "one" && !isOther ? (
                      <button type="button" class="link-btn" onClick={() => hide(i)} data-office-living-hide={key}>
                        隠す
                      </button>
                    ) : null}
                  </span>
                </div>
                {r.kind === "group" || (r.kind !== "split" && r.label !== undefined) || (r.kind === "split" && r.label !== undefined) ? <small class="os-note">内訳: {cats.map((c) => STANDARD_LIVING_NAMES[c]).join("＋")}</small> : null}
                {isOther ? <small class="os-note">その他は隠せません（隠した内訳を入れる行です）</small> : null}
                {r.kind === "split" ? (
                  <div class="os-lv-parts" data-office-living-parts={key}>
                    {r.parts.map((p, k) => (
                      <div class="os-lv-part" key={k}>
                        <input value={p.label} maxLength={LIVING_LABEL_MAX} aria-label={`${nameOf(r)}の分けた行 ${k + 1} の名前`} onInput={(e) => setPart(i, k, { label: (e.currentTarget as HTMLInputElement).value })} data-office-living-part={`${key}:${k}`} />
                        <span class="os-in">
                          <input inputMode="numeric" size={3} value={p.share === undefined ? "" : String(p.share)} placeholder={String(partShares(r.parts)[k] ?? "")} aria-label={`${p.label}の割合`} onInput={(e) => setPart(i, k, { share: (e.currentTarget as HTMLInputElement).value })} data-office-living-share={`${key}:${k}`} />%
                        </span>
                        <button type="button" class="link-btn" disabled={r.parts.length <= LIVING_PARTS_MIN} onClick={() => dropPart(i, k)}>
                          外す
                        </button>
                      </div>
                    ))}
                    {r.parts.length < LIVING_PARTS_MAX ? (
                      <button type="button" class="link-btn" onClick={() => addPart(i)} data-office-living-add-part={key}>
                        ＋ 分けた行を足す
                      </button>
                    ) : null}
                    <small class="os-note">
                      分けた行の合計が{nameOf(r)}になります。割合は、まだ分けていない世帯で見せる目安です（入れなければ等分）。
                    </small>
                    {problem !== null ? (
                      <small class="fld-help warn" role="status" data-office-living-share-problem={key}>
                        {problem}
                      </small>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div class="os-lv-preview" data-office-living-preview>
          <h4>見え方（{PREVIEW_SIZE}人の世帯の平均の額で）</h4>
          <table>
            <tbody>
              {preview.map((p, i) => (
                <tr key={i} class={p.sub ? "sub" : p.label === "合計" && i === preview.length - 1 ? "total" : ""}>
                  <th scope="row">
                    {p.sub ? "　" : ""}
                    {p.label}
                    {p.note !== undefined ? <small>（{p.note}）</small> : null}
                  </th>
                  <td>{p.amount === null ? "—" : man(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {hidden.length > 0 ? (
        <p class="pl-sub" data-office-living-hidden>
          隠している内訳（「その他」の行に入れます）:
          {hidden.map((c) => (
            <span key={c} class="os-lv-hidden">
              {STANDARD_LIVING_NAMES[c]}
              <button type="button" class="link-btn" onClick={() => unhide(c)} data-office-living-unhide={c}>
                戻す
              </button>
            </span>
          ))}
        </p>
      ) : null}
      <p class="pl-sub">
        <button type="button" class="link-btn" onClick={() => onChange(undefined)} data-office-living-reset>
          既定の並べ方に戻す（10の内訳を標準の名前で）
        </button>
      </p>
    </section>
  );
}
