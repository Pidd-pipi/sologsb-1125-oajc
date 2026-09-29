import { useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Link as RouterLink } from 'react-router-dom';
import SampleCard from '../components/common/SampleCard';
import EmptyState from '../components/common/EmptyState';
import { useSampleFilter } from '../hooks/useSampleFilter';
import { useSampleStore } from '../stores/sampleStore';
import { useUiStore } from '../stores/uiStore';
import {
  CATEGORY_LABELS,
  CHEMICAL_GROUP_LABELS,
  SAMPLE_CATEGORIES,
  CHEMICAL_GROUPS,
} from '../types/sample';
import { isLoanOpen, isLoanOverdue, overdueDays } from '../types/loan';
import { formatWeight } from '../utils/format';

/** `/` 样本总览 */
export default function Overview() {
  const { results, total, activeCount } = useSampleFilter();
  const samples = useSampleStore((s) => s.samples);
  const finds = useSampleStore((s) => s.finds);
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);
  const loans = useSampleStore((s) => s.loans);

  const ui = useUiStore();

  const findBySample = useMemo(() => new Map(finds.map((f) => [f.sampleId, f])), [finds]);
  const sectionCount = useMemo(() => {
    const m = new Map<string, number>();
    sections.forEach((s) => m.set(s.sampleId, (m.get(s.sampleId) ?? 0) + 1));
    return m;
  }, [sections]);
  const analysisCount = useMemo(() => {
    const m = new Map<string, number>();
    analysis.forEach((a) => m.set(a.sampleId, (m.get(a.sampleId) ?? 0) + 1));
    return m;
  }, [analysis]);
  const activeLoanBySample = useMemo(() => {
    const m = new Map(loans.filter(isLoanOpen).map((l) => [l.sampleId, l]));
    return m;
  }, [loans]);

  const overdueLoans = useMemo(
    () => loans.filter((l) => isLoanOverdue(l)).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1)),
    [loans],
  );

  const totalWeight = results.reduce((n, s) => n + s.totalWeight, 0);

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="h4">样本总览</Typography>
          <Typography variant="body2" color="text.secondary">
            共 {total} 份样本，当前筛选命中 {results.length} 份，合计 {formatWeight(totalWeight)}
          </Typography>
        </Box>
        <Button component={RouterLink} to="/samples/new" variant="contained" startIcon={<AddIcon />}>
          登记新样本
        </Button>
      </Stack>

      {overdueLoans.length > 0 ? (
        <Alert
          severity="error"
          icon={<WarningAmberIcon fontSize="inherit" />}
          sx={{ alignItems: 'center' }}
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2">
              超期提醒：{overdueLoans.length} 份外借样本已过应还日期
            </Typography>
            {overdueLoans.map((l) => {
              const no = samples.find((s) => s.id === l.sampleId)?.sampleNo ?? l.sampleId;
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
            <Button
              size="small"
              color="error"
              component={RouterLink}
              to="/loans"
              sx={{ textDecoration: 'underline' }}
            >
              前往借阅台账催还
            </Button>
          </Stack>
        </Alert>
      ) : null}

      <Box
        sx={{
          p: 2,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2.5,
          bgcolor: 'background.paper',
        }}
      >
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" sx={{ width: 72 }}>
              分类
            </Typography>
            {SAMPLE_CATEGORIES.map((c) => {
              const active = ui.categories.includes(c);
              return (
                <Chip
                  key={c}
                  label={CATEGORY_LABELS[c]}
                  color={active ? 'primary' : 'default'}
                  variant={active ? 'filled' : 'outlined'}
                  onClick={() =>
                    ui.setCategories(
                      active ? ui.categories.filter((x) => x !== c) : [...ui.categories, c],
                    )
                  }
                />
              );
            })}
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" sx={{ width: 72 }}>
              化学群
            </Typography>
            {CHEMICAL_GROUPS.map((g) => {
              const active = ui.groups.includes(g);
              return (
                <Chip
                  key={g}
                  label={CHEMICAL_GROUP_LABELS[g]}
                  color={active ? 'secondary' : 'default'}
                  variant={active ? 'filled' : 'outlined'}
                  onClick={() =>
                    ui.setGroups(active ? ui.groups.filter((x) => x !== g) : [...ui.groups, g])
                  }
                />
              );
            })}
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" sx={{ width: 72 }}>
              重量区间
            </Typography>
            <TextField
              id="filter-min-weight"
              size="small"
              type="number"
              label="最小 g"
              value={ui.minWeight ?? ''}
              onChange={(e) =>
                ui.setWeightRange(e.target.value === '' ? null : Number(e.target.value), ui.maxWeight)
              }
              sx={{ width: 130 }}
            />
            <Typography variant="body2">~</Typography>
            <TextField
              id="filter-max-weight"
              size="small"
              type="number"
              label="最大 g"
              value={ui.maxWeight ?? ''}
              onChange={(e) =>
                ui.setWeightRange(ui.minWeight, e.target.value === '' ? null : Number(e.target.value))
              }
              sx={{ width: 130 }}
            />
            <TextField
              id="filter-keyword"
              size="small"
              label="编号 / 备注关键词"
              value={ui.keyword}
              onChange={(e) => ui.setKeyword(e.target.value)}
              sx={{ width: 220 }}
            />
            <FormControl size="small" sx={{ width: 160 }}>
              <InputLabel id="sort-label">排序</InputLabel>
              <Select
                labelId="sort-label"
                label="排序"
                value={ui.sort}
                onChange={(e) => ui.setSort(e.target.value as typeof ui.sort)}
              >
                <MenuItem value="createdAt">按登记时间</MenuItem>
                <MenuItem value="totalWeight">按总重量</MenuItem>
                <MenuItem value="sampleNo">按样本编号</MenuItem>
              </Select>
            </FormControl>
            <Button variant="text" onClick={ui.reset} disabled={activeCount === 0}>
              清空筛选
            </Button>
            <Chip size="small" label={`生效条件 ${activeCount}`} variant="outlined" />
          </Stack>
        </Stack>
      </Box>

      {results.length === 0 ? (
        <EmptyState
          title={samples.length === 0 ? '还没有任何样本档案' : '没有符合筛选条件的样本'}
          description={
            samples.length === 0
              ? '先登记一份陨石样本，再补录发现地坐标与切片制样信息。'
              : '试着放宽分类、化学群或重量区间条件。'
          }
          actionLabel={samples.length === 0 ? '登记第一份样本' : '清空筛选条件'}
          actionTo={samples.length === 0 ? '/samples/new' : undefined}
          onAction={samples.length === 0 ? undefined : ui.reset}
        />
      ) : (
        <Grid container spacing={2}>
          {results.map((s) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={s.id}>
              <SampleCard
                sample={s}
                find={findBySample.get(s.id)}
                sectionCount={sectionCount.get(s.id) ?? 0}
                analysisCount={analysisCount.get(s.id) ?? 0}
                activeLoan={activeLoanBySample.get(s.id)}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
