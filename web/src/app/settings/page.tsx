'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
// v1: API registry removed for v0

// ── Model definitions ────────────────────────────────────

interface ModelDef {
  id: string
  name: string
  provider: string
  providerColor: string
  priceIn: number       // $/M tokens input
  priceOut: number      // $/M tokens output
  priceLabel: string    // free / $ / $$ / $$$
  description: string
  requiredKey?: string  // which BYOK key unlocks this
  tier?: string         // maps to existing tier system
}

const MODELS: ModelDef[] = [
  {
    id: 'qwen3-coder',
    name: 'Qwen3-Coder',
    provider: 'Alibaba (OpenRouter)',
    providerColor: '#6366f1',
    priceIn: 0, priceOut: 0,
    priceLabel: 'FREE',
    description: 'Fast, free, good for simple tasks',
    tier: 'free',
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'Google',
    providerColor: '#4285f4',
    priceIn: 0.075, priceOut: 0.30,
    priceLabel: '$',
    description: 'Very fast, cheap, multimodal',
    requiredKey: 'google_ai',
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    providerColor: '#00b4d8',
    priceIn: 0.14, priceOut: 0.28,
    priceLabel: '$',
    description: 'Great for code, very cost-effective',
    requiredKey: 'deepseek',
    tier: 'mid',
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    provider: 'Google',
    providerColor: '#4285f4',
    priceIn: 1.25, priceOut: 5.00,
    priceLabel: '$$',
    description: 'Strong reasoning, large context',
    requiredKey: 'google_ai',
  },
  {
    id: 'claude-sonnet',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    providerColor: '#d97706',
    priceIn: 3.00, priceOut: 15.00,
    priceLabel: '$$',
    description: 'Best reasoning, excellent at code',
    requiredKey: 'anthropic',
  },
  {
    id: 'claude-opus',
    name: 'Claude Opus 4.6',
    provider: 'Anthropic',
    providerColor: '#d97706',
    priceIn: 15.00, priceOut: 75.00,
    priceLabel: '$$$',
    description: 'Strongest model available',
    requiredKey: 'anthropic',
  },
]

// Rough cost per message: ~1K tokens in, ~2K tokens out
function estimateCostPerMessage(model: ModelDef): string {
  if (model.priceIn === 0 && model.priceOut === 0) return 'Free'
  const cost = (model.priceIn * 1000 + model.priceOut * 2000) / 1_000_000
  if (cost < 0.001) return '<$0.001'
  return `~$${cost.toFixed(4)}`
}

// ── BYOK key definitions ─────────────────────────────────

interface KeyDef {
  id: string
  label: string
  placeholder: string
  models: string[]
}

const API_KEYS: KeyDef[] = [
  { id: 'anthropic', label: 'Anthropic API Key', placeholder: 'sk-ant-...', models: ['Claude Sonnet 4.6', 'Claude Opus 4.6'] },
  { id: 'openrouter', label: 'OpenRouter API Key', placeholder: 'sk-or-...', models: ['Any model via OpenRouter'] },
  { id: 'deepseek', label: 'DeepSeek API Key', placeholder: 'sk-...', models: ['DeepSeek V3'] },
  { id: 'google_ai', label: 'Google AI API Key', placeholder: 'AIza...', models: ['Gemini 3 Flash', 'Gemini 3 Pro'] },
  { id: 'openai', label: 'OpenAI API Key', placeholder: 'sk-...', models: ['GPT-4o, o3'] },
]

// ── Components ───────────────────────────────────────────

