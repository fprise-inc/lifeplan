// 世帯の一覧（上の帯の「世帯」から開く）: 顧客の世帯を開く・新しく作る・顧客番号と区分を変える・完全削除（0013 の5）と、
// 見本の棚（アプリに入っている見本と、自分で作った見本。顧客番号を持たず、顧客の一覧には混ぜない。0033）。
// 一覧に出すのは表示用の顧客番号（区分の記号＋通し番号。区分を使わないときは通し番号だけ）と構成の要約（続柄と人数）だけ。氏名は持たない（0012）。
// 区分を使うかは、初めて世帯の一覧を使うときに1回だけ聞く（区分の設定がまだ一度も決まっていないとき。0033 の追記）
import { useEffect, useState } from "preact/hooks";
import type { StorageNotice, StoredHousehold, StoreStatus } from "../../engine/host.ts";
import { AGE_BANDS, CATEGORY_CODE, DEFAULT_CATEGORIES, FAMILY_SHAPES, NO_CATEGORY, SAMPLE_TRAITS, ageBandName, categoryText, filterCustomers, filterShelf, parseSampleNo, sampleNoText, type Category, type CategoryEdit, type SampleRequest, type ShelfItem } from "./numbering.ts";
import { OFFICE_MESSAGES, sinceText } from "./office.ts";
import { storageNoticeText } from "./storage.ts";

export type HouseholdTab = "customers" | "samples";

export interface HouseholdPanelProps {
  status: StoreStatus | null;
  /** 保存の部品を使えない理由（使えるときは null） */
  unavailable: string | null;
  /** 直前の操作の失敗 */
  error: string | null;
  /** 顧客の世帯（見本は入れない） */
  list: StoredHousehold[];
  /** 開いている保存した世帯（見本を開いているときは見本の世帯） */
  currentId: string | null;
  /** 区分の一覧（空は区分を使わない） */
  categories: Category[];
  /** 区分を使うかを決めたか（false なら「区分を使いますか？」を1回だけ聞く。省略は決めたもの） */
  categoriesDecided?: boolean;
  /** 見本の棚（アプリの見本と自分で作った見本。見本番号の順） */
  shelf: ShelfItem[];
  /** 開いている見本（アプリの見本の名前か、自分で作った見本の内部ID） */
  currentSample: string | null;
  /** 開いている世帯の家族の形と本人の年代（見本に登録するときの初めの値） */
  currentShape: { family: number; age: number } | null;
  /** 開いているのが保存していない空の世帯なら、その名前（見本を開いているときは null） */
  unsavedTitle: string | null;
  initialTab?: HouseholdTab;
  onOpen: (id: string) => void;
  /** 空から作る（区分を選ぶ。区分を使わないときは undefined） */
  onCreate: (category: string | undefined) => void;
  onSaveCurrent: (category: string | undefined) => void;
  onRename: (id: string, customerNo: string) => Promise<string | null>;
  onSetCategory: (id: string, category: string) => Promise<string | null>;
  onAssignSerial: (id: string) => Promise<string | null>;
  onMakeSample: (id: string, req: SampleRequest) => Promise<string | null>;
  onSaveCategories: (edits: CategoryEdit[]) => Promise<string | null>;
  onDelete: (id: string, confirm: string) => Promise<string | null>;
  /** 見本を開く（動かしても見本は変わらない） */
  onOpenSample: (item: ShelfItem) => void;
  /** 見本をもとに顧客を作る（見本は変わらない） */
  onCustomerFromSample: (item: ShelfItem, category: string | undefined) => void;
  /** 見本を写して手直しする（次の空き番号の新しい見本） */
  onCopySample: (item: ShelfItem) => void;
  onUpdateSample: (id: string, name: string, traits: string[]) => Promise<string | null>;
  onRecovery: () => void;
  /** AI接続口の事務所全体の設定を開く */
  onAiConnector?: () => void;
  aiEnabled?: boolean;
  /** 事務所の共有の設定を開く（0023） */
  onOffice?: () => void;
  /** 事務所の共有の状態（off・pending・member・removed・unavailable） */
  officeState?: string;
  /** 同期サービスの衝突の写しを選ぶ画面を開く */
  onForks?: (id: string) => void;
  /** 保存先（このPCの中・同期フォルダ）の設定を開く（0024） */
  onStorage?: () => void;
  /** 使い方: 1人で複数の PC の同期フォルダ（personal）／事務所での共有（office）。共有していなければ null */
  usage?: "personal" | "office" | null;
  /** 保存先と同期の通知 */
  storageNotices?: StorageNotice[];
  onClose: () => void;
}

const CUSTOMER_NO = /^[A-Za-z0-9_-]{1,16}$/;

