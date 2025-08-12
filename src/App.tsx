import React, { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts'
import { Plus, Trash2, Download, Upload } from 'lucide-react'

const PALETTE = {
  bg: '#CDD2D3',
  card: '#F2F6F7',
  text: '#707070',
  line: '#92989A',
  accent: '#707070',
}

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const fmtCOP = (cents?: number | null) => {
  const safe = Object.is(cents, -0) ? 0 : (cents ?? 0)
  return COP.format(safe / 100)
}
const toCents = (str: string) => {
  if (!str) return 0
  const s = ('' + str).replace(/[^0-9.,-]/g, '').replace(/,/g, '.')
  const v = parseFloat(s)
  if (isNaN(v)) return 0
  return Math.round(v * 100)
}
const todayStr = () => new Date().toISOString().slice(0, 10)

const ACCOUNT_TYPES = { CASH: 'CASH', CREDIT: 'CREDIT' } as const
type AccountType = typeof ACCOUNT_TYPES[keyof typeof ACCOUNT_TYPES]

const PAYMENT_METHODS = [
  { id: 'VISA', label: 'Tarjeta de crédito Visa', accountName: 'Tarjeta Visa' },
  { id: 'DEBITO_AHORROS', label: 'Tarjeta débito cuenta de ahorros', accountName: 'Cuenta de ahorros' },
  { id: 'NEQUI', label: 'Nequi', accountName: 'Nequi' },
  { id: 'DAVIPLATA', label: 'Daviplata', accountName: 'Daviplata' },
  { id: 'CUENTA_AHORROS', label: 'Cuenta de ahorros', accountName: 'Cuenta de ahorros' },
  { id: 'EFECTIVO', label: 'Efectivo', accountName: 'Efectivo' },
]

type Account = { id: string; name: string; type: AccountType; initialBalanceCents?: number; creditLimitCents?: number; initialDebtCents?: number }
const defaultAccounts: Account[] = [
  { id: 'ahorros',  name: 'Cuenta de ahorros', type: ACCOUNT_TYPES.CASH,   initialBalanceCents: 0 },
  { id: 'empresa',  name: 'Cuenta de la empresa', type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: 'efectivo', name: 'Efectivo',            type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: 'nequi',    name: 'Nequi',               type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: 'daviplata',name: 'Daviplata',           type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: 'visa',     name: 'Tarjeta Visa',        type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 300000000, initialDebtCents: 0 },
  { id: 'rotativo', name: 'Crédito rotativo',    type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 500000000, initialDebtCents: 0 },
]

type Category = { id: string; name: string; kind: 'GASTO' | 'INGRESO' }
const defaultCategories: Category[] = [
  { id: 'vivienda_servicios', name: 'Vivienda - Servicios', kind: 'GASTO' },
  { id: 'mercado', name: 'Mercado', kind: 'GASTO' },
  { id: 'restaurantes_ocio', name: 'Restaurantes - Ocio', kind: 'GASTO' },
  { id: 'transporte', name: 'Transporte', kind: 'GASTO' },
  { id: 'salud_bienestar', name: 'Salud - bienestar', kind: 'GASTO' },
  { id: 'mascota', name: 'Mascota', kind: 'GASTO' },
  { id: 'aseo_hogar', name: 'Aseo - hogar', kind: 'GASTO' },
  { id: 'suscripciones', name: 'Suscripciones', kind: 'GASTO' },
  { id: 'trabajos', name: 'Trabajos', kind: 'INGRESO' },
  { id: 'ventas_reembolsos', name: 'Ventas - reembolsos', kind: 'INGRESO' },
  { id: 'rendimientos', name: 'Rendimientos', kind: 'INGRESO' },
]

const LS_KEYS = { ACCOUNTS: 'ga_accounts', CATEGORIES: 'ga_categories', TXS: 'ga_transactions' }
function useLocalState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : initial
  })
  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)) }, [key, state])
  return [state, setState] as const
}

