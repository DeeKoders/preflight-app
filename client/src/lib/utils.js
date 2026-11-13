import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs) => twMerge(clsx(inputs));

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function relativeTime(value) {
  if (!value) return '—';
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  const units = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2629800],
    ['year', 31557600],
  ];
  let unit = units[0];
  for (const u of units) if (abs >= u[1]) unit = u;
  return rtf.format(Math.round(diff / unit[1]), unit[0]);
}

export const formatDateTime = (v) =>
  v ? new Date(v).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const formatNumber = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());

export function formatCost(v) {
  if (v === null || v === undefined) return 'Not available';
  if (v === 0) return '$0.00';
  return v < 0.01 ? `<$0.01` : `$${v.toFixed(v < 1 ? 3 : 2)}`;
}

export const formatDuration = (ms) => {
  if (!ms && ms !== 0) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export const PROVIDER_LABELS = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini' };

export function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
