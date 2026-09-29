import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Link as RouterLink } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import { DiffView } from '../components/loan/LoanPanel';
import { useSampleStore } from '../stores/sampleStore';
import {
  LOAN_STATUS_LABELS,
  isLoanOpen,
  isLoanOverdue,
  overdueDays,
  type LoanRecord,
  type LoanStatus,
} from '../types/loan';

type TabKey = 'open' | 'overdue' | 'legacy' | 'returned' | 'all';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'open', label: '外借中' },
  { key: 'overdue', label: '超期催还' },
  { key: 'legacy', label: '旧册待补全' },
  { key: 'returned', label: '已归还历史' },
  { key: 'all', label: '全部台账' },
];

/** `/loans` 借出/归还/审计台账总览 */
export default function Loans() {
  const loans = useSampleStore((s) => s.loans);
  const samples = useSampleStore((s) => s.samples);
  const sections = useSampleStore((s) => s.sections);
  const [tab, setTab] = useState<TabKey>('open');
  const [keyword, setKeyword] = useState('');

  const sampleMap = useMemo(() => new Map(samples.map((s) => [s.id, s])), [samples]);
  const sectionLabel = useMemo(() => new Map(sections.map((s) => [s.id, s.sectionNo])), [sections]);

  const overdueLoans = useMemo(
    () => loans.filter((l) => isLoanOverdue(l)).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1)),
    [loans],
  );

  const counts = useMemo(
    () => ({
      open: loans.filter((l) => l.status === 'active').length,
      overdue: overdueLoans.length,
      legacy: loans.filter((l) => l.status === 'legacy').length,
      returned: loans.filter((l) => l.status === 'returned').length,
      all: loans.length,
    }),
    [loans, overdueLoans],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const matchKw = (l: LoanRecord) => {
      if (!kw) return true;
      const sampleNo = sampleMap.get(l.sampleId)?.sampleNo ?? '（样本已清理）';
      return `${sampleNo} ${l.borrower ?? ''} ${l.note ?? ''}`.toLowerCase().includes(kw);
    };
    const list = loans.filter((l) => {
      switch (tab) {
        case 'open':
          return l.status === 'active';
        case 'overdue':
          return isLoanOverdue(l);
        case 'legacy':
          return l.status === 'legacy';
        case 'returned':
          return l.status === 'returned';
        default:
          return true;
      }
    }).filter(matchKw);
    return list.sort((a, b) => {
      // 未关闭优先、超期优先，再按借出日期倒序
      const openRank = Number(isLoanOpen(b)) - Number(isLoanOpen(a));
      if (openRank !== 0) return openRank;
      return (b.loanDate ?? '').localeCompare(a.loanDate ?? '') || b.createdAt - a.createdAt;
    });
  }, [loans, tab, keyword, sampleMap]);

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4">借阅台账</Typography>
        <Typography variant="body2" color="text.secondary">
          借出登记、归还核对与审计串成一条台账：借出前快照永久留档，冲突核对后才关闭借阅；已归还历史即使样本清理也保留。
        </Typography>
      </Box>

      {overdueLoans.length > 0 ? (
        <Alert
          severity="error"
          icon={<WarningAmberIcon fontSize="inherit" />}
          sx={{ '& .MuiAlert-message': { width: '100%' } }}
        >
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            超期档案 · {overdueLoans.length} 份外借样本已过应还日期
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {overdueLoans.map((l) => {
              const no = sampleMap.get(l.sampleId)?.sampleNo ?? '（样本已清理）';
              return (
                <Chip
                  key={l.id}
                  size="small"
                  color="error"
                  variant="outlined"
                  component={RouterLink}
                  to={`/samples/${l.sampleId}`}
                  clickable
                  label={`${no} · ${l.borrower ?? '借用人未登记'} · 超期 ${overdueDays(l)} 天`}
                  sx={{ color: 'error.main' }}
                />
              );
            })}
          </Stack>
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Tabs value={tab} onChange={(_, v) => setTab(v as TabKey)} variant="scrollable">
            {TABS.map((t) => (
              <Tab
                key={t.key}
                value={t.key}
                label={`${t.label} (${counts[t.key]})`}
                id={`loan-tab-${t.key}`}
              />
            ))}
          </Tabs>
          <Box sx={{ flex: 1 }} />
          <TextField
            id="loan-keyword"
            size="small"
            label="编号 / 借用人关键词"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            sx={{ width: 230 }}
          />
        </Stack>
      </Paper>

      {filtered.length === 0 ? (
        <EmptyState
          title="该分类下暂无借阅记录"
          description="可在样本详情页登记借出；旧册里只有“外借中”标记的样本会出现在“旧册待补全”中。"
          actionLabel="去样本总览"
          actionTo="/"
        />
      ) : (
        <Grid container spacing={2}>
          {filtered.map((loan) => (
            <Grid item xs={12} md={6} key={loan.id}>
              <LoanLedgerCard loan={loan} sampleNo={sampleMap.get(loan.sampleId)?.sampleNo} sectionLabel={sectionLabel} />
            </Grid>
          ))}
        </Grid>
      )}
    </Stack>
  );
}

