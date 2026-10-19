// 提案書の帳票の入力（0009 の9）を組み立てる部品の入口
export { buildProposalInput, displayYears, percent, roles } from "./build.ts";
export type { EngineOutput, InvestmentMaterial, ProposalBundle, Run, TableCell } from "./bundle.ts";
export { DEFAULT_LAYOUT, PROPOSAL_INPUT_FORMAT, PROPOSAL_INPUT_VERSION, type CashflowLayout, type Comparison, type InvestmentView, type MarketDropView, type Orientation, type ProposalInput, type ReportLayout } from "./input.ts";
export { CHAPTER_IDS, CHAPTERS, hasMaterial, selectChapters, type ChapterDef, type ChapterId } from "./chapters.ts";
export { comparisonMetrics, ESTIMATED_NOTE, hasEstimatedBox, type ComparisonMetrics } from "./build.ts";
