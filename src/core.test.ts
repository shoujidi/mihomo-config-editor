import { describe, expect, it } from 'vitest'
import {
  buildConfig,
  copyProxyNodes,
  deleteProxyGroup,
  deleteProxyNodes,
  orderProxyGroupReferences,
  parseConfig,
  parseProxyInput,
  renameProxyGroup,
  renameProxyNodes,
  SAMPLE_YAML,
  type ExitSettings,
} from './core'
import { parse } from 'yaml'

const settings: ExitSettings = {
  type: 'socks5',
  label: '住宅出口',
  server: '203.0.113.8',
  port: 1080,
  username: 'user',
  password: 'secret',
  udp: true,
  tls: false,
  skipCertVerify: false,
  nameTemplate: '{node} · {exit}',
  createGroup: true,
  groupName: '代理 IP 出口',
  syncSourceGroups: true,
}

describe('Mihomo config builder', () => {
  it('parses inline proxies and groups', () => {
    const result = parseConfig(SAMPLE_YAML)
    expect(result.proxies.map((node) => node.name)).toEqual(['香港 01', '新加坡 01'])
    expect(result.groups[0].name).toBe('节点选择')
  })

  it('creates one socks5 exit per selected node with correct chain direction', () => {
    const result = buildConfig(SAMPLE_YAML, ['香港 01', '新加坡 01'], settings)
    const config = parse(result.yaml)
    const exits = config.proxies.slice(-2)
    expect(exits[0]).toMatchObject({
      name: '香港 01 · 住宅出口',
      type: 'socks5',
      server: '203.0.113.8',
      port: 1080,
      username: 'user',
      password: 'secret',
      udp: true,
      'dialer-proxy': '香港 01',
    })
    expect(exits[1]['dialer-proxy']).toBe('新加坡 01')
    expect(config['proxy-groups'].find((group: { name: string }) => group.name === '代理 IP 出口').proxies).toEqual(result.generatedNames)
    expect(config['proxy-groups'][0].proxies).toContain('香港 01 · 住宅出口')
  })

  it('preserves source comments while appending nodes', () => {
    const result = buildConfig(SAMPLE_YAML, ['香港 01'], { ...settings, syncSourceGroups: false })
    expect(result.yaml).toContain('# Mihomo / Meta 配置示例')
  })

  it('avoids duplicate names', () => {
    const once = buildConfig(SAMPLE_YAML, ['香港 01'], { ...settings, createGroup: false, syncSourceGroups: false })
    const twice = buildConfig(once.yaml, ['香港 01'], { ...settings, createGroup: false, syncSourceGroups: false })
    expect(twice.generatedNames[0]).toBe('香港 01 · 住宅出口 (2)')
  })
})

describe('proxy paste parser', () => {
  it.each([
    ['203.0.113.8:1080', { server: '203.0.113.8', port: 1080 }],
    ['203.0.113.8:1080:user:secret', { server: '203.0.113.8', port: 1080, username: 'user', password: 'secret' }],
    ['user:secret@203.0.113.8:1080', { server: '203.0.113.8', port: 1080, username: 'user', password: 'secret' }],
    ['203.0.113.8|1080|user|secret', { server: '203.0.113.8', port: 1080, username: 'user', password: 'secret' }],
    ['socks5://user:secret@203.0.113.8:1080', { type: 'socks5', server: '203.0.113.8', port: 1080, username: 'user', password: 'secret' }],
    ['https://user:secret@proxy.example.com:8443', { type: 'http', tls: true, server: 'proxy.example.com', port: 8443, username: 'user', password: 'secret' }],
  ])('recognizes %s', (source, expected) => {
    expect(parseProxyInput(source)).toMatchObject(expected)
  })

  it('recognizes JSON and provider key-value copies', () => {
    expect(parseProxyInput('{"ip":"203.0.113.9","port":9000,"user":"demo","password":"pwd","protocol":"http"}')).toMatchObject({
      type: 'http', server: '203.0.113.9', port: 9000, username: 'demo', password: 'pwd',
    })
    expect(parseProxyInput('host=proxy.test port=3128 username=alice password=hello protocol=https')).toMatchObject({
      type: 'http', tls: true, server: 'proxy.test', port: 3128, username: 'alice', password: 'hello',
    })
  })
})

