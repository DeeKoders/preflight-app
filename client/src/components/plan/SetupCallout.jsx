import { Link } from 'react-router';
import { Bot, Plug } from 'lucide-react';
import { Panel } from '../ui/panel';
import { Button } from '../ui/button';
import { APP_NAME } from '../../lib/brand';

/** Shown when a required integration is missing: explains what to do and links there. */
export function SetupCallout({ kind }) {
  const copy =
    kind === 'jira'
      ? {
          icon: Plug,
          title: 'Connect Jira to see your tickets',
          body: `${APP_NAME} reads the Jira Cloud issues assigned to you with your own API token. Nothing is written back to Jira.`,
          to: '/integrations',
          cta: 'Connect Jira',
        }
      : {
          icon: Bot,
          title: 'Add an AI provider to generate plans',
          body: 'Plans are generated with your own Anthropic, OpenAI or Gemini API key, billed to your provider account.',
          to: '/ai-settings',
          cta: 'Configure AI provider',
        };
  const Icon = copy.icon;
  return (
    <Panel className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft">
        <Icon className="h-5 w-5 text-accent" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold">{copy.title}</h2>
        <p className="mt-0.5 text-[13.5px] text-muted">{copy.body}</p>
      </div>
      <Link to={copy.to}>
        <Button variant="primary">{copy.cta}</Button>
      </Link>
    </Panel>
  );
}
