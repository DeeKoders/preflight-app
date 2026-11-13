import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';

/** Table of contents with scroll-spy. Section numbers come from the document itself. */
export function PlanToc({ sections }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    // Active section = the last section heading that has scrolled past the top band of the viewport.
    const onScroll = () => {
      let current = sections[0]?.id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 140) current = s.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [sections]);

  return (
    <nav aria-label="Plan contents" className="text-[13px]">
      <p className="mb-2 px-2 font-medium text-ink-2">Contents</p>
      <ol className="space-y-px">
        {sections.map((s) => {
          const [, num, rest] = s.title.match(/^(\d+)\.\s*(.*)$/) || [null, null, s.title];
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={() => setActive(s.id)}
                aria-current={active === s.id ? 'location' : undefined}
                className={cn(
                  'flex gap-2 rounded-md px-2 py-1 leading-snug transition-colors',
                  active === s.id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink'
                )}
              >
                {num && <span className="w-4 shrink-0 text-right tabular-nums opacity-70">{num}</span>}
                <span>{rest}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
