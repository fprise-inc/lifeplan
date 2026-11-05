// 上の帯の FP のメニュー（線のアイコン1つ）。顧客と一緒に見る画面に常に出す必要のない FP の操作を、ここにまとめる（0077 の追記）:
// 控え（この時点を残す・控えの一覧）／面談の準備（世帯の中身の一覧・次の1年に起きること・前回から変わったこと）／取り込む（今の選択肢）／事務所の設定（今の保存先と事務所の共有の状態・既定値）／
// ファイナンシアへ（要望・不具合を送る。0087。お知らせの一覧の下にも同じ入口がある）。
// 開いた一覧は帯の下に重ねて出す（画面は動かさない）。Esc・外を押すと閉じる。1つを押すと閉じて、その中身を開く
// （入力のホームの中身なら、親が入力のタブに切り替えて開く。どのタブでも帯は同じ）
import { useEffect, useRef, useState } from "preact/hooks";
import { PopIcon } from "../../presentation/icons.tsx";

/** メニューで押せる物 */
export type FpMenuAction = "snapTake" | "snapList" | "contents" | "year" | "review" | "hearing" | "ai" | "storage" | "office" | "officeDefaults" | "feedback";

export interface FpMenuItem {
  action: FpMenuAction;
  label: string;
  /** 右に添える短い文（今の状態など） */
  note?: string;
  /** 押すと中央のパネル（別の画面）が開く */
  pop?: boolean;
}

export interface FpMenuGroup {
  id: "snapshots" | "tools" | "imports" | "office" | "feedback";
  label: string;
  items: FpMenuItem[];
}

export interface FpMenuInput {
  /** 控えの件数 */
  snapshots: number;
  /** 最後の控えと次の見直しの目安（前回から変わったことの横に添える）。控えが無ければ null */
  review: { last: string; next: string } | null;
  /** 取り込むの選択肢（ヒアリングシート・AI に資料を渡す）。本体につながっていないときは null（出さない） */
  imports: { ai: boolean } | null;
  /** 事務所の設定（今の保存先と事務所の共有の状態）。本体につながっていないときは null（出さない） */
  office: { storage: string; share: string } | null;
}

/** メニューの中身（並びと文）。描画と切り離して確かめられるように、ここで決める */
export function fpMenuGroups(p: FpMenuInput): FpMenuGroup[] {
  const out: FpMenuGroup[] = [
    {
      id: "snapshots",
      label: "控え",
      items: [
        { action: "snapTake", label: "この時点を残す" },
        { action: "snapList", label: `控えの一覧（${p.snapshots}件）` },
      ],
    },
    {
      id: "tools",
      label: "面談の準備",
      items: [
        { action: "contents", label: "世帯の中身の一覧" },
        { action: "year", label: "次の1年に起きること" },
        { action: "review", label: "前回から変わったこと", ...(p.review !== null ? { note: `最後の控え ${p.review.last}・次の目安 ${p.review.next}` } : {}) },
      ],
    },
  ];
  if (p.imports !== null)
    out.push({
      id: "imports",
      label: "取り込む",
      items: [{ action: "hearing", label: "ヒアリングシート" }, ...(p.imports.ai ? [{ action: "ai" as const, label: "AI に資料を渡す", pop: true }] : [])],
    });
  if (p.office !== null)
    out.push({
      id: "office",
      label: "事務所の設定",
      items: [
        { action: "storage", label: "保存先", note: p.office.storage, pop: true },
        { action: "office", label: "事務所の共有", note: p.office.share, pop: true },
        { action: "officeDefaults", label: "事務所の既定値", note: "新しい世帯に写す値・ホームの並び", pop: true },
      ],
    });
  out.push({ id: "feedback", label: "ファイナンシアへ", items: [{ action: "feedback", label: "要望・不具合を送る", note: "受付番号を作ってフォームを開きます", pop: true }] });
  return out;
}

/** 今の保存先の文（世帯の選択のメニューの「保存先」と同じ） */
export function storageText(officeState: string | undefined, personal: boolean): string {
  return officeState === undefined || officeState === "off" ? "このPCの中" : personal ? (officeState === "member" ? "同期フォルダ（2台のPC）" : "同期フォルダ（使えません）") : "事務所の共有フォルダ";
}

/** 事務所の共有の状態の文（世帯の選択のメニューの「事務所の共有」と同じ） */
export function officeShareText(officeState: string | undefined, personal: boolean): string {
  if (personal) return "オフ（同期フォルダで1人で使っています）";
  return officeState === "member" ? "オン" : officeState === "pending" ? "承認待ち" : officeState === "removed" ? "外されました" : officeState === "unavailable" ? "使えません" : "オフ（既定）";
}

export function FpMenu({ groups, onPick, initialOpen = false }: { groups: readonly FpMenuGroup[]; onPick: (a: FpMenuAction) => void; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (box.current !== null && e.target instanceof Node && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  return (
    <div class="fpm" ref={box}>
      <button type="button" class="fpm-btn" ref={btn} aria-expanded={open} aria-haspopup="true" aria-label="FP のメニュー" title="FP のメニュー（控え・面談の準備・取り込む・事務所の設定・要望を送る）" onClick={() => setOpen(!open)} data-fp-menu>
        <svg class="fpm-ico" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.5" y="6" width="15" height="10.5" rx="2" />
          <path d="M7 6V4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 13 4.5V6" />
          <path d="M2.5 10.5h15" />
        </svg>
      </button>
      {open ? (
        <div class="fpm-list" role="menu" aria-label="FP のメニュー" data-fp-menu-list>
          {groups.map((g) => (
            <div class="fpm-group" role="group" aria-label={g.label} key={g.id} data-fp-menu-group={g.id}>
              <span class="fpm-h">{g.label}</span>
              {g.items.map((i) => (
                <button
                  type="button"
                  role="menuitem"
                  class="fpm-item"
                  key={i.action}
                  onClick={() => {
                    setOpen(false);
                    onPick(i.action);
                  }}
                  data-fp-menu-item={i.action}
                >
                  <span class="fpm-label">
                    {i.label}
                    {i.pop === true ? <PopIcon /> : null}
                  </span>
                  {i.note !== undefined ? <span class="fpm-note">{i.note}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
