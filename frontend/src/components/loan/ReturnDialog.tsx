import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useSampleStore } from '../../stores/sampleStore';
import { useToastStore } from '../../stores/uiStore';
import type { LoanRecord } from '../../types/loan';
import { diffAnalysis, diffSections } from '../../utils/loan';

interface ReturnDialogProps {
  open: boolean;
  loan?: LoanRecord;
  onClose: () => void;
  onReturned?: () => void;
}

/**
 * 归还确认弹窗：归还前若切片数量或检测记录已变化，提示冲突并保留借出前快照，
 * 核对差异后才关闭借阅。连续点击只落一条记录（store 幂等 + 按钮 busy 禁用）。
 */
export default function ReturnDialog({ open, loan, onClose, onReturned }: ReturnDialogProps) {
  const sections = useSampleStore((s) => s.sections);
  const analysis = useSampleStore((s) => s.analysis);
  const returnLoan = useSampleStore((s) => s.returnLoan);
  const notify = useToastStore((s) => s.notify);

  const [confirmed, setConfirmed] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmed(false);
      setReturnNote('');
      setError(null);
      setBusy(false);
    }
  }, [open, loan?.id]);

  const { sectionDiff, analysisDiff, hasConflict } = useMemo(() => {
    if (!loan) return { sectionDiff: null, analysisDiff: null, hasConflict: false };
    const curSections = sections.filter((s) => s.sampleId === loan.sampleId);
    const curAnalysis = analysis.filter((a) => a.sampleId === loan.sampleId);
    const sd = diffSections(loan.sectionsSnapshot, curSections);
    const ad = diffAnalysis(loan.analysisSnapshot, curAnalysis);
    return { sectionDiff: sd, analysisDiff: ad, hasConflict: sd.changed || ad.changed };
  }, [loan, sections, analysis]);

  const handleReturn = async () => {
    if (!loan) return;
    if (hasConflict && !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await returnLoan(loan.id, hasConflict, returnNote);
      if (res.conflict) {
        setError('核对后仍存在差异，请再次确认差异明细');
        setBusy(false);
        return;
      }
      notify(`已归还 ${loan.sampleNo}，借阅关闭`);
      onReturned?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '归还失败');
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>归还样本 · {loan?.sampleNo}</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        {hasConflict ? (
          <Stack spacing={1.5}>
            <Alert severity="warning">
              检测到借出后切片数量或检测记录已变化。已保留借出前快照，请核对差异后再关闭借阅。
            </Alert>
            {sectionDiff?.changed ? (
              <Box>
                <Typography variant="subtitle2">切片差异</Typography>
                <Typography variant="body2" color="text.secondary">
                  借出时 {sectionDiff.before} 张 → 现在 {sectionDiff.after} 张
                </Typography>
                {sectionDiff.added.length ? (
                  <Typography variant="body2" color="success.main">
                    新增：{sectionDiff.added.join('、')}
                  </Typography>
                ) : null}
                {sectionDiff.removed.length ? (
                  <Typography variant="body2" color="error">
                    减少：{sectionDiff.removed.join('、')}
                  </Typography>
                ) : null}
              </Box>
            ) : null}
            {analysisDiff?.changed ? (
              <Box>
                <Typography variant="subtitle2">检测记录差异</Typography>
                <Typography variant="body2" color="text.secondary">
                  借出前 {analysisDiff.before} 条 → 现在 {analysisDiff.after} 条
                </Typography>
                {analysisDiff.added.length ? (
                  <Typography variant="body2" color="success.main">
                    新增：{analysisDiff.added.join('、')}
                  </Typography>
                ) : null}
                {analysisDiff.removed.length ? (
                  <Typography variant="body2" color="error">
                    减少：{analysisDiff.removed.join('、')}
                  </Typography>
                ) : null}
              </Box>
            ) : null}
            <FormControlLabel
              control={
                <Checkbox
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
              }
              label="我已核对借出前快照与现状，确认归还并关闭借阅"
            />
          </Stack>
        ) : (
          <DialogContentText>
            借出期间切片与检测记录无变化。确认归还后将关闭本次借阅，样本恢复在库。
          </DialogContentText>
        )}
        <TextField
          size="small"
          label="归还备注（可选）"
          value={returnNote}
          onChange={(e) => setReturnNote(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button
          variant="contained"
          color={hasConflict ? 'warning' : 'primary'}
          onClick={handleReturn}
          disabled={busy || (hasConflict && !confirmed)}
        >
          {busy ? '归还中…' : '确认归还'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
