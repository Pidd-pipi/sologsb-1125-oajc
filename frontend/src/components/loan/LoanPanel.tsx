import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { useSampleStore } from '../../stores/sampleStore';
import { useToastStore } from '../../stores/uiStore';
import type { MeteoriteSample } from '../../types/sample';
import { daysUntilDue, isIncomplete, isOverdue } from '../../utils/loan';
import { formatDate } from '../../utils/format';
import ReturnDialog from './ReturnDialog';

interface LoanPanelProps {
  sample: MeteoriteSample;
}

/** 样本详情侧的借阅状态面板：外借信息、归还、旧册补全 */
export default function LoanPanel({ sample }: LoanPanelProps) {
  const loans = useSampleStore((s) => s.loans);
  const completeLegacyLoan = useSampleStore((s) => s.completeLegacyLoan);
  const notify = useToastStore((s) => s.notify);

  const [returnOpen, setReturnOpen] = useState(false);
  const [completeDraft, setCompleteDraft] = useState({ borrower: '', dueDate: '' });
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loan = useMemo(
    () => loans.find((l) => l.sampleId === sample.id && l.status === 'open'),
    [loans, sample.id],
  );
  const incomplete = loan ? isIncomplete(loan) : false;
  const overdue = loan ? isOverdue(loan) : false;
  const days = loan ? daysUntilDue(loan) : null;

  const submitComplete = async () => {
    if (!loan) return;
    if (!completeDraft.borrower.trim()) {
      setCompleteError('请填写借用人');
      return;
    }
    if (!completeDraft.dueDate) {
      setCompleteError('请选择应还日期');
      return;
    }
    setBusy(true);
    setCompleteError(null);
    try {
      await completeLegacyLoan(loan.id, {
        borrower: completeDraft.borrower,
        dueDate: completeDraft.dueDate,
      });
      notify('借阅信息已补全');
      setCompleteDraft({ borrower: '', dueDate: '' });
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : '补全失败');
    } finally {
      setBusy(false);
    }
  };

  if (!loan) {
    return (
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={1.5} alignItems="flex-start">
          <Typography variant="h6">借阅状态</Typography>
          <Typography variant="body2" color="text.secondary">
            该样本目前在库，可登记借出。
          </Typography>
          <Button
            component={RouterLink}
            to={`/loans?sampleId=${sample.id}&lend=1`}
            variant="contained"
            startIcon={<EditNoteIcon />}
          >
            借出登记
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Typography variant="h6">外借中</Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Chip size="small" color="secondary" label="外借中" />
            {incomplete ? <Chip size="small" color="warning" label="待补全" /> : null}
            {overdue ? <Chip size="small" color="error" label="已超期" /> : null}
            {loan.dueDate && days !== null ? (
              <Chip
                size="small"
                variant="outlined"
                color={days < 0 ? 'error' : 'default'}
                label={days < 0 ? `超期 ${-days} 天` : `距应还 ${days} 天`}
              />
            ) : null}
          </Stack>
        </Stack>

        {incomplete ? (
          <Alert severity="warning">
            旧册遗留：该样本标着外借中，却缺借阅人与应还日期，请补全后再归还。
          </Alert>
        ) : null}

        <Grid container spacing={1.5}>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">
              借用人
            </Typography>
            <Typography variant="body1">{loan.borrower || '—（待补全）'}</Typography>
          </Grid>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">
              借出日期
            </Typography>
            <Typography variant="body1">{formatDate(loan.loanedAt)}</Typography>
          </Grid>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">
              应还日期
            </Typography>
            <Typography variant="body1">
              {loan.dueDate ? formatDate(loan.dueDate) : '—（待补全）'}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">
              随样切片
            </Typography>
            <Typography variant="body1">{loan.sectionsSnapshot.length} 张</Typography>
          </Grid>
          <Grid item xs={6} sm={4}>
            <Typography variant="caption" color="text.secondary">
              借出前检测
            </Typography>
            <Typography variant="body1">{loan.analysisSnapshot.length} 条</Typography>
          </Grid>
        </Grid>

        {incomplete ? (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <Typography variant="subtitle2">补全借阅信息</Typography>
            {completeError ? <Alert severity="error">{completeError}</Alert> : null}
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <TextField
                size="small"
                label="借用人"
                value={completeDraft.borrower}
                onChange={(e) =>
                  setCompleteDraft((d) => ({ ...d, borrower: e.target.value }))
                }
                sx={{ width: 180 }}
              />
              <TextField
                size="small"
                type="date"
                label="应还日期"
                InputLabelProps={{ shrink: true }}
                value={completeDraft.dueDate}
                onChange={(e) => setCompleteDraft((d) => ({ ...d, dueDate: e.target.value }))}
                sx={{ width: 180 }}
              />
              <Button variant="contained" onClick={submitComplete} disabled={busy}>
                保存补全
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Box>
            <Button
              variant="contained"
              color={overdue ? 'error' : 'primary'}
              startIcon={<AssignmentReturnIcon />}
              onClick={() => setReturnOpen(true)}
            >
              归还样本
            </Button>
          </Box>
        )}
      </Stack>

      <ReturnDialog open={returnOpen} loan={loan} onClose={() => setReturnOpen(false)} />
    </Paper>
  );
}
