import React, { useEffect, useMemo, useState } from 'react'

const PALETTE = {
  bg: '#CDD2D3',
  card: '#F2F6F7',
  text: '#707070',
  line: '#92989A',
  accent: '#707070',
  field: '#FAFEFF',
}

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const fmtCOP = (cents?: number | null) => COP.format(((cents ?? 0) === -0 ? 0 : (cents ?? 0)) / 100)
const toCents = (str: string) => {
  if (!str) return 0
  const s = ('' + str).replace(/[^0-9.,-]/g, '').replace(/,/g, '.')
  const v = parseFloat(s)
  return isNaN(v) ? 0 : Math.round(v * 100)
}
const todayStr = () => new Date().toISOString().slice(0, 10)
const monthKey = (dateStr: string) => {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

const ACCOUNT_TYPES = { CASH: 'CASH', CREDIT: 'CREDIT' } as const
type AccountType = typeof ACCOUNT_TYPES[keyof typeof ACCOUNT_TYPES]
type Account = { id: string; name: string; type: AccountType; initialBalanceCents?: number; creditLimitCents?: number; initialDebtCents?: number }
type Category = { id: string; name: string; kind: 'GASTO' | 'INGRESO' }

const PAYMENT_METHODS = [
  { id: 'VISA',             label: 'Tarjeta de crédito Visa',          accountName: 'Tarjeta Visa' },
  { id: 'DEBITO_AHORROS',   label: 'Tarjeta débito cuenta de ahorros', accountName: 'Cuenta de ahorros' },
  { id: 'NEQUI',            label: 'Nequi',                            accountName: 'Nequi' },
  { id: 'DAVIPLATA',        label: 'Daviplata',                        accountName: 'Daviplata' },
  { id: 'CUENTA_AHORROS',   label: 'Cuenta de ahorros',                accountName: 'Cuenta de ahorros' },
  { id: 'EFECTIVO',         label: 'Efectivo',                         accountName: 'Efectivo' },
]

const defaultAccounts: Account[] = [
  { id: 'daviplata', name: 'Daviplata',            type: ACCOUNT_TYPES.CASH,   initialBalanceCents: 0 },
  { id: 'nequi',     name: 'Nequi',                type: ACCOUNT_TYPES.CASH,   initialBalanceCents: 0 },
  { id: 'visa',      name: 'Tarjeta Visa',         type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 300000000, initialDebtCents: 0 },
  { id: 'rotativo',  name: 'Crédito rotativo',     type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 500000000, initialDebtCents: 0 },
  { id: 'empresa',   name: 'Cuenta de la empresa', type: ACCOUNT_TYPES.CASH,   initialBalanceCents: 0 },
  { id: 'efectivo',  name: 'Efectivo',             type: ACCOUNT_TYPES.CASH,   initialBalanceCents: 0 },
  { id: 'ahorros',   name: 'Cuenta de ahorros',    type: ACCOUNT_TYPES.CASH,   initialBalanceCents: 0 },
  { id: 'inversion', name: 'Inversión',            type: ACCOUNT_TYPES.CASH,   initialBalanceCents: 0 },
]

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
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : initial
    } catch { return initial }
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
      const to = accounts.find(a => a.id === t.accountToId)
      if (!to) return
      if (to.type === ACCOUNT_TYPES.CASH) ef[to.id] = (ef[to.id] || 0) + t.amountCents
      else debt[to.id] = (debt[to.id] || 0) - t.amountCents
    } else if (t.type === 'GASTO') {
      const from = accounts.find(a => a.id === t.accountFromId)
      if (!from) return
      if (from.type === ACCOUNT_TYPES.CREDIT) debt[from.id] = (debt[from.id] || 0) + t.amountCents
      else ef[from.id] = (ef[from.id] || 0) - t.amountCents
    } else if (t.type === 'TRANSFERENCIA') {
      const from = accounts.find(a => a.id === t.accountFromId)
      const to   = accounts.find(a => a.id === t.accountToId)
      if (!from || !to || from.id === to.id) return
      if (to.type === ACCOUNT_TYPES.CREDIT) {
        debt[to.id] = (debt[to.id] || 0) - t.amountCents
        if (from.type === ACCOUNT_TYPES.CASH) ef[from.id] = (ef[from.id] || 0) - t.amountCents
        else if (from.type === ACCOUNT_TYPES.CREDIT) debt[from.id] = (debt[from.id] || 0) + t.amountCents
      } else if (from.type === ACCOUNT_TYPES.CASH && to.type === ACCOUNT_TYPES.CASH) {
        ef[from.id] = (ef[from.id] || 0) - t.amountCents
        ef[to.id]   = (ef[to.id] || 0) + t.amountCents
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
  const efectivoTotal = Object.values(ef).reduce((a,b)=>a+b,0)
  return { accounts: perAccount, efectivoTotal, creditoDisponibleTotal }
}

function buildCSV(txs: any[]) {
  const header = 'id,type,date,amountCents,accountFromId,accountToId,categoryId,paymentMethod,note'
  const rows = txs.map((t:any) => [
    t.id, t.type, t.date, t.amountCents,
    t.accountFromId || '', t.accountToId || '',
    t.categoryId || '', t.paymentMethod || '',
    (t.note || '').replace(/,/g,';')
  ].join(','))
  return [header, ...rows].join('\n')
}
function parseCSV(text: string) {
  const clean = text.replace(/\r/g,'')
  const lines = clean.split('\n').filter(Boolean)
  if (lines.length <= 1) return []
  return lines.slice(1).map(line => {
    const [id, type, date, amountCents, accountFromId, accountToId, categoryId, paymentMethod, note] = line.split(',')
    return {
      id: id || crypto.randomUUID(),
      type, date, amountCents: Number(amountCents || 0),
      accountFromId: accountFromId || null, accountToId: accountToId || null,
      categoryId: categoryId || null, paymentMethod: paymentMethod || null,
      note: note || null, createdAt: Date.now(), updatedAt: Date.now()
    }
  })
}

export default function App() {
  const [accounts] = useLocalState<Account[]>(LS_KEYS.ACCOUNTS, defaultAccounts)
  const [categories, setCategories] = useLocalState<Category[]>(LS_KEYS.CATEGORIES, defaultCategories)
  useEffect(() => { if (!Array.isArray(categories) || categories.some((c:any)=>!c.kind)) setCategories(defaultCategories) }, [categories, setCategories])

  const [txs, setTxs] = useLocalState<any[]>(LS_KEYS.TXS, [])
  const [tab, setTab] = useState<'dashboard'|'reportes'>('dashboard')

  const summary = useMemo(() => computeBalances(accounts, txs), [accounts, txs])

  const LIQ_ACCOUNTS = ['daviplata','nequi','empresa','efectivo','ahorros']
  const liquidezTotalCents = useMemo(() => {
    const map: Record<string, number> = {}; summary.accounts.forEach(s=>{ map[s.account.id]=s.balanceCents })
    return LIQ_ACCOUNTS.reduce((acc,id)=>acc+(map[id]||0),0)
  }, [summary])

  const [form, setForm] = useState<any>({
    type: 'TRANSFERENCIA',
    date: todayStr(),
    amount: '',
    accountFromId: 'visa',
    accountToId: 'ahorros',
    paymentMethod: 'VISA',
    categoryId: null,
    note: ''
  })
  const onChange = (k:string, v:any) => setForm((f:any)=>({ ...f, [k]: v }))

  useEffect(() => {
    if (form.type !== 'GASTO') return
    const pm = PAYMENT_METHODS.find(m=>m.id===form.paymentMethod)
    if (!pm) return
    const target = accounts.find(a => a.name.includes(pm.accountName))
    if (target && form.accountFromId !== target.id) setForm((f:any)=>({ ...f, accountFromId: target.id }))
  }, [form.paymentMethod, form.type, accounts])

  useEffect(() => {
    if (form.type === 'TRANSFERENCIA') { if (form.categoryId) setForm((f:any)=>({ ...f, categoryId: null })); return }
    const allowed = defaultCategories.filter(c => (form.type==='GASTO' && c.kind==='GASTO') || (form.type==='INGRESO' && c.kind==='INGRESO'))
    if (!allowed.some(c=>c.id===form.categoryId)) setForm((f:any)=>({ ...f, categoryId: allowed[0]?.id || null }))
  }, [form.type])

  const isIngreso = form.type === 'INGRESO'
  const isGasto   = form.type === 'GASTO'
  const isTransf  = form.type === 'TRANSFERENCIA'

  const addTx = () => {
    const amountCents = toCents(form.amount)
    if (amountCents <= 0) { alert('Monto inválido'); return }
    const base = {
      id: crypto.randomUUID?.() || String(Math.random()),
      amountCents, date: form.date, note: form.note?.trim() || null,
      createdAt: Date.now(), updatedAt: Date.now(),
      categoryId: null as string|null, paymentMethod: null as string|null,
      accountFromId: null as string|null, accountToId: null as string|null
    }
    let tx:any
    if (isIngreso)      tx = { ...base, type: 'INGRESO',       accountToId: form.accountToId, categoryId: form.categoryId }
    else if (isGasto)   tx = { ...base, type: 'GASTO',         accountFromId: form.accountFromId, categoryId: form.categoryId, paymentMethod: form.paymentMethod }
    else                tx = { ...base, type: 'TRANSFERENCIA', accountFromId: form.accountFromId, accountToId: form.accountToId }
    setTxs((prev:any[]) => [tx, ...prev])
    setForm((f:any)=>({ ...f, amount: '', note: '' }))
  }

  const allMonths = useMemo(() => { const s = new Set<string>(); txs.forEach(t=>s.add(monthKey(t.date))); return Array.from(s).sort() }, [txs])
  const [monthFilter, setMonthFilter] = useState<string>('TOTAL')
  const txsFiltered = useMemo(() => monthFilter==='TOTAL' ? txs : txs.filter(t=>monthKey(t.date)===monthFilter), [txs, monthFilter])

  const gastosPorCuenta = useMemo(() => {
    const map: Record<string, number> = {}
    txsFiltered.filter(t=>t.type==='GASTO').forEach(t => { const id = t.accountFromId || ''; map[id] = (map[id] || 0) + t.amountCents })
    const order = ['daviplata','nequi','visa','rotativo','empresa','efectivo','ahorros','inversion']
    return order.map(id => ({ id, name: accounts.find(a=>a.id===id)?.name || id, value: map[id] || 0 }))
  }, [txsFiltered, accounts])

  const gastosPorCategoria = useMemo(() => {
    const map: Record<string, number> = {}
    txsFiltered.filter(t=>t.type==='GASTO').forEach(t => {
      const id = t.categoryId || 'sin'
      const name = defaultCategories.find(c=>c.id===id)?.name || 'Sin categoría'
      map[name] = (map[name] || 0) + t.amountCents
    })
    return Object.entries(map).map(([name,value]) => ({ name, value }))
  }, [txsFiltered])

  const exportCSV = () => {
    const csv = buildCSV(txs)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'hasaba-transacciones.csv'; a.click(); URL.revokeObjectURL(url)
  }
  const importCSV = (file: File) => {
    const reader = new FileReader(); reader.onload = (e:any) => setTxs((prev:any[]) => [...parseCSV(e.target.result as string), ...prev]); reader.readAsText(file)
  }

  return (
    <div style={{ backgroundColor: PALETTE.bg, minHeight: '100vh', color: PALETTE.text }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, padding: 8, backdropFilter: 'blur(6px)' }}>
        <div style={{ display: 'flex', gap: 8, padding: 8, borderRadius: 16, background: 'rgba(255,255,255,0.35)' }}>
          {[{ id: 'dashboard', label: 'DASHBOARD' }, { id: 'reportes', label: 'REPORTES' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              style={{ flex: 1, height: 44, borderRadius: 14, color: (tab === t.id ? 'white' : PALETTE.text), background: (tab === t.id ? PALETTE.accent : '#FAFEFF'), border: 'none', fontWeight: 600 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className='container'>
        {tab === 'dashboard' && (
          <section style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gap: 16 }}>

              <div className='card'>
                <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>Liquidez total</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(liquidezTotalCents)}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {['daviplata','nequi'].map(id => { const x = summary.accounts.find(s=>s.account.id===id)!; return (
                  <div className='card' key={x.account.id}>
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                  </div>
                )})}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {['visa','rotativo'].map(id => { const x = summary.accounts.find(s=>s.account.id===id)!; return (
                  <div className='card' key={x.account.id}>
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                    {x.account.type === 'CREDIT' && (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                        Disponible {fmtCOP(x.creditAvailableCents)} · Cupo {fmtCOP(x.account.creditLimitCents || 0)}
                      </div>
                    )}
                  </div>
                )})}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {['empresa','efectivo'].map(id => { const x = summary.accounts.find(s=>s.account.id===id)!; return (
                  <div className='card' key={x.account.id}>
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                  </div>
                )})}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {['ahorros','inversion'].map(id => { const x = summary.accounts.find(s=>s.account.id===id)!; return (
                  <div className='card' key={x.account.id}>
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                  </div>
                )})}
              </div>

            </div>

            <div className='card'>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Fecha</div>
                  <input type='date' value={form.date} onChange={(e)=>onChange('date', e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Monto (COP)</div>
                  <input
                    type='number'
                    inputMode='decimal'
                    step='any'
                    placeholder='0'
                    value={form.amount}
                    onKeyDown={(e)=>['e','E','+','-'].includes((e as any).key) && e.preventDefault()}
                    onChange={(e)=>onChange('amount', e.target.value)}
                  />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, opacity: 0.7 }}>Medio de pago</div>
                <select value={form.paymentMethod} onChange={(e)=>onChange('paymentMethod', e.target.value)} disabled={isIngreso || isTransf}>
                  {PAYMENT_METHODS.map(m => (<option key={m.id} value={m.id}>{m.label}</option>))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Cuenta origen</div>
                  <select value={form.accountFromId} onChange={(e)=>onChange('accountFromId', e.target.value)} disabled={isIngreso || isGasto}>
                    {accounts.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Cuenta destino</div>
                  <select value={form.accountToId} onChange={(e)=>onChange('accountToId', e.target.value)} disabled={isGasto}>
                    {accounts.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Categoría</div>
                  <select value={form.categoryId || ''} onChange={(e)=>onChange('categoryId', e.target.value)} disabled={isTransf}>
                    {defaultCategories.filter(c => (form.type==='GASTO' && c.kind==='GASTO') || (form.type==='INGRESO' && c.kind==='INGRESO'))
                                     .map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Nota</div>
                  <input type='text' placeholder='Descripción' value={form.note} onChange={(e)=>onChange('note', e.target.value)} />
                </div>
              </div>

              <div className='seg' style={{ marginTop: 12 }}>
                {['INGRESO','GASTO','TRANSFERENCIA'].map(t => (
                  <button key={t} className={form.type===t ? 'active' : ''} onClick={()=>onChange('type', t)}>{t[0]+t.slice(1).toLowerCase()}</button>
                ))}
              </div>

              <button className='btn-primary' onClick={addTx}
                style={{ width: '100%', marginTop: 12, padding: '12px 16px', borderRadius: 16 }}>
                Guardar
              </button>
            </div>
          </section>
        )}

        {tab === 'reportes' && (
          <section style={{ display: 'grid', gap: 16 }}>
            <div className='card' style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div><b>Mes:</b></div>
              <select value={monthFilter} onChange={(e)=>setMonthFilter(e.target.value)}>
                <option value='TOTAL'>Total</option>
                {allMonths.map(m => (<option key={m} value={m}>{m}</option>))}
              </select>
              <div style={{ flex: 1 }} />
              <button onClick={exportCSV}>Exportar</button>
              <label style={{ cursor: 'pointer' }}>
                Importar
                <input type='file' accept='.csv' style={{ display: 'none' }} onChange={(e)=>e.target.files&&e.target.files[0]&&importCSV(e.target.files[0])} />
              </label>
            </div>

            <div className='card'>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Gastos por cuenta</div>
              <table style={{ width: '100%', fontSize: 15 }}>
                <tbody>
                  {gastosPorCuenta.map(r => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                      <td style={{ padding: '8px 0' }}>{r.name}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600 }}>{fmtCOP(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className='card'>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Gastos por categoría</div>
              <table style={{ width: '100%', fontSize: 15 }}>
                <tbody>
                  {gastosPorCategoria.map((r:any, i:number) => (
                    <tr key={i} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                      <td style={{ padding: '8px 0' }}>{r.name}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600 }}>{fmtCOP(r.value)}</td>
                    </tr>
                  ))}
                  {gastosPorCategoria.length===0 && (
                    <tr><td colSpan={2} style={{ textAlign:'center', opacity:0.6, padding:12 }}>Sin gastos</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className='card' style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Transacciones</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 14 }}>
                  <thead>
                    <tr style={{ color: PALETTE.text, opacity: 0.8 }}>
                      <th style={{ textAlign: 'left', padding: '8px 0' }}>Fecha</th>
                      <th style={{ textAlign: 'left' }}>Tipo</th>
                      <th style={{ textAlign: 'left' }}>Monto</th>
                      <th style={{ textAlign: 'left' }}>Cuenta</th>
                      <th style={{ textAlign: 'left' }}>Categoría</th>
                      <th style={{ textAlign: 'left' }}>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txsFiltered.map((t:any) => (
                      <tr key={t.id} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                        <td style={{ padding: '8px 0', whiteSpace: 'nowrap' }}>{t.date}</td>
                        <td>{t.type}</td>
                        <td>{fmtCOP(t.amountCents)}</td>
                        <td>
                          {t.type === 'INGRESO' && (accounts.find((a:any)=>a.id===t.accountToId)?.name || '—')}
                          {t.type === 'GASTO' && (accounts.find((a:any)=>a.id===t.accountFromId)?.name || '—')}
                          {t.type === 'TRANSFERENCIA' && `${accounts.find((a:any)=>a.id===t.accountFromId)?.name || '—'} → ${accounts.find((a:any)=>a.id===t.accountToId)?.name || '—'}`}
                        </td>
                        <td>{defaultCategories.find((c:any)=>c.id===t.categoryId)?.name || '—'}</td>
                        <td title={t.note || ''} style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.note || ''}</td>
                      </tr>
                    ))}
                    {txsFiltered.length===0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: PALETTE.text, opacity: 0.6, padding: 16 }}>Sin transacciones</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
