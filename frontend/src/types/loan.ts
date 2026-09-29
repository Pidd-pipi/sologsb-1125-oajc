import type { AnalysisRecord } from './analysis';
import type { MeteoriteSample } from './sample';
import type { ThinSection } from './section';

/** 借阅单状态：active 外借中 / returned 已归还 / legacy 旧册缺信息 */
export type LoanStatus = 'active' | 'returned' | 'legacy';

/**
 * 借出/归还台账（LoanRecord）。
 * 一条记录串起一次完整外借：借出登记 → 借出前快照 → 归还核对 → 关闭。
 * 旧系统里只把存放位置标成 loan-out、没有借用人/应还日期的样本，
 * 升级迁移后以 status='legacy' 落账，可在补全后转成 active 正常归还。
 */
export interface LoanRecord {
  id: string;
  /** 关联样本 id（样本被清理后仍保留，追责链路不断） */
  sampleId: string;
  /** 借用人姓名 / 机构；旧册迁移记录可为空，补全后回填 */
  borrower?: string;
  /** 借出日期 YYYY-MM-DD；旧册迁移记录可为空，补全后回填 */
  loanDate?: string;
  /** 应还日期 YYYY-MM-DD；旧册迁移记录可为空，补全后回填 */
  dueDate?: string;
  /** 实际归还日期 YYYY-MM-DD */
  returnedAt?: string;
  /** 随样切片 id 清单 */
  sectionIds: string[];
  /**
   * 借出前快照：登记借出时刻的样本、随样切片与该样本全部检测记录。
   * 归还时与现状逐项核对，永久保留。
   */
  snapshot: LoanSnapshot;
  status: LoanStatus;
  /** 归还核对差异（关闭借阅时写入，与快照一并留档） */
  closeDiff?: LoanDiff;
  /** 旧册补全备注（原存放标记的迁入说明等） */
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** 借出前快照 */
export interface LoanSnapshot {
  sample: MeteoriteSample;
  sections: ThinSection[];
  analysis: AnalysisRecord[];
}

/** 快照与现状的单条差异 */
export interface LoanDiffEntry {
  kind: 'section' | 'analysis';
  refId: string;
  refLabel: string;
  /** added 借出后新增 / removed 已缺失 / modified 内容被修改 */
  change: 'added' | 'removed' | 'modified';
  detail: string;
}

/** 归还核对差异汇总 */
export interface LoanDiff {
  entries: LoanDiffEntry[];
  /** 借出时切片数 vs 归还时切片数 */
  sectionCountBefore: number;
  sectionCountAfter: number;
  /** 借出时检测记录数 vs 归还时检测记录数 */
  analysisCountBefore: number;
  analysisCountAfter: number;
  /** 存在差异即为冲突，必须核对确认后才能关闭借阅 */
  hasConflict: boolean;
}

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  active: '外借中',
  returned: '已归还',
  legacy: '旧册待补全',
};

/** 借出登记入参 */
export interface LoanOutInput {
  sampleId: string;
  borrower: string;
  loanDate: string;
  dueDate: string;
  sectionIds: string[];
  note?: string;
}

/** 旧册补全入参 */
export interface CompleteLegacyInput {
  borrower: string;
  loanDate: string;
  dueDate: string;
  sectionIds: string[];
}

/** 归还入参 */
export interface ReturnLoanInput {
  returnedAt: string;
  /** 存在冲突时，必须显式确认差异已核对才能关闭 */
  acknowledgedConflict: boolean;
}

/** YYYY-MM-DD 合法性校验 */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const [y, m, day] = value.split('-').map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

/** 比较两个 YYYY-MM-DD：a<b 返回 -1，相等 0，a>b 1 */
export function compareDateString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 今天的 YYYY-MM-DD（本地时区） */
export function todayString(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 借阅单是否仍未关闭（外借中 / 旧册待补全都占着追责链路） */
export function isLoanOpen(loan: LoanRecord): boolean {
  return loan.status !== 'returned';
}

/** 是否已超期：有应还日期、仍未归还且应还日期早于今天 */
export function isLoanOverdue(loan: LoanRecord, today = todayString()): boolean {
  return isLoanOpen(loan) && !!loan.dueDate && compareDateString(loan.dueDate, today) < 0;
}

/** 超期天数（已归还按实际归还日判断，未归还按今天判断） */
export function overdueDays(loan: LoanRecord, today = todayString()): number {
  if (!loan.dueDate) return 0;
  const end = loan.status === 'returned' ? loan.returnedAt ?? today : today;
  const diff = compareDateString(end, loan.dueDate);
  if (diff <= 0) return 0;
  const ms = new Date(`${end}T00:00:00`).getTime() - new Date(`${loan.dueDate}T00:00:00`).getTime();
  return Math.round(ms / 86400000);
}
