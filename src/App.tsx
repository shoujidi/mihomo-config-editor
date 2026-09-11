import { useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clipboard,
  ClipboardPaste,
  Clock3,
  Download,
  FileCode2,
  FileUp,
  Github,
  LockKeyhole,
  Network,
  QrCode,
  ScanLine,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react'
import {
  buildConfig,
  parseConfig,
  parseProxyInput,
  SAMPLE_YAML,
  validateSettings,
  type ExitSettings,
  type ParsedProxyInput,
} from './core'
import NodeManager, { type SelectionMode } from './NodeManager'
import ConfigEditor from './ConfigEditor'

const initialSettings: ExitSettings = {
  type: 'socks5',
  label: '住宅出口',
  server: '',
  port: 1080,
  username: '',
  password: '',
  udp: true,
  tls: false,
  skipCertVerify: false,
  nameTemplate: '{node} · {exit}',
  createGroup: true,
  groupName: '代理 IP 出口',
  syncSourceGroups: true,
}

type ShareResult = {
  url: string
  qrDataUrl: string
  filename: string
  size: number
  expiresAt: number
}

type AppView = 'builder' | 'editor'

function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  )
}

function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" className="switch-row" onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span className={`switch ${checked ? 'on' : ''}`}><span /></span>
      <span className="switch-copy">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
    </button>
  )
}