const EDITOR_YAML = `proxies:
  - name: Base
    type: ss
    server: base.example
    port: 443
  - name: Exit
    type: socks5
    server: exit.example
    port: 1080
    dialer-proxy: Base
proxy-groups:
  - name: Main
    type: select
    proxies: [Base, Exit, Secondary]
  - name: Secondary
    type: select
    proxies: [Base, DIRECT]
rules:
  - DOMAIN,example.com,Main
  - DOMAIN,base.example,Base
sub-rules:
  media:
    - DOMAIN-SUFFIX,media.example,Main,no-resolve
`

describe('configuration editor integrity', () => {
  it('renames a node across dialer chains, groups, rules and sub-rules', () => {
    const config = parse(renameProxyNodes(EDITOR_YAML, [{ from: 'Base', to: 'Base Renamed' }]))
    expect(config.proxies.map((node: { name: string }) => node.name)).toContain('Base Renamed')
    expect(config.proxies.find((node: { name: string }) => node.name === 'Exit')['dialer-proxy']).toBe('Base Renamed')
    expect(config['proxy-groups'][0].proxies).toContain('Base Renamed')
    expect(config.rules).toContain('DOMAIN,base.example,Base Renamed')
  })

  it('renames a group across nested references, rules, sub-rules and dialer chains', () => {
    const source = EDITOR_YAML
      .replace('dialer-proxy: Base', 'dialer-proxy: Main')
      .replace('proxies: [Base, DIRECT]', 'proxies: [Base, Main, DIRECT]')
    const config = parse(renameProxyGroup(source, 'Main', 'Main Renamed'))
    expect(config['proxy-groups'].map((group: { name: string }) => group.name)).toContain('Main Renamed')
    expect(config.rules).toContain('DOMAIN,example.com,Main Renamed')
    expect(config['sub-rules'].media).toContain('DOMAIN-SUFFIX,media.example,Main Renamed,no-resolve')
    expect(config['proxy-groups'].find((group: { name: string }) => group.name === 'Secondary').proxies).toContain('Main Renamed')
    expect(config.proxies.find((node: { name: string }) => node.name === 'Exit')['dialer-proxy']).toBe('Main Renamed')
  })

  it('deletes a group while migrating selected rules and nested references', () => {
    const source = EDITOR_YAML
      .replace('proxies: [Base, DIRECT]', 'proxies: [Base, Main, DIRECT]')
      .replace('rules:', '  - name: Outer\n    type: select\n    proxies: [Main, DIRECT]\nrules:')
    const config = parse(deleteProxyGroup(source, 'Main', 'Secondary', ['rules:0']))
    expect(config['proxy-groups'].map((group: { name: string }) => group.name)).not.toContain('Main')
    expect(config['proxy-groups'].find((group: { name: string }) => group.name === 'Secondary').proxies).not.toContain('Secondary')
    expect(config['proxy-groups'].find((group: { name: string }) => group.name === 'Outer').proxies).toContain('Secondary')
    expect(config.rules).toContain('DOMAIN,example.com,Secondary')
    expect(config['sub-rules'].media).toEqual([])
  })

  it('cascades node deletion through dialer dependencies and cleans references', () => {
    const config = parse(deleteProxyNodes(EDITOR_YAML, ['Base']))
    expect(config.proxies).toEqual([])
    expect(config['proxy-groups'][0].proxies).toEqual(['Secondary'])
    expect(config.rules).not.toContain('DOMAIN,base.example,Base')
  })

  it('reorders group references without losing duplicate entries', () => {
    const source = EDITOR_YAML.replace('proxies: [Base, Exit, Secondary]', 'proxies: [Base, Exit, Base, Secondary]')
    const config = parse(orderProxyGroupReferences(source, [{ groupName: 'Main', proxies: ['Secondary', 'Base', 'Base', 'Exit'] }]))
    expect(config['proxy-groups'][0].proxies).toEqual(['Secondary', 'Base', 'Base', 'Exit'])
  })

  it('copies selected nodes with dialer dependencies and resolves name conflicts', () => {
    const target = `proxies:\n  - name: Base\n    type: ss\n    server: other.example\n    port: 443\n`
    const result = copyProxyNodes(EDITOR_YAML, target, ['Exit'], 'rename')
    const config = parse(result.yaml)
    expect(result.dependencyCount).toBe(1)
    expect(result.renamed).toContainEqual({ from: 'Base', to: 'Base (复制)' })
    expect(config.proxies.find((node: { name: string }) => node.name === 'Exit')['dialer-proxy']).toBe('Base (复制)')
  })
})
