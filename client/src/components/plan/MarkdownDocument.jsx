import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export const slugify = (text) =>
  String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

/**
 * Splits the canonical Markdown into a preamble and level-2 sections so each
 * section can collapse. The Markdown itself stays the single source of truth.
 */
export function splitSections(markdown = '') {
  const lines = markdown.split('\n');
  const sections = [];
  let current = { title: null, lines: [] };
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && /^## /.test(line)) {
      sections.push(current);
      current = { title: line.replace(/^## /, '').trim(), lines: [] };
    } else current.lines.push(line);
  }
  sections.push(current);
  return {
    preamble: sections[0].lines.join('\n'),
    sections: sections.slice(1).map((s) => ({
      title: s.title,
      id: slugify(s.title),
      body: s.lines.join('\n'),
      subheadings: s.lines.filter((l) => /^### /.test(l)).map((l) => ({ title: l.replace(/^### /, '').trim(), id: slugify(l.replace(/^### /, '').trim()) })),
    })),
  };
}

const safeHref = (href) => (/^(https?:|mailto:|#)/i.test(href || '') ? href : undefined);

const components = {
  a: ({ href, children, ...props }) => {
    const url = safeHref(href);
    if (!url) return <span>{children}</span>;
    const external = /^https?:/i.test(url);
    return (
      <a href={url} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...props}>
        {children}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
  // GFM task checkboxes render read-only: the generated Markdown is the source of truth.
  input: (props) => (props.type === 'checkbox' ? <input type="checkbox" checked={Boolean(props.checked)} readOnly disabled aria-label="Checklist item" /> : null),
  img: () => null,
};

const textOf = (children) => (Array.isArray(children) ? children.map(textOf).join('') : typeof children === 'string' ? children : children?.props ? textOf(children.props.children) : '');

function Md({ children, idPrefix }) {
  const comps = idPrefix
    ? { ...components, h3: ({ children: c }) => <h3 id={`${idPrefix}--${slugify(textOf(c))}`}>{c}</h3> }
    : components;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={comps} skipHtml>
      {children}
    </ReactMarkdown>
  );
}

function Section({ section, collapsed, onToggle }) {
  return (
    <section aria-labelledby={section.id} data-section-id={section.id}>
      <h2 id={section.id} className="group flex items-center justify-between gap-3">
        <span>{section.title}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls={`${section.id}-body`}
          className="rounded-md p-1 text-muted opacity-60 transition hover:bg-surface-2 hover:opacity-100 focus-visible:opacity-100"
        >
          <span className="sr-only">{collapsed ? 'Expand' : 'Collapse'} {section.title}</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed && '-rotate-90')} aria-hidden />
        </button>
      </h2>
      <div id={`${section.id}-body`} hidden={collapsed}>
        <Md idPrefix={section.id}>{section.body}</Md>
      </div>
    </section>
  );
}

export function MarkdownDocument({ markdown }) {
  const { preamble, sections } = useMemo(() => splitSections(markdown), [markdown]);
  const [collapsed, setCollapsed] = useState({});
  const allCollapsed = sections.length > 0 && sections.every((s) => collapsed[s.id]);
  return (
    <article className="plan-doc">
      <Md>{preamble}</Md>
      {sections.length > 0 && (
        <div className="mt-4 flex justify-end font-sans">
          <button
            type="button"
            className="text-[12.5px] text-muted hover:text-ink"
            onClick={() => setCollapsed(allCollapsed ? {} : Object.fromEntries(sections.map((s) => [s.id, true])))}
          >
            {allCollapsed ? 'Expand all sections' : 'Collapse all sections'}
          </button>
        </div>
      )}
      {sections.map((s) => (
        <Section key={s.id} section={s} collapsed={Boolean(collapsed[s.id])} onToggle={() => setCollapsed((c) => ({ ...c, [s.id]: !c[s.id] }))} />
      ))}
    </article>
  );
}
