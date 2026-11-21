import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { parseConfig } from './core'
import { applyRefresh, readRefreshFile, refreshRows } from './refresh'

const previous = `# preserve
proxies:
  - { name: HK, type: ss, server: before.invalid, port: 443, password: old, plugin: old-plugin, dialer-proxy: DIRECT }
  - { name: Renamed, type: ss, server: prior.invalid, port: 443, password: old }
proxy-groups:
  - { name: G, type: select, proxies: [HK, Renamed] }
rules: ['MATCH,G']
`
function file(server: string, password: string) {
  return `proxies:
  - {name: HK, type: ss, server: ${server}, port: 8443, password: ${password}, dialer-proxy: ignored}
  - {name: NewLabel, type: ss, server: renamed.invalid, port: 80}
  - {name: "剩余流量：2GB", type: ss, server: status.invalid, port: 80}
`
}

describe('offline refresh', () => {
  it('refreshes only confirmed nodes and preserves names, routing and local dialer choice', () => {
    const incoming = readRefreshFile(file('new.invalid', 'rotated'), 'vendor.yaml', 0)
    const old = parseConfig(previous)
    expect(incoming).toHaveLength(2)
    const rows = refreshRows(old.proxies, incoming)
    expect(rows.map((row) => row.auto)).toEqual(['0:0', undefined])
    const output = applyRefresh(previous, new Map([['HK', incoming[0]]]))
    const next = parseConfig(output)
    expect(next.proxies).toHaveLength(2)
    expect(next.proxies[0]).toEqual({name: 'HK', type: 'ss', server: 'new.invalid', port: 8443, password: 'rotated', 'dialer-proxy': 'DIRECT'})
    expect(next.proxies[1]).toEqual(old.proxies[1])
    expect(next.groups).toEqual(old.groups)
    expect(parse(output).rules).toEqual(parse(previous).rules)
    expect(output).toContain('# preserve')
  })

  it('does not use a six-character prefix or first candidate to resolve duplicate providers', () => {
    const a = readRefreshFile(file('a.invalid', 'a'), 'sameaa-provider-a.yaml', 0)
    const b = readRefreshFile(file('b.invalid', 'b'), 'sameaa-provider-b.yaml', 1)
    const rows = refreshRows(parseConfig(previous).proxies, [...a, ...b])
    expect(rows[0]).toMatchObject({auto: undefined, ambiguous: true})
    expect(rows[1].auto).toBeUndefined()
    const out = parseConfig(applyRefresh(previous, new Map([['HK', b[0]], ['Renamed', a[1]]])))
    expect(out.proxies.map((node) => [node.name, node.server])).toEqual([['HK', 'b.invalid'], ['Renamed', 'renamed.invalid']])
    expect(out.proxies[1]['dialer-proxy']).toBeUndefined()
    expect(() => applyRefresh(previous, new Map([['HK', b[0]], ['Renamed', b[0]]]))).toThrow()
  })

  it('rejects changing unselected settings inherited through a YAML alias', () => {
    const incoming = readRefreshFile(file('new.invalid', 'new'), 'vendor.yaml', 0)
    const anchor = previous.replace('- { name: HK', '- &linked { name: HK') + 'local-copy: *linked\n'
    expect(() => applyRefresh(anchor, new Map([['HK', incoming[0]]]))).toThrow(/共享引用/)
  })

  it('leaves the original unchanged when preview selections are cancelled', () => {
    const incoming = readRefreshFile(file('cancel.invalid', 'cancel'), 'vendor.yaml', 0)
    refreshRows(parseConfig(previous).proxies, incoming)
    expect(applyRefresh(previous, new Map())).toBe(previous)
  })

  it('does not silently refresh duplicated targets or accept an incompatible protocol', () => {
    const incoming = readRefreshFile(file('new.invalid', 'new'), 'vendor.yaml', 0)
    const duplicate = previous.replace('name: Renamed', 'name: HK')
    expect(refreshRows(parseConfig(duplicate).proxies, incoming).every((row) => row.blocked)).toBe(true)
    expect(() => applyRefresh(previous, new Map([['HK', {...incoming[0], node: {...incoming[0].node, type: 'vless'}}]]))).toThrow()
  })
})
