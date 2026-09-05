import type { RenderIssue } from '../../domain/render';

export type IssueView = 'template' | 'local' | 'ai';
export interface LocatedIssue extends RenderIssue {
  /** Which projection the offset belongs to. A missing binding is a position in the template; a
   * leaked value is a position in the rendered AI output, and those are different texts. */
  view: IssueView;
  line: number;
  blocks: ('local' | 'ai')[];
}

const lineOf = (text: string, offset: number) => text.slice(0, Math.max(0, offset)).split('\n').length;

/** Merges the problems from both projections into one list.
 *
 * They used to be shown one projection at a time, and the leak check only ever runs for AI, so in
 * the template view a disabled Copy button had its reason rendered nowhere on screen. */
export function collectIssues(template: string, local: { text: string; issues: RenderIssue[] }, ai: { text: string; issues: RenderIssue[] }): LocatedIssue[] {
  const merged = new Map<string, LocatedIssue>();
  const add = (issue: RenderIssue, blocks: 'local' | 'ai') => {
    const view: IssueView = issue.kind === 'leak' ? 'ai' : 'template';
    const source = view === 'ai' ? ai.text : template;
    const key = `${issue.kind}:${issue.name}:${issue.start}`;
    const existing = merged.get(key);
    if (existing) {
      if (!existing.blocks.includes(blocks)) existing.blocks.push(blocks);
      return;
    }
    merged.set(key, { ...issue, view, line: lineOf(source, issue.start), blocks: [blocks] });
  };
  for (const issue of local.issues) add(issue, 'local');
  for (const issue of ai.issues) add(issue, 'ai');
  return [...merged.values()].sort((a, b) => a.line - b.line);
}

const label = (blocks: ('local' | 'ai')[]) =>
  blocks.length === 2 ? 'blockerar båda kopieringarna' : blocks[0] === 'ai' ? 'blockerar Copy for AI' : 'blockerar Copy Local';

export function IssuePanel({ issues, onSelect }: { issues: LocatedIssue[]; onSelect: (issue: LocatedIssue) => void }) {
  if (!issues.length) return null;
  return (
    <div className="issue-panel" role="alert">
      <h3>
        {issues.length} {issues.length === 1 ? 'problem' : 'problem'} hindrar kopiering
      </h3>
      {issues.map((issue) => (
        <button key={`${issue.kind}:${issue.name}:${issue.start}`} className="issue-item" onClick={() => onSelect(issue)}>
          <span className="issue-head">
            <b>{issue.name}</b>
            <small>
              rad {issue.line} · {label(issue.blocks)}
            </small>
          </span>
          <span>{issue.message}</span>
        </button>
      ))}
    </div>
  );
}
