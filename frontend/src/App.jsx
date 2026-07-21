import { useEffect, useMemo, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const SESSION_KEY = 'nostr-marketing-session'

const emptyCampaignForm = {
  name: '',
  productDescription: '',
  keywords: '',
  nwcUrl: '',
  satsPerImpact: '',
  endsAt: '',
}

function App() {
  const [session, setSession] = useState(() => readSession())
  const [authMode, setAuthMode] = useState('login')
  const [campaigns, setCampaigns] = useState([])
  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [campaignForm, setCampaignForm] = useState(emptyCampaignForm)
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [savingCampaign, setSavingCampaign] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const totals = useMemo(() => summarizeCampaigns(campaigns), [campaigns])

  useEffect(() => {
    if (session?.token) {
      loadCampaigns()
    }
    // loadCampaigns is intentionally triggered only when the active token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token])

  async function request(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        ...options.headers,
      },
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(extractError(payload, response.statusText))
    }
    return payload
  }

  async function handleAuth(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      if (authMode === 'register') {
        await request('/companies', {
          method: 'POST',
          body: JSON.stringify({
            name: authForm.name.trim(),
            email: authForm.email.trim(),
            password: authForm.password,
          }),
        })
      }

      const login = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: authForm.email.trim(),
          password: authForm.password,
        }),
      })

      const nextSession = {
        token: login.access_token,
        company: login.company ?? { email: authForm.email.trim(), name: authForm.name.trim() },
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession))
      setSession(nextSession)
      setAuthForm({ name: '', email: '', password: '' })
    } catch (authError) {
      setError(authError.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadCampaigns() {
    setLoading(true)
    setError('')

    try {
      const data = await request('/campaigns')
      setCampaigns(data)
      if (selectedCampaign) {
        const refreshed = data.find((campaign) => campaign.id === selectedCampaign.id)
        if (!refreshed) setSelectedCampaign(null)
      }
    } catch (loadError) {
      setError(loadError.message)
      if (loadError.message.includes('Unauthorized')) handleLogout()
    } finally {
      setLoading(false)
    }
  }

  async function loadCampaignDetail(campaignId) {
    setDetailLoading(true)
    setError('')

    try {
      const detail = await request(`/campaigns/${campaignId}`)
      setSelectedCampaign(detail)
    } catch (detailError) {
      setError(detailError.message)
    } finally {
      setDetailLoading(false)
    }
  }

  async function createCampaign(event) {
    event.preventDefault()
    setSavingCampaign(true)
    setError('')
    setMessage('')

    try {
      await request('/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: campaignForm.name.trim(),
          productDescription: campaignForm.productDescription.trim(),
          keywords: campaignForm.keywords
            .split(',')
            .map((keyword) => keyword.trim())
            .filter(Boolean),
          nwcUrl: campaignForm.nwcUrl.trim(),
          satsPerImpact: Number(campaignForm.satsPerImpact),
          endsAt: new Date(campaignForm.endsAt).toISOString(),
        }),
      })

      setCampaignForm(emptyCampaignForm)
      setMessage('Campaña creada correctamente.')
      await loadCampaigns()
    } catch (createError) {
      setError(createError.message)
    } finally {
      setSavingCampaign(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setCampaigns([])
    setSelectedCampaign(null)
  }

  if (!session?.token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
        <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
              Nostr Marketing
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">
              {authMode === 'login' ? 'Iniciar sesión' : 'Registrar empresa'}
            </h1>
          </div>

          <form className="space-y-4" onSubmit={handleAuth}>
            {authMode === 'register' && (
              <Field
                label="Empresa"
                value={authForm.name}
                onChange={(value) => setAuthForm((form) => ({ ...form, name: value }))}
                required
              />
            )}
            <Field
              label="Email"
              type="email"
              value={authForm.email}
              onChange={(value) => setAuthForm((form) => ({ ...form, email: value }))}
              required
            />
            <Field
              label="Password"
              type="password"
              value={authForm.password}
              onChange={(value) => setAuthForm((form) => ({ ...form, password: value }))}
              minLength={6}
              required
            />

            <Alert error={error} message={message} />

            <button
              className="w-full rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading}
              type="submit"
            >
              {loading ? 'Procesando...' : authMode === 'login' ? 'Entrar' : 'Crear cuenta'}
            </button>
          </form>

          <button
            className="mt-4 w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            onClick={() => {
              setAuthMode((mode) => (mode === 'login' ? 'register' : 'login'))
              setError('')
              setMessage('')
            }}
            type="button"
          >
            {authMode === 'login' ? 'Registrar una empresa' : 'Ya tengo cuenta'}
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
              Nostr Marketing
            </p>
            <h1 className="text-2xl font-semibold text-slate-950">
              Campañas e impactos
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
              {session.company?.name || session.company?.email}
            </span>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={handleLogout}
              type="button"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-6">
        <section className="space-y-6">
          <Alert error={error} message={message} />
          <Metrics totals={totals} />
          <CampaignList
            campaigns={campaigns}
            loading={loading}
            onRefresh={loadCampaigns}
            onSelect={loadCampaignDetail}
            selectedCampaignId={selectedCampaign?.id}
          />
          <CampaignDetail campaign={selectedCampaign} loading={detailLoading} />
        </section>

        <aside className="h-fit rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Nueva campaña</h2>
          <form className="mt-4 space-y-4" onSubmit={createCampaign}>
            <Field
              label="Nombre"
              value={campaignForm.name}
              onChange={(value) => setCampaignForm((form) => ({ ...form, name: value }))}
              required
            />
            <TextArea
              label="Descripción del producto"
              value={campaignForm.productDescription}
              onChange={(value) =>
                setCampaignForm((form) => ({ ...form, productDescription: value }))
              }
              required
            />
            <Field
              label="Keywords"
              placeholder="bitcoin, wallet, pagos"
              value={campaignForm.keywords}
              onChange={(value) => setCampaignForm((form) => ({ ...form, keywords: value }))}
              required
            />
            <Field
              label="NWC URL"
              value={campaignForm.nwcUrl}
              onChange={(value) => setCampaignForm((form) => ({ ...form, nwcUrl: value }))}
              required
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Field
                label="Sats por impacto"
                min="0"
                type="number"
                value={campaignForm.satsPerImpact}
                onChange={(value) =>
                  setCampaignForm((form) => ({ ...form, satsPerImpact: value }))
                }
                required
              />
              <Field
                label="Finaliza"
                type="datetime-local"
                value={campaignForm.endsAt}
                onChange={(value) => setCampaignForm((form) => ({ ...form, endsAt: value }))}
                required
              />
            </div>
            <button
              className="w-full rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={savingCampaign}
              type="submit"
            >
              {savingCampaign ? 'Creando...' : 'Crear campaña'}
            </button>
          </form>
        </aside>
      </div>
    </main>
  )
}

