// 推定から入った年ごとの変化の表（GroupDef.table。staged.ts の tableGroup。0238）: 閉じた形（要約の1行と「▸ 年ごとの割合を見る・直す」）から始め、
// 開くと1年1行（年・割合・その年からの額の目安）。行の「詳しく」を開いたときだけ、その年の細かい欄と「外す」を出す。
// 割合を確かめた後・直した後も同じ表の行のまま（1件ずつの枠に開かない）。開け閉めは見せ方だけで、値は何も変えない（GroupOpen で覚える。保存しない）。
// 欄そのものの描き方は FieldViews.tsx の Field（field で受け取る。循環を避けるため、ここからは型だけ取り込む）
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { revealOpened } from "../../presentation/revealAdded.ts";
import type { ActionDef, FieldDef, GroupDef, StageTableDef, StageTableRow } from "./form.ts";
import type { GroupOpenState } from "./FieldViews.tsx";

/** 行の「詳しく」の開け閉めを覚えるキー */
export const stageRowOpenKey = (groupKey: string, id: string): string => `${groupKey}/row/${id}`;

/** 開くボタンの文（閉じているとき） */
export const STAGE_TABLE_OPEN = "年ごとの割合を見る・直す";

/** 行の「詳しく」の読み上げ用の名前（何が出るかを添える。推定のままの年は「いつから」を出さない） */
export const stageRowMoreLabel = (row: StageTableRow, open: boolean): string => (open ? `閉じる（${row.label}の変化）` : `${row.label}の変化を詳しく（${row.estimated ? "入れ方・外す" : "いつから・入れ方・外す"}）`);

/**
 * 表の欄・ボタンは、まとまりの欄・ボタン（group.fields・group.actions）から同じキーの物を使う（行の物からは名前だけ）。項目を組み立てるときに、
 * 書いた後の片付け（ほかの欄をついてこさせる・外した物を指す欄を片付ける。stages/index.ts）は、まとまりの欄・ボタンのほうに付くため
 */
export function tableField(group: GroupDef, f: FieldDef): FieldDef {
  const g = group.fields.find((x) => x.key === f.key);
  return g === undefined ? f : ({ ...g, label: f.label } as FieldDef);
}
export const tableAction = (group: GroupDef, a: ActionDef): ActionDef => group.actions.find((x) => x.key === a.key) ?? a;