function computeBalances(accounts: Account[], txs: any[]) {
  const ef: Record<string, number> = {}
  const debt: Record<string, number> = {}
  accounts.forEach(a => { a.type === ACCOUNT_TYPES.CASH ? ef[a.id] = a.initialBalanceCents || 0 : debt[a.id] = a.initialDebtCents || 0 })

  txs.forEach(t => {
    if (t.type === 'INGRESO') {
      if (t.accountToId && ef[t.accountToId] !== undefined) ef[t.accountToId] += t.amountCents
    } else if (t.type === 'GASTO') {
      const acc = accounts.find(a => a.id === t.accountFromId)
      if (acc?.type === ACCOUNT_TYPES.CREDIT) debt[acc.id] = (debt[acc.id] || 0) + t.amountCents
      else if (acc?.type === ACCOUNT_TYPES.CASH) ef[acc.id] = (ef[acc.id] || 0) - t.amountCents
    } else if (t.type === 'TRANSFERENCIA') {
      const from = accounts.find(a => a.id === t.accountFromId)
      const to = accounts.find(a => a.id === t.accountToId)
      if (!from || !to || from.id === to.id) return
      if (to.type === ACCOUNT_TYPES.CREDIT) {
        debt[to.id] = (debt[to.id] || 0) - t.amountCents
        if (from.type === ACCOUNT_TYPES.CASH) ef[from.id] = (ef[from.id] || 0) - t.amountCents
      } else if (from.type === ACCOUNT_TYPES.CASH && to.type === ACCOUNT_TYPES.CASH) {
        ef[from.id] = (ef[from.id] || 0) - t.amountCents
        ef[to.id] = (ef[to.id] || 0) + t.amountCents
      }
    }
  })

  let creditoDisponibleTotal = 0
  const perAccount = accounts.map(a => {
    if (a.type === ACCOUNT_TYPES.CREDIT) {
      const d = debt[a.id] || 0
      const disp = (a.creditLimitCents || 0) - d
      creditoDisponibleTotal += disp
      return { account: a, balanceCents: -d, creditAvailableCents: disp }
    }
    return { account: a, balanceCents: ef[a.id] || 0, creditAvailableCents: null }
  })
  const efectivoTotal = Object.values(ef).reduce((a, b) => a + b, 0)
  return { accounts: perAccount, efectivoTotal, creditoDisponibleTotal }
}

