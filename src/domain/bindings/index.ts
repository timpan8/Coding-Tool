import type { Binding, Category } from '../../types/models';

export function resolveBinding(name: string, bindings: Binding[], projectId: string, versionId: string | null): Binding | undefined {
  return bindings.find(b => b.name === name && b.scope === 'version' && b.scopeRef === versionId)
    ?? bindings.find(b => b.name === name && b.scope === 'project' && b.scopeRef === projectId)
    ?? bindings.find(b => b.name === name && b.scope === 'global');
}
export function resolveValue(binding: Binding, profileId: string | null): string | undefined {
  return (profileId ? binding.values[profileId] : undefined) ?? binding.values.__default__;
}
/** A refusal the user can act on, as opposed to a failure they cannot. The dialog prints the message
 * of this class and nothing else's, so invariant 5 holds by construction: only text we wrote here
 * reaches the screen, never a storage error that might carry a key or a value. */
export class BindingRefusal extends Error {}
export function validateBinding(binding: Binding, others: Binding[]): string[] {
  const errors: string[] = [];
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(binding.name)) errors.push('Namn måste vara 2–64 tecken: A–Z, siffror och understreck, med bokstav först.');
  if (others.some(b => b.id !== binding.id && b.name === binding.name && b.scope === binding.scope && b.scopeRef === binding.scopeRef)) errors.push('Namnet används redan i detta scope.');
  if ((binding.scope === 'global') !== (binding.scopeRef === null)) errors.push('Scope och referens stämmer inte överens.');
  if (!binding.aiReplacement) errors.push('Ange ett ofarligt AI-värde.');
  if (/\{\{[A-Z][A-Z0-9_]*\}\}/.test(binding.aiReplacement)) errors.push('AI-värdet får inte innehålla platshållarsyntax.');
  if (Object.values(binding.values).some(v => v.length > 0 && binding.aiReplacement.includes(v))) errors.push('AI-värdet får inte innehålla ett privat värde för samma binding.');
  return errors;
}
export const defaults: Record<Category, string> = {
  secret: '<PASSWORD>', identity: 'example.user', infrastructure: 'server.example.test',
  environment: 'C:\\Temp\\Example', configuration: 'EXAMPLE_VALUE', testdata: 'example.test',
};
/** The name is derived from the variable to the left of the selection, so two lines assigning to the
 * same variable produce the same name. Without `taken` the second one was proposed anyway and then
 * rejected on save with "Namnet används redan i detta scope." — an error the user did not cause and
 * could not act on without inventing a name themselves. Every caller that creates a binding
 * programmatically (a scanner finding, a blocklist term) would inherit the same collision. */
export function suggestBinding(
  lineBefore: string,
  selected: string,
  bindings: Binding[],
  scope: Pick<Binding, 'scope' | 'scopeRef'>,
): { name: string; category: Category } {
  const variable = /["'$]?([A-Za-z_][A-Za-z0-9_]*)["']?\s*[:=][^=]*$/.exec(lineBefore)?.[1] || 'VALUE';
  const base = variable.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase().slice(0, 64);
  const category: Category = /pass|secret|token|key/i.test(variable) ? 'secret'
    : /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(selected) ? 'environment'
    : /server|host|domain|ip/i.test(variable) ? 'infrastructure' : 'identity';
  return { name: freeName(base.length > 1 ? base : `${base}_VALUE`, bindings, scope), category };
}

/** A name for a value the scanner found where there is no assignment to read one from — an error
 * message, a transcript. The rule that found it says what kind of thing it is. */
export function suggestNameForRule(ruleId: string): string {
  const names: Record<string, string> = {
    'secret-assignment': 'PASSWORD', 'builtin:entropy': 'SECRET', 'aws-key': 'AWS_KEY', 'github-token': 'GITHUB_TOKEN', jwt: 'JWT',
    pem: 'PRIVATE_KEY', 'basic-auth-url': 'CONNECTION_URL', 'private-ip': 'IP', 'internal-host': 'HOST', fqdn: 'HOST',
    'unc-path': 'UNC_PATH', 'windows-path': 'PATH', 'unix-path': 'PATH', email: 'EMAIL', personnummer: 'PERSONNUMMER',
    guid: 'GUID', 'tenant-id': 'TENANT_ID', 'username-assignment': 'USERNAME', 'username-parameter': 'USERNAME',
    'server-parameter': 'SERVER', 'connection-server': 'SERVER', 'domain-parameter': 'DOMAIN',
  };
  return names[ruleId] ?? 'VALUE';
}

/** Counts up until the name is free in the scope the binding will land in — the same comparison
 * validateBinding makes, so a suggestion can never be rejected by it. The suffix is trimmed back
 * into the 64 characters the name rule allows rather than pushing the name past it.
 *
 * Takes the names rather than whole bindings so a caller naming several at once can add the ones it
 * has just decided on to the list, and not propose the same name twice in one pass. */
export function freeName(base: string, bindings: Pick<Binding, 'name' | 'scope' | 'scopeRef'>[], scope: Pick<Binding, 'scope' | 'scopeRef'>): string {
  const used = new Set(bindings.filter(b => b.scope === scope.scope && b.scopeRef === scope.scopeRef).map(b => b.name));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `_${n}`;
    const candidate = base.slice(0, 64 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

