'use strict';

/**
 * Converts Atlassian Document Format (ADF) — used by Jira Cloud REST v3 for
 * descriptions, comments and rich-text custom fields — into Markdown text.
 * Unknown node types degrade gracefully to their text content.
 */
function adfToMarkdown(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToMarkdown).join('');
  return render(node, { listDepth: 0 }).replace(/\n{3,}/g, '\n\n').trim();
}

function renderChildren(node, ctx) {
  return (node.content || []).map((c) => render(c, ctx)).join('');
}

function applyMarks(text, marks = []) {
  return marks.reduce((acc, mark) => {
    switch (mark.type) {
      case 'strong':
        return `**${acc}**`;
      case 'em':
        return `_${acc}_`;
      case 'code':
        return `\`${acc}\``;
      case 'strike':
        return `~~${acc}~~`;
      case 'link': {
        const href = mark.attrs?.href;
        return href && /^https?:\/\//i.test(href) ? `[${acc}](${href})` : acc;
      }
      default:
        return acc;
    }
  }, text);
}

function render(node, ctx) {
  if (!node || typeof node !== 'object') return '';
  const indent = '  '.repeat(Math.max(0, ctx.listDepth - 1));
  switch (node.type) {
    case 'doc':
      return renderChildren(node, ctx);
    case 'paragraph':
      return `${renderChildren(node, ctx)}\n\n`;
    case 'text':
      return applyMarks(node.text || '', node.marks);
    case 'hardBreak':
      return '\n';
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.attrs?.level || 1));
      return `${'#'.repeat(level)} ${renderChildren(node, ctx).trim()}\n\n`;
    }
    case 'bulletList':
    case 'orderedList': {
      const inner = { ...ctx, listDepth: ctx.listDepth + 1 };
      const items = (node.content || []).map((item, i) => {
        const marker = node.type === 'orderedList' ? `${(node.attrs?.order || 1) + i}.` : '-';
        const body = renderChildren(item, inner).trim().replace(/\n\n+/g, '\n');
        return `${'  '.repeat(ctx.listDepth)}${marker} ${body}`;
      });
      return `${items.join('\n')}\n\n`;
    }
    case 'listItem':
      return renderChildren(node, ctx);
    case 'taskList':
      return `${(node.content || []).map((t) => render(t, ctx)).join('')}\n`;
    case 'taskItem':
      return `${indent}- [${node.attrs?.state === 'DONE' ? 'x' : ' '}] ${renderChildren(node, ctx).trim()}\n`;
    case 'codeBlock': {
      const lang = node.attrs?.language || '';
      const code = (node.content || []).map((c) => c.text || '').join('');
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }
    case 'blockquote':
      return `${renderChildren(node, ctx)
        .trim()
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}\n\n`;
    case 'rule':
      return '---\n\n';
    case 'panel':
      return `> **${(node.attrs?.panelType || 'note').toUpperCase()}:** ${renderChildren(node, ctx).trim()}\n\n`;
    case 'mention':
      return `@${(node.attrs?.text || 'user').replace(/^@/, '')}`;
    case 'emoji':
      return node.attrs?.text || node.attrs?.shortName || '';
    case 'date': {
      const ts = Number(node.attrs?.timestamp);
      return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '';
    }
    case 'status':
      return `[${node.attrs?.text || 'status'}]`;
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard': {
      const url = node.attrs?.url;
      return url ? `<${url}>${node.type === 'inlineCard' ? '' : '\n\n'}` : '';
    }
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return '[attachment]\n\n';
    case 'table': {
      const rows = (node.content || []).map((row) =>
        (row.content || []).map((cell) => renderChildren(cell, ctx).trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|'))
      );
      if (!rows.length) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (r) => [...r, ...Array(width - r.length).fill('')];
      const lines = [`| ${pad(rows[0]).join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`];
      rows.slice(1).forEach((r) => lines.push(`| ${pad(r).join(' | ')} |`));
      return `${lines.join('\n')}\n\n`;
    }
    case 'expand':
    case 'nestedExpand':
      return `**${node.attrs?.title || 'Details'}**\n\n${renderChildren(node, ctx)}`;
    default:
      return node.content ? renderChildren(node, ctx) : node.text || '';
  }
}

/** Jira fields can be ADF, plain strings, option objects, arrays, numbers... */
function fieldToText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(fieldToText).filter(Boolean).join(', ');
  if (value.type === 'doc') return adfToMarkdown(value);
  return value.value || value.name || value.displayName || value.key || value.title || '';
}

module.exports = { adfToMarkdown, fieldToText };
