import type { AnalysisMethod, AnalysisTarget } from './analysis';
import type { PreparationMethod, SectionQuality } from './section';

/** 借阅状态：外借中 / 已归还 */
export type LoanStatus = 'open' | 'returned';

/** 随样切片快照项（借出时登记，归还时核对差异用） */
export interface LoanSectionSnapshot {
  sectionId: string;
  sectionNo: string;
  thickness: number;
  preparation: PreparationMethod;
  quality: SectionQuality;
}

/** 检测记录快照项（借出前快照，归还时核对差异用） */
export interface LoanAnalysisSnapshot {
  analysisId: string;
  method: AnalysisMethod;
  target: AnalysisTarget;
  testedAt: string;
  fa: number;
  fs: number;
  ni: number;
  kamaciteBandwidth: number;
}

/** 借阅台账（LoanRecord）：把借出、归还与审计串成一条台账 */
export interface LoanRecord {
  id: string;
  /** 关联样本 id（样本被清理后台账仍保留，用于审计追责） */
  sampleId: string;
  /** 样本编号冗余（样本清理后仍可辨识） */
  sampleNo: string;
  status: LoanStatus;
  /** 借用人 */
  borrower: string;
  /** 借出日期 YYYY-MM-DD */
  loanedAt: string;
  /** 应还日期 YYYY-MM-DD（旧册遗留缺失，需补全） */
  dueDate: string | null;
  /** 归还日期 YYYY-MM-DD */
  returnedAt: string | null;
  /** 随样切片快照 */
  sectionsSnapshot: LoanSectionSnapshot[];
  /** 借出前检测记录快照 */
  analysisSnapshot: LoanAnalysisSnapshot[];
  /** 归还核对备注 */
  returnNote?: string;
  /** 旧册遗留：借阅人/应还日期缺失，需补全 */
  legacy: boolean;
  createdAt: number;
  updatedAt: number;
}

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  open: '外借中',
  returned: '已归还',
};