function PriceBadge({ label }: { label: string }) {
  const colors: Record<string, string> = {
    'FREE': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    '$': 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    '$$': 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    '$$$': 'bg-red-500/15 text-red-400 border-red-500/25',
  }
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${colors[label] || 'bg-[#222] text-[#888] border-[#333]'}`}>
      {label}
    </span>
  )
}

function ModelCard({ model, selected, available, onSelect }: {
  model: ModelDef
  selected: boolean
  available: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      disabled={!available}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        selected
          ? 'border-[#ff0505] bg-[#ff0505]/5'
          : available
            ? 'border-[#222] bg-[#141414] hover:border-[#444] hover:bg-[#1a1a1a]'
            : 'border-[#1a1a1a] bg-[#0e0e0e] opacity-40 cursor-not-allowed'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">{model.name}</span>
            <PriceBadge label={model.priceLabel} />
          </div>
          <p className="text-[11px] text-[#666] mt-0.5">{model.provider}</p>
          <p className="text-xs text-[#888] mt-1">{model.description}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-[#555] font-mono">{estimateCostPerMessage(model)}/msg</p>
          {selected && (
            <div className="mt-1 w-2 h-2 rounded-full bg-[#ff0505] ml-auto" />
          )}
        </div>
      </div>
      {!available && model.requiredKey && (
        <p className="text-[10px] text-[#444] mt-2">Requires {API_KEYS.find(k => k.id === model.requiredKey)?.label}</p>
      )}
    </button>
  )
}

function KeyInput({ keyDef, value, onChange, onVerify, verifyStatus }: {
  keyDef: KeyDef
  value: string
  onChange: (v: string) => void
  onVerify: () => void
  verifyStatus: 'idle' | 'checking' | 'valid' | 'invalid'
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs text-[#888]">{keyDef.label}</label>
        <span className="text-[10px] text-[#444]">{keyDef.models.join(', ')}</span>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={keyDef.placeholder}
            className="w-full px-3 py-2 bg-[#141414] border border-[#222] rounded-lg text-sm text-white placeholder-[#333] focus:outline-none focus:border-[#ff0505]/40 pr-8 font-mono"
          />
          <button
            onClick={() => setVisible(!visible)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888]"
          >
            {visible ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        </div>
        <button
          onClick={onVerify}
          disabled={!value || verifyStatus === 'checking'}
          className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
            verifyStatus === 'valid'
              ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
              : verifyStatus === 'invalid'
                ? 'border-red-500/40 text-red-400 bg-red-500/10'
                : 'border-[#333] text-[#888] bg-[#1a1a1a] hover:border-[#555] disabled:opacity-30'
          }`}
        >
          {verifyStatus === 'checking' ? '...' : verifyStatus === 'valid' ? 'Valid' : verifyStatus === 'invalid' ? 'Bad' : 'Verify'}
        </button>
      </div>
    </div>
  )
}

// v1: UsageData types and CostBar component removed for v0 (no billing)

// ── Main Settings Page ───────────────────────────────────

