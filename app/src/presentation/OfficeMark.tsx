// 表示の設定の「事務所の既定値」「この世帯だけ」の印（提示層。0213 の段C）: 結果のタブ・資産と負債のタブの表示の設定で、設定ごとに
// 事務所の既定値に従っているか、この世帯だけの値かを小さく出し、「この世帯だけ」には「事務所の既定値に戻す」を置く。
// 見た目は前提条件の欄の印（0214 の4。input/FieldViews.tsx の PremiseTag・PremiseReset）にそろえる

/** 表示の設定の画面に渡す、設定ごとの印（作業の層が作る。id は表示の設定の一覧の id） */
export interface OfficeMarks {
  /** 事務所の既定値に従っているか */
  follows: (id: string) => boolean;
  /** 事務所の今の既定値の言葉（印の説明に出す） */
  officeText: (id: string) => string;
  /** 事務所の既定値に戻す（印を付け直し、事務所の今の既定値にする。一緒に変える設定はまとめて1回） */
  onReset: (ids: readonly string[]) => void;
}

/** 1つの設定の印（ids は同じ欄で一緒に変える設定。どれか1つでもこの世帯だけなら「この世帯だけ」） */
export function OfficeMark({ marks, ids }: { marks: OfficeMarks; ids: readonly string[] }) {
  const own = ids.filter((id) => !marks.follows(id));
  const office = ids.map((id) => marks.officeText(id)).join("・");
  if (own.length === 0)
    return (
      <span class="ds-office">
        <span class="fld-premise office" title={`事務所の既定値に従っています（${office}）。事務所の既定値を変えると、この世帯も変わります`} data-display-office={ids.join(" ")}>
          事務所の既定値
        </span>
      </span>
    );
  return (
    <span class="ds-office">
      <span class="fld-premise household" title={`この世帯だけの値です（事務所の既定値は ${office}）。事務所の既定値を変えても、この世帯は変わりません`} data-display-household={ids.join(" ")}>
        この世帯だけ
      </span>
      <button
        type="button"
        class="link-btn"
        title={`事務所の今の既定値（${office}）にして、これからも事務所の既定値に従います`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          marks.onReset(own);
        }}
        data-display-reset={own.join(" ")}
      >
        事務所の既定値に戻す
      </button>
    </span>
  );
}
