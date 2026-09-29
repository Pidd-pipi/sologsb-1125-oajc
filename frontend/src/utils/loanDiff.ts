import type { AnalysisRecord } from '../types/analysis';
import { ANALYSIS_METHOD_LABELS } from '../types/analysis';
import type { LoanDiff, LoanDiffEntry, LoanSnapshot } from '../types/loan';
import type { ThinSection } from '../types/section';
import { PREPARATION_LABELS, mineralTotal } from '../types/section';

/** 切片的展示名，用于差异清单 */
export function sectionRefLabel(s: ThinSection): string {
  return `${s.sectionNo}（${s.thickness}μm · ${PREPARATION_LABELS[s.preparation]}）`;
}

/** 检测记录的展示名 */
export function analysisRefLabel(a: AnalysisRecord): string {
  return `${ANALYSIS_METHOD_LABELS[a.method]} · ${a.testedAt}（Fa ${a.fa} / Fs ${a.fs} / Ni ${a.ni}）`;
}

/** 切片可比对字段：除 id / sampleId / createdAt 外的业务属性 */
function sectionFingerprint(s: ThinSection): string {
  return JSON.stringify({
    sectionNo: s.sectionNo,
    thickness: s.thickness,
    preparation: s.preparation,
    minerals: s.minerals,
    micrographs: s.micrographs,
    quality: s.quality,
  });
}

/** 检测记录可比对字段 */
function analysisFingerprint(a: AnalysisRecord): string {
  return JSON.stringify({
    target: a.target,
    sectionId: a.sectionId ?? null,
    method: a.method,
    fa: a.fa,
    fs: a.fs,
    ni: a.ni,
    kamaciteBandwidth: a.kamaciteBandwidth,
    testedAt: a.testedAt,
  });
}

/**
 * 归还核对：把借出前快照与当前切片/检测现状逐项比对。
 * - 切片数量变化（新增 / 缺失）必然冲突；
 * - 数量不变但业务字段被修改（厚度、矿物占比、质量标注等）同样提示冲突；
 * - 检测记录的新增、缺失或数值被修改同样计入冲突。
 */
export function buildLoanDiff(
  snapshot: LoanSnapshot,
  currentSections: ThinSection[],
  currentAnalysis: AnalysisRecord[],
): LoanDiff {
  const entries: LoanDiffEntry[] = [];

  const beforeSections = new Map(snapshot.sections.map((s) => [s.id, s]));
  const afterSections = new Map(currentSections.map((s) => [s.id, s]));

  for (const [id, now] of afterSections) {
    const before = beforeSections.get(id);
    if (!before) {
      entries.push({
        kind: 'section',
        refId: id,
        refLabel: sectionRefLabel(now),
        change: 'added',
        detail: '借出期间新增的切片，不在随样清单内',
      });
    } else if (sectionFingerprint(before) !== sectionFingerprint(now)) {
      entries.push({
        kind: 'section',
        refId: id,
        refLabel: now.sectionNo,
        change: 'modified',
        detail: `借出前矿物占比合计 ${mineralTotal(before.minerals)}%、厚度 ${before.thickness}μm；` +
          `归还时合计 ${mineralTotal(now.minerals)}%、厚度 ${now.thickness}μm`,
      });
    }
  }
  for (const [id, before] of beforeSections) {
    if (!afterSections.has(id)) {
      entries.push({
        kind: 'section',
        refId: id,
        refLabel: sectionRefLabel(before),
        change: 'removed',
        detail: '借出前随样的切片已缺失',
      });
    }
  }

  const beforeAnalysis = new Map(snapshot.analysis.map((a) => [a.id, a]));
  const afterAnalysis = new Map(currentAnalysis.map((a) => [a.id, a]));

  for (const [id, now] of afterAnalysis) {
    const before = beforeAnalysis.get(id);
    if (!before) {
      entries.push({
        kind: 'analysis',
        refId: id,
        refLabel: analysisRefLabel(now),
        change: 'added',
        detail: '借出期间新录入的检测记录',
      });
    } else if (analysisFingerprint(before) !== analysisFingerprint(now)) {
      entries.push({
        kind: 'analysis',
        refId: id,
        refLabel: `${ANALYSIS_METHOD_LABELS[now.method]} · ${now.testedAt}`,
        change: 'modified',
        detail: `借出前 Fa ${before.fa} / Fs ${before.fs} / Ni ${before.ni}；` +
          `归还时 Fa ${now.fa} / Fs ${now.fs} / Ni ${now.ni}`,
      });
    }
  }
  for (const [id, before] of beforeAnalysis) {
    if (!afterAnalysis.has(id)) {
      entries.push({
        kind: 'analysis',
        refId: id,
        refLabel: analysisRefLabel(before),
        change: 'removed',
        detail: '借出前的检测记录已被删除',
      });
    }
  }

  return {
    entries,
    sectionCountBefore: snapshot.sections.length,
    sectionCountAfter: currentSections.length,
    analysisCountBefore: snapshot.analysis.length,
    analysisCountAfter: currentAnalysis.length,
    hasConflict: entries.length > 0,
  };
}
