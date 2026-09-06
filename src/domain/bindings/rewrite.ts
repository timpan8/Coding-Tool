const placeholder = (name: string) => `{{${name}}}`;

/** Rewrites every occurrence of one placeholder to another.
 *
 * Plain text replacement is enough and is what makes this safe: a placeholder has a fixed shape
 * with no escaping to consider, so nothing else in the template can be caught by accident. */
export function renameInTemplates(
  templates: Record<string, string>,
  from: string,
  to: string,
): { templates: Record<string, string>; occurrences: number } {
  let occurrences = 0;
  const rewritten: Record<string, string> = {};
  for (const [fileId, template] of Object.entries(templates)) {
    const parts = template.split(placeholder(from));
    occurrences += parts.length - 1;
    rewritten[fileId] = parts.join(placeholder(to));
  }
  return { templates: rewritten, occurrences };
}

/** Puts a value back where its placeholder stood, for a binding being removed. */
export function restoreValueInTemplates(
  templates: Record<string, string>,
  name: string,
  value: string,
): { templates: Record<string, string>; occurrences: number } {
  return renameInTemplatesRaw(templates, placeholder(name), value);
}

function renameInTemplatesRaw(templates: Record<string, string>, from: string, to: string) {
  let occurrences = 0;
  const rewritten: Record<string, string> = {};
  for (const [fileId, template] of Object.entries(templates)) {
    const parts = template.split(from);
    occurrences += parts.length - 1;
    rewritten[fileId] = parts.join(to);
  }
  return { templates: rewritten, occurrences };
}

/** Counts occurrences without rewriting, so a dialog can say what a rename would touch. */
export function countPlaceholder(templates: Record<string, string>, name: string): number {
  return Object.values(templates).reduce((total, template) => total + template.split(placeholder(name)).length - 1, 0);
}