function App() {
  const [view, setView] = useState<AppView>('builder')
  const [editorIncoming, setEditorIncoming] = useState<{ id: number; source: string; filename: string }>()
  const [source, setSource] = useState(SAMPLE_YAML)
  const [filename, setFilename] = useState('示例配置.yaml')
  const [mode, setMode] = useState<SelectionMode>('multiple')
  const [selected, setSelected] = useState<Set<string>>(new Set(['香港 01']))
  const [settings, setSettings] = useState<ExitSettings>(initialSettings)
  const [output, setOutput] = useState('')
  const [generatedNames, setGeneratedNames] = useState<string[]>([])
  const [toast, setToast] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [proxyInput, setProxyInput] = useState('')
  const [proxyParseResult, setProxyParseResult] = useState<ParsedProxyInput | null>(null)
  const [proxyParseError, setProxyParseError] = useState('')
  const [showQrShare, setShowQrShare] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareResult, setShareResult] = useState<ShareResult | null>(null)
  const [shareError, setShareError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const qrFileInput = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => {
    try {
      return { data: parseConfig(source), error: '' }
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : 'YAML 解析失败' }
    }
  }, [source])

  const settingErrors = validateSettings(settings)
  const canGenerate = !parsed.error && selected.size > 0 && settingErrors.length === 0

  const flash = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  const sendToEditor = (yaml: string, nextFilename: string) => {
    if (!yaml.trim()) return
    setEditorIncoming({ id: Date.now(), source: yaml, filename: nextFilename })
    setView('editor')
  }

  const receiveFromEditor = (yaml: string, nextFilename: string) => {
    setSource(yaml)
    setFilename(nextFilename || '编辑后的配置.yaml')
    setSelected(new Set())
    setOutput('')
    setGeneratedNames([])
    setView('builder')
    flash('配置已转入出口生成，可以继续添加代理出口')
  }

  const updateSettings = <K extends keyof ExitSettings>(key: K, value: ExitSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
    setOutput('')
  }

  const changeMode = (next: SelectionMode) => {
    setMode(next)
    if (next === 'single' && selected.size > 1) setSelected(new Set([Array.from(selected)[0]]))
  }

  const applyProxyInput = (value: string) => {
    setProxyInput(value)
    try {
      const result = parseProxyInput(value)
      setProxyParseResult(result)
      setProxyParseError('')
      setSettings((current) => ({
        ...current,
        type: result.type ?? current.type,
        server: result.server,
        port: result.port,
        username: result.username ?? '',
        password: result.password ?? '',
        tls: result.tls ?? current.tls,
      }))
      setOutput('')
      flash(`已识别 ${result.format}`)
    } catch (error) {
      setProxyParseResult(null)
      setProxyParseError(error instanceof Error ? error.message : '代理信息识别失败')
    }
  }

  const pasteProxyFromClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText()
      if (!value.trim()) {
        if (proxyInput.trim()) applyProxyInput(proxyInput)
        else flash('剪贴板中没有可识别的文本')
        return
      }
      applyProxyInput(value)
    } catch {
      if (proxyInput.trim()) applyProxyInput(proxyInput)
      else flash('无法读取剪贴板，请先复制代理信息或在输入框内按 Ctrl+V')
    }
  }

  const loadFile = async (file?: File) => {
    if (!file) return
    if (!/\.ya?ml$/i.test(file.name)) {
      flash('请选择 .yaml 或 .yml 文件')
      return
    }
    const text = await file.text()
    setSource(text)
    setFilename(file.name)
    setSelected(new Set())
    setOutput('')
    flash(`已载入 ${file.name}`)
  }

  const generate = () => {
    try {
      const result = buildConfig(source, Array.from(selected), settings)
      setOutput(result.yaml)
      setGeneratedNames(result.generatedNames)
      flash(`已生成 ${result.generatedNames.length} 个出口节点`)
    } catch (error) {
      flash(error instanceof Error ? error.message : '生成失败')
    }
  }

  const copyOutput = async () => {
    if (!output) return
    await navigator.clipboard.writeText(output)
    flash('配置已复制到剪贴板')
  }

  const downloadOutput = () => {
    if (!output) return
    const blob = new Blob([output], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const stem = filename.replace(/\.ya?ml$/i, '') || 'config'
    anchor.href = url
    anchor.download = `${stem}-出口.yaml`
    anchor.click()
    URL.revokeObjectURL(url)
    flash('YAML 已下载')
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const shareLocalFile = async (file?: File) => {
    if (!file) return
    if (file.size > 50 * 1024 * 1024) {
      setShareError('文件不能超过 50 MB')
      return
    }
    setShowQrShare(true)
    setShareBusy(true)
    setShareResult(null)
    setShareError('')
    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      })
      const responseBody = await response.text()
      let result: { url?: string; filename?: string; size?: number; expiresAt?: number; error?: string } = {}
      try {
        result = responseBody ? JSON.parse(responseBody) : {}
      } catch {
        throw new Error('文件传输服务未启动。请关闭旧窗口后重新双击“启动编辑器.cmd”')
      }
      if (!response.ok || !result.url) {
        throw new Error(result.error || '文件传输服务未响应。请关闭旧窗口后重新双击“启动编辑器.cmd”')
      }
      const qrDataUrl = await QRCode.toDataURL(result.url, {
        errorCorrectionLevel: 'M',
        width: 300,
        margin: 2,
        color: { dark: '#19211d', light: '#ffffff' },
      })
      setShareResult({
        url: result.url,
        qrDataUrl,
        filename: result.filename || file.name,
        size: result.size ?? file.size,
        expiresAt: result.expiresAt ?? Date.now() + 30 * 60 * 1000,
      })
    } catch (error) {
      setShareError(error instanceof Error ? error.message : '二维码生成失败')
    } finally {
      setShareBusy(false)
    }
  }

  const shareGeneratedYaml = () => {
    if (!output) return
    const stem = filename.replace(/\.ya?ml$/i, '') || 'config'
    shareLocalFile(new File([output], `${stem}-出口.yaml`, { type: 'text/yaml;charset=utf-8' }))
  }

  const shareYaml = (yaml: string, nextFilename: string) => {
    if (!yaml.trim()) return
    shareLocalFile(new File([yaml], nextFilename, { type: 'text/yaml;charset=utf-8' }))
  }

  const copyShareUrl = async () => {
    if (!shareResult) return
    await navigator.clipboard.writeText(shareResult.url)
    flash('手机下载地址已复制')
  }

  return (
    <div className={`app-shell view-${view}`}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="机场配置修改工具首页" onClick={() => setView('builder')}>
          <span className="brand-mark"><Network size={20} /></span>
          <span>机场配置修改工具</span>
          <span className="version">MIHOMO 2026.05+</span>
        </a>
        <nav>
          <div className="app-view-switcher" role="navigation" aria-label="工具入口">
            <button type="button" className={view === 'builder' ? 'active' : ''} onClick={() => setView('builder')}>出口生成</button>
            <button type="button" className={view === 'editor' ? 'active' : ''} onClick={() => setView('editor')}>配置编辑</button>
          </div>
          <button type="button" className="qr-nav-button" onClick={() => { setShowQrShare(true); setShareError('') }}><QrCode size={15} /> 二维码传文件</button>
          <a href="https://wiki.metacubex.one/en/config/proxies/dialer-proxy/" target="_blank" rel="noreferrer">语法文档 <ArrowRight size={14} /></a>
          <span className="privacy"><ShieldCheck size={15} /> 文件仅在本地处理</span>
        </nav>
      </header>

      <div className={`app-view-panel ${view === 'builder' ? '' : 'is-hidden'}`}>
      <main id="top">
        <section className="hero">
          <div className="eyebrow"><Sparkles size={14} /> MIHOMO 出口编排工具 · 本地安全处理</div>
          <h1>把机场节点接到你的 <em>代理 IP 出口</em></h1>
          <p />
          <div className="hero-stats">
            <span><strong>{parsed.data?.proxies.length ?? 0}</strong> 已识别节点</span>
            <i />
            <span><strong>{selected.size}</strong> 已选择</span>
            <i />
            <span><strong>{output ? generatedNames.length : 0}</strong> 已生成出口</span>
          </div>
        </section>

        <section className="workflow-card">
          <div className="workspace">
            <section className="panel source-panel">
              <div className="panel-heading">
                <div><span className="section-no">01</span><div><h2>导入配置</h2><p>支持标准 Mihomo YAML</p></div></div>
                <button type="button" className="text-button" onClick={() => setShowSource(!showSource)}>
                  {showSource ? '收起源码' : '查看源码'} <ChevronDown className={showSource ? 'rotated' : ''} size={16} />
                </button>
              </div>

              <input ref={fileInput} type="file" accept=".yaml,.yml,text/yaml" hidden onChange={(event) => loadFile(event.target.files?.[0])} />
              <div
                className={`file-zone ${parsed.error ? 'has-error' : ''}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); loadFile(event.dataTransfer.files[0]) }}
              >
                <span className="file-icon"><FileCode2 size={22} /></span>
                <div className="file-copy">
                  <strong>{filename}</strong>
                  <span>{parsed.error ? 'YAML 存在语法错误' : `${parsed.data?.proxies.length ?? 0} 个节点 · ${parsed.data?.groups.length ?? 0} 个策略组`}</span>
                </div>
                <button type="button" className="secondary-button handoff-inline" disabled={!!parsed.error} onClick={() => sendToEditor(source, filename)}><ArrowRightLeft size={15} /> 转到配置编辑</button>
                <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}><FileUp size={16} /> 更换文件</button>
              </div>

              {parsed.error && <div className="inline-error"><CircleAlert size={16} /><span>{parsed.error}</span></div>}
              {showSource && (
                <div className="source-editor-wrap">
                  <div className="editor-bar"><span>YAML 源码</span><button type="button" onClick={() => { setSource(SAMPLE_YAML); setFilename('示例配置.yaml'); setSelected(new Set(['香港 01'])) }}>恢复示例</button></div>
                  <textarea value={source} onChange={(event) => { setSource(event.target.value); setOutput('') }} spellCheck={false} aria-label="YAML 源码" />
                </div>
              )}
            </section>

            <div className="content-grid">
              <NodeManager
                configId="single-config"
                source={source}
                nodes={parsed.data?.proxies ?? []}
                selected={selected}
                mode={mode}
                onModeChange={changeMode}
                onSelectionChange={(next) => { setSelected(next); setOutput('') }}
                onSourceChange={(nextSource, message) => { setSource(nextSource); setOutput(''); setGeneratedNames([]); flash(message) }}
              />

              <section className="panel settings-panel">
                <div className="panel-heading">
                  <div><span className="section-no">03</span><div><h2>配置代理出口</h2><p>为每个所选节点生成出站</p></div></div>
                </div>

                <div className={`proxy-paste-box ${proxyParseError ? 'has-error' : ''} ${proxyParseResult ? 'has-result' : ''}`}>
                  <div className="proxy-paste-heading">
                    <span><ScanLine size={15} /><strong>粘贴识别代理 IP</strong></span>
                    <small>支持代理网站一键复制格式</small>
                  </div>
                  <div className="proxy-paste-input">
                    <textarea
                      value={proxyInput}
                      onChange={(event) => { setProxyInput(event.target.value); setProxyParseResult(null); setProxyParseError('') }}
                      onPaste={(event) => { event.preventDefault(); applyProxyInput(event.clipboardData.getData('text')) }}
                      onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') applyProxyInput(proxyInput) }}
                      placeholder="粘贴 IP:端口:账号:密码、代理链接或网站复制内容"
                      spellCheck={false}
                      aria-label="粘贴代理信息"
                    />
                    <button type="button" onClick={pasteProxyFromClipboard}><ClipboardPaste size={13} />粘贴识别</button>
                  </div>
                  <div className="format-examples"><span>IP:PORT</span><span>IP:PORT:USER:PASS</span><span>USER:PASS@IP:PORT</span><span>URL / JSON / 多行</span></div>
                  {proxyParseResult && <div className="parse-result">
                    <span><CircleCheck size={14} /> {proxyParseResult.format}</span>
                    <code>{proxyParseResult.server}:{proxyParseResult.port}</code>
                    <span>{proxyParseResult.type?.toUpperCase() ?? '沿用当前协议'}</span>
                    {proxyParseResult.username && <span>账号 {proxyParseResult.username}</span>}
                  </div>}
                  {proxyParseError && <div className="proxy-parse-error"><CircleAlert size={14} />{proxyParseError}</div>}
                </div>

                <div className="protocol-tabs">
                  <button className={settings.type === 'socks5' ? 'active' : ''} onClick={() => updateSettings('type', 'socks5')}><span>SOCKS5</span><small>推荐 · 支持 UDP</small></button>
                  <button className={settings.type === 'http' ? 'active' : ''} onClick={() => updateSettings('type', 'http')}><span>HTTP</span><small>HTTP / HTTPS</small></button>
                </div>

                <div className="form-grid">
                  <Field label="出口标识"><input value={settings.label} onChange={(event) => updateSettings('label', event.target.value)} placeholder="例如：住宅出口" /></Field>
                  <Field label="端口"><input type="number" min="1" max="65535" value={settings.port} onChange={(event) => updateSettings('port', Number(event.target.value))} /></Field>
                  <Field label="服务器 IP / 域名" className="span-2"><div className="input-icon"><Server size={16} /><input value={settings.server} onChange={(event) => updateSettings('server', event.target.value)} placeholder="203.0.113.8" /></div></Field>
                  <Field label="用户名" hint="可选"><input value={settings.username} onChange={(event) => updateSettings('username', event.target.value)} placeholder="username" autoComplete="off" /></Field>
                  <Field label="密码" hint="可选"><div className="input-icon"><LockKeyhole size={15} /><input type="password" value={settings.password} onChange={(event) => updateSettings('password', event.target.value)} placeholder="password" autoComplete="new-password" /></div></Field>
                </div>

                <button className="advanced-toggle" type="button" onClick={() => setShowAdvanced(!showAdvanced)}>高级设置 <ChevronDown size={15} className={showAdvanced ? 'rotated' : ''} /></button>
                {showAdvanced && <div className="advanced-box">
                  <Field label="节点命名模板" hint="变量：{node} / {exit}"><input value={settings.nameTemplate} onChange={(event) => updateSettings('nameTemplate', event.target.value)} /></Field>
                  <Field label="出口策略组名称"><input value={settings.groupName} disabled={!settings.createGroup} onChange={(event) => updateSettings('groupName', event.target.value)} /></Field>
                  <div className="switches">
                    {settings.type === 'socks5' && <Switch checked={settings.udp} onChange={(value) => updateSettings('udp', value)} label="启用 UDP" description="向出口节点写入 udp: true" />}
                    <Switch checked={settings.tls} onChange={(value) => updateSettings('tls', value)} label="TLS 连接" description={settings.type === 'http' ? '启用后作为 HTTPS 代理' : '出口服务需支持 TLS'} />
                    {settings.tls && <Switch checked={settings.skipCertVerify} onChange={(value) => updateSettings('skipCertVerify', value)} label="跳过证书验证" description="仅在自签证书时开启" />}
                    <Switch checked={settings.createGroup} onChange={(value) => updateSettings('createGroup', value)} label="创建出口策略组" description="集中展示本次生成的出口节点" />
                    <Switch checked={settings.syncSourceGroups} onChange={(value) => updateSettings('syncSourceGroups', value)} label="同步原策略组" description="在包含原节点的组中加入对应出口" />
                  </div>
                </div>}

                <div className="chain-card">
                  <div className="chain-title"><Zap size={15} /> 实际流量链路</div>
                  <div className="chain-flow">
                    <span><i className="dot local" />本机</span><ArrowRight size={15} />
                    <span><i className="dot airport" />机场节点</span><ArrowRight size={15} />
                    <span><i className="dot exit" />代理 IP</span><ArrowRight size={15} />
                    <span><i className="dot web" />目标网站</span>
                  </div>
                  <p>目标网站最终看到的是 <strong>代理 IP 出口地址</strong></p>
                </div>

                <button className="generate-button" type="button" disabled={!canGenerate} onClick={generate}>
                  <Sparkles size={18} /> 生成 {selected.size || 0} 个出口节点 <ArrowRight size={18} />
                </button>
                {!canGenerate && <div className="form-hint">{parsed.error ? '请先修复 YAML 语法' : selected.size === 0 ? '请先选择至少一个机场节点' : settingErrors[0]}</div>}
              </section>
            </div>

            {output && <section className="panel output-panel">
              <div className="output-heading">
                <div className="success-mark"><CircleCheck size={22} /></div>
                <div><h2>配置已生成</h2><p>新增 {generatedNames.length} 个出口节点，原配置结构与注释已保留</p></div>
                <div className="output-actions">
                  <button className="secondary-button" onClick={copyOutput}><Clipboard size={16} /> 复制</button>
                  <button className="secondary-button" onClick={shareGeneratedYaml}><QrCode size={16} /> 二维码</button>
                  <button className="secondary-button handoff-inline" onClick={() => { const stem = filename.replace(/\.ya?ml$/i, '') || 'config'; sendToEditor(output, `${stem}-出口.yaml`) }}><ArrowRightLeft size={16} /> 继续编辑</button>
                  <button className="download-button" onClick={downloadOutput}><Download size={16} /> 下载 YAML</button>
                </div>
              </div>
              <div className="generated-chips">{generatedNames.map((name) => <span key={name}><Check size={12} />{name}</span>)}</div>
              <pre><code>{output}</code></pre>
            </section>}
          </div>
        </section>

      </main>
      </div>
      <div className={`app-view-panel ${view === 'editor' ? '' : 'is-hidden'}`}>
        <ConfigEditor onFlash={flash} incoming={editorIncoming} onSendToBuilder={receiveFromEditor} onShareYaml={shareYaml} />
      </div>

      <footer>
        <span>机场配置修改工具 · {view === 'builder' ? 'Mihomo 代理 IP 出口编排' : 'Mihomo 配置节点编辑'}</span>
        <a href="https://github.com/MetaCubeX/mihomo" target="_blank" rel="noreferrer"><Github size={15} /> MetaCubeX / mihomo</a>
      </footer>

      {showQrShare && <div className="qr-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowQrShare(false) }}>
        <section className="qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-share-title">
          <button type="button" className="qr-modal-close" onClick={() => setShowQrShare(false)} aria-label="关闭"><X size={18} /></button>
          <div className="qr-modal-heading">
            <span className="qr-modal-icon"><Smartphone size={22} /></span>
            <div><h2 id="qr-share-title">二维码传文件到手机</h2><p>手机与电脑连接同一个 Wi‑Fi，扫码即可下载</p></div>
          </div>

          <input ref={qrFileInput} type="file" hidden onChange={(event) => shareLocalFile(event.target.files?.[0])} />
          {!shareResult && <button
            type="button"
            className={`qr-file-zone ${shareBusy ? 'loading' : ''}`}
            disabled={shareBusy}
            onClick={() => !shareBusy && qrFileInput.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); shareLocalFile(event.dataTransfer.files[0]) }}
          >
            {shareBusy ? <><span className="share-spinner" /><strong>正在创建临时下载地址…</strong><small>请保持程序窗口开启</small></> : <><UploadCloud size={30} /><strong>选择本地文件</strong><small>或将文件拖到这里，最大 50 MB</small></>}
          </button>}

          {shareResult && <div className="qr-share-result">
            <div className="qr-image-wrap"><img src={shareResult.qrDataUrl} alt="手机下载二维码" /></div>
            <div className="qr-share-meta">
              <strong>{shareResult.filename}</strong>
              <span>{formatFileSize(shareResult.size)}</span>
              <span><Clock3 size={13} /> 约 30 分钟后失效</span>
            </div>
            <div className="qr-url-row"><input value={shareResult.url} readOnly aria-label="手机下载地址" /><button type="button" onClick={copyShareUrl}><Clipboard size={14} />复制</button></div>
            <button type="button" className="qr-again-button" onClick={() => { setShareResult(null); setShareError(''); if (qrFileInput.current) qrFileInput.current.value = '' }}>选择其他文件</button>
          </div>}

          {shareError && <div className="qr-share-error"><CircleAlert size={15} />{shareError}</div>}
          <div className="qr-share-note"><ShieldCheck size={14} /><span>文件只在本机内存中临时保存，不上传云端。若手机打不开，请允许 Windows 防火墙的“专用网络”访问。</span></div>
        </section>
      </div>}

      {toast && <div className="toast"><CircleCheck size={17} />{toast}</div>}
    </div>
  )
}

export default App
