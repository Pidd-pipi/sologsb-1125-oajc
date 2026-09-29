import Dexie, { type Table } from 'dexie';
import type { MeteoriteSample } from '../types/sample';
import type { FindRecord } from '../types/find';
import type { ThinSection } from '../types/section';
import type { AnalysisRecord } from '../types/analysis';
import type { LoanRecord } from '../types/loan';

/** 库名固定为 gbmeteorite-db */
export const DB_NAME = 'gbmeteorite-db';

/** 深拷贝（ES2020 目标无 structuredClone，快照必须与原对象脱钩） */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 版本历史（IndexedDB 升级迁移）：
 *  - v1：建 samples / finds / sections 三张表
 *  - v2：新增 analysis 表，并为 analysis 加 sampleId 索引
 *  - v3：为 samples 补 updatedAt 字段，并按 id 回填旧记录
 *  - v4：新增 loans 借阅台账表；旧册里 storage=loan-out 但缺借用人/应还日期
 *        的样本，迁入为 status='legacy' 的借阅单（无借用人、无日期），
 *        升级后仍可查询并在台账中补全
 */
export class MeteoriteDB extends Dexie {
  samples!: Table<MeteoriteSample, string>;
  finds!: Table<FindRecord, string>;
  sections!: Table<ThinSection, string>;
  analysis!: Table<AnalysisRecord, string>;
  loans!: Table<LoanRecord, string>;

  constructor() {
    super(DB_NAME);

    this.version(1).stores({
      samples: 'id, sampleNo, category, chemicalGroup, totalWeight, createdAt',
      finds: 'id, sampleId, region, createdAt',
      sections: 'id, sectionNo, sampleId, thickness, createdAt',
    });

    this.version(2)
      .stores({
        samples: 'id, sampleNo, category, chemicalGroup, totalWeight, createdAt',
        finds: 'id, sampleId, region, createdAt',
        sections: 'id, sectionNo, sampleId, thickness, createdAt',
        analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
      })
      .upgrade(async (tx) => {
        // v2：旧记录补齐新表所需字段，避免读取时 undefined
        await tx
          .table<AnalysisRecord, string>('analysis')
          .toCollection()
          .modify((rec) => {
            if (typeof rec.createdAt !== 'number') rec.createdAt = Date.now();
          });
      });

    this.version(3)
      .stores({
        samples:
          'id, sampleNo, category, chemicalGroup, totalWeight, createdAt, updatedAt',
        finds: 'id, sampleId, region, createdAt',
        sections: 'id, sectionNo, sampleId, thickness, createdAt',
        analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
      })
      .upgrade(async (tx) => {
        // v3：为样本表补 updatedAt，并按 id 回填旧记录
        await tx
          .table<MeteoriteSample, string>('samples')
          .toCollection()
          .modify((sample) => {
            if (typeof sample.updatedAt !== 'number') {
              sample.updatedAt =
                typeof sample.createdAt === 'number' ? sample.createdAt : Date.now();
            }
          });
      });

    this.version(4)
      .stores({
        samples:
          'id, sampleNo, category, chemicalGroup, totalWeight, createdAt, updatedAt',
        finds: 'id, sampleId, region, createdAt',
        sections: 'id, sectionNo, sampleId, thickness, createdAt',
        analysis: 'id, sampleId, sectionId, method, testedAt, createdAt',
        loans: 'id, sampleId, status, loanDate, dueDate, returnedAt, createdAt',
      })
      .upgrade(async (tx) => {
        // v4：旧册中只标记了 loan-out、没有借用人与应还日期的样本，
        // 迁入借阅台账为 legacy 单，保证升级后仍可查并等待补全
        const samplesTable = tx.table<MeteoriteSample, string>('samples');
        const sectionsTable = tx.table<ThinSection, string>('sections');
        const analysisTable = tx.table<AnalysisRecord, string>('analysis');
        const loanTable = tx.table<LoanRecord, string>('loans');

        const loanedSamples = (await samplesTable.toArray()).filter(
          (s) => s.storage === 'loan-out',
        );
        // 幂等保护：已经有未关闭借阅单的样本不再重复迁入
        const existingLoanSampleIds = new Set(
          (await loanTable.toArray())
            .filter((l) => l.status !== 'returned')
            .map((l) => l.sampleId),
        );
        const now = Date.now();
        for (const sample of loanedSamples) {
          if (existingLoanSampleIds.has(sample.id)) continue;
          const secs = await sectionsTable.where('sampleId').equals(sample.id).toArray();
          const recs = await analysisTable.where('sampleId').equals(sample.id).toArray();
          await loanTable.add({
            id: `loan_legacy_${sample.id}`,
            sampleId: sample.id,
            sectionIds: secs.map((s) => s.id),
            snapshot: { sample: clone(sample), sections: clone(secs), analysis: clone(recs) },
            status: 'legacy',
            note: '旧册迁移：原仅有“外借中”存放标记，缺借用人与日期，请补全',
            createdAt: sample.updatedAt || now,
            updatedAt: now,
          });
        }
      });
  }
}