function monthKey(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

function buildCSV(txs: any[]) {
  const header = 'id,type,date,amountCents,accountFromId,accountToId,categoryId,paymentMethod,note'
  const rows = txs.map(t => [t.id, t.type, t.date, t.amountCents, t.accountFromId || '', t.accountToId || '', t.categoryId || '', t.paymentMethod || '', (t.note || '').replace(/,/g,';')].join(','))
  return [header, ...rows].join('\n')
}
function parseCSV(text: string) {
  const clean = text.replace(/\r/g,'')
  const lines = clean.split('\n').filter(Boolean)
  if (lines.length <= 1) return []
  return lines.slice(1).map(line => {
    const [id, type, date, amountCents, accountFromId, accountToId, categoryId, paymentMethod, note] = line.split(',')
    return { id: id || crypto.randomUUID(), type, date, amountCents: Number(amountCents || 0), accountFromId: accountFromId || null, accountToId: accountToId || null, categoryId: categoryId || null, paymentMethod: paymentMethod || null, note: note || null, createdAt: Date.now(), updatedAt: Date.now() }
  })
}

const cardStyle: React.CSSProperties = { backgroundColor: PALETTE.card, color: PALETTE.text, border: 'none', borderRadius: 24 }
const inputCls = 'w-full rounded-xl px-3 py-2 outline-none'
const inputStyle: React.CSSProperties = { backgroundColor: '#FAFEFF', color: PALETTE.text, border: 'none', boxShadow: 'none' }
const tabBase = 'flex-1 px-4 py-2 rounded-xl font-semibold tracking-wide'
const disabledField: React.CSSProperties = { opacity: 0.55 }

export default function App() {
  const [accounts] = useLocalState<Account[]>(LS_KEYS.ACCOUNTS, defaultAccounts)
  const [categories, setCategories] = useLocalState<Category[]>(LS_KEYS.CATEGORIES, defaultCategories)
  useEffect(() => {
    if (!Array.isArray(categories) || categories.some(c => !(c as any).kind)) setCategories(defaultCategories)
  }, [categories, setCategories])
  const [txs, setTxs] = useLocalState<any[]>(LS_KEYS.TXS, [])
  const [tab, setTab] = useState<'dashboard'|'reportes'>('dashboard')

  const summary = useMemo(() => computeBalances(accounts, txs), [accounts, txs])

  const [form, setForm] = useState<any>({ type: 'TRANSFERENCIA', date: todayStr(), amount: '', accountFromId: 'visa', accountToId: 'ahorros', paymentMethod: 'VISA', categoryId: null, note: '' })
  useEffect(() => {
    if (form.type === 'GASTO') {
      const pm = PAYMENT_METHODS.find(m => m.id === form.paymentMethod)
      if (pm) {
        const target = accounts.find(a => a.name.includes(pm.accountName))
        if (target && form.accountFromId !== target.id) setForm((f:any) => ({ ...f, accountFromId: target.id }))
      }
    }
  }, [form.paymentMethod, form.type, accounts])

  useEffect(() => {
    const isGastoLocal = form.type === 'GASTO'
    const isIngresoLocal = form.type === 'INGRESO'
    const isTransfLocal = form.type === 'TRANSFERENCIA'
    if (isTransfLocal) { if (form.categoryId) setForm((f:any)=>({ ...f, categoryId: null })); return }
    const allowed = categories.filter(c => (isGastoLocal && c.kind==='GASTO') || (isIngresoLocal && c.kind==='INGRESO'))
    if (!allowed.some(c => c.id === form.categoryId)) {
      const first = allowed[0]?.id || null
      setForm((f:any) => ({ ...f, categoryId: first }))
    }
  }, [form.type, categories])

  const onChange = (k: string, v: any) => setForm((f:any)=>({ ...f, [k]: v }))
  const isIngreso = form.type === 'INGRESO'
  const isGasto = form.type === 'GASTO'
  const isTransf = form.type === 'TRANSFERENCIA'

  const addTx = () => {
    const amountCents = toCents(form.amount); if (amountCents <= 0) { alert('Monto inválido'); return }
    const base = { id: crypto.randomUUID?.() || String(Math.random()), amountCents, date: form.date, note: form.note?.trim() || null, createdAt: Date.now(), updatedAt: Date.now(), categoryId: null as string|null, paymentMethod: null as string|null, accountFromId: null as string|null, accountToId: null as string|null }
    let tx: any
    if (isIngreso)      tx = { ...base, type: 'INGRESO',       accountToId: form.accountToId, categoryId: form.categoryId }
    else if (isGasto)   tx = { ...base, type: 'GASTO',          accountFromId: form.accountFromId, categoryId: form.categoryId, paymentMethod: form.paymentMethod }
    else                tx = { ...base, type: 'TRANSFERENCIA', accountFromId: form.accountFromId, accountToId: form.accountToId }
    setTxs((prev:any[]) => [tx, ...prev]); setForm((f:any)=>({ ...f, amount: '', note: '' }))
  }

  const gastosPorCategoria = useMemo(() => {
    const now = new Date(); const key = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`; const map: Record<string, number> = {}
    txs.filter(t => t.type==='GASTO' && monthKey(t.date)===key).forEach(t => { const cat = categories.find(c => c.id===t.categoryId)?.name || 'Sin categoría'; map[cat] = (map[cat] || 0) + t.amountCents })
    return Object.entries(map).map(([name,value]) => ({ name, value }))
  }, [txs, categories])
  const gastosPorMes = useMemo(() => {
    const map: Record<string, number> = {}; txs.filter(t => t.type==='GASTO').forEach(t => { const k = monthKey(t.date); map[k] = (map[k] || 0) + t.amountCents }); const keys = Object.keys(map).sort().slice(-6); return keys.map(k => ({ name: k, value: map[k] }))
  }, [txs])

  const exportCSV = () => { const csv = buildCSV(txs); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'hasaba-transacciones.csv'; a.click(); URL.revokeObjectURL(url) }
  const importCSV = (file: File) => { const reader = new FileReader(); reader.onload = (e:any) => setTxs((prev:any[]) => [...parseCSV(e.target.result as string), ...prev]); reader.readAsText(file) }

  return (
    <div style={{ backgroundColor: PALETTE.bg, minHeight: '100vh', color: PALETTE.text }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, padding: 8, backdropFilter: 'blur(6px)' }}>
        <div style={{ display: 'flex', gap: 8, padding: 8, borderRadius: 16, background: 'rgba(255,255,255,0.35)' }}>
          {[{ id: 'dashboard', label: 'DASHBOARD' }, { id: 'reportes', label: 'REPORTES' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)} className={'seg-btn'}
              style={{ flex: 1, color: tab === t.id ? 'white' : PALETTE.text, background: tab === t.id ? PALETTE.accent : 'var(--field)', border:'none' }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className='container'>
        {tab === 'dashboard' && (
          <section style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gap: 16 }}>
              {/* Ahorros ancho completo */}
              {(() => { const x = computeBalances(accounts, txs).accounts.find(s => s.account.id==='ahorros'); if(!x) return null; const {account,balanceCents}=x; return (
                <div key={account.id} className='card'>
                  <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{account.name}</div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(balanceCents)}</div>
                </div>
              )})()}

              {/* Daviplata - Nequi */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {['daviplata','nequi'].map(id => { const x = computeBalances(accounts, txs).accounts.find(s=>s.account.id===id)!; return (
                  <div key={x.account.id} className='card'>
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                  </div>
                )})}
              </div>

              {/* Visa - Rotativo */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {['visa','rotativo'].map(id => { const x = computeBalances(accounts, txs).accounts.find(s=>s.account.id===id)!; return (
                  <div key={x.account.id} className='card'>
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                    {x.account.type === ACCOUNT_TYPES.CREDIT && (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                        Disponible {fmtCOP(x.creditAvailableCents)} · Cupo {fmtCOP(x.account.creditLimitCents || 0)}
                      </div>
                    )}
                  </div>
                )})}
              </div>

              {/* Empresa - Efectivo */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {['empresa','efectivo'].map(id => { const x = computeBalances(accounts, txs).accounts.find(s=>s.account.id===id)!; return (
                  <div key={x.account.id} className='card'>
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                  </div>
                )})}
              </div>
            </div>

            {/* Formulario */}
            <div className='card'>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Fecha</div>
                  <input type='date' value={todayStr()} readOnly className={'w-full rounded-xl px-3 py-2 outline-none'} style={{ background: '#FAFEFF', color: PALETTE.text, border: 'none' }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Monto (COP)</div>
                  <input type='text' placeholder='63.800' className={'w-full rounded-xl px-3 py-2 outline-none'} style={{ background: '#FAFEFF', color: PALETTE.text, border: 'none' }} />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, opacity: 0.7 }}>Medio de pago</div>
                <select className={'w-full rounded-xl px-3 py-2 outline-none'} style={{ background: '#FAFEFF', color: PALETTE.text, border: 'none' }}>
                  {PAYMENT_METHODS.map(m => (<option key={m.id} value={m.id}>{m.label}</option>))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Cuenta origen</div>
                  <select className={'w-full rounded-xl px-3 py-2 outline-none'} style={{ background: '#FAFEFF', color: PALETTE.text, border: 'none' }}>
                    {defaultAccounts.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Cuenta destino</div>
                  <select className={'w-full rounded-xl px-3 py-2 outline-none'} style={{ background: '#FAFEFF', color: PALETTE.text, border: 'none' }}>
                    {defaultAccounts.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Categoría</div>
                  <select className={'w-full rounded-xl px-3 py-2 outline-none'} style={{ background: '#FAFEFF', color: PALETTE.text, border: 'none' }}>
                    {defaultCategories.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Nota</div>
                  <input type='text' placeholder='Descripción' className={'w-full rounded-xl px-3 py-2 outline-none'} style={{ background: '#FAFEFF', color: PALETTE.text, border: 'none' }} />
                </div>
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                {['Ingreso','Gasto','Transferencia'].map(lbl => (
                  <button key={lbl} className={'seg-btn'} style={{ background: '#FAFEFF', color: PALETTE.text }}>{lbl}</button>
                ))}
              </div>

              <button style={{ width: '100%', marginTop: 12, padding: '12px 16px', borderRadius: 16, background: PALETTE.accent, color: 'white', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border:'none' }}>
                <Plus style={{ width: 18, height: 18 }} /> Guardar
              </button>
            </div>
          </section>
        )}

        {tab === 'reportes' && (
          <div style={{ backgroundColor: PALETTE.card, color: PALETTE.text, borderRadius: 24, padding: 16 }}>
            (Reportes... versión de demo)
          </div>
        )}
      </div>
    </div>
  )
}
