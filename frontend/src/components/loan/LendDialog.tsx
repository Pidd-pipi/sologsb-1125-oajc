import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useSampleStore } from '../../stores/sampleStore';
import { useToastStore } from '../../stores/uiStore';
import { todayStr } from '../../utils/loan';

interface LendDialogProps {
  open: boolean;
  /** 预设样本 id（从详情页带 sampleId 跳转时） */
  defaultSampleId?: string;
  onClose: () => void;
  onLent?: () => void;
}

/** 借出登记弹窗：登记借用人、日期与随样切片，详情/总览/切片库同步显示 */
export default function LendDialog({ open, defaultSampleId, onClose, onLent }: LendDialogProps) {
  const samples = useSampleStore((s) => s.samples);
  const sections = useSampleStore((s) => s.sections);
  const lendSample = useSampleStore((s) => s.lendSample);
  const notify = useToastStore((s) => s.notify);

  const [sampleId, setSampleId] = useState('');
  const [borrower, setBorrower] = useState('');
  const [loanedAt, setLoanedAt] = useState(todayStr());
  const [dueDate, setDueDate] = useState('');
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const availableSamples = useMemo(
    () => samples.filter((s) => s.storage !== 'loan-out'),
    [samples],
  );
  const sampleSections = useMemo(
    () => sections.filter((s) => s.sampleId === sampleId),
    [sections, sampleId],
  );

  useEffect(() => {
    if (open) {
      const sid =
        defaultSampleId && availableSamples.some((s) => s.id === defaultSampleId)
          ? defaultSampleId
          : availableSamples[0]?.id ?? '';
      setSampleId(sid);
      setBorrower('');
      setLoanedAt(todayStr());
      setDueDate('');
      setError(null);
      setBusy(false);
      setSectionIds(sections.filter((s) => s.sampleId === sid).map((s) => s.id));
    }
  }, [open, defaultSampleId, availableSamples, sections]);

  const handleSampleChange = (sid: string) => {
    setSampleId(sid);
    setSectionIds(sections.filter((s) => s.sampleId === sid).map((s) => s.id));
  };

  const handleSubmit = async () => {
    if (!sampleId) {
      setError('请选择借出样本');
      return;
    }
    if (!borrower.trim()) {
      setError('请填写借用人');
      return;
    }
    if (!loanedAt) {
      setError('请选择借出日期');
      return;
    }
    if (!dueDate) {
      setError('请选择应还日期');
      return;
    }
    if (dueDate < loanedAt) {
      setError('应还日期不能早于借出日期，交易不成立');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await lendSample({ sampleId, borrower, loanedAt, dueDate, sectionIds });
      const sample = samples.find((s) => s.id === sampleId);
      notify(`已借出 ${sample?.sampleNo ?? ''}，借用人：${borrower.trim()}`);
      onLent?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '借出失败');
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>借出登记</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <FormControl size="small" fullWidth>
            <InputLabel id="lend-sample-label">借出样本</InputLabel>
            <Select
              labelId="lend-sample-label"
              label="借出样本"
              value={sampleId}
              onChange={(e) => handleSampleChange(e.target.value)}
            >
              {availableSamples.length === 0 ? (
                <MenuItem value="" disabled>
                  没有可借出的在库样本
                </MenuItem>
              ) : null}
              {availableSamples.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.sampleNo}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            size="small"
            label="借用人"
            value={borrower}
            onChange={(e) => setBorrower(e.target.value)}
            fullWidth
            required
          />

          <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
            <TextField
              size="small"
              type="date"
              label="借出日期"
              InputLabelProps={{ shrink: true }}
              value={loanedAt}
              onChange={(e) => setLoanedAt(e.target.value)}
              sx={{ width: 180 }}
            />
            <TextField
              size="small"
              type="date"
              label="应还日期"
              InputLabelProps={{ shrink: true }}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              sx={{ width: 180 }}
            />
          </Stack>

          <FormControl size="small" fullWidth>
            <InputLabel id="lend-sections-label">随样切片</InputLabel>
            <Select
              labelId="lend-sections-label"
              label="随样切片"
              multiple
              value={sectionIds}
              onChange={(e) => setSectionIds(e.target.value as string[])}
              renderValue={(selected) => `${selected.length} 张随样`}
            >
              {sampleSections.length === 0 ? (
                <MenuItem value="" disabled>
                  该样本暂无切片
                </MenuItem>
              ) : null}
              {sampleSections.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  <Checkbox checked={sectionIds.includes(s.id)} size="small" />
                  <ListItemText primary={`${s.sectionNo}（${s.thickness} μm）`} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary">
            随样切片与借出前检测记录将固化为快照，归还时核对差异。
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={busy}>
          {busy ? '登记中…' : '确认借出'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
