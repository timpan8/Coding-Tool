import type { Field, FieldKind } from './types'

/**
 * Example values live in reserved namespaces (RFC 2606 / RFC 5737 and
 * obviously-fake patterns) so a fake can never collide with a real value and
 * the guard can tell them apart by construction.
 */
export interface ExampleNamespace {
  mailDomain: string
  domain: string
  netbios: string
  hostPrefix: string
  pathRoot: string
  tenant: string
}

export const DEFAULT_NAMESPACE: ExampleNamespace = {
  mailDomain: 'example.com',
  domain: 'corp.example',
  netbios: 'EXAMPLE',
  hostPrefix: 'SRV-EXAMPLE',
  pathRoot: 'C:\\Example',
  tenant: 'example.onmicrosoft.com',
}

export const ALTERNATE_NAMESPACES: readonly ExampleNamespace[] = [
  {
    mailDomain: 'example.net',
    domain: 'corp.example.net',
    netbios: 'EXMPL',
    hostPrefix: 'SRV-EXMPL',
    pathRoot: 'C:\\Exmpl',
    tenant: 'exmpl.onmicrosoft.com',
  },
  {
    mailDomain: 'example.org',
    domain: 'corp.example.org',
    netbios: 'SAMPLEORG',
    hostPrefix: 'SRV-SAMPLE',
    pathRoot: 'C:\\SampleOrg',
    tenant: 'sampleorg.onmicrosoft.com',
  },
]

export interface GenerateOptions {
  /** The real value's shape decides e.g. FQDN vs short host, NetBIOS vs DNS domain. */
  shapeOf?: string
  /** AI-visible project name used in path examples. */
  aiVisibleName?: string
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')

export function generateExample(
  kind: FieldKind,
  n: number,
  ns: ExampleNamespace = DEFAULT_NAMESPACE,
  opts: GenerateOptions = {},
): string {
  const shape = opts.shapeOf ?? ''
  switch (kind) {
    case 'email':
      return `anna.exempel${n}@${ns.mailDomain}`
    case 'domain': {
      const looksNetbios = shape !== '' && !shape.includes('.')
      if (looksNetbios) return n === 1 ? ns.netbios : `${ns.netbios}${n}`
      return n === 1 ? ns.domain : ns.domain.replace(/^([^.]+)/, `$1${n}`)
    }
    case 'username': {
      const domainQualified = /^[^\\@]+\\[^\\]+$/.test(shape)
      if (domainQualified) return `${ns.netbios}\\svc-example${pad(n, 2)}`
      return `svc-example${pad(n, 2)}`
    }
    case 'server': {
      const short = shape !== '' && !shape.includes('.')
      return short ? `${ns.hostPrefix}${pad(n, 2)}` : `${ns.hostPrefix}${pad(n, 2)}.${ns.domain}`
    }
    case 'ip':
      return n <= 244 ? `192.0.2.${10 + n}` : `198.51.100.${(n - 244) % 250}`
    case 'tenantId':
      return `11111111-2222-4333-8444-${pad(n, 12)}`
    case 'unc':
      return `\\\\${ns.hostPrefix}${pad(n, 2)}\\Share`
    case 'path': {
      const project = opts.aiVisibleName ?? 'Project01'
      return n === 1 ? `${ns.pathRoot}\\${project}` : `${ns.pathRoot}\\${project}\\Path${pad(n, 2)}`
    }
    case 'password':
      return `Ex@mple-Passw0rd-${n}`
    case 'apiKey':
      return `EXAMPLE-KEY-${pad(n, 4)}`
    case 'blob':
      return `EXAMPLE-BLOCK-${pad(n, 2)}`
    case 'custom':
      return `EXAMPLE-VALUE-${pad(n, 2)}`
  }
}

/** Smallest n >= 1 whose generated example is not already used by another field. */
export function nextExample(
  kind: FieldKind,
  fields: Iterable<Pick<Field, 'example'>>,
  ns: ExampleNamespace = DEFAULT_NAMESPACE,
  opts: GenerateOptions = {},
): string {
  const used = new Set<string>()
  for (const f of fields) used.add(f.example.toLowerCase())
  for (let n = 1; n < 10_000; n++) {
    const candidate = generateExample(kind, n, ns, opts)
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  throw new Error('example namespace exhausted')
}

const TEST_NET = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/
const FAKE_GUID = /^11111111-2222-4333-8444-\d{12}$/i

/** True when a value is recognisably inside the tool's fake namespace. */
export function isInExampleNamespace(value: string, ns: ExampleNamespace = DEFAULT_NAMESPACE): boolean {
  const v = value.toLowerCase()
  if (TEST_NET.test(v) || FAKE_GUID.test(v)) return true
  if (/^ex@mple-passw0rd-\d+$/.test(v) || /^example-(key|block|value)-\d+$/.test(v)) return true
  if (/(^|[^a-z0-9])(example|exempel)([^a-z0-9]|$)/.test(v)) return true
  const needles = [ns.mailDomain, ns.domain, ns.hostPrefix, ns.pathRoot, ns.tenant, ns.netbios].map((s) =>
    s.toLowerCase(),
  )
  return needles.some((needle) => v.includes(needle))
}

/**
 * A real value that falls inside the fake namespace disables namespace-based
 * trust; the caller then switches the vault to an alternate namespace.
 */
export function realValueCollidesWithNamespace(realValue: string, ns: ExampleNamespace): boolean {
  return isInExampleNamespace(realValue, ns)
}
