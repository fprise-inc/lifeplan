// 0006 の2〜4: 組み立て役。計算のはじめに部品IDごとに実装を1つだけ決める
import { EngineError } from "../errors.ts";
import { isTestId } from "../ids/ids.ts";
import type { ComponentDefinition } from "./define.ts";
import { SLOTS } from "./slots.ts";
import { contractMajor, satisfiesRange } from "../regulation/versions.ts";

export type Origin = "official" | "replacement" | "extension";

export interface Impl {
  readonly def: ComponentDefinition;
  readonly hash: string;
  readonly origin: Origin;
  readonly slot?: string;
  /** 外から来た部品（replacements・extensions で渡した差し替え・追加）。計算式ID の頭を確かめる（0006 の7・0119） */
  readonly custom?: true;
}

export interface OfficialComponent {
  readonly def: ComponentDefinition;
  readonly hash: string;
}

/** 差し替え（公式部品の置き換え）。0016 のマニフェストの { type: "replace", target, contract } に当たる */
export interface Replacement {
  readonly type: "replace";
  readonly target: string;
  readonly contract: string;
  readonly component: ComponentDefinition;
  readonly hash: string;
}

/** 追加（差し込み口への足し算） */
export interface Extension {
  readonly type: "extend";
  readonly extensionPoint: string;
  readonly contract: string;
  readonly component: ComponentDefinition;
  readonly hash: string;
}

export interface ComponentRef {
  readonly id: string;
  readonly contract: string;
  readonly revision: number;
  readonly hash: string;
  readonly origin: Origin;
  readonly slot?: string;
}

export interface Assembly {
  readonly impls: ReadonlyMap<string, Impl>;
  readonly extensions: ReadonlyMap<string, readonly Impl[]>;
  readonly refs: readonly ComponentRef[];
}

export interface AssembleOptions {
  readonly replacements?: readonly Replacement[];
  readonly extensions?: readonly Extension[];
}

export function assemble(official: readonly OfficialComponent[], options: AssembleOptions = {}): Assembly {
  const impls = new Map<string, Impl>();
  for (const o of official) {
    if (impls.has(o.def.id)) throw new EngineError("E_COMPONENT_DUPLICATE", [o.def.id]);
    impls.set(o.def.id, { def: o.def, hash: o.hash, origin: "official" });
  }

  for (const r of options.replacements ?? []) {
    const target = impls.get(r.target);
    if (target === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [r.target]);
    if (target.origin !== "official") throw new EngineError("E_COMPONENT_DUPLICATE", [r.target]);
    // 0119: 差し替えを許すのは、マニフェストに replaceable を付けた公式部品だけ（推定・目安・FP の考え方で変わる部品）
    if (target.def.replaceable !== true) throw new EngineError("E_NOT_REPLACEABLE", [r.target]);
    checkReplacement(target.def, r);
    impls.set(r.target, { def: r.component, hash: r.hash, origin: "replacement", custom: true });
  }

  const extensions = new Map<string, Impl[]>();
  for (const x of options.extensions ?? []) {
    const slot = SLOTS.get(x.extensionPoint);
    if (slot === undefined) throw new EngineError("E_SLOT_UNKNOWN", [x.extensionPoint]);
    if (!slot.open) throw new EngineError("E_SLOT_CLOSED", [x.extensionPoint]);
    if (Number(x.contract) !== contractMajor(slot.contract) || contractMajor(x.component.contract) !== contractMajor(slot.contract)) {
      throw new EngineError("E_CONTRACT_MISMATCH", [x.extensionPoint, x.component.id]);
    }
    const id = x.component.id;
    if (!id.startsWith("ext.") && !isTestId(id)) throw new EngineError("E_COMPONENT_DEFINITION", [id, "extensionId"]);
    if (impls.has(id) || [...extensions.values()].some((l) => l.some((i) => i.def.id === id))) {
      throw new EngineError("E_COMPONENT_DUPLICATE", [id]);
    }
    const list = extensions.get(slot.id) ?? [];
    list.push({ def: x.component, hash: x.hash, origin: "extension", slot: slot.id, custom: true });
    extensions.set(slot.id, list);
  }
  // 差し込み口の中の順番は部品IDの順（足した順に依らない）
  for (const list of extensions.values()) list.sort((a, b) => (a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0));

  checkRequires(impls);
  const refs: ComponentRef[] = [];
  for (const i of [...impls.values(), ...[...extensions.values()].flat()]) {
    refs.push({
      id: i.def.id,
      contract: i.def.contract,
      revision: i.def.revision,
      hash: i.hash,
      origin: i.origin,
      ...(i.slot !== undefined ? { slot: i.slot } : {}),
    });
  }
  refs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { impls, extensions, refs };
}

/**
 * 差し替えの約束（0119 の2）: 公式の部品と同じ ID・同じ入出力の形（スキーマのキー）・同じ MAJOR で公式以下の MINOR の約束の版、
 * 呼ぶ差し込み口は公式の部品が呼ぶものの内、replaceable は書かない。公式の MAJOR が上がったら差し替えは使わず、黙って公式に戻さずに計算を止める
 */
function checkReplacement(official: ComponentDefinition, r: Replacement): void {
  const id = official.id;
  const component = r.component;
  if (component.id !== id) throw new EngineError("E_COMPONENT_DEFINITION", [id, "id"]);
  if (!contractFits(official.contract, r.contract, component.contract)) throw new EngineError("E_CONTRACT_MISMATCH", [id]);
  if (component.replaceable !== undefined) throw new EngineError("E_COMPONENT_DEFINITION", [id, "replaceable"]);
  if (component.input !== official.input) throw new EngineError("E_COMPONENT_DEFINITION", [id, "input"]);
  if (component.output !== official.output) throw new EngineError("E_COMPONENT_DEFINITION", [id, "output"]);
  const allowed = new Set(official.slots ?? []);
  if ((component.slots ?? []).some((s) => !allowed.has(s))) throw new EngineError("E_COMPONENT_DEFINITION", [id, "slots"]);
}

/** 差し替えが名乗る約束の版が、公式と同じ MAJOR で、MINOR が公式以下か（公式より新しい約束は名乗れない） */
function contractFits(official: string, declared: string, component: string): boolean {
  const [om, on] = official.split(".").map(Number) as [number, number];
  const [cm, cn] = component.split(".").map(Number) as [number, number];
  return Number(declared) === om && cm === om && cn <= on;
}

/** 使う部品があり、約束の MAJOR が合い、依存が循環していないこと */
function checkRequires(impls: ReadonlyMap<string, Impl>): void {
  for (const i of impls.values()) {
    for (const [dep, range] of Object.entries(i.def.requires)) {
      const d = impls.get(dep);
      if (d === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [i.def.id, dep]);
      if (!satisfiesRange(contractMajor(d.def.contract), range)) throw new EngineError("E_CONTRACT_MISMATCH", [i.def.id, dep]);
    }
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: readonly string[]): void => {
    const s = state.get(id);
    if (s === "done") return;
    if (s === "visiting") throw new EngineError("E_COMPONENT_CYCLE", [...path, id]);
    state.set(id, "visiting");
    for (const dep of Object.keys((impls.get(id) as Impl).def.requires)) visit(dep, [...path, id]);
    state.set(id, "done");
  };
  for (const id of impls.keys()) visit(id, []);
}
