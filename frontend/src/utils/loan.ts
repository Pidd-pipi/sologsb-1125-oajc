import { ANALYSIS_METHOD_LABELS, type AnalysisRecord } from '../types/analysis';
import type { ThinSection } from '../types/section';
import type {
  LoanAnalysisSnapshot,
  LoanRecord,
  LoanSectionSnapshot,
} from '../types/loan';

/** 今天 YYYY-MM-DD（本地时区） */
export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 日期字符串比较（YYYY-MM-DD 可直接字典序） */
export function compareDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 应还日期是否已超期（仅外借中且过了应还日期） */
export function isOverdue(loan: LoanRecord, today: string = todayStr()): boolean {
  return loan.status === 'open' && !!loan.dueDate && compareDate(loan.dueDate, today) < 0;
}

/** 旧册遗留：借阅人或应还日期缺失，需补全 */
export function isIncomplete(loan: LoanRecord): boolean {
  return loan.status === 'open' && (!loan.borrower || !loan.dueDate);
}

/** 距应还日期天数（负数为已超期天数；无应还日期返回 null） */
export function daysUntilDue(loan: LoanRecord, today: string = todayStr()): number | null {
  if (!loan.dueDate) return null;
  const due = new Date(`${loan.dueDate}T00:00:00`).getTime();
  const now = new Date(`${today}T00:00:00`).getTime();
  return Math.round((due - now) / 86400000);
}

/** 由切片记录生成随样快照 */
export function snapshotSections(sections: ThinSection[]): LoanSectionSnapshot[] {
  return sections.map((s) => ({
    sectionId: s.id,
    sectionNo: s.sectionNo,
    thickness: s.thickness,
    preparation: s.preparation,
    quality: s.quality,
  }));
}

/** 由检测记录生成借出前快照 */
export function snapshotAnalysis(records: AnalysisRecord[]): LoanAnalysisSnapshot[] {
  return records.map((a) => ({
    analysisId: a.id,
    method: a.method,
    target: a.target,
    testedAt: a.testedAt,
    fa: a.fa,
    fs: a.fs,
    ni: a.ni,
    kamaciteBandwidth: a.kamaciteBandwidth,
  }));
}

export interface SectionDiff {
  changed: boolean;
  before: number;
  after: number;
  added: string[];
  removed: string[];
}

export interface AnalysisDiff {
  changed: boolean;
  before: number;
  after: number;
  added: string[];
  removed: string[];
}

function describeSection(s: ThinSection): string {
  return `${s.sectionNo}（厚 ${s.thickness}μm）`;
}

function describeAnalysis(a: AnalysisRecord): string {
  return `${a.testedAt} · ${ANALYSIS_METHOD_LABELS[a.method]} · Fa ${a.fa}`;
}

/** 核对切片差异：数量或 id 集合变化即视为冲突 */
export function diffSections(
  snapshot: LoanSectionSnapshot[],
  current: ThinSection[],
): SectionDiff {
  const snapIds = new Set(snapshot.map((s) => s.sectionId));
  const curIds = new Set(current.map((s) => s.id));
  const added = current.filter((s) => !snapIds.has(s.id)).map(describeSection);
  const removed = snapshot
    .filter((s) => !curIds.has(s.sectionId))
    .map((s) => s.sectionNo);
  const changed = added.length > 0 || removed.length > 0 || snapshot.length !== current.length;
  return { changed, before: snapshot.length, after: current.length, added, removed };
}

/** 核对检测记录差异：数量或 id 集合变化即视为冲突 */
export function diffAnalysis(
  snapshot: LoanAnalysisSnapshot[],
  current: AnalysisRecord[],
): AnalysisDiff {
  const snapIds = new Set(snapshot.map((a) => a.analysisId));
  const curIds = new Set(current.map((a) => a.id));
  const added = current.filter((a) => !snapIds.has(a.id)).map(describeAnalysis);
  const removed = snapshot
    .filter((a) => !curIds.has(a.analysisId))
    .map((a) => `${a.testedAt} · ${ANALYSIS_METHOD_LABELS[a.method]}`);
  const changed = added.length > 0 || removed.length > 0 || snapshot.length !== current.length;
  return { changed, before: snapshot.length, after: current.length, added, removed };
}
