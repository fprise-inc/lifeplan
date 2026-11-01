// 提案書の帳票の入力（0009 の9）を組み立てる部品の入口
export { buildProposalInput, displayYears, E_REPORT_NO_YEARS, percent, roles } from "./build.ts";
export type { EngineOutput, InvestmentMaterial, ProposalBundle, RealEstateAnalysis, RealEstateAnalysisProperty, RealEstateAnalysisTotal, RealEstateAnalysisYear, Run, TableCell } from "./bundle.ts";
export { pctText, timesText } from "./rentalText.ts";
export { saleCompareOf, saleVariantRequest, saleVariants, type SaleCompare, type SaleCompareRow, type SaleResult, type SaleVariant, type SaleVariantKey } from "./rentalSale.ts";
export { DEFAULT_LAYOUT, PROPOSAL_INPUT_FORMAT, PROPOSAL_INPUT_VERSION, type CashflowLayout, type Comparison, type InvestmentView, type MarketDropView, type Orientation, type ProposalInput, type ReportLayout } from "./input.ts";
export { CHAPTER_IDS, CHAPTERS, hasMaterial, selectChapters, type ChapterDef, type ChapterId } from "./chapters.ts";
export { comparisonMetrics, ESTIMATED_NOTE, hasEstimatedBox, type ComparisonMetrics } from "./build.ts";
export { bsHouseholdOf, bsSeries, groupTotal, BS_REAL_ESTATE_KEYS, BS_ASSET_GROUPS, BS_DEBT_GROUPS, BS_FINANCIAL_GROUPS, BS_GROUP_LABEL, BS_GROUP_SHORT, type BsAt, type BsGroup, type BsHousehold, type BsLine } from "./bsGroups.ts";
export { DEFAULT_MONEY_THREE, MONEY_THREE_LIST_MAX, MONEY_THREE_NAME_CHOICES, moneyThreeModel, moneyThreeResult, placementOf, readMoneyThree, type MoneyThreeModel, type MoneyThreeSettings } from "./moneyThree.ts";
export { childScholarshipNotes, childScholarshipsOf, type ChildScholarship } from "./childScholarships.ts";