export const db = new MeteoriteDB();

/** 生成一个稳定的本地 id */
export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

/** 种子档案（首次运行灌入；bulkAdd 与借阅单快照共用同一份定义） */
function buildSeedData() {
  const now = Date.now();
  const day = 86400000;
  const iso = (daysAgo: number) => new Date(now - day * daysAgo).toISOString().slice(0, 10);

  const samples: MeteoriteSample[] = [
    { id: 'sample_seed_1', sampleNo: 'MET-2024-001', totalWeight: 1250.4, category: 'chondrite', chemicalGroup: 'H', weathering: 'W1', fallOrFind: 'find', storage: 'loan-out', note: '撒哈拉回收，熔壳完整', createdAt: now - day * 40, updatedAt: now - day * 40 },
    { id: 'sample_seed_2', sampleNo: 'MET-2024-002', totalWeight: 8420, category: 'iron', chemicalGroup: 'IAB', weathering: 'W0', fallOrFind: 'find', storage: 'loan-out', note: '八面体结构清晰', createdAt: now - day * 30, updatedAt: now - day * 30 },
    { id: 'sample_seed_3', sampleNo: 'MET-2024-003', totalWeight: 318.9, category: 'achondrite', chemicalGroup: 'ungrouped', weathering: 'W2', fallOrFind: 'fall', storage: 'desiccator', note: '目击坠落，无熔壳', createdAt: now - day * 18, updatedAt: now - day * 18 },
    { id: 'sample_seed_4', sampleNo: 'MET-2024-004', totalWeight: 642.7, category: 'stony-iron', chemicalGroup: 'ungrouped', weathering: 'W1', fallOrFind: 'find', storage: 'cabinet-a', note: '橄榄陨铁切片，供教学', createdAt: now - day * 12, updatedAt: now - day * 12 },
    { id: 'sample_seed_5', sampleNo: 'MET-2024-005', totalWeight: 210.3, category: 'chondrite', chemicalGroup: 'LL', weathering: 'W3', fallOrFind: 'find', storage: 'loan-out', note: '南极冰盖回收，风化较深', createdAt: now - day * 9, updatedAt: now - day * 9 },
    { id: 'sample_seed_6', sampleNo: 'MET-2024-006', totalWeight: 1520, category: 'iron', chemicalGroup: 'IAB', weathering: 'W0', fallOrFind: 'find', storage: 'cabinet-b', note: '高校合作项目已归还归档', createdAt: now - day * 60, updatedAt: now - day * 3 },
  ];

  const finds: FindRecord[] = [
    { id: 'find_seed_1', sampleId: 'sample_seed_1', placeName: 'Dar al Gani 区域', region: '利比亚', longitude: 16.2, latitude: 27.4, coordinateSource: 'gps', environment: 'desert', finder: '野外队 A 组', createdAt: now - day * 40 },
    { id: 'find_seed_2', sampleId: 'sample_seed_2', placeName: 'Gobi 南缘', region: '中国 内蒙古', longitude: 108.6, latitude: 42.1, coordinateSource: 'literature', environment: 'desert', finder: '标本室交换', createdAt: now - day * 30 },
    { id: 'find_seed_5', sampleId: 'sample_seed_5', placeName: 'Groves 冰原', region: '南极洲', longitude: 145.0, latitude: -72.5, coordinateSource: 'gps', environment: 'antarctica', finder: '南极考察队', createdAt: now - day * 9 },
  ];

  const sections: ThinSection[] = [
    { id: 'section_seed_1', sectionNo: 'TS-2024-001', sampleId: 'sample_seed_1', thickness: 30, preparation: 'resin', minerals: { olivine: 42, pyroxene: 28, feldspar: 12, metal: 18 }, micrographs: ['met001_ppl.jpg', 'met001_xpl.jpg'], quality: 'good', createdAt: now - day * 35 },
    { id: 'section_seed_2', sectionNo: 'TS-2024-002', sampleId: 'sample_seed_2', thickness: 60, preparation: 'epoxy', minerals: { olivine: 2, pyroxene: 5, feldspar: 1, metal: 92 }, micrographs: ['met002_reflect.jpg'], quality: 'fair', createdAt: now - day * 25 },
    { id: 'section_seed_5', sectionNo: 'TS-2024-005', sampleId: 'sample_seed_5', thickness: 30, preparation: 'resin', minerals: { olivine: 46, pyroxene: 26, feldspar: 11, metal: 17 }, micrographs: ['met005_xpl.jpg'], quality: 'good', createdAt: now - day * 8 },
    { id: 'section_seed_6', sectionNo: 'TS-2024-006', sampleId: 'sample_seed_6', thickness: 45, preparation: 'epoxy', minerals: { olivine: 4, pyroxene: 6, feldspar: 2, metal: 88 }, micrographs: [], quality: 'unrated', createdAt: now - day * 50 },
  ];

  const analysis: AnalysisRecord[] = [
    { id: 'analysis_seed_1', sampleId: 'sample_seed_1', target: 'sample', method: 'microprobe', fa: 18.6, fs: 16.2, ni: 0.8, kamaciteBandwidth: 0.02, testedAt: '2024-06-12', createdAt: now - day * 20 },
    { id: 'analysis_seed_2', sampleId: 'sample_seed_2', target: 'sample', method: 'sem-eds', fa: 3.2, fs: 4.1, ni: 7.4, kamaciteBandwidth: 0.62, testedAt: '2024-07-03', createdAt: now - day * 12 },
    { id: 'analysis_seed_6', sampleId: 'sample_seed_6', target: 'sample', method: 'microprobe', fa: 2.8, fs: 3.6, ni: 8.1, kamaciteBandwidth: 0.58, testedAt: '2024-05-20', createdAt: now - day * 45 },
  ];

  const sampleById = new Map(samples.map((s) => [s.id, s]));
  const sectionsBySample = (sampleId: string) => sections.filter((s) => s.sampleId === sampleId);
  const analysisBySample = (sampleId: string) => analysis.filter((a) => a.sampleId === sampleId);
  const legacyNote = '旧册迁移：原仅有“外借中”存放标记，缺借用人与日期，请补全';

  // 三份旧册样本：仅有“外借中”标记，缺借用人、借出日期与应还日期
  const loans: LoanRecord[] = (['sample_seed_1', 'sample_seed_2', 'sample_seed_5'] as const).map(
    (sampleId) => ({
      id: `loan_legacy_${sampleId}`,
      sampleId,
      sectionIds: sectionsBySample(sampleId).map((s) => s.id),
      snapshot: {
        sample: clone(sampleById.get(sampleId)!),
        sections: clone(sectionsBySample(sampleId)),
        analysis: clone(analysisBySample(sampleId)),
      },
      status: 'legacy' as const,
      note: legacyNote,
      createdAt: now,
      updatedAt: now,
    }),
  );

  // 一份正常登记、尚未归还且已超期的外借单（总览醒目提示用）
  loans.push({
    id: 'loan_seed_active_4',
    sampleId: 'sample_seed_4',
    borrower: '省地质博物馆 · 周岚',
    loanDate: iso(20),
    dueDate: iso(6),
    sectionIds: [],
    snapshot: {
      sample: clone(sampleById.get('sample_seed_4')!),
      sections: [],
      analysis: [],
    },
    status: 'active',
    createdAt: now - day * 20,
    updatedAt: now - day * 20,
  });

  // 一份已归还的历史台账：无冲突关闭
  loans.push({
    id: 'loan_seed_returned_6',
    sampleId: 'sample_seed_6',
    borrower: '北原大学行星科学系',
    loanDate: iso(45),
    dueDate: iso(30),
    returnedAt: iso(28),
    sectionIds: ['section_seed_6'],
    snapshot: {
      sample: clone(sampleById.get('sample_seed_6')!),
      sections: clone(sectionsBySample('sample_seed_6')),
      analysis: clone(analysisBySample('sample_seed_6')),
    },
    status: 'returned',
    closeDiff: {
      entries: [],
      sectionCountBefore: 1,
      sectionCountAfter: 1,
      analysisCountBefore: 1,
      analysisCountAfter: 1,
      hasConflict: false,
    },
    createdAt: now - day * 45,
    updatedAt: now - day * 28,
  });

  return { samples, finds, sections, analysis, loans };
}

/** 首次运行时灌入演示档案，保证页面有可检索内容 */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.samples.count();
  if (count > 0) return;
  const seed = buildSeedData();
  await db.transaction(
    'rw',
    db.samples,
    db.finds,
    db.sections,
    db.analysis,
    db.loans,
    async () => {
      await db.samples.bulkAdd(seed.samples);
      await db.finds.bulkAdd(seed.finds);
      await db.sections.bulkAdd(seed.sections);
      await db.analysis.bulkAdd(seed.analysis);
      await db.loans.bulkAdd(seed.loans);
    },
  );
}