const domId = (key: string): string => `stg-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;

interface Props {
  group: GroupDef;
  table: StageTableDef;
  opened: GroupOpenState;
  /** ほかのまとまりの枠の中に描くか（枠と地の色を付けない） */
  nested?: boolean;
  /** 頭のまとまりの「▸ 詳しく」で開いた中身か（開いたときに光らせる目印） */
  moreOf?: string | undefined;
  /** 名前の横の「?」（まとまりの説明） */
  help: ComponentChildren;
  /** 名前の横の印（プランで足した物の印など） */
  tag?: ComponentChildren;
  field: (f: FieldDef) => ComponentChildren;
  run: (a: ActionDef) => void;
}

export function StageTable({ group, table, opened, nested = false, moreOf, help, tag = null, field, run }: Props) {
  const open = opened.isOpen(group.key);
  const body = useRef<HTMLDivElement>(null);
  const bodyId = domId(group.key);
  // 確かめの一覧などから、閉じた表の中の欄へ移ってきたとき（パネルが移った先に jumped の印を付ける）: 表と、その欄のある行の「詳しく」を開いて、その欄に移る。
  // 閉じている間も行と行の「詳しく」の中身は描いておく（隠すだけ）ので、欄は探せる。パネルの印は、この部品の後に付くので、一拍おいて探す
  useEffect(() => {
    const t = setTimeout(() => {
      const hit = body.current?.querySelector<HTMLElement>(".jumped");
      if (hit == null) return;
      const rowKey = hit.closest<HTMLElement>("[data-stage-row-detail]")?.dataset.stageRowDetail;
      const closed = [group.key, ...(rowKey !== undefined ? [rowKey] : [])].filter((k) => !opened.isOpen(k));
      if (closed.length === 0) return;
      for (const k of closed) opened.toggle(k);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!hit.isConnected) return;
          const target = hit.matches("button, input, select") ? hit : hit.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled])");
          target?.focus({ preventScroll: true });
          hit.scrollIntoView({ block: "center" });
        }),
      );
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const own = (f: FieldDef): ComponentChildren => field(tableField(group, f));
  const act = (x: ActionDef): void => run(tableAction(group, x));
  const removeAuto = table.removeAuto;
  return (
    <div class={`in-group stage-table${nested ? " in-sub" : ""}`} data-group={group.key} data-stage-table={open ? "open" : "closed"} {...(moreOf !== undefined ? { "data-more-of": moreOf } : {})}>
      <div class="stage-table-line">
        <h4 class="stage-table-name">
          {table.name}
          {help}
        </h4>
        {tag}
        <span class="stage-table-what">{table.what}</span>
        {table.estimated > 0 ? (
          <span class="stage-table-est" data-stage-table-est={table.estimated}>
            <span class="badge est">推定</span>
            {table.estimated < table.rows.length ? `のまま ${String(table.estimated)}件` : null}
          </span>
        ) : null}
        {table.ends !== null ? <span class="stage-table-ends">{table.ends}</span> : null}
      </div>
      <div class="grp-more">
        {/* 押したときに欄からフォーカスを外さない（「▸ 詳しく」と同じ） */}
        <button
          type="button"
          class="link-btn grp-more-btn"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? "閉じる" : STAGE_TABLE_OPEN}（${table.name}）`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            if (!open) revealOpened(e.currentTarget, group.key);
            opened.toggle(group.key);
          }}
          data-stage-table-toggle={group.key}
        >
          <span class="grp-more-mark" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span class="grp-more-text">{open ? "閉じる" : STAGE_TABLE_OPEN}</span>
        </button>
      </div>
      <div class="stage-table-body" id={bodyId} ref={body} hidden={!open} data-more-of={group.key}>
        <p class="in-note stage-table-lead">{table.lead}</p>
        <div class="stage-rows" role="list">
          {table.rows.map((row) => {
            const rk = stageRowOpenKey(group.key, row.id);
            const rowOpen = opened.isOpen(rk);
            const detailId = domId(rk);
            return (
              <div class={`stage-row${rowOpen ? " is-open" : ""}`} role="listitem" key={row.id} data-stage-row={row.id} data-stage-row-state={row.estimated ? "estimated" : "set"}>
                <div class="stage-row-main">
                  {own(row.value)}
                  {row.ramp !== null && !rowOpen ? <span class="stage-row-ramp">{row.ramp}</span> : null}
                  <button
                    type="button"
                    class="link-btn stage-row-more"
                    aria-expanded={rowOpen}
                    aria-controls={detailId}
                    aria-label={stageRowMoreLabel(row, rowOpen)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      if (!rowOpen) revealOpened(e.currentTarget, rk);
                      opened.toggle(rk);
                    }}
                    data-stage-row-toggle={row.id}
                  >
                    {rowOpen ? "閉じる" : "詳しく"}
                  </button>
                </div>
                {/* 閉じている間も描いておく（隠すだけ。欄を探して移ってこられるように） */}
                <div class="stage-row-detail" id={detailId} hidden={!rowOpen} data-more-of={rk} data-stage-row-detail={rk}>
                  {row.note !== null ? <p class="in-note stage-row-note">{row.note}</p> : null}
                  <div class="fields">{row.detail.map((f) => own(f))}</div>
                  <div class="stage-row-actions">
                    <button type="button" class="link-btn danger" aria-label={`${row.label}の変化を外す`} onClick={() => act(row.remove)} data-action={row.remove.key}>
                      {row.remove.label}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {removeAuto !== null ? (
          <div class="stage-table-actions">
            <button type="button" class="link-btn danger" onClick={() => act(removeAuto)} data-action={removeAuto.key}>
              {removeAuto.label}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
