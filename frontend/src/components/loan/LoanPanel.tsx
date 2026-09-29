import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import { LoanActionError, useSampleStore } from '../../stores/sampleStore';
import { useToastStore } from '../../stores/uiStore';
import {
  LOAN_STATUS_LABELS,
  isLoanOpen,
  isLoanOverdue,
  overdueDays,
  todayString,
  type LoanDiff,
  type LoanRecord,
} from '../../types/loan';
import { PREPARATION_LABELS } from '../../types/section';

/** 两周后的默认应还日期 */
function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface LoanPanelProps {
  sampleId: string;
}

/** 样本详情页的借阅台账面板：借出、旧册补全、归还核对、历史留档 */
export default function LoanPanel({ sampleId }: LoanPanelProps) {
  const loans = useSampleStore((s) => s.loans);
  const sections = useSampleStore((s) => s.sections);
  const samples = useSampleStore((s) => s.samples);
  const loanOut = useSampleStore((s) => s.loanOut);
  const completeLegacy = useSampleStore((s) => s.completeLegacy);
  const previewReturn = useSampleStore((s) => s.previewReturn);
  const returnLoan = useSampleStore((s) => s.returnLoan);
  const notify = useToastStore((s) => s.notify);

  const sample = samples.find((s) => s.id === sampleId);
  const mySections = useMemo(() => sections.filter((s) => s.sampleId === sampleId), [sections, sampleId]);
  const myLoans = useMemo(
    () =>
      loans
        .filter((l) => l.sampleId === sampleId)
        .sort((a, b) => (b.loanDate ?? '').localeCompare(a.loanDate ?? '') || b.createdAt - a.createdAt),
    [loans, sampleId],
  );
  const openLoan = myLoans.find(isLoanOpen);
  const history = myLoans.filter((l) => l.status === 'returned');

  // 借出登记表单
  const [outForm, setOutForm] = useState({
    borrower: '',
    loanDate: todayString(),
    dueDate: defaultDueDate(),
    sectionIds: [] as string[],
  });
  const [submittingOut, setSubmittingOut] = useState(false);

  // 旧册补全表单
  const [legacyForm, setLegacyForm] = useState({
    borrower: '',
    loanDate: todayString(),
    dueDate: defaultDueDate(),
    sectionIds: openLoan?.sectionIds ?? [],
  });
  const [submittingLegacy, setSubmittingLegacy] = useState(false);

  // 归还核对
  const [returnedAt, setReturnedAt] = useState(todayString());
  const [diff, setDiff] = useState<LoanDiff | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const submittingReturnRef = useRef(false);
  const [submittingReturn, setSubmittingReturn] = useState(false);

  if (!sample) return null;

  const sectionLabel = (id: string) => {
    const s = sections.find((x) => x.id === id);
    return s ? `${s.sectionNo}（${s.thickness}μm · ${PREPARATION_LABELS[s.preparation]}）` : id;
  };

  const toggleSection = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const submitLoanOut = async () => {
    if (submittingOut) return;
    setSubmittingOut(true);
    try {
      await loanOut({
        sampleId,
        borrower: outForm.borrower,
        loanDate: outForm.loanDate,
        dueDate: outForm.dueDate,
        sectionIds: outForm.sectionIds,
      });
      notify('借出已登记，台账与切片库已同步');
      setOutForm({ borrower: '', loanDate: todayString(), dueDate: defaultDueDate(), sectionIds: [] });
      setDiff(null);
      setAcknowledged(false);
    } catch (err) {
      notify(err instanceof LoanActionError ? err.message : '借出登记失败', 'error');
    } finally {
      setSubmittingOut(false);
    }
  };

  const submitCompleteLegacy = async () => {
    if (!openLoan || submittingLegacy) return;
    setSubmittingLegacy(true);
    try {
      await completeLegacy(openLoan.id, {
        borrower: legacyForm.borrower,
        loanDate: legacyForm.loanDate,
        dueDate: legacyForm.dueDate,
        sectionIds: legacyForm.sectionIds,
      });
      notify('旧册记录已补全，可办理归还');
    } catch (err) {
      notify(err instanceof LoanActionError ? err.message : '补全失败', 'error');
    } finally {
      setSubmittingLegacy(false);
    }
  };

  const runPreview = () => {
    if (!openLoan) return;
    try {
      const d = previewReturn(openLoan.id);
      setDiff(d);
      setAcknowledged(false);
      if (d.hasConflict) {
        notify(`发现 ${d.entries.length} 处差异，请核对借出前快照`, 'warning');
      } else {
        notify('借出前快照与现状一致，无冲突');
      }
    } catch (err) {
      notify(err instanceof LoanActionError ? err.message : '归还核对失败', 'error');
    }
  };

  const submitReturn = async () => {
    if (!openLoan || submittingReturnRef.current) return; // 连续点击只落一条
    // 落库前以最新档案重算一次，防止预览之后切片/检测又发生变化
    let fresh: LoanDiff;
    try {
      fresh = previewReturn(openLoan.id);
    } catch (err) {
      notify(err instanceof LoanActionError ? err.message : '归还核对失败', 'error');
      return;
    }
    setDiff(fresh);
    if (fresh.hasConflict && !acknowledged) {
      notify('借出期间档案又有新差异，请重新核对并勾选确认', 'warning');
      return;
    }
    submittingReturnRef.current = true;
    setSubmittingReturn(true);
    try {
      await returnLoan(openLoan.id, {
        returnedAt,
        acknowledgedConflict: fresh.hasConflict && acknowledged,
      });
      notify('已归还并关闭借阅，差异与快照已留档');
      setDiff(null);
      setAcknowledged(false);
      setReturnedAt(todayString());
    } catch (err) {
      notify(err instanceof LoanActionError ? err.message : '归还失败', 'error');
    } finally {
      submittingReturnRef.current = false;
      setSubmittingReturn(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <SwapHorizIcon color="primary" />
        <Typography variant="h6">借阅台账</Typography>
        {openLoan ? (
          <Chip
            size="small"
            color={openLoan.status === 'legacy' ? 'warning' : 'primary'}
            label={LOAN_STATUS_LABELS[openLoan.status]}
            sx={{ ml: 'auto' }}
          />
        ) : (
          <Chip size="small" variant="outlined" label="在库可借" sx={{ ml: 'auto' }} />
        )}
      </Stack>

      {/* ===== 未关闭借阅：旧册补全 / 正常归还 ===== */}
      {openLoan ? (
        <Stack spacing={2}>
          <OpenLoanSummary loan={openLoan} sectionLabel={sectionLabel} />

          {openLoan.status === 'legacy' ? (
            <>
              <Alert severity="warning">
                这是升级前的旧册记录：只有“外借中”标记，缺借用人、借出日期与应还日期。请补全后再办理归还。
              </Alert>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField
                  id="legacy-borrower"
                  size="small"
                  label="借用人 / 机构"
                  value={legacyForm.borrower}
                  onChange={(e) => setLegacyForm((f) => ({ ...f, borrower: e.target.value }))}
                  sx={{ width: 220 }}
                />
                <TextField
                  id="legacy-loan-date"
                  size="small"
                  type="date"
                  label="借出日期"
                  InputLabelProps={{ shrink: true }}
                  value={legacyForm.loanDate}
                  onChange={(e) => setLegacyForm((f) => ({ ...f, loanDate: e.target.value }))}
                  sx={{ width: 170 }}
                />
                <TextField
                  id="legacy-due-date"
                  size="small"
                  type="date"
                  label="应还日期"
                  InputLabelProps={{ shrink: true }}
                  value={legacyForm.dueDate}
                  onChange={(e) => setLegacyForm((f) => ({ ...f, dueDate: e.target.value }))}
                  sx={{ width: 170 }}
                />
              </Stack>
              <SectionCheckboxes
                sections={mySections}
                selected={legacyForm.sectionIds}
                onToggle={(id) =>
                  setLegacyForm((f) => ({ ...f, sectionIds: toggleSection(f.sectionIds, id) }))
                }
              />
              <Button
                variant="contained"
                color="warning"
                onClick={() => void submitCompleteLegacy()}
                disabled={submittingLegacy}
                sx={{ alignSelf: 'flex-start' }}
              >
                补全并转为外借单
              </Button>
            </>
          ) : (
            <>
              <Divider textAlign="left">
                <Typography variant="caption">归还核对</Typography>
              </Divider>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <TextField
                  id="returned-at"
                  size="small"
                  type="date"
                  label="实际归还日期"
                  InputLabelProps={{ shrink: true }}
                  value={returnedAt}
                  onChange={(e) => setReturnedAt(e.target.value)}
                  sx={{ width: 170 }}
                />
                <Button variant="outlined" startIcon={<FactCheckIcon />} onClick={runPreview}>
                  核对借出前快照
                </Button>
              </Stack>

              {diff ? <DiffView diff={diff} /> : null}

              {diff?.hasConflict ? (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                      color="warning"
                    />
                  }
                  label="以上差异已逐条核对，确认现状无误并关闭借阅"
                />
              ) : null}

              <Button
                variant="contained"
                color="success"
                startIcon={<AssignmentReturnIcon />}
                onClick={() => void submitReturn()}
                disabled={submittingReturn || (diff?.hasConflict && !acknowledged)}
                sx={{ alignSelf: 'flex-start' }}
              >
                {submittingReturn ? '正在归还…' : '确认归还并关闭借阅'}
              </Button>
              {!diff ? (
                <Typography variant="caption" color="text.secondary">
                  建议先核对借出前快照：切片数量或检测记录有变化时会提示冲突，核对确认后才能归还。
                </Typography>
              ) : null}
            </>
          )}
        </Stack>
      ) : (
        /* ===== 在库：借出登记 ===== */
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <TextField
              id="loan-borrower"
              size="small"
              label="借用人 / 机构"
              value={outForm.borrower}
              onChange={(e) => setOutForm((f) => ({ ...f, borrower: e.target.value }))}
              sx={{ width: 220 }}
              required
            />
            <TextField
              id="loan-date"
              size="small"
              type="date"
              label="借出日期"
              InputLabelProps={{ shrink: true }}
              value={outForm.loanDate}
              onChange={(e) => setOutForm((f) => ({ ...f, loanDate: e.target.value }))}
              sx={{ width: 170 }}
              required
            />
            <TextField
              id="loan-due-date"
              size="small"
              type="date"
              label="应还日期"
              InputLabelProps={{ shrink: true }}
              value={outForm.dueDate}
              onChange={(e) => setOutForm((f) => ({ ...f, dueDate: e.target.value }))}
              sx={{ width: 170 }}
              required
            />
          </Stack>
          <SectionCheckboxes
            sections={mySections}
            selected={outForm.sectionIds}
            onToggle={(id) =>
              setOutForm((f) => ({ ...f, sectionIds: toggleSection(f.sectionIds, id) }))
            }
          />
          <Button
            variant="contained"
            startIcon={<SwapHorizIcon />}
            onClick={() => void submitLoanOut()}
            disabled={submittingOut}
            sx={{ alignSelf: 'flex-start' }}
          >
            登记借出
          </Button>
        </Stack>
      )}

      {/* ===== 已归还历史（样本清理后仍在台账页保留） ===== */}
      {history.length > 0 ? (
        <>
          <Divider sx={{ my: 2 }} textAlign="left">
            <Typography variant="caption">归还历史（{history.length}）</Typography>
          </Divider>
          <List dense disablePadding>
            {history.map((l) => (
              <ListItem
                key={l.id}
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 1 }}
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="subtitle2">{l.borrower ?? '—'}</Typography>
                      <Chip size="small" label="已归还" color="success" variant="outlined" />
                      {l.closeDiff?.hasConflict ? (
                        <Chip size="small" color="warning" label={`带 ${l.closeDiff.entries.length} 处差异归还`} />
                      ) : (
                        <Chip size="small" variant="outlined" label="核对无差异" />
                      )}
                    </Stack>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary" component="span">
                      借出 {l.loanDate} · 应还 {l.dueDate} · 实际归还 {l.returnedAt} · 随样切片{' '}
                      {l.snapshot.sections.length} 张 · 检测记录 {l.snapshot.analysis.length} 条
                    </Typography>
                  }
                />
              </ListItem>
            ))}
          </List>
        </>
      ) : null}
    </Paper>
  );
}

