import { create } from 'zustand';
import { db, makeId, seedIfEmpty } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type {
  CompleteLegacyInput,
  LoanDiff,
  LoanOutInput,
  LoanRecord,
  ReturnLoanInput,
} from '../types/loan';
import { compareDateString, isLoanOpen, isValidDateString } from '../types/loan';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import { buildLoanDiff } from '../utils/loanDiff';

/** 台账动作统一抛出的业务错误（消息直接面向用户） */
export class LoanActionError extends Error {}

/** 归还进行中的借阅单 id：连点/并发只允许第一条落库 */
const returningLoanIds = new Set<string>();

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
  /** 清理样本档案；外借中（含旧册待补全）的样本会被拒绝，已归还台账保留 */
  removeSample: (id: string) => Promise<void>;
  addFind: (input: Omit<FindRecord, 'id' | 'createdAt'>) => Promise<string>;
  addSection: (input: Omit<ThinSection, 'id' | 'createdAt'>) => Promise<string>;
  updateSection: (id: string, patch: Partial<ThinSection>) => Promise<void>;
  addAnalysis: (input: Omit<AnalysisRecord, 'id' | 'createdAt'>) => Promise<string>;
  nextSampleSeq: () => number;
  /** 借出登记：写借阅单、拍借出前快照、样本转为外借中（原子事务） */
  loanOut: (input: LoanOutInput) => Promise<string>;
  /** 旧册补全：补借用人/日期/随样切片，转成正常外借单 */
  completeLegacy: (loanId: string, input: CompleteLegacyInput) => Promise<void>;
  /**
   * 归还预检：只算差异不落库。
   * 切片数量或检测记录发生变化（含内容被修改）时返回的 diff 带冲突。
   */
  previewReturn: (loanId: string) => LoanDiff;
  /** 确认归还：有冲突必须 acknowledgedConflict；连续点击只落一条记录 */
  returnLoan: (loanId: string, input: ReturnLoanInput) => Promise<void>;
}

/** 深拷贝快照（与 db 层一致，ES2020 无 structuredClone） */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 日期先后顺序校验：返回错误消息，合法返回 null */
function validateDateOrder(loanDate: string, dueDate: string, returnedAt?: string): string | null {
  if (!isValidDateString(loanDate) || !isValidDateString(dueDate)) {
    return '日期格式不合法，应为 YYYY-MM-DD';
  }
  if (compareDateString(dueDate, loanDate) < 0) {
    return '应还日期不能早于借出日期，该交易不成立';
  }
  if (returnedAt !== undefined) {
    if (!isValidDateString(returnedAt)) return '归还日期格式不合法，应为 YYYY-MM-DD';
    if (compareDateString(returnedAt, loanDate) < 0) {
      return '归还日期不能早于借出日期，该交易不成立';
    }
  }
  return null;
}