/** 一覧の日時（ISO 8601 → 2026/10/18 14:03。端末の時刻で） */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const STORE_MESSAGES: Record<string, string> = {
  E_STORE_CUSTOMER_NO: "顧客番号は英数字・ハイフン・下線の16字までです（お名前は入れないでください）",
  E_STORE_CATEGORY: "区分の記号は英大文字1〜2字、名前は20字までで、記号は重ねられません",
  E_STORE_CATEGORY_IN_USE: "世帯が使っている区分は消せません（記号や名前を変えるのはできます）",
  E_STORE_SAMPLE: "見本の指定を確かめてください（見本番号は変えられません。同じ家族の形・年代の見本は99番までです）",
  E_STORE_CONFIRM: "確認の番号が違います",
  E_STORE_CONFLICT: "ほかの人（ほかのPC）がこの世帯を先に保存していました。上書きせず、今の内容はこのPCの中に残しました。どちらを残すか選んでください",
  E_STORE_READ_ONLY: "新しい版のアプリで保存された世帯のため、閲覧だけできます（保存はできません）",
  E_STORE_FORMAT_TOO_NEW: "新しい版のアプリで保存されたファイルです。アプリを更新してください",
  E_STORE_CORRUPT: "世帯ファイルを開けませんでした（壊れているか、書き換えられています）",
  E_STORE_NO_KEY: "この世帯の鍵がありません（削除した世帯の可能性があります）",
  E_STORE_NEEDS_RECOVERY: "復元キーを入れるまで、保存した世帯を開けません",
  E_STORE_KEYCHAIN: "OS の資格情報の保管庫を使えませんでした",
  E_STORE_IO: "ファイルの読み書きに失敗しました",
  ...OFFICE_MESSAGES,
};

export const storeMessage = (code: string) => STORE_MESSAGES[code] ?? `保存の処理に失敗しました（${code}）`;

/** 見本に登録するときの「中身は架空です」の確認の文 */
export const FICTIONAL_CONFIRM = "中身は架空です（実在のお客さまの情報を入れていません）";

/** 区分を選ぶ欄の既定（見込み客 C。無ければ最初の区分。区分を使わないときは undefined） */
export const defaultCategory = (cats: readonly Category[]): string | undefined => (cats.some((c) => c.code === "C") ? "C" : cats[0]?.code);

/** 初めの「区分を使いますか？」の、あとから変えられることの一文 */
export const CATEGORY_LATER = "あとから世帯の一覧の下の「区分を設定する」でいつでも変えられます。番号の数字（通し番号）は変わりません。";

/** 見本の写しの指定（同じ家族の形・年代。名前に「写し」を付ける） */
export function copyRequest(item: ShelfItem): SampleRequest | null {
  const p = parseSampleNo(item.no);
  if (p === null) return null;
  return { family: p.family, age: p.age, name: `${item.name}（写し）`.slice(0, 40), traits: [...item.traits] };
}

function CategorySelect(p: { categories: readonly Category[]; value: string | undefined; onChange: (v: string) => void; label: string }) {
  if (p.categories.length === 0) return null;
  return (
    <select class="hh-sel" value={p.value} aria-label={p.label} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value)}>
      {p.categories.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} {c.name}
        </option>
      ))}
    </select>
  );
}

function TraitPicker(p: { value: readonly string[]; onChange: (v: string[]) => void; label: string }) {
  const extra = p.value.filter((t) => !SAMPLE_TRAITS.includes(t));
  return (
    <span class="hh-traits" role="group" aria-label={p.label}>
      {[...SAMPLE_TRAITS, ...extra].map((t) => {
        const on = p.value.includes(t);
        return (
          <button type="button" key={t} class={`hh-trait${on ? " on" : ""}`} aria-pressed={on} onClick={() => p.onChange(on ? p.value.filter((x) => x !== t) : [...p.value, t])}>
            {t}
          </button>
        );
      })}
    </span>
  );
}

