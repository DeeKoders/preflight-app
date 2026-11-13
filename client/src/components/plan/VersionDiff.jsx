import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { diffLines } from 'diff';
import { api } from '../../lib/api';
import { cn, formatDateTime } from '../../lib/utils';
import { Dialog } from '../ui/dialog';
import { Field } from '../ui/form';
import { Select } from '../ui/select';
import { ErrorState, Spinner } from '../ui/misc';

/** Line-level diff of two plan versions' Markdown. */
export function computeDiff(a = '', b = '') {
  const parts = diffLines(a, b);
  const rows = [];
  let oldNo = 1;
  let newNo = 1;
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    for (const text of lines) {
      if (part.added) {
        rows.push({ type: 'add', text, newNo: newNo++ });
        added += 1;
      } else if (part.removed) {
        rows.push({ type: 'del', text, oldNo: oldNo++ });
        removed += 1;
      } else rows.push({ type: 'same', text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return { rows, added, removed };
}

/** Collapses long unchanged runs, keeping 3 lines of context around changes. */
function withContext(rows, context = 3) {
  const keep = new Set();
  rows.forEach((r, i) => {
    if (r.type !== 'same') for (let k = i - context; k <= i + context; k += 1) keep.add(k);
  });
  const out = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    if (keep.has(i)) {
      if (skipped) out.push({ type: 'gap', count: skipped });
      skipped = 0;
      out.push(r);
    } else skipped += 1;
  });
  if (skipped) out.push({ type: 'gap', count: skipped });
  return out;
}

export function VersionDiff({ open, onOpenChange, planId, versions, defaultTarget }) {
  const completed = versions.filter((v) => v.status === 'completed');
  const [target, setTarget] = useState(String(defaultTarget ?? completed[0]?.version ?? ''));
  const [base, setBase] = useState(String(completed.find((v) => String(v.version) !== String(defaultTarget ?? completed[0]?.version))?.version ?? ''));
  const options = completed.map((v) => ({ value: String(v.version), label: `Version ${v.version}`, hint: `${formatDateTime(v.createdAt)} — ${v.aiModel}` }));

  const fetchVersion = (v) => ({ queryKey: ['plan-version', planId, v], queryFn: () => api.get(`/plans/${planId}/versions/${v}`), enabled: open && Boolean(v) });
  const a = useQuery(fetchVersion(base));
  const b = useQuery(fetchVersion(target));
  const diff = useMemo(() => (a.data && b.data ? computeDiff(a.data.markdown, b.data.markdown) : null), [a.data, b.data]);
  const rows = useMemo(() => (diff ? withContext(diff.rows) : []), [diff]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Compare versions" description="Line-by-line changes between two generated plans." width="max-w-5xl">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field label="From">{(p) => <Select {...p} value={base} onValueChange={setBase} options={options} />}</Field>
        <Field label="To">{(p) => <Select {...p} value={target} onValueChange={setTarget} options={options} />}</Field>
      </div>
      {(a.isLoading || b.isLoading) && <Spinner />}
      {(a.isError || b.isError) && <ErrorState error={a.error || b.error} />}
      {diff && (
        <>
          <p className="mb-2 text-[13px] text-muted">
            <span className="font-medium text-ok">+{diff.added}</span> added, <span className="font-medium text-danger">−{diff.removed}</span> removed
            {base === target && ' — choose two different versions'}
          </p>
          <div className="overflow-x-auto rounded-lg border border-line font-mono text-[12.5px] leading-[1.6]">
            {rows.length === 0 && <p className="p-4 font-sans text-muted">The two versions are identical.</p>}
            {rows.map((r, i) =>
              r.type === 'gap' ? (
                <div key={i} className="bg-surface-2 px-3 py-1 font-sans text-[12px] text-muted">
                  {r.count} unchanged line{r.count === 1 ? '' : 's'}
                </div>
              ) : (
                <div key={i} className={cn('flex', r.type === 'add' && 'bg-ok-soft', r.type === 'del' && 'bg-danger-soft')}>
                  <span className="w-10 shrink-0 select-none px-2 text-right text-muted">{r.oldNo ?? ''}</span>
                  <span className="w-10 shrink-0 select-none px-2 text-right text-muted">{r.newNo ?? ''}</span>
                  <span className={cn('w-4 shrink-0 select-none', r.type === 'add' ? 'text-ok' : r.type === 'del' ? 'text-danger' : 'text-muted')}>
                    {r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}
                  </span>
                  <span className="whitespace-pre-wrap break-words pr-3">{r.text || ' '}</span>
                </div>
              )
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
