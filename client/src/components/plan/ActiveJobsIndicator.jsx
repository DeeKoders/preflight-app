import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Spinner } from '../ui/misc';

/** Sidebar affordance so users can leave a progress screen and find their way back. */
export function ActiveJobsIndicator() {
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => api.get('/planning-jobs', { status: 'active', limit: 5 }),
    refetchInterval: (q) => ((q.state.data || []).length ? 3000 : 20000),
  });
  if (!jobs.length) return null;
  return (
    <div className="mx-3 mb-3 rounded-lg border border-line bg-surface-2 p-2.5">
      <p className="mb-1.5 px-1 text-[12px] text-muted">Planning in progress</p>
      <ul className="space-y-0.5">
        {jobs.map((j) => (
          <li key={j.id}>
            <Link to={`/jobs/${j.id}`} className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-surface">
              <Spinner className="h-3.5 w-3.5 text-accent" label="Running" />
              <span className="font-mono text-[12px]">{j.ticket?.key}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