/** 未关闭借阅单摘要：借用人、日期、超期提示、随样切片与快照规模 */
function OpenLoanSummary({
  loan,
  sectionLabel,
}: {
  loan: LoanRecord;
  sectionLabel: (id: string) => string;
}) {
  const overdue = isLoanOverdue(loan);
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`借用人：${loan.borrower || '未登记'}`} />
          <Chip size="small" variant="outlined" label={`借出日期：${loan.loanDate ?? '未登记'}`} />
          <Chip size="small" variant="outlined" label={`应还日期：${loan.dueDate ?? '未登记'}`} />
          {overdue ? (
            <Chip
              size="small"
              color="error"
              label={`已超期 ${overdueDays(loan)} 天`}
              sx={{ fontWeight: 700 }}
            />
          ) : null}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          随样切片（{loan.sectionIds.length}）：
          {loan.sectionIds.length
            ? loan.sectionIds.map(sectionLabel).join('、')
            : '无'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          借出前快照含切片 {loan.snapshot.sections.length} 张、检测记录{' '}
          {loan.snapshot.analysis.length} 条，归还时逐项核对并永久留档。
        </Typography>
        {loan.note ? (
          <Typography variant="caption" color="warning.main">
            备注：{loan.note}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

/** 差异清单展示 */
export function DiffView({ diff }: { diff: LoanDiff }) {
  if (!diff.hasConflict) {
    return (
      <Alert severity="success">
        借出前快照与现状一致：切片 {diff.sectionCountBefore} 张、检测记录{' '}
        {diff.analysisCountBefore} 条，均无变化，可直接归还。
      </Alert>
    );
  }
  return (
    <Alert severity="warning" sx={{ alignItems: 'flex-start' }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        归还冲突：与借出前快照存在 {diff.entries.length} 处差异
      </Typography>
      <Typography variant="body2">
        切片 {diff.sectionCountBefore} → {diff.sectionCountAfter} 张；检测记录{' '}
        {diff.analysisCountBefore} → {diff.analysisCountAfter} 条。请逐条核对后勾选确认。
      </Typography>
      <List dense disablePadding sx={{ mt: 0.5 }}>
        {diff.entries.map((e, i) => (
          <ListItem key={`${e.kind}-${e.refId}-${i}`} sx={{ py: 0 }}>
            <ListItemText
              primary={
                <Typography variant="body2">
                  <Chip
                    size="small"
                    color={e.change === 'removed' ? 'error' : 'warning'}
                    label={
                      e.change === 'added' ? '新增' : e.change === 'removed' ? '缺失' : '被修改'
                    }
                    sx={{ mr: 1 }}
                  />
                  {e.kind === 'section' ? '切片' : '检测'} · {e.refLabel}
                </Typography>
              }
              secondary={e.detail}
            />
          </ListItem>
        ))}
      </List>
    </Alert>
  );
}

/** 随样切片勾选清单 */
function SectionCheckboxes({
  sections,
  selected,
  onToggle,
}: {
  sections: { id: string; sectionNo: string; thickness: number }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (sections.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        该样本暂无切片档案，本次外借不随样切片。
      </Typography>
    );
  }
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        随样切片（勾选借出的切片，切片库将同步显示外借状态）
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {sections.map((s) => (
          <FormControlLabel
            key={s.id}
            sx={{ mr: 0 }}
            control={
              <Checkbox
                size="small"
                checked={selected.includes(s.id)}
                onChange={() => onToggle(s.id)}
                inputProps={{ 'aria-label': `随样切片 ${s.sectionNo}` }}
              />
            }
            label={`${s.sectionNo}（${s.thickness}μm）`}
          />
        ))}
      </Stack>
    </Box>
  );
}