const sortByCreatedDesc = <T extends { createdAt: number }>(list: T[]) =>
  [...list].sort((a, b) => b.createdAt - a.createdAt);

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
    set({
      samples: sortByCreatedDesc(samples),
      finds: sortByCreatedDesc(finds),
      sections: sortByCreatedDesc(sections),
      analysis: sortByCreatedDesc(analysis),
      loans: sortByCreatedDesc(loans),
      loading: false,
      loaded: true,
    });
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
    const open = get().loans.find((l) => l.sampleId === id && isLoanOpen(l));
    if (open) {
      // 外借中的样本被清理会切断追责链路，直接挡住
      throw new LoanActionError(
        open.status === 'legacy'
          ? '该样本是旧册待补全的外借记录，请先在借阅台账补全并归还后再清理'
          : `该样本仍在外借中（借用人：${open.borrower ?? '—'}），归还前不能清理`,
      );
    }
    await db.transaction('rw', db.samples, db.finds, db.sections, db.analysis, async () => {
      await db.samples.delete(id);
      await db.finds.where('sampleId').equals(id).delete();
      await db.sections.where('sampleId').equals(id).delete();
      await db.analysis.where('sampleId').equals(id).delete();
      // 已归还历史保留：loans 表不参与级联删除，追责链路可继续回溯
    });
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

  loanOut: async (input) => {
    const state = get();
    const borrower = input.borrower.trim();
    if (!borrower) throw new LoanActionError('借用人不能为空');
    const dateError = validateDateOrder(input.loanDate, input.dueDate);
    if (dateError) throw new LoanActionError(dateError);

    const sample = state.samples.find((s) => s.id === input.sampleId);
    if (!sample) throw new LoanActionError('样本不存在，无法登记借出');
    const open = state.loans.find((l) => l.sampleId === input.sampleId && isLoanOpen(l));
    if (open) throw new LoanActionError('该样本已有未关闭的借阅单，不能重复借出');

    // 勾选随样的切片必须确实属于该样本
    const sampleSections = state.sections.filter((s) => s.sampleId === input.sampleId);
    const validIds = sampleSections
      .filter((s) => input.sectionIds.includes(s.id))
      .map((s) => s.id);
    if (validIds.length !== input.sectionIds.length) {
      throw new LoanActionError('随样切片清单包含不属于该样本的切片');
    }
    // 快照固化该样本名下全部切片（不论是否物理随样），
    // 这样归还时未随样切片的正常改动不会被误报，借出期间的增删改才计入冲突
    const snapshotSections = clone(sampleSections);
    const snapshotAnalysis = clone(state.analysis.filter((a) => a.sampleId === input.sampleId));

    const now = Date.now();
    // 快照固化借出前状态：样本对象里 storage 保留外借前位置，
    // 归还时据此放回原柜（随后样本本身才翻成 loan-out）
    const snapshotSample: MeteoriteSample = { ...clone(sample), storage: sample.storage };
    const loan: LoanRecord = {
      id: makeId('loan'),
      sampleId: input.sampleId,
      borrower,
      loanDate: input.loanDate,
      dueDate: input.dueDate,
      sectionIds: validIds,
      snapshot: { sample: snapshotSample, sections: snapshotSections, analysis: snapshotAnalysis },
      status: 'active',
      note: input.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    await db.transaction('rw', db.loans, db.samples, async () => {
      await db.loans.add(loan);
      await db.samples.update(input.sampleId, { storage: 'loan-out', updatedAt: now });
    });
    set({
      loans: [loan, ...state.loans],
      samples: state.samples.map((s) =>
        s.id === input.sampleId ? { ...s, storage: 'loan-out', updatedAt: now } : s,
      ),
    });
    return loan.id;
  },

  completeLegacy: async (loanId, input) => {
    const state = get();
    const loan = state.loans.find((l) => l.id === loanId);
    if (!loan) throw new LoanActionError('借阅单不存在');
    if (loan.status !== 'legacy') throw new LoanActionError('该借阅单不是旧册待补全记录');

    const borrower = input.borrower.trim();
    if (!borrower) throw new LoanActionError('借用人不能为空');
    const dateError = validateDateOrder(input.loanDate, input.dueDate);
    if (dateError) throw new LoanActionError(dateError);

    const sampleSections = state.sections.filter((s) => s.sampleId === loan.sampleId);
    const chosenIds = sampleSections
      .filter((s) => input.sectionIds.includes(s.id))
      .map((s) => s.id);
    if (chosenIds.length !== input.sectionIds.length) {
      throw new LoanActionError('随样切片清单包含不属于该样本的切片');
    }

    const updatedAt = Date.now();
    const currentSample = state.samples.find((s) => s.id === loan.sampleId);
    // 补全时以当前档案重拍快照；旧册不知外借前柜位，归还时默认回 A 柜
    const snapshotSample: MeteoriteSample = currentSample
      ? { ...clone(currentSample), storage: 'cabinet-a' }
      : { ...loan.snapshot.sample, storage: 'cabinet-a' as const };
    const updated: LoanRecord = {
      ...loan,
      borrower,
      loanDate: input.loanDate,
      dueDate: input.dueDate,
      sectionIds: chosenIds,
      snapshot: {
        sample: snapshotSample,
        sections: clone(sampleSections),
        analysis: clone(state.analysis.filter((a) => a.sampleId === loan.sampleId)),
      },
      status: 'active',
      note: loan.note ? `${loan.note}（已补全）` : undefined,
      updatedAt,
    };
    await db.loans.put(updated);
    set({ loans: state.loans.map((l) => (l.id === loanId ? updated : l)) });
  },

  previewReturn: (loanId) => {
    const state = get();
    const loan = state.loans.find((l) => l.id === loanId);
    if (!loan) throw new LoanActionError('借阅单不存在');
    if (!isLoanOpen(loan)) throw new LoanActionError('该借阅单已归还，不能重复操作');
    return buildLoanDiff(
      loan.snapshot,
      state.sections.filter((s) => s.sampleId === loan.sampleId),
      state.analysis.filter((a) => a.sampleId === loan.sampleId),
    );
  },

  returnLoan: async (loanId, input) => {
    if (returningLoanIds.has(loanId)) {
      throw new LoanActionError('归还正在处理中，连续点击不会重复落账');
    }
    const state = get();
    const loan = state.loans.find((l) => l.id === loanId);
    if (!loan) throw new LoanActionError('借阅单不存在');
    if (!isLoanOpen(loan)) throw new LoanActionError('该借阅单已归还，连续点击不会重复落账');
    if (loan.status === 'legacy') {
      throw new LoanActionError('旧册记录缺借用人与日期，请先补全后再办理归还');
    }

    const returnedAt = input.returnedAt;
    const dateError = validateDateOrder(loan.loanDate!, loan.dueDate!, returnedAt);
    if (dateError) throw new LoanActionError(dateError);

    const diff = buildLoanDiff(
      loan.snapshot,
      state.sections.filter((s) => s.sampleId === loan.sampleId),
      state.analysis.filter((a) => a.sampleId === loan.sampleId),
    );
    if (diff.hasConflict && !input.acknowledgedConflict) {
      throw new LoanActionError(
        `检测到 ${diff.entries.length} 处差异，请核对借出前快照并勾选确认后再归还`,
      );
    }

    returningLoanIds.add(loanId);
    try {
      const updatedAt = Date.now();
      // 归还后回到借出前快照记录的存放位置（外借前在哪个柜就回哪个柜）。
      // 旧册补全时已把快照 storage 归正为 cabinet-a，故此处直接取用
      const restoreStorage = loan.snapshot.sample.storage;
      const updatedLoan: LoanRecord = {
        ...loan,
        status: 'returned',
        returnedAt,
        closeDiff: diff,
        updatedAt,
      };

      await db.transaction('rw', db.loans, db.samples, async () => {
        await db.loans.put(updatedLoan);
        await db.samples.update(loan.sampleId, { storage: restoreStorage, updatedAt });
      });
      set((prev) => ({
        loans: prev.loans.map((l) => (l.id === loanId ? updatedLoan : l)),
        samples: prev.samples.map((s) =>
          s.id === loan.sampleId ? { ...s, storage: restoreStorage, updatedAt } : s,
        ),
      }));
    } finally {
      returningLoanIds.delete(loanId);
    }
  },
}));
