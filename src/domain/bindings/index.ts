import type { Binding, Category } from '../../types/models';

export function resolveBinding(name: string, bindings: Binding[], projectId: string, versionId: string | null): Binding | undefined {
  return bindings.find(b => b.name === name && b.scope === 'version' && b.scopeRef === versionId)
    ?? bindings.find(b => b.name === name && b.scope === 'project' && b.scopeRef === projectId)
    ?? bindings.find(b => b.name === name && b.scope === 'global');
}
export function resolveValue(binding: Binding, profileId: string | null): string | undefined {
  return (profileId ? binding.values[profileId] : undefined) ?? binding.values.__default__;
}
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
export function suggestBinding(lineBefore: string, selected: string): { name: string; category: Category } {
  const variable = /[\"'$]?([A-Za-z_][A-Za-z0-9_]*)[\"']?\s*[:=][^=]*$/.exec(lineBefore)?.[1] || 'VALUE';
  const name = variable.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase().slice(0, 64);
  const category: Category = /pass|secret|token|key/i.test(variable) ? 'secret'
    : /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(selected) ? 'environment'
    : /server|host|domain|ip/i.test(variable) ? 'infrastructure' : 'identity';
  return { name: name.length > 1 ? name : `${name}_VALUE`, category };
}

