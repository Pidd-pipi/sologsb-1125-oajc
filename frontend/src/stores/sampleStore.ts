import { create } from 'zustand';
import { db, makeId, seedIfEmpty } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { LoanRecord } from '../types/loan';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import {
  diffAnalysis,
  diffSections,
  snapshotAnalysis,
  snapshotSections,
  todayStr,
  type AnalysisDiff,
  type SectionDiff,
} from '../utils/loan';

export interface LendInput {
  sampleId: string;
  borrower: string;
  loanedAt: string;
  dueDate: string;
  sectionIds: string[];
}

export interface ReturnConflict {
  sectionDiff: SectionDiff;
  analysisDiff: AnalysisDiff;
}

export interface SampleState {
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
  loans: LoanRecord[];
  loading: boolean;
  loaded: boolean;
  loadAll: () => Promise<void>;
  addSample: (input: Omit<MeteoriteSample, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateSample: (id: string, patch: Partial<MeteoriteSample>) => Promise<void>;
  removeSample: (id: string) => Promise<void>;
  addFind: (input: Omit<FindRecord, 'id' | 'createdAt'>) => Promise<string>;
  addSection: (input: Omit<ThinSection, 'id' | 'createdAt'>) => Promise<string>;
  updateSection: (id: string, patch: Partial<ThinSection>) => Promise<void>;
  addAnalysis: (input: Omit<AnalysisRecord, 'id' | 'createdAt'>) => Promise<string>;
  nextSampleSeq: () => number;
  lendSample: (input: LendInput) => Promise<string>;
  completeLegacyLoan: (loanId: string, patch: { borrower: string; dueDate: string }) => Promise<void>;
  returnLoan: (
    loanId: string,
    confirmChanges?: boolean,
    returnNote?: string,
  ) => Promise<{ conflict: boolean; detail?: ReturnConflict }>;
  openLoanOf: (sampleId: string) => LoanRecord | undefined;
  isSectionOnLoan: (sectionId: string) => boolean;
}

export const useSampleStore = create<SampleState>((set, get) => ({
  samples: [],
  finds: [],
  sections: [],
  analysis: [],
  loans: [],
  loading: false,
  loaded: false,

  loadAll: async () => {
    set({ loading: true });
    await seedIfEmpty();
    const [samples, finds, sections, analysis, loans] = await Promise.all([
      db.samples.toArray(),
      db.finds.toArray(),
      db.sections.toArray(),
      db.analysis.toArray(),
      db.loans.toArray(),
    ]);
    samples.sort((a, b) => b.createdAt - a.createdAt);
    finds.sort((a, b) => b.createdAt - a.createdAt);
    sections.sort((a, b) => b.createdAt - a.createdAt);
    analysis.sort((a, b) => b.createdAt - a.createdAt);
    loans.sort((a, b) => b.createdAt - a.createdAt);
    set({ samples, finds, sections, analysis, loans, loading: false, loaded: true });
  },

  addSample: async (input) => {
    const now = Date.now();
    const record: MeteoriteSample = { ...input, id: makeId('sample'), createdAt: now, updatedAt: now };
    await db.samples.add(record);
    set({ samples: [record, ...get().samples] });
    return record.id;
  },

  updateSample: async (id, patch) => {
    const updatedAt = Date.now();
    await db.samples.update(id, { ...patch, updatedAt });
    set({
      samples: get().samples.map((s) => (s.id === id ? { ...s, ...patch, updatedAt } : s)),
    });
  },

  removeSample: async (id) => {
    // 外借中的样本被清理会切断追责链路，必须先挡住
    const openLoan = get().openLoanOf(id);
    if (openLoan) {
      throw new Error(
        `该样本外借中（借用人：${openLoan.borrower || '待补全'}，应还：${openLoan.dueDate || '待补全'}），清理会切断追责链路，请先归还再清理。`,
      );
    }
    await db.transaction('rw', db.samples, db.finds, db.sections, db.analysis, async () => {
      await db.samples.delete(id);
      await db.finds.where('sampleId').equals(id).delete();
      await db.sections.where('sampleId').equals(id).delete();
      await db.analysis.where('sampleId').equals(id).delete();
    });
    // 注意：已归还的借阅台账保留，不随样本清理删除，用于审计追责
    set({
      samples: get().samples.filter((s) => s.id !== id),
      finds: get().finds.filter((f) => f.sampleId !== id),
      sections: get().sections.filter((s) => s.sampleId !== id),
      analysis: get().analysis.filter((a) => a.sampleId !== id),
    });
  },

  addFind: async (input) => {
    const record: FindRecord = { ...input, id: makeId('find'), createdAt: Date.now() };
    await db.finds.add(record);
    set({ finds: [record, ...get().finds] });
    return record.id;
  },

  addSection: async (input) => {
    const record: ThinSection = { ...input, id: makeId('section'), createdAt: Date.now() };
    await db.sections.add(record);
    set({ sections: [record, ...get().sections] });
    return record.id;
  },

  updateSection: async (id, patch) => {
    await db.sections.update(id, patch);
    set({ sections: get().sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  },

  addAnalysis: async (input) => {
    const record: AnalysisRecord = { ...input, id: makeId('analysis'), createdAt: Date.now() };
    await db.analysis.add(record);
    set({ analysis: [record, ...get().analysis] });
    return record.id;
  },

  nextSampleSeq: () => {
    const year = new Date().getFullYear();
    const prefix = `MET-${year}-`;
    const used = get()
      .samples.map((s) => s.sampleNo)
      .filter((no) => no.startsWith(prefix))
      .map((no) => Number(no.slice(prefix.length)))
      .filter((n) => Number.isFinite(n));
    const max = used.length ? Math.max(...used) : 0;
    return max + 1;
  },

  lendSample: async (input) => {
    const sample = get().samples.find((s) => s.id === input.sampleId);
    if (!sample) throw new Error('样本不存在');
    if (get().openLoanOf(input.sampleId)) throw new Error('该样本已外借中，请先归还再借出');
    if (!input.borrower.trim()) throw new Error('请填写借用人');
    if (!input.loanedAt) throw new Error('请选择借出日期');
    if (!input.dueDate) throw new Error('请选择应还日期');
    if (input.dueDate < input.loanedAt) throw new Error('应还日期不能早于借出日期，交易不成立');

    const sections = get().sections.filter((s) => input.sectionIds.includes(s.id));
    const analysis = get().analysis.filter((a) => a.sampleId === input.sampleId);
    const now = Date.now();
    const record: LoanRecord = {
      id: makeId('loan'),
      sampleId: sample.id,
      sampleNo: sample.sampleNo,
      status: 'open',
      borrower: input.borrower.trim(),
      loanedAt: input.loanedAt,
      dueDate: input.dueDate,
      returnedAt: null,
      sectionsSnapshot: snapshotSections(sections),
      analysisSnapshot: snapshotAnalysis(analysis),
      legacy: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.loans.add(record);
    await db.samples.update(sample.id, { storage: 'loan-out', updatedAt: now });
    set({
      loans: [record, ...get().loans],
      samples: get().samples.map((s) =>
        s.id === sample.id ? { ...s, storage: 'loan-out', updatedAt: now } : s,
      ),
    });
    return record.id;
  },

  completeLegacyLoan: async (loanId, patch) => {
    const loan = get().loans.find((l) => l.id === loanId);
    if (!loan || loan.status !== 'open') return;
    if (!patch.borrower.trim()) throw new Error('请填写借用人');
    if (!patch.dueDate) throw new Error('请选择应还日期');
    if (patch.dueDate < loan.loanedAt) throw new Error('应还日期不能早于借出日期，交易不成立');
    const now = Date.now();
    const updated: LoanRecord = {
      ...loan,
      borrower: patch.borrower.trim(),
      dueDate: patch.dueDate,
      updatedAt: now,
    };
    await db.loans.put(updated);
    set({ loans: get().loans.map((l) => (l.id === loanId ? updated : l)) });
  },

  returnLoan: async (loanId, confirmChanges = false, returnNote) => {
    const loan = get().loans.find((l) => l.id === loanId);
    // 幂等：已归还直接返回，连续点击只落一条记录
    if (!loan || loan.status !== 'open') return { conflict: false };

    const today = todayStr();
    if (today < loan.loanedAt) {
      throw new Error('归还日期不能早于借出日期，交易不成立');
    }

    const currentSections = get().sections.filter((s) => s.sampleId === loan.sampleId);
    const currentAnalysis = get().analysis.filter((a) => a.sampleId === loan.sampleId);
    const sectionDiff = diffSections(loan.sectionsSnapshot, currentSections);
    const analysisDiff = diffAnalysis(loan.analysisSnapshot, currentAnalysis);
    const hasConflict = sectionDiff.changed || analysisDiff.changed;

    if (hasConflict && !confirmChanges) {
      return { conflict: true, detail: { sectionDiff, analysisDiff } };
    }

    const now = Date.now();
    const updated: LoanRecord = {
      ...loan,
      status: 'returned',
      returnedAt: today,
      returnNote: returnNote?.trim() || undefined,
      updatedAt: now,
    };
    await db.loans.put(updated);
    // 样本若仍在库，恢复存放位置；样本已清理则台账保留
    const sample = get().samples.find((s) => s.id === loan.sampleId);
    if (sample) {
      await db.samples.update(sample.id, { storage: 'cabinet-a', updatedAt: now });
    }
    set({
      loans: get().loans.map((l) => (l.id === loanId ? updated : l)),
      samples: sample
        ? get().samples.map((s) =>
            s.id === sample.id ? { ...s, storage: 'cabinet-a', updatedAt: now } : s,
          )
        : get().samples,
    });
    return { conflict: false };
  },

  openLoanOf: (sampleId) => get().loans.find((l) => l.sampleId === sampleId && l.status === 'open'),

  isSectionOnLoan: (sectionId) =>
    get().loans.some(
      (l) => l.status === 'open' && l.sectionsSnapshot.some((s) => s.sectionId === sectionId),
    ),
}));