export default function SettingsPage() {
  const [selectedModel, setSelectedModel] = useState('qwen3-coder')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [keyStatus, setKeyStatus] = useState<Record<string, 'idle' | 'checking' | 'valid' | 'invalid'>>({})
  const [useLocalClaude, setUseLocalClaude] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // v1: usage, billingLoading, apiData, apiFilter state removed for v0

  // Load settings
  useEffect(() => {
    // Load keys from localStorage
    try {
      const stored = localStorage.getItem('daemon_api_keys')
      if (stored) setKeys(JSON.parse(stored))
    } catch {}

    // Load model preference from server
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (data.model) setSelectedModel(data.model)
        if (data.useLocalClaude) setUseLocalClaude(data.useLocalClaude)
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    // v1: usage and API registry fetches removed for v0
  }, [])

  // Check which models are available (free always, others need keys or local claude)
  const availableModels = new Set(['qwen3-coder'])
  if (keys.deepseek) availableModels.add('deepseek-v3')
  if (keys.anthropic) { availableModels.add('claude-sonnet'); availableModels.add('claude-opus') }
  if (keys.google_ai) { availableModels.add('gemini-3-flash'); availableModels.add('gemini-3-pro') }
  if (keys.openrouter) MODELS.forEach(m => availableModels.add(m.id))
  if (useLocalClaude) { availableModels.add('claude-sonnet'); availableModels.add('claude-opus') }

  const saveSettings = useCallback(async (model: string, localClaude: boolean) => {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, useLocalClaude: localClaude }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {}
    setSaving(false)
  }, [])

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId)
    saveSettings(modelId, useLocalClaude)
  }

  const handleKeyChange = (keyId: string, value: string) => {
    const next = { ...keys, [keyId]: value }
    setKeys(next)
    setKeyStatus(s => ({ ...s, [keyId]: 'idle' }))
    try { localStorage.setItem('daemon_api_keys', JSON.stringify(next)) } catch {}
  }

  const handleVerifyKey = async (keyId: string) => {
    setKeyStatus(s => ({ ...s, [keyId]: 'checking' }))
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifyKey: keyId, keyValue: keys[keyId] }),
      })
      const data = await res.json()
      setKeyStatus(s => ({ ...s, [keyId]: data.valid ? 'valid' : 'invalid' }))
    } catch {
      setKeyStatus(s => ({ ...s, [keyId]: 'invalid' }))
    }
  }

  const toggleLocalClaude = () => {
    const next = !useLocalClaude
    setUseLocalClaude(next)
    saveSettings(selectedModel, next)
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-[#333] text-sm">loading...</div>
      </div>
    )
  }

  return (
    <div className="h-[100dvh] bg-[#0a0a0a] text-[#bfbfbf] overflow-y-auto">
      {/* Header */}
      <div className="h-12 border-b border-[#222] flex items-center justify-between px-4 bg-[#111] sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/chat" className="text-[#555] hover:text-[#888] transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </Link>
          <Image src="/brand/favicon.png" alt="daemon" width={20} height={20} />
          <span className="text-sm font-medium text-white">Settings</span>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[10px] text-emerald-400">Saved</span>}
          {saving && <span className="text-[10px] text-[#555]">Saving...</span>}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        {/* ── Models ────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-medium text-white">Models</h2>
          </div>
          <p className="text-xs text-[#555] mb-4">Choose your default model. Cost scales with capability.</p>

          {/* Pareto front visual */}
          <div className="mb-4 px-2">
            <div className="flex items-end justify-between h-16 relative">
              {MODELS.map((m, i) => {
                const isSelected = m.id === selectedModel
                const isAvailable = availableModels.has(m.id)
                // Position along x-axis (cost), height = capability
                const xPct = (i / (MODELS.length - 1)) * 100
                const heights = [25, 40, 55, 70, 85, 100]
                const hPct = heights[i]
                return (
                  <div
                    key={m.id}
                    className="absolute bottom-0 flex flex-col items-center"
                    style={{ left: `${xPct}%`, transform: 'translateX(-50%)' }}
                  >
                    <div
                      className={`w-2.5 h-2.5 rounded-full transition-all ${
                        isSelected
                          ? 'bg-[#ff0505] ring-2 ring-[#ff0505]/30 scale-125'
                          : isAvailable
                            ? 'bg-[#444]'
                            : 'bg-[#222]'
                      }`}
                      style={{ marginBottom: `${hPct * 0.5}px` }}
                    />
                  </div>
                )
              })}
              {/* Axis labels */}
              <div className="absolute -bottom-4 left-0 text-[9px] text-[#333]">free</div>
              <div className="absolute -bottom-4 right-0 text-[9px] text-[#333]">$$$</div>
              <div className="absolute -left-1 top-0 text-[9px] text-[#333] -rotate-90 origin-bottom-left" style={{ transformOrigin: 'bottom left' }}>power</div>
            </div>
          </div>

          <div className="grid gap-2">
            {MODELS.map(m => (
              <ModelCard
                key={m.id}
                model={m}
                selected={m.id === selectedModel}
                available={availableModels.has(m.id)}
                onSelect={() => handleModelSelect(m.id)}
              />
            ))}
          </div>
        </section>

        {/* ── API Keys (BYOK) ──────────────────────────────── */}
        <section>
          <h2 className="text-lg font-medium text-white mb-1">Bring Your Own Keys</h2>
          <p className="text-xs text-[#555] mb-4">
            Paste your API keys to use any model. Keys stay in your browser -- we never store them on our servers.
          </p>

          <div className="space-y-4">
            {API_KEYS.map(k => (
              <KeyInput
                key={k.id}
                keyDef={k}
                value={keys[k.id] || ''}
                onChange={(v) => handleKeyChange(k.id, v)}
                onVerify={() => handleVerifyKey(k.id)}
                verifyStatus={keyStatus[k.id] || 'idle'}
              />
            ))}
          </div>
        </section>

        {/* ── Claude Code / Max Subscription ────────────────── */}
        <section>
          <h2 className="text-lg font-medium text-white mb-1">Link Claude Max</h2>
          <p className="text-xs text-[#555] mb-4">
            Have Claude Max ($100/mo)? Link it for unlimited Claude through Daemon — no per-token charges.
          </p>

          <button
            onClick={toggleLocalClaude}
            className={`flex items-center gap-3 w-full p-3 rounded-xl border transition-all ${
              useLocalClaude
                ? 'border-[#ff0505] bg-[#ff0505]/5'
                : 'border-[#222] bg-[#141414] hover:border-[#444]'
            }`}
          >
            <div className={`w-10 h-5 rounded-full transition-colors relative ${useLocalClaude ? 'bg-[#ff0505]' : 'bg-[#333]'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${useLocalClaude ? 'left-5' : 'left-0.5'}`} />
            </div>
            <div className="text-left">
              <p className="text-sm text-white">Use my Claude Max subscription</p>
              <p className="text-[10px] text-[#555]">Routes through Claude CLI on your connected device</p>
            </div>
          </button>

          {useLocalClaude && (
            <div className="mt-3 p-3 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
              <p className="text-[11px] text-[#888] mb-2">How it works:</p>
              <ol className="text-[11px] text-[#666] space-y-1.5 list-decimal list-inside">
                <li>Install daemon on a machine where <code className="text-[#ff0505] bg-[#1a1a1a] px-1 rounded">claude</code> CLI is logged in</li>
                <li>The daemon bridge detects Claude and reports it as a capability</li>
                <li>When you select Claude models, requests route through your CLI — unlimited, no extra cost</li>
              </ol>
              <div className="mt-3 flex items-center gap-2 text-[10px]">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-[#888]">Claude CLI detected on: <strong className="text-white">arturito</strong></span>
              </div>
            </div>
          )}
        </section>

        {/* v1: APIs & Integrations section removed for v0 */}

        {/* v1: Usage & Billing section removed for v0 */}

        {/* ── Auto Model Routing ──────────────────────────── */}
        <section>
          <h2 className="text-lg font-medium text-white mb-1">Auto Model Routing</h2>
          <p className="text-xs text-[#555] mb-4">
            Daemon picks the best model per task. High reasoning gets Opus, coding sub-agents get DeepSeek, quick lookups get Qwen.
          </p>

          <div className="p-4 rounded-xl border border-[#222] bg-[#141414]">
            {/* Flow diagram */}
            <div className="space-y-3">
              {[
                { label: 'You ask a question', model: 'Opus', cost: '~$0.02', color: '#d97706', desc: 'Brainstorming, planning, complex reasoning' },
                { label: 'Code sub-agent', model: 'DeepSeek', cost: '~$0.001', color: '#00b4d8', desc: 'Writing code, refactoring, debugging' },
                { label: 'Quick lookup', model: 'Qwen3', cost: 'Free', color: '#6366f1', desc: 'Simple questions, file searches, summaries' },
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0" style={{ borderColor: step.color }}>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: step.color }} />
                  </div>
                  {i > 0 && (
                    <div className="absolute ml-3 -mt-6 w-px h-3 bg-[#333]" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white">{step.label}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: `${step.color}40`, color: step.color, backgroundColor: `${step.color}10` }}>
                        {step.model}
                      </span>
                      <span className="text-[10px] font-mono text-[#555] ml-auto">{step.cost}</span>
                    </div>
                    <p className="text-[10px] text-[#444] mt-0.5">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-[#1a1a1a]">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-[#888]">Example conversation cost</p>
                <p className="text-xs font-mono text-white">
                  $0.02 + $0.001 + $0.00 = <span className="text-emerald-400">$0.021</span>
                </p>
              </div>
              <p className="text-[10px] text-[#444] mt-1">
                vs. $0.06+ if everything ran on Opus
              </p>
            </div>
          </div>
        </section>

        {/* Bottom spacing */}
        <div className="h-8" />
      </div>
    </div>
  )
}