function CampaignList({ campaigns, loading, onRefresh, onSelect, selectedCampaignId }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-950">Campañas</h2>
        <button
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          onClick={onRefresh}
          type="button"
        >
          Actualizar
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Nombre</th>
              <th className="px-5 py-3 font-semibold">Estado</th>
              <th className="px-5 py-3 font-semibold">Impactos</th>
              <th className="px-5 py-3 font-semibold">Total</th>
              <th className="px-5 py-3 font-semibold">Finaliza</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && campaigns.length === 0 ? (
              <tr>
                <td className="px-5 py-8 text-center text-slate-500" colSpan="5">
                  Cargando campañas...
                </td>
              </tr>
            ) : campaigns.length === 0 ? (
              <tr>
                <td className="px-5 py-8 text-center text-slate-500" colSpan="5">
                  No hay campañas todavía.
                </td>
              </tr>
            ) : (
              campaigns.map((campaign) => (
                <tr
                  className={`cursor-pointer transition hover:bg-emerald-50 ${
                    selectedCampaignId === campaign.id ? 'bg-emerald-50' : ''
                  }`}
                  key={campaign.id}
                  onClick={() => onSelect(campaign.id)}
                >
                  <td className="px-5 py-4">
                    <div className="font-medium text-slate-950">{campaign.name}</div>
                    <div className="mt-1 max-w-sm truncate text-slate-500">
                      {campaign.productDescription}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={campaign.status} />
                  </td>
                  <td className="px-5 py-4 text-slate-700">{campaign.impactsCount}</td>
                  <td className="px-5 py-4 font-medium text-slate-950">
                    {formatSats(campaign.totalSpentSats)}
                  </td>
                  <td className="px-5 py-4 text-slate-600">{formatDate(campaign.endsAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CampaignDetail({ campaign, loading }) {
  if (loading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
        Cargando detalle...
      </section>
    )
  }

  if (!campaign) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Selecciona una campaña para ver sus impactos.
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{campaign.name}</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              {campaign.productDescription}
            </p>
          </div>
          <StatusBadge status={campaign.status} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(campaign.keywords ?? []).map((keyword) => (
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-700" key={keyword}>
              {keyword}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 border-b border-slate-200 p-5 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Zap enviado" value={formatSats(campaign.totalZapSats)} />
        <Metric label="Fee Lightning" value={formatSats(campaign.totalLightningFeeSats)} />
        <Metric label="Fee plataforma" value={formatSats(campaign.totalPlatformFeeSats)} />
        <Metric label="Total gastado" value={formatSats(campaign.totalSpentSats)} />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Usuario</th>
              <th className="px-5 py-3 font-semibold">Post</th>
              <th className="px-5 py-3 font-semibold">Keywords</th>
              <th className="px-5 py-3 font-semibold">Zap</th>
              <th className="px-5 py-3 font-semibold">Fee LN</th>
              <th className="px-5 py-3 font-semibold">Fee plataforma</th>
              <th className="px-5 py-3 font-semibold">Total</th>
              <th className="px-5 py-3 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(campaign.impacts ?? []).length === 0 ? (
              <tr>
                <td className="px-5 py-8 text-center text-slate-500" colSpan="8">
                  Esta campaña todavía no tiene impactos.
                </td>
              </tr>
            ) : (
              campaign.impacts.map((impact) => (
                <tr key={impact.id}>
                  <td className="px-5 py-4 font-mono text-xs text-slate-700">
                    {shorten(impact.targetPubkey)}
                  </td>
                  <td className="px-5 py-4">
                    <div className="max-w-md text-slate-700">
                      {impact.targetContent || 'No disponible'}
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-400">
                      {shorten(impact.targetEventId)}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex min-w-40 flex-wrap gap-1.5">
                      {(impact.foundKeywords ?? []).length === 0 ? (
                        <span className="text-slate-400">No disponible</span>
                      ) : (
                        impact.foundKeywords.map((keyword) => (
                          <span
                            className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
                            key={keyword}
                          >
                            {keyword}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-700">{formatSats(impact.zapSats)}</td>
                  <td className="px-5 py-4 text-slate-700">
                    {formatSats(impact.lightningFeeSats)}
                  </td>
                  <td className="px-5 py-4 text-slate-700">{formatSats(impact.platformFee)}</td>
                  <td className="px-5 py-4 font-medium text-slate-950">
                    {formatSats(impact.totalSpentSats)}
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={impact.status} />
                    <div className="mt-1 text-xs text-slate-400">{formatDate(impact.createdAt)}</div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Metrics({ totals }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="Campañas activas" value={totals.activeCampaigns} />
      <Metric label="Impactos" value={totals.impactsCount} />
      <Metric label="Zap enviado" value={formatSats(totals.totalZapSats)} />
      <Metric label="Fees" value={formatSats(totals.totalLightningFeeSats + totals.totalPlatformFeeSats)} />
      <Metric label="Total gastado" value={formatSats(totals.totalSpentSats)} />
    </section>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  )
}

function Field({ label, onChange, ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </label>
  )
}

function TextArea({ label, value, onChange, ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea
        className="mt-1 min-h-24 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        onChange={(event) => onChange(event.target.value)}
        value={value}
        {...props}
      />
    </label>
  )
}

function Alert({ error, message }) {
  if (!error && !message) return null

  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${
        error
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      }`}
    >
      {error || message}
    </div>
  )
}

function StatusBadge({ status }) {
  const colors = {
    active: 'bg-emerald-100 text-emerald-800',
    completed: 'bg-blue-100 text-blue-800',
    paused: 'bg-amber-100 text-amber-800',
    cancelled: 'bg-red-100 text-red-800',
    full_success: 'bg-emerald-100 text-emerald-800',
    comment_only: 'bg-amber-100 text-amber-800',
  }

  return (
    <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${colors[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {formatStatus(status)}
    </span>
  )
}

function readSession() {
  try {
    const storedSession = localStorage.getItem(SESSION_KEY)
    return storedSession ? JSON.parse(storedSession) : null
  } catch {
    return null
  }
}

function summarizeCampaigns(campaigns) {
  return campaigns.reduce(
    (totals, campaign) => ({
      activeCampaigns: totals.activeCampaigns + (campaign.status === 'active' ? 1 : 0),
      impactsCount: totals.impactsCount + (campaign.impactsCount ?? 0),
      totalZapSats: totals.totalZapSats + (campaign.totalZapSats ?? 0),
      totalLightningFeeSats:
        totals.totalLightningFeeSats + (campaign.totalLightningFeeSats ?? 0),
      totalPlatformFeeSats: totals.totalPlatformFeeSats + (campaign.totalPlatformFeeSats ?? 0),
      totalSpentSats: totals.totalSpentSats + (campaign.totalSpentSats ?? 0),
    }),
    {
      activeCampaigns: 0,
      impactsCount: 0,
      totalZapSats: 0,
      totalLightningFeeSats: 0,
      totalPlatformFeeSats: 0,
      totalSpentSats: 0,
    },
  )
}

function extractError(payload, fallback) {
  if (Array.isArray(payload.message)) return payload.message.join(', ')
  return payload.message ?? fallback ?? 'Ocurrió un error'
}

function formatSats(value) {
  return `${Number(value ?? 0).toLocaleString()} sats`
}

function formatDate(value) {
  if (!value) return 'No disponible'
  return new Intl.DateTimeFormat('es', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatStatus(status) {
  return String(status ?? 'unknown').replaceAll('_', ' ')
}

function shorten(value) {
  if (!value) return 'No disponible'
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}...${value.slice(-8)}`
}

export default App
