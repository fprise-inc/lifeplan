// 通しの入力のテストで、ページの中に入れる手助けの関数（window.__wt）。画面の部品は触らず、見えている文字・欄の名前で探す。
// 押す所の座標を返し、押す・打つは browser.ts が本物の入力の出来事で送る
export const PAGE_HELPERS = String.raw`
(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const txt = (el) => (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
  const all = (sel, root) => [...(root ?? document).querySelectorAll(sel)].filter(vis);
  const panel = () => all(".ipanel")[0] ?? null;
  const dialog = () => all("[role=dialog]").at(-1) ?? null;
  const rootOf = (within) => within === "panel" ? panel() : within === "dialog" ? dialog() : document;
  /** 押す所: 要素の上で、ほかの物（欄の中の「この値にする」など）に隠れていない点 */
  const center = (el) => {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    const y = Math.round(r.top + r.height / 2);
    for (const fy of [0.5, 0.2, 0.8])
      for (const f of [0.5, 0.15, 0.3, 0.7, 0.9, 0.05]) {
        const x = Math.round(r.left + r.width * f);
        const yy = Math.round(r.top + r.height * fy);
        const hit = document.elementFromPoint(x, yy);
        if (hit !== null && (hit === el || el.contains(hit))) return { x, y: yy, covered: false };
      }
    // どこもほかの物（パネルの下の固定の帯など）に隠れている: 押さずに、Tab で来たのと同じく欄に入る（browser.ts）
    window.__wtCovered = el;
    return { x: Math.round(r.left + r.width / 2), y, covered: true };
  };
  const CLICKABLE = "button,a,[role=button],[role=tab],summary,label,[role=option],[role=menuitem]";
  function target(text, within, nth, exact, row) {
    let root = rootOf(within);
    // row: その文字で始まる行（表の行・一覧の行）の中の押せる物
    if (root !== null && row !== null && row !== undefined) root = all("tr, li, [role=row]", root).find((r) => txt(r).startsWith(row)) ?? null;
    if (root === null) return "探す所がありません: " + within;
    const els = all(CLICKABLE, root).filter((e) => !e.disabled);
    const pick = (f) => els.filter(f);
    let list = pick((e) => txt(e) === text);
    if (!exact && list.length <= nth) list = pick((e) => txt(e).startsWith(text));
    if (!exact && list.length <= nth) list = pick((e) => (e.getAttribute("aria-label") ?? "") === text);
    const el = list[nth];
    if (!el) return "押す物が見つかりません: " + text + "（" + els.map(txt).filter(Boolean).slice(0, 60).join(" | ") + "）";
    return center(el);
  }
  /** 欄の名前（.fld の頭の文字）で欄を探す。group を渡すと、その見出しで始まるまとまりの中だけ */
  function inputOf(label, nth, group) {
    let root = panel() ?? document;
    if (group !== null) {
      const g = all(".in-group, .in-entry, fieldset, section", root).filter((x) => txt(x).startsWith(group));
      if (g.length === 0) return "まとまりが見つかりません: " + group;
      root = g.at(-1);
    }
    const cands = all(".fld", root).filter((l) => txt(l).startsWith(label));
    let n = nth;
    for (const l of cands) {
      const inp = [...l.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea")].find(vis);
      if (inp && n-- === 0) return inp;
    }
    // 表の形の欄（貯蓄・運用の口座の表など）は、欄の名前を aria-label に持つ
    const named = all("input, select, textarea", root).filter((i) => (i.getAttribute("aria-label") ?? "") === label);
    if (named[n]) return named[n];
    return "欄が見つかりません: " + label + "（" + all(".fld", root).map((l) => txt(l).slice(0, 16)).join(" | ") + "）";
  }
  function field(label, nth, group) {
    const el = inputOf(label, nth, group);
    return typeof el === "string" ? el : center(el);
  }
  function choose(label, option, nth, group) {
    const el = inputOf(label, nth, group);
    if (typeof el === "string") return el;
    // 1つの欄に選ぶ物がいくつかある（時点の欄の「年齢／年月」と人など）ときは、その選択肢を持つ物
    const sels = el.tagName === "SELECT" ? [el, ...el.closest(".fld").querySelectorAll("select")] : [...(el.closest(".fld")?.querySelectorAll("select") ?? [])];
    if (sels.length === 0) return "選ぶ欄ではありません: " + label;
    const find = (s, f) => [...s.options].find(f);
    const sel = sels.find((s) => find(s, (o) => o.text.trim() === option)) ?? sels.find((s) => find(s, (o) => o.text.trim().startsWith(option)));
    if (!sel) return "選択肢がありません: " + option + "（" + sels.flatMap((s) => [...s.options].map((o) => o.text)).join(" / ") + "）";
    const opt = find(sel, (o) => o.text.trim() === option) ?? find(sel, (o) => o.text.trim().startsWith(option));
    sel.scrollIntoView({ block: "center" });
    sel.focus();
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  }
  const focusCovered = () => { const el = window.__wtCovered; window.__wtCovered = null; if (!el) return false; el.focus(); return document.activeElement === el; };
  window.__wt = { focusCovered, vis, txt, all, panel, dialog, target, field, choose, panelText: () => { const p = panel(); return p ? txt(p) : ""; } };
})();
`;
