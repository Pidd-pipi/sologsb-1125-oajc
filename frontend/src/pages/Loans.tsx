import { useEffect, useMemo, useState } from 'react';
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
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import LendDialog from '../components/loan/LendDialog';
import ReturnDialog from '../components/loan/ReturnDialog';
import { useSampleStore } from '../stores/sampleStore';
import {
  daysUntilDue,
  isIncomplete,
  isOverdue,
} from '../utils/loan';
import { formatDate } from '../utils/format';
import {
  ANALYSIS_METHOD_LABELS,
} from '../types/analysis';
import {
  PREPARATION_LABELS,
  SECTION_QUALITY_LABELS,
} from '../types/section';

type FilterKey = 'all' | 'open' | 'returned' | 'overdue' | 'incomplete';

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '外借中' },
  { key: 'overdue', label: '超期' },
  { key: 'incomplete', label: '待补全' },
  { key: 'returned', label: '已归还' },
];

/** `/loans` 借阅台账：借出、归还、审计一条台账 */
export default function Loans() {
  const loans = useSampleStore((s) => s.loans);
  const samples = useSampleStore((s) => s.samples);
  const [searchParams, setSearchParams] = useSearchParams();

  const [filter, setFilter] = useState<FilterKey>('all');
  const [lendOpen, setLendOpen] = useState(false);
  const [returnLoan, setReturnLoan] = useState<(typeof loans)[number] | undefined>(undefined);

  const defaultSampleId = searchParams.get('sampleId') ?? undefined;

  useEffect(() => {
    if (searchParams.get('lend') === '1') {
      setLendOpen(true);
    }
  }, [searchParams]);

  const openLend = () => {
    setLendOpen(true);
    setSearchParams({}, { replace: true });
  };

  const closeLend = () => {
    setLendOpen(false);
    setSearchParams({}, { replace: true });
  };

  const sampleMap = useMemo(
    () => new Map(samples.map((s) => [s.id, s])),
    [samples],
  );

  const stats = useMemo(() => {
    const open = loans.filter((l) => l.status === 'open').length;
    const returned = loans.filter((l) => l.status === 'returned').length;
    const overdue = loans.filter((l) => isOverdue(l)).length;
    const incomplete = loans.filter((l) => isIncomplete(l)).length;
    return { open, returned, overdue, incomplete, total: loans.length };
  }, [loans]);

  const filtered = useMemo(() => {
    const list = loans.filter((l) => {
      switch (filter) {
        case 'open':
          return l.status === 'open';
        case 'returned':
          return l.status === 'returned';
        case 'overdue':
          return isOverdue(l);
        case 'incomplete':
          return isIncomplete(l);
        default:
          return true;
      }
    });
    return list;
  }, [loans, filter]);

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="h4">借阅台账</Typography>
          <Typography variant="body2" color="text.secondary">
            借出、归还与审计一条台账。外借 {stats.open} · 已归还 {stats.returned} · 超期 {stats.overdue} · 待补全 {stats.incomplete}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openLend}>
          借出登记
        </Button>
      </Stack>

      {stats.incomplete > 0 ? (
        <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => setFilter('incomplete')}>去补全</Button>}>
          有 {stats.incomplete} 份外借档案缺少借阅人或应还日期（旧册遗留），补全后追责链路才完整。
        </Alert>
      ) : null}
      {stats.overdue > 0 ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setFilter('overdue')}>去催还</Button>}>
          有 {stats.overdue} 份外借档案已超期，请联系借用人归还。
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Tabs
          value={filter}
          onChange={(_, v) => setFilter(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {FILTER_TABS.map((t) => (
            <Tab key={t.key} value={t.key} label={t.label} />
          ))}
        </Tabs>
      </Paper>

      {filtered.length === 0 ? (
        <EmptyState
          title={loans.length === 0 ? '还没有借阅记录' : '当前筛选下没有借阅记录'}
          description={
            loans.length === 0
              ? '点击「借出登记」登记第一笔外借，或在样本详情页登记借出。'
              : '试着切换到其他筛选标签。'
          }
          actionLabel={loans.length === 0 ? '借出登记' : undefined}
          onAction={loans.length === 0 ? openLend : undefined}
        />
      ) : (
        <Grid container spacing={2}>
          {filtered.map((loan) => {
            const sample = sampleMap.get(loan.sampleId);
            const overdue = isOverdue(loan);
            const incomplete = isIncomplete(loan);
            const days = daysUntilDue(loan);
            return (
              <Grid item xs={12} md={6} key={loan.id}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    height: '100%',
                    borderColor: overdue ? 'error.main' : incomplete ? 'warning.main' : 'divider',
                    borderWidth: overdue || incomplete ? 1.5 : 1,
                  }}
                >
                  <Stack spacing={1.25}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
                      <Box>
                        <Typography variant="h6" fontWeight={700}>
                          {loan.sampleNo}
                        </Typography>
                        {sample ? (
                          <Typography
                            component={RouterLink}
                            to={`/samples/${sample.id}`}
                            variant="caption"
                            sx={{ color: 'primary.main', textDecoration: 'none' }}
                          >
                            查看样本详情 ↗
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            样本已清理（台账保留用于审计）
                          </Typography>
                        )}
                      </Box>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <Chip
                          size="small"
                          color={loan.status === 'open' ? 'secondary' : 'default'}
                          label={loan.status === 'open' ? '外借中' : '已归还'}
                        />
                        {incomplete ? <Chip size="small" color="warning" label="待补全" /> : null}
                        {overdue ? <Chip size="small" color="error" label="已超期" /> : null}
                        {loan.legacy ? <Chip size="small" variant="outlined" label="旧册补全" /> : null}
                      </Stack>
                    </Stack>

                    <Grid container spacing={1}>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">借用人</Typography>
                        <Typography variant="body2">{loan.borrower || '—（待补全）'}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">借出日期</Typography>
                        <Typography variant="body2">{formatDate(loan.loanedAt)}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">应还日期</Typography>
                        <Typography variant="body2">
                          {loan.dueDate ? formatDate(loan.dueDate) : '—（待补全）'}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">归还日期</Typography>
                        <Typography variant="body2">
                          {loan.returnedAt ? formatDate(loan.returnedAt) : '—'}
                        </Typography>
                      </Grid>
                    </Grid>

                    {loan.status === 'open' && days !== null ? (
                      <Typography variant="caption" color={days < 0 ? 'error.main' : 'text.secondary'}>
                        {days < 0 ? `已超期 ${-days} 天，请催还` : `距应还还有 ${days} 天`}
                      </Typography>
                    ) : null}

                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        随样切片（{loan.sectionsSnapshot.length}）：
                      </Typography>
                      {loan.sectionsSnapshot.length ? (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                          {loan.sectionsSnapshot.map((s) => (
                            <Chip
                              key={s.sectionId}
                              size="small"
                              variant="outlined"
                              label={`${s.sectionNo} · ${PREPARATION_LABELS[s.preparation]} · ${SECTION_QUALITY_LABELS[s.quality].split('（')[0]}`}
                            />
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary"> 无</Typography>
                      )}
                    </Box>

                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        借出前检测快照（{loan.analysisSnapshot.length}）：
                      </Typography>
                      {loan.analysisSnapshot.length ? (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                          {loan.analysisSnapshot.map((a) => (
                            <Chip
                              key={a.analysisId}
                              size="small"
                              variant="outlined"
                              label={`${ANALYSIS_METHOD_LABELS[a.method]} · ${a.testedAt} · Fa ${a.fa}`}
                            />
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary"> 无</Typography>
                      )}
                    </Box>

                    {loan.returnNote ? (
                      <Typography variant="caption" color="text.secondary">
                        归还备注：{loan.returnNote}
                      </Typography>
                    ) : null}

                    {loan.status === 'open' ? (
                      <Box>
                        <Button
                          size="small"
                          variant="contained"
                          color={overdue ? 'error' : 'primary'}
                          onClick={() => setReturnLoan(loan)}
                          disabled={incomplete}
                        >
                          归还
                        </Button>
                        {incomplete ? (
                          <Typography variant="caption" color="warning.main" sx={{ ml: 1 }}>
                            请先补全借阅信息
                          </Typography>
                        ) : null}
                      </Box>
                    ) : null}
                  </Stack>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}

      <LendDialog
        open={lendOpen}
        defaultSampleId={defaultSampleId}
        onClose={closeLend}
      />
      <ReturnDialog
        open={Boolean(returnLoan)}
        loan={returnLoan}
        onClose={() => setReturnLoan(undefined)}
      />
    </Stack>
  );
}