const STATUS_CHIP: Record<LoanStatus, { color: 'default' | 'primary' | 'success' | 'warning'; label: string }> = {
  active: { color: 'primary', label: LOAN_STATUS_LABELS.active },
  returned: { color: 'success', label: LOAN_STATUS_LABELS.returned },
  legacy: { color: 'warning', label: LOAN_STATUS_LABELS.legacy },
};

function LoanLedgerCard({
  loan,
  sampleNo,
  sectionLabel,
}: {
  loan: LoanRecord;
  sampleNo?: string;
  sectionLabel: Map<string, string>;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const overdue = isLoanOverdue(loan);
  const chip = STATUS_CHIP[loan.status];
  const sampleExists = !!sampleNo;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: '100%',
        borderColor: overdue ? 'error.main' : 'divider',
        borderWidth: overdue ? 2 : 1,
      }}
    >
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {sampleExists ? (
            <Typography
              component={RouterLink}
              to={`/samples/${loan.sampleId}`}
              variant="h6"
              sx={{ color: 'primary.main', textDecoration: 'none' }}
            >
              {sampleNo} ↗
            </Typography>
          ) : (
            <Typography variant="h6" color="text.secondary">
              （样本已清理）
            </Typography>
          )}
          <Chip size="small" color={chip.color} label={chip.label} />
          {overdue ? (
            <Chip size="small" color="error" label={`超期 ${overdueDays(loan)} 天`} sx={{ fontWeight: 700 }} />
          ) : null}
          {!sampleExists && loan.status === 'returned' ? (
            <Chip size="small" variant="outlined" label="历史留档" />
          ) : null}
        </Stack>

        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Chip size="small" variant="outlined" label={`借用人：${loan.borrower || '未登记'}`} />
          <Chip size="small" variant="outlined" label={`借出：${loan.loanDate ?? '未登记'}`} />
          <Chip
            size="small"
            variant="outlined"
            color={overdue ? 'error' : 'default'}
            label={`应还：${loan.dueDate ?? '未登记'}`}
          />
          {loan.returnedAt ? (
            <Chip size="small" color="success" variant="outlined" label={`归还：${loan.returnedAt}`} />
          ) : null}
        </Stack>

        <Typography variant="body2" color="text.secondary">
          随样切片 {loan.sectionIds.length} 张
          {loan.sectionIds.length
            ? `：${loan.sectionIds.map((id) => sectionLabel.get(id) ?? id).join('、')}`
            : ''}
          ；借出前快照：切片 {loan.snapshot.sections.length} 张、检测记录{' '}
          {loan.snapshot.analysis.length} 条
        </Typography>

        {loan.status === 'legacy' || loan.note ? (
          <Typography variant="caption" color="warning.main">
            {loan.note}
          </Typography>
        ) : null}

        {loan.closeDiff ? (
          <Stack spacing={1}>
            <Chip
              size="small"
              color={loan.closeDiff.hasConflict ? 'warning' : 'success'}
              variant="outlined"
              sx={{ alignSelf: 'flex-start' }}
              label={
                loan.closeDiff.hasConflict
                  ? `带 ${loan.closeDiff.entries.length} 处差异核对后归还`
                  : '归还核对无差异'
              }
            />
            <Button size="small" variant="text" sx={{ alignSelf: 'flex-start' }} onClick={() => setShowDiff((v) => !v)}>
              {showDiff ? '收起差异明细' : '查看归还核对明细'}
            </Button>
            {showDiff ? <DiffView diff={loan.closeDiff} /> : null}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}