/** 見本の家族の形・年代・名前・絞り込みの項目の欄 */
function SampleFields(p: { value: SampleRequest; onChange: (v: SampleRequest) => void; shapeFixed?: boolean }) {
  const v = p.value;
  return (
    <span class="hh-sample-fields">
      {p.shapeFixed === true ? null : (
        <>
          <label>
            家族の形{" "}
            <select class="hh-sel" value={v.family} onChange={(e) => p.onChange({ ...v, family: Number((e.currentTarget as HTMLSelectElement).value) })} data-sample-family>
              {FAMILY_SHAPES.map((f) => (
                <option key={f.n} value={f.n}>
                  {f.n} {f.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            本人の年代{" "}
            <select class="hh-sel" value={v.age} onChange={(e) => p.onChange({ ...v, age: Number((e.currentTarget as HTMLSelectElement).value) })} data-sample-age>
              {AGE_BANDS.map((a) => (
                <option key={a} value={a}>
                  {a} {ageBandName(a)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label>
        見本の名前 <input value={v.name} maxLength={40} onInput={(e) => p.onChange({ ...v, name: (e.currentTarget as HTMLInputElement).value })} data-sample-name />
      </label>
      <TraitPicker value={v.traits} onChange={(traits) => p.onChange({ ...v, traits })} label="見本の絞り込みの項目" />
    </span>
  );
}

/** 区分の設定（足す・名前と記号を変える・使っていない区分を消す） */
function CategoryEditor(p: { categories: readonly Category[]; inUse: ReadonlySet<string>; onSave: (edits: CategoryEdit[]) => Promise<string | null>; onClose: () => void; initial?: CategoryEdit[]; saveLabel?: string }) {
  const [rows, setRows] = useState<CategoryEdit[]>(p.initial ?? p.categories.map((c) => ({ from: c.code, code: c.code, name: c.name })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const put = (i: number, r: Partial<CategoryEdit>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...r } : x)));
  return (
    <form
      class="hh-cats"
      data-category-editor
      onSubmit={(e) => {
        e.preventDefault();
        const rs = rows.map((r) => ({ ...r, code: r.code.trim().toUpperCase(), name: r.name.trim() }));
        if (rs.some((r) => !CATEGORY_CODE.test(r.code) || r.name === "" || r.name.length > 20) || new Set(rs.map((r) => r.code)).size !== rs.length) return setError(storeMessage("E_STORE_CATEGORY"));
        setBusy(true);
        void p.onSave(rs).then((err) => {
          setBusy(false);
          if (err === null) p.onClose();
          else setError(err);
        });
      }}
    >
      <p class="pl-sub">
        区分の記号（英大文字1〜2字）は顧客番号の頭に付きます。記号を変えると、その区分の世帯の顧客番号の記号も付け替えます（通し番号はそのまま。自由な番号の世帯は付け替えません）。
        {p.categories.length === 0 ? "区分を使わずに付けた番号（0042 など）は区分なしのまま残ります。必要なら1件ずつ「区分を変える」で付けられます（通し番号は変わりません）。" : "区分をすべて消すと、区分を使わない形（番号は通し番号だけ）になります。"}
      </p>
      <table class="plan-list hh-cat-list">
        <thead>
          <tr>
            <th>記号</th>
            <th>名前</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input value={r.code} maxLength={2} size={3} aria-label="区分の記号" onInput={(e) => put(i, { code: (e.currentTarget as HTMLInputElement).value.toUpperCase() })} data-category-code={i} />
              </td>
              <td>
                <input value={r.name} maxLength={20} aria-label="区分の名前" onInput={(e) => put(i, { name: (e.currentTarget as HTMLInputElement).value })} data-category-name={i} />
              </td>
              <td>
                {r.from !== undefined && p.inUse.has(r.from) ? (
                  <span class="pl-sub">使っている世帯があります</span>
                ) : (
                  <button type="button" class="link-btn danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    消す
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="hh-new">
        <button type="button" class="link-btn" onClick={() => setRows([...rows, { code: "", name: "" }])} data-category-add>
          ＋ 区分を足す
        </button>
        {rows.length === 0 ? (
          <button type="button" class="link-btn" onClick={() => setRows(DEFAULT_CATEGORIES.map((c) => ({ code: c.code, name: c.name })))} data-category-defaults>
            A 顧問契約・B 単発相談・C 見込み客 を入れる
          </button>
        ) : null}
        <button type="submit" class="btn primary" disabled={busy} data-category-save>
          {p.saveLabel ?? (rows.length === 0 ? "区分を使わないで保存" : "区分を保存")}
        </button>
        <button type="button" class="link-btn" onClick={p.onClose}>
          キャンセル
        </button>
        {error !== null ? <span class="hh-err">{error}</span> : null}
      </div>
    </form>
  );
}

type RowForm =
  | { kind: "rename"; id: string; value: string; error: string | null }
  | { kind: "category"; id: string; value: string; error: string | null }
  | { kind: "delete"; id: string; value: string; error: string | null }
  | { kind: "sample"; id: string; value: SampleRequest; ok: boolean; error: string | null };

export function HouseholdPanel(p: HouseholdPanelProps) {
  const [tab, setTab] = useState<HouseholdTab>(p.initialTab ?? "customers");
  const [form, setForm] = useState<RowForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [editCats, setEditCats] = useState(false);
  const [newCat, setNewCat] = useState(defaultCategory(p.categories));
  /** 初めの「区分を使いますか？」: 「使う」を押したら、既定の区分をその場で直せる欄を出す */
  const [choosing, setChoosing] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const useCats = p.categories.length > 0;
  const decided = p.categoriesDecided !== false;
  // 区分の一覧が変わったら（使う・使わないを決めた・区分を消した）、新しい世帯の区分の既定を合わせる
  useEffect(() => {
    if (newCat === undefined || !p.categories.some((c) => c.code === newCat)) setNewCat(defaultCategory(p.categories));
  }, [p.categories]);
  // 見本の棚の絞り込みと操作
  const [shelfFamily, setShelfFamily] = useState(0);
  const [shelfAge, setShelfAge] = useState(0);
  const [shelfTraits, setShelfTraits] = useState<string[]>([]);
  const [fromSample, setFromSample] = useState<{ item: ShelfItem; category: string | undefined } | null>(null);
  const [sampleEdit, setSampleEdit] = useState<{ id: string; name: string; traits: string[]; error: string | null } | null>(null);
  const [sampleDelete, setSampleDelete] = useState<{ id: string; value: string; error: string | null } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);

  const ready = p.status?.state === "ready" && p.unavailable === null;
  const shared = p.officeState === "member";
  /** 1人で複数の PC の同期フォルダ: 「人」ではなく「PC」の言葉で出す（0024） */
  const personal = p.usage === "personal";
  // 一覧に出す通知（鍵が無い・PC の中だけで復元キーを保管していないは、この下と帯の案内で出すので除く）
  const notices = (p.storageNotices ?? []).filter((n) => n.kind !== "needsRecovery" && !(n.kind === "recoveryNotKept" && n.scope === "local"));
  const storageLabel = p.officeState === undefined || p.officeState === "off" ? "このPCの中" : personal ? (p.officeState === "member" ? "同期フォルダ（2台のPC）" : "同期フォルダ（使えません）") : "事務所の共有フォルダ";
  const shown = filterCustomers(p.list, query, catFilter);
  const inUse = new Set(p.list.flatMap((h) => (h.category !== undefined ? [h.category] : [])));
  const shelf = filterShelf(p.shelf, { family: shelfFamily, age: shelfAge, traits: shelfTraits });
  const ownCount = p.shelf.filter((i) => i.kind === "own").length;
  /** 行の操作の共通の流れ（失敗したら、その欄に理由を出す） */
  const run = (f: RowForm, fn: () => Promise<string | null>) => {
    setBusy(true);
    void fn().then((err) => {
      setBusy(false);
      if (err === null) setForm(null);
      else setForm({ ...f, error: err });
    });
  };

  const rowForm = (h: StoredHousehold) => {
    if (form === null || form.id !== h.id) return null;
    const cancel = (
      <button type="button" class="link-btn" onClick={() => setForm(null)}>
        キャンセル
      </button>
    );
    const err = form.error !== null ? <span class="hh-err">{form.error}</span> : null;
    switch (form.kind) {
      case "rename":
        return (
          <form
            class="pl-edit"
            onSubmit={(e) => {
              e.preventDefault();
              const v = form.value.trim();
              if (!CUSTOMER_NO.test(v)) return setForm({ ...form, error: storeMessage("E_STORE_CUSTOMER_NO") });
              run(form, () => p.onRename(h.id, v));
            }}
          >
            <input value={form.value} maxLength={16} aria-label="新しい顧客番号" onInput={(e) => setForm({ ...form, value: (e.currentTarget as HTMLInputElement).value, error: null })} data-rename-input />
            <button type="submit" class="btn" disabled={busy}>
              変える
            </button>
            {cancel}
            <span class="pl-sub">{useCats ? "区分の記号＋通し番号（A0042）、関係する世帯は枝番（A0042-1・A0042-C）。" : "通し番号（0042）、関係する世帯は枝番（0042-1・0042-C）。"}ほかの形は自由な番号として持ちます。英数字・ハイフン・下線の16字まで。お名前は入れないでください</span>
            {err}
          </form>
        );
      case "category":
        return (
          <form
            class="pl-edit"
            onSubmit={(e) => {
              e.preventDefault();
              run(form, () => p.onSetCategory(h.id, form.value));
            }}
          >
            <CategorySelect categories={p.categories} value={form.value} onChange={(v) => setForm({ ...form, value: v, error: null })} label="新しい区分" />
            <button type="submit" class="btn" disabled={busy} data-set-category>
              変える
            </button>
            {cancel}
            <span class="pl-sub">{h.serial !== undefined ? "記号だけが変わり、通し番号はそのままです" : "自由な番号は番号を変えず、区分だけを持ちます"}</span>
            {err}
          </form>
        );
      case "sample":
        return (
          <form
            class="pl-confirm hh-make-sample"
            onSubmit={(e) => {
              e.preventDefault();
              run(form, () => p.onMakeSample(h.id, { ...form.value, name: form.value.name.trim() }));
            }}
            data-make-sample-form
          >
            <span>見本の棚へ移します。顧客番号（{h.customerNo}）は外れ、見本番号（10〜）が付きます。外れた通し番号は使い回しません。</span>
            <SampleFields value={form.value} onChange={(v) => setForm({ ...form, value: v, error: null })} />
            <label class="hh-fictional">
              <input type="checkbox" checked={form.ok} onChange={(e) => setForm({ ...form, ok: (e.currentTarget as HTMLInputElement).checked })} data-fictional-confirm />
              {FICTIONAL_CONFIRM}
            </label>
            <button type="submit" class="btn" disabled={busy || !form.ok || form.value.name.trim() === ""} data-make-sample-go>
              見本に登録する
            </button>
            {cancel}
            {err}
          </form>
        );
      case "delete":
        return (
          <form
            class="pl-confirm hh-delete"
            onSubmit={(e) => {
              e.preventDefault();
              run(form, () => p.onDelete(h.id, form.value));
            }}
          >
            <span>
              世帯ファイル・直前の世代・アプリのバックアップの写しを消し、この世帯の鍵を消します。元に戻せません。
              アプリのバックアップからも完全に読めなくなるのは30日後です。同期サービスの版の履歴や、ご自分で取ったバックアップはアプリから消せません。
            </span>
            <label>
              確認のため顧客番号（{h.customerNo}）を入れてください{" "}
              <input value={form.value} maxLength={16} aria-label="確認の顧客番号" onInput={(e) => setForm({ ...form, value: (e.currentTarget as HTMLInputElement).value, error: null })} data-delete-confirm />
            </label>
            <button type="submit" class="btn danger" disabled={busy || form.value.trim() !== h.customerNo} data-delete-go>
              完全に削除する
            </button>
            {cancel}
            {err}
          </form>
        );
    }
  };

  const customers = (
    <>
      {p.unsavedTitle !== null && ready ? (
        <div class="hh-unsaved">
          <span>いま開いている「{p.unsavedTitle}」は保存していません。</span>
          <CategorySelect categories={p.categories} value={newCat} onChange={setNewCat} label="保存するときの区分" />
          <button type="button" class="btn primary" onClick={() => p.onSaveCurrent(newCat)} data-save-current>
            この世帯を保存して使う
          </button>
        </div>
      ) : null}
      {ready && !decided ? (
        <div class="hh-choice" data-category-choice>
          <h3 class="hh-h">区分を使いますか？</h3>
          <p>
            顧客番号の頭に区分の記号を付けると、番号を見ただけで顧問契約・単発相談・見込み客の別が分かります（例 A0042・C0043）。使わないときは通し番号だけです（例 0042）。
          </p>
          <p class="hh-choice-later" data-category-later>
            {CATEGORY_LATER}
          </p>
          {choosing ? (
            <CategoryEditor categories={[]} inUse={new Set()} initial={DEFAULT_CATEGORIES.map((c) => ({ code: c.code, name: c.name }))} saveLabel="この区分で始める" onSave={p.onSaveCategories} onClose={() => setChoosing(false)} />
          ) : (
            <div class="hh-new">
              <button type="button" class="btn primary" onClick={() => setChoosing(true)} data-category-choice-use>
                使う（A 顧問契約・B 単発相談・C 見込み客）
              </button>
              <button
                type="button"
                class="btn"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void p.onSaveCategories([]).then((err) => {
                    setBusy(false);
                    setChoiceError(err);
                  });
                }}
                data-category-choice-none
              >
                使わない（通し番号だけ）
              </button>
              {choiceError !== null ? <span class="hh-err">{choiceError}</span> : null}
            </div>
          )}
        </div>
      ) : null}
      {ready ? (
        <>
          <h3 class="hh-h">顧客の世帯（{p.list.length}）</h3>
          {p.list.length === 0 ? <p class="in-note">まだありません。下の「新しく作る」か、「見本」の一覧の「この見本をもとに顧客を作る」から始めてください。</p> : null}
          {p.list.length > 0 ? (
            <div class="hh-tools">
              <label>
                番号で探す{" "}
                <input type="search" value={query} placeholder={useCats ? "例: 42、C0042" : "例: 42、0042"} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} data-household-search />
              </label>
              {useCats ? (
              <label>
                区分{" "}
                <select class="hh-sel" value={catFilter} onChange={(e) => setCatFilter((e.currentTarget as HTMLSelectElement).value)} data-category-filter>
                  <option value="">すべて</option>
                  {p.categories.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} {c.name}
                    </option>
                  ))}
                  <option value={NO_CATEGORY}>区分なし</option>
                </select>
              </label>
              ) : null}
              {query !== "" || catFilter !== "" ? <span class="pl-sub">{shown.length}件</span> : null}
            </div>
          ) : null}
          {shown.length > 0 ? (
            <div class="plan-list-wrap">
              <table class="plan-list hh-list">
                <thead>
                  <tr>
                    <th>顧客番号</th>
                    {useCats ? <th>区分</th> : null}
                    <th>家族</th>
                    <th>最後に保存</th>
                    {shared ? <th>{personal ? "最後に直したPC" : "最後に直した人"}</th> : null}
                    {shared ? <th>{personal ? "開いているPC" : "開いている人"}</th> : null}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((h) => (
                    <tr key={h.id} class={h.id === p.currentId ? "sel" : ""} data-household-row={h.customerNo}>
                      <td>
                        <b>{h.customerNo}</b>
                        {h.serial === undefined ? (
                          <span class="pl-tag hh-free" title={useCats ? "区分の記号＋通し番号の形でない番号（区分を変えても付け替えません）" : "通し番号の形でない番号"}>
                            自由な番号
                          </span>
                        ) : null}
                        {h.id === p.currentId ? <span class="pl-tag">開いています</span> : null}
                        {h.forks > 0 ? (
                          <button type="button" class="link-btn danger hh-fork" onClick={() => p.onForks?.(h.id)} data-household-forks={h.forks}>
                            同期の衝突の写しがあります
                          </button>
                        ) : null}
                      </td>
                      {useCats ? <td data-household-category={h.category ?? ""}>{categoryText(p.categories, h.category)}</td> : null}
                      <td>{h.summary || "—"}</td>
                      <td class="num">{shortDate(h.updatedAt)}</td>
                      {shared ? <td data-household-editor>{h.updatedBy ?? "—"}</td> : null}
                      {shared ? (
                        <td data-household-presence={h.openBy.length}>
                          {h.openBy.length === 0 ? (
                            "—"
                          ) : (
                            <span class="hh-presence">
                              {h.openBy.map((o) => (personal ? `「${o.name}」（${sinceText(o.since)}）` : `${o.name}さん（${sinceText(o.since)}）`)).join("、")}
                            </span>
                          )}
                        </td>
                      ) : null}
                      <td>
                        {rowForm(h) ?? (
                          <span class="pl-ops">
                            {h.id !== p.currentId ? (
                              <button type="button" class="link-btn" onClick={() => p.onOpen(h.id)} data-open-household={h.customerNo}>
                                開く
                              </button>
                            ) : null}
                            {useCats ? (
                              <button type="button" class="link-btn" onClick={() => setForm({ kind: "category", id: h.id, value: h.category ?? defaultCategory(p.categories) ?? "", error: null })} data-change-category={h.customerNo}>
                                区分を変える
                              </button>
                            ) : null}
                            <button type="button" class="link-btn" onClick={() => setForm({ kind: "rename", id: h.id, value: h.customerNo, error: null })}>
                              顧客番号を変える
                            </button>
                            {h.serial === undefined ? (
                              <button type="button" class="link-btn" onClick={() => run({ kind: "rename", id: h.id, value: h.customerNo, error: null }, () => p.onAssignSerial(h.id))} title={useCats ? "区分の記号＋新しい通し番号に付け替えます（元の番号には戻りません）" : "新しい通し番号に付け替えます（元の番号には戻りません）"} data-assign-serial={h.customerNo}>
                                通し番号を付ける
                              </button>
                            ) : null}
                            <button type="button" class="link-btn" onClick={() => setForm({ kind: "sample", id: h.id, value: { ...(h.id === p.currentId && p.currentShape !== null ? p.currentShape : { family: 3, age: 4 }), name: "", traits: [] }, ok: false, error: null })} data-make-sample={h.customerNo}>
                              見本に登録
                            </button>
                            <button type="button" class="link-btn danger" onClick={() => setForm({ kind: "delete", id: h.id, value: "", error: null })} data-delete-household={h.customerNo}>
                              完全削除
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : p.list.length > 0 ? (
            <p class="in-note">当てはまる世帯がありません。</p>
          ) : null}
          {p.status !== null && p.status.deletionsPending > 0 ? (
            <p class="in-note">完全削除した世帯が {p.status.deletionsPending}件 あります。アプリのバックアップからも読めなくなるまで、削除の日から30日かかります。</p>
          ) : null}
          {decided ? (
            <>
          <h3 class="hh-h">新しく作る</h3>
          <div class="hh-new">
            <CategorySelect categories={p.categories} value={newCat} onChange={setNewCat} label="新しい世帯の区分" />
            <button type="button" class="btn" onClick={() => p.onCreate(newCat)} data-create-blank>
              空から作る
            </button>
            <button type="button" class="link-btn" onClick={() => setTab("samples")}>
              見本から作る
            </button>
            <span class="pl-sub">{useCats ? "顧客番号は「区分の記号＋通し番号」で自動で付きます（例 C0042）。区分を変えても通し番号はそのままです。" : "顧客番号は通し番号で自動で付きます（例 0042）。"}</span>
          </div>
          <h3 class="hh-h">区分</h3>
          {editCats ? (
            <CategoryEditor categories={p.categories} inUse={inUse} onSave={p.onSaveCategories} onClose={() => setEditCats(false)} />
          ) : (
            <div class="hh-new">
              <span class="pl-sub" data-category-list>
                {useCats ? p.categories.map((c) => `${c.code} ${c.name}`).join("・") : "区分を使っていません（番号は通し番号だけ）"}
              </span>
              <button type="button" class="link-btn" onClick={() => setEditCats(true)} data-edit-categories>
                区分を設定する
              </button>
            </div>
          )}
            </>
          ) : null}
        </>
      ) : null}
    </>
  );

  const sampleOps = (s: ShelfItem, isCurrent: boolean) => {
    if (fromSample?.item.id === s.id)
      return (
        <form
          class="pl-edit"
          onSubmit={(e) => {
            e.preventDefault();
            setFromSample(null);
            p.onCustomerFromSample(s, fromSample.category);
          }}
        >
          <CategorySelect categories={p.categories} value={fromSample.category} onChange={(v) => setFromSample({ ...fromSample, category: v })} label="作る顧客の区分" />
          <button type="submit" class="btn primary" data-customer-from-sample-go>
            顧客を作る
          </button>
          <button type="button" class="link-btn" onClick={() => setFromSample(null)}>
            キャンセル
          </button>
          <span class="pl-sub">新しい顧客番号を付けた世帯を作ります。見本は変わりません</span>
        </form>
      );
    if (sampleDelete?.id === s.id)
      return (
        <form
          class="pl-confirm hh-delete"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void p.onDelete(s.id, sampleDelete.value).then((err) => {
              setBusy(false);
              if (err === null) setSampleDelete(null);
              else setSampleDelete({ ...sampleDelete, error: err });
            });
          }}
        >
          <label>
            確認のため見本番号（{s.no}）を入れてください{" "}
            <input value={sampleDelete.value} maxLength={6} aria-label="確認の見本番号" onInput={(e) => setSampleDelete({ ...sampleDelete, value: (e.currentTarget as HTMLInputElement).value, error: null })} />
          </label>
          <button type="submit" class="btn danger" disabled={busy || sampleDelete.value.trim() !== s.no}>
            完全に削除する
          </button>
          <button type="button" class="link-btn" onClick={() => setSampleDelete(null)}>
            キャンセル
          </button>
          {sampleDelete.error !== null ? <span class="hh-err">{sampleDelete.error}</span> : null}
        </form>
      );
    return (
      <span class="pl-ops">
        {!isCurrent ? (
          <button type="button" class="link-btn" onClick={() => p.onOpenSample(s)} data-open-sample={s.no}>
            開く
          </button>
        ) : null}
        {ready ? (
          <>
            <button type="button" class="link-btn" onClick={() => setFromSample({ item: s, category: defaultCategory(p.categories) })} data-customer-from-sample={s.no}>
              この見本をもとに顧客を作る
            </button>
            <button type="button" class="link-btn" onClick={() => p.onCopySample(s)} title="同じ家族の形・年代の次の空き番号（10〜）で、新しい見本を作ります" data-copy-sample={s.no}>
              写して手直しする
            </button>
          </>
        ) : null}
        {s.kind === "own" ? (
          <>
            <button type="button" class="link-btn" onClick={() => setSampleEdit({ id: s.id, name: s.name, traits: [...s.traits], error: null })}>
              名前と項目を直す
            </button>
            <button type="button" class="link-btn danger" onClick={() => setSampleDelete({ id: s.id, value: "", error: null })} data-delete-sample={s.no}>
              完全削除
            </button>
          </>
        ) : null}
      </span>
    );
  };

  const samples = (
    <>
      <p class="pl-sub hh-shelf-note">
        見本は架空の世帯です。顧客番号を持たず、顧客の一覧には出ません。番号は「家族の形-本人の年代-順番」で、01〜09 はアプリに入っている見本（直せません）、10〜 は{shared && !personal ? "事務所" : "自分"}で作った見本です。開いて動かしても見本は変わりません（閉じれば元どおり）。
      </p>
      <div class="hh-tools">
        <label>
          家族の形{" "}
          <select class="hh-sel" value={shelfFamily} onChange={(e) => setShelfFamily(Number((e.currentTarget as HTMLSelectElement).value))} data-shelf-family>
            <option value={0}>すべて</option>
            {FAMILY_SHAPES.map((f) => (
              <option key={f.n} value={f.n}>
                {f.n} {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          本人の年代{" "}
          <select class="hh-sel" value={shelfAge} onChange={(e) => setShelfAge(Number((e.currentTarget as HTMLSelectElement).value))} data-shelf-age>
            <option value={0}>すべて</option>
            {AGE_BANDS.map((a) => (
              <option key={a} value={a}>
                {ageBandName(a)}
              </option>
            ))}
          </select>
        </label>
        <TraitPicker value={shelfTraits} onChange={setShelfTraits} label="項目で絞り込む" />
      </div>
      {shelf.length === 0 ? <p class="in-note">当てはまる見本がありません。</p> : null}
      {shelf.length > 0 ? (
        <div class="plan-list-wrap">
          <table class="plan-list hh-list hh-shelf">
            <thead>
              <tr>
                <th>見本番号</th>
                <th>名前</th>
                <th>家族・年代</th>
                <th>項目</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shelf.map((s) => {
                const isCurrent = p.currentSample === s.id;
                return (
                  <tr key={`${s.kind}-${s.id}`} class={isCurrent ? "sel" : ""} data-sample-row={s.no}>
                    <td>
                      <b>{s.no}</b>
                      {s.kind === "app" ? <span class="pl-tag hh-app">アプリ</span> : null}
                      {isCurrent ? <span class="pl-tag">開いています</span> : null}
                    </td>
                    <td>
                      {sampleEdit?.id === s.id ? (
                        <form
                          class="pl-edit"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const name = sampleEdit.name.trim();
                            if (name === "") return setSampleEdit({ ...sampleEdit, error: storeMessage("E_STORE_SAMPLE") });
                            setBusy(true);
                            void p.onUpdateSample(s.id, name, sampleEdit.traits).then((err) => {
                              setBusy(false);
                              if (err === null) setSampleEdit(null);
                              else setSampleEdit({ ...sampleEdit, error: err });
                            });
                          }}
                        >
                          <SampleFields value={{ family: 0, age: 0, name: sampleEdit.name, traits: sampleEdit.traits }} onChange={(v) => setSampleEdit({ ...sampleEdit, name: v.name, traits: v.traits, error: null })} shapeFixed />
                          <button type="submit" class="btn" disabled={busy}>
                            直す
                          </button>
                          <button type="button" class="link-btn" onClick={() => setSampleEdit(null)}>
                            キャンセル
                          </button>
                          {sampleEdit.error !== null ? <span class="hh-err">{sampleEdit.error}</span> : null}
                        </form>
                      ) : (
                        s.name
                      )}
                    </td>
                    <td class="hh-nowrap">{sampleNoText(s.no)}</td>
                    <td>
                      <span class="hh-tags">
                        {s.traits.map((t) => (
                          <span key={t} class="hh-tag">
                            {t}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>{sampleOps(s, isCurrent)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <p class="pl-sub">自分で作った世帯を見本にするときは、「顧客」の一覧の「見本に登録」から（中身が架空であることを確かめます）。</p>
    </>
  );

  return (
    <section class="card hh-panel" aria-label="世帯の一覧" data-household-panel>
      <div class="card-h">
        <h2>世帯</h2>
        <span class="aside">{shared ? (personal ? "世帯ごとに暗号化して、同期フォルダに自動で保存します（2台のPCで使えます）" : "世帯ごとに暗号化して、事務所の共有フォルダに自動で保存します") : "世帯ごとに暗号化して、このPCのアプリのデータの場所に自動で保存します"}</span>
        <button type="button" class="btn" onClick={p.onClose}>
          閉じる
        </button>
      </div>
      <div class="tabs hh-tabs" role="tablist" aria-label="世帯の一覧の切り替え">
        <button type="button" role="tab" aria-selected={tab === "customers"} class={tab === "customers" ? "on" : ""} onClick={() => setTab("customers")} data-hh-tab="customers">
          顧客（{p.list.length}）
        </button>
        <button type="button" role="tab" aria-selected={tab === "samples"} class={tab === "samples" ? "on" : ""} onClick={() => setTab("samples")} data-hh-tab="samples">
          見本（{p.shelf.length}
          {ownCount > 0 ? `・うち自分で作った見本 ${ownCount}` : ""}）
        </button>
      </div>
      {p.unavailable !== null ? <p class="hh-warn">{p.unavailable}</p> : null}
      {notices.length > 0 ? (
        <ul class="sp-notices" data-household-notices>
          {notices.map((n) => (
            <li key={`${n.kind}-${n.at ?? ""}`} class={`sp-n-${n.level}`}>
              {storageNoticeText(n)}
              {p.onStorage !== undefined && personal ? (
                <button type="button" class="link-btn" onClick={p.onStorage}>
                  保存先を開く
                </button>
              ) : p.onOffice !== undefined && n.scope === "office" ? (
                <button type="button" class="link-btn" onClick={p.onOffice}>
                  事務所の共有を開く
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {p.error !== null ? (
        <p class="hh-warn" role="alert">
          {p.error}
        </p>
      ) : null}
      {p.status?.state === "needsRecovery" ? (
        <p class="hh-warn">
          この PC の資格情報の保管庫に、事務所の鍵が見つかりません。
          <button type="button" class="link-btn" onClick={p.onRecovery}>
            復元キーを入れる
          </button>
        </p>
      ) : null}
      {tab === "customers" ? customers : samples}
      <div class="hh-foot">
        <button type="button" class="link-btn" onClick={p.onRecovery} data-open-recovery>
          復元キー
        </button>
        {p.status?.state === "ready" ? <span class="pl-sub">{p.status.recoveryAcknowledged ? "復元キーは保管済みです" : "復元キーをまだ保管していません"}</span> : null}
        {p.onStorage !== undefined ? (
          <>
            <button type="button" class="link-btn" onClick={p.onStorage} data-open-storage>
              保存先
            </button>
            <span class="pl-sub" data-storage-label>{storageLabel}</span>
          </>
        ) : null}
        {p.onOffice !== undefined ? (
          <>
            <button type="button" class="link-btn" onClick={p.onOffice} data-open-office>
              事務所の共有
            </button>
            <span class="pl-sub">{personal ? "オフ（同期フォルダで1人で使っています）" : p.officeState === "member" ? "オン" : p.officeState === "pending" ? "承認待ち" : p.officeState === "removed" ? "外されました" : p.officeState === "unavailable" ? "使えません" : "オフ（既定）"}</span>
          </>
        ) : null}
        {p.onAiConnector !== undefined ? (
          <>
            <button type="button" class="link-btn" onClick={p.onAiConnector} data-open-ai-connector>
              AI接続口
            </button>
            <span class="pl-sub">{p.aiEnabled === true ? "オン" : "オフ（既定）"}</span>
          </>
        ) : null}
      </div>
    </section>
  );
}
