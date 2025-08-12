
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Upload, Download, Trash2, Edit3, X } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

// ======= Theme =======
const PALETTE = {
  bg: '#CDD2D3',
  card: '#F2F6F7',
  text: '#707070',
  line: '#92989A',
  accent: '#707070',
};

// ======= Utils =======
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const fmtCOP = (cents?: number | null) => {
  const safe = Object.is(cents, -0) ? 0 : (cents ?? 0);
  return COP.format(safe / 100);
};
const toCents = (str: string) => {
  if (!str) return 0;
  const s = ('' + str).replace(/[^0-9.,-]/g, '').replace(/,/g, '.');
  const v = parseFloat(s);
  if (isNaN(v)) return 0;
  return Math.round(v * 100);
};
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthKey = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ======= Data types =======
const ACCOUNT_TYPES = { CASH: 'CASH', CREDIT: 'CREDIT' } as const;
type AccountType = typeof ACCOUNT_TYPES[keyof typeof ACCOUNT_TYPES];
type Account = { id: string; name: string; type: AccountType; initialBalanceCents?: number; creditLimitCents?: number; initialDebtCents?: number };

type TxType = 'INGRESO' | 'GASTO' | 'TRANSFERENCIA';
type Tx = {
  id: string;
  type: TxType;
  date: string;
  amountCents: number;
  accountFromId: string | null;
  accountToId: string | null;
  categoryId: string | null;
  paymentMethod: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

type Category = { id: string; name: string; kind: 'GASTO' | 'INGRESO' };

// ======= Defaults =======
const defaultAccounts: Account[] = [
  { id: 'daviplata', name: 'Daviplata', type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: 'nequi', name: 'Nequi', type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: 'empresa', name: 'Cuenta de la empresa', type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: 'efectivo', name: 'Efectivo', type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: 'ahorros', name: 'Cuenta de ahorros', type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: 'inversion', name: 'Inversión - Ahorro', type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: 'visa', name: 'Tarjeta Visa', type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 300000000, initialDebtCents: 0 },
  { id: 'rotativo', name: 'Crédito rotativo', type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 500000000, initialDebtCents: 0 },
];

const PAYMENT_METHODS = [
  { id: 'VISA', label: 'Tarjeta de crédito Visa', accountName: 'Tarjeta Visa' },
  { id: 'DEBITO_AHORROS', label: 'Tarjeta débito cuenta de ahorros', accountName: 'Cuenta de ahorros' },
  { id: 'NEQUI', label: 'Nequi', accountName: 'Nequi' },
  { id: 'DAVIPLATA', label: 'Daviplata', accountName: 'Daviplata' },
  { id: 'CUENTA_EMPRESA', label: 'Cuenta de la empresa', accountName: 'Cuenta de la empresa' },
  { id: 'EFECTIVO', label: 'Efectivo', accountName: 'Efectivo' },
];

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
];

// ======= Local storage helper =======
const LS_KEYS = { ACCOUNTS: 'ga_accounts', CATEGORIES: 'ga_categories', TXS: 'ga_transactions' };
function useLocalState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : initial;
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)); }, [key, state]);
  return [state, setState] as const;
}

// ======= Computations =======
function computeBalances(accounts: Account[], txs: Tx[]) {
  const cash: Record<string, number> = {};
  const debt: Record<string, number> = {};
  accounts.forEach(a => {
    if (a.type === ACCOUNT_TYPES.CASH) cash[a.id] = a.initialBalanceCents || 0;
    if (a.type === ACCOUNT_TYPES.CREDIT) debt[a.id] = a.initialDebtCents || 0;
  });

  txs.forEach(t => {
    if (t.type === 'INGRESO') {
      if (t.accountToId && cash[t.accountToId] !== undefined) cash[t.accountToId] += t.amountCents;
      if (t.accountToId && debt[t.accountToId] !== undefined) debt[t.accountToId] -= t.amountCents; // abono a crédito
    } else if (t.type === 'GASTO') {
      const from = accounts.find(a => a.id === t.accountFromId);
      if (!from) return;
      if (from.type === ACCOUNT_TYPES.CREDIT) {
        debt[from.id] = (debt[from.id] || 0) + t.amountCents;
      } else {
        cash[from.id] = (cash[from.id] || 0) - t.amountCents;
      }
    } else if (t.type === 'TRANSFERENCIA') {
      const from = accounts.find(a => a.id === t.accountFromId);
      const to = accounts.find(a => a.id === t.accountToId);
      if (!from || !to || from.id === to.id) return;
      if (to.type === ACCOUNT_TYPES.CREDIT) {
        debt[to.id] = (debt[to.id] || 0) - t.amountCents;
        if (from.type === ACCOUNT_TYPES.CASH) cash[from.id] = (cash[from.id] || 0) - t.amountCents;
      } else if (from.type === ACCOUNT_TYPES.CASH && to.type === ACCOUNT_TYPES.CASH) {
        cash[from.id] = (cash[from.id] || 0) - t.amountCents;
        cash[to.id] = (cash[to.id] || 0) + t.amountCents;
      }
    }
  });

  const perAccount = accounts.map(a => {
    if (a.type === ACCOUNT_TYPES.CREDIT) {
      const d = debt[a.id] || 0;
      const disp = (a.creditLimitCents || 0) - d;
      return { account: a, balanceCents: -d, creditAvailableCents: disp };
    } else {
      return { account: a, balanceCents: cash[a.id] || 0, creditAvailableCents: null };
    }
  });

  const liquidez = ['daviplata','nequi','empresa','efectivo','ahorros']
    .map(id => cash[id] || 0)
    .reduce((a,b) => a + b, 0);

  return { accounts: perAccount, liquidez };
}

// ======= CSV helpers =======
function buildCSV(txs: Tx[]) {
  const header = 'id,type,date,amountCents,accountFromId,accountToId,categoryId,paymentMethod,note,createdAt,updatedAt';
  const rows = txs.map(t => [
    t.id, t.type, t.date, t.amountCents,
    t.accountFromId || '', t.accountToId || '', t.categoryId || '', t.paymentMethod || '',
    (t.note || '').replace(/,/g, ';'),
    t.createdAt, t.updatedAt
  ].join(','));
  return [header, ...rows].join('\\n');
}
function parseCSV(text: string): Tx[] {
  const clean = text.replace(/\\r/g, '');
  const lines = clean.split('\\n').filter(Boolean);
  if (lines.length <= 1) return [];
  return lines.slice(1).map(line => {
    const [id, type, date, amountCents, accountFromId, accountToId, categoryId, paymentMethod, note, createdAt, updatedAt] = line.split(',');
    return {
      id: id || crypto.randomUUID(),
      type: (type as TxType) || 'GASTO',
      date,
      amountCents: Number(amountCents || 0),
      accountFromId: accountFromId || null,
      accountToId: accountToId || null,
      categoryId: categoryId || null,
      paymentMethod: paymentMethod || null,
      note: note || null,
      createdAt: Number(createdAt || Date.now()),
      updatedAt: Number(updatedAt || Date.now()),
    };
  });
}

// ======= Component =======
export default function App() {
  const [accounts, setAccounts] = useLocalState<Account[]>(LS_KEYS.ACCOUNTS, defaultAccounts);
  const [categories, setCategories] = useLocalState<Category[]>(LS_KEYS.CATEGORIES, defaultCategories);
  const [txs, setTxs] = useLocalState<Tx[]>(LS_KEYS.TXS, []);
  const [tab, setTab] = useState<'dashboard' | 'reportes'>('dashboard');

  // migrations: ensure new accounts & category kinds
  useEffect(() => {
    const byId = new Set(accounts.map(a => a.id));
    let updated = [...accounts];
    defaultAccounts.forEach(def => {
      if (!byId.has(def.id)) updated.push(def);
    });
    if (JSON.stringify(updated) !== JSON.stringify(accounts)) setAccounts(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!Array.isArray(categories) || categories.some(c => !(c as any).kind)) setCategories(defaultCategories);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // form state
  const [form, setForm] = useState<any>({
    type: 'TRANSFERENCIA' as TxType,
    date: todayStr(),
    amount: '',
    paymentMethod: 'VISA',
    accountFromId: 'visa',
    accountToId: 'ahorros',
    categoryId: null,
    note: ''
  });
  const onChange = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const isIngreso = form.type === 'INGRESO';
  const isGasto = form.type === 'GASTO';
  const isTransf = form.type === 'TRANSFERENCIA';

  // auto set accountFrom on gasto based on payment method
  useEffect(() => {
    if (form.type !== 'GASTO') return;
    const pm = PAYMENT_METHODS.find(m => m.id === form.paymentMethod);
    if (!pm) return;
    const target = accounts.find(a => a.name.includes(pm.accountName));
    if (target && form.accountFromId !== target.id) setForm((f: any) => ({ ...f, accountFromId: target.id }));
  }, [form.paymentMethod, form.type, accounts, form.accountFromId]);

  // category reset when switching type
  useEffect(() => {
    if (isTransf) { if (form.categoryId) onChange('categoryId', null); return; }
    const allowed = categories.filter(c => (isGasto && c.kind === 'GASTO') || (isIngreso && c.kind === 'INGRESO'));
    if (!allowed.some(c => c.id === form.categoryId)) onChange('categoryId', allowed[0]?.id || null);
  }, [form.type, categories]); // eslint-disable-line

  const summary = useMemo(() => computeBalances(accounts, txs), [accounts, txs]);

  function addTx() {
    const amountCents = toCents(form.amount);
    if (amountCents <= 0) { alert('Monto inválido'); return; }
    const base = {
      id: crypto.randomUUID?.() || String(Math.random()),
      date: form.date,
      amountCents,
      note: form.note?.trim() || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      categoryId: null as string | null,
      paymentMethod: null as string | null,
      accountFromId: null as string | null,
      accountToId: null as string | null,
    };
    let tx: Tx;
    if (isIngreso) {
      tx = { ...base, type: 'INGRESO', accountToId: form.accountToId, categoryId: form.categoryId };
    } else if (isGasto) {
      tx = { ...base, type: 'GASTO', accountFromId: form.accountFromId, categoryId: form.categoryId, paymentMethod: form.paymentMethod };
    } else {
      tx = { ...base, type: 'TRANSFERENCIA', accountFromId: form.accountFromId, accountToId: form.accountToId };
    }
    setTxs(prev => [tx, ...prev]);
    setForm((f: any) => ({ ...f, amount: '', note: '' }));
  }

  function deleteTx(id: string) {
    if (!confirm('¿Eliminar transacción?')) return;
    setTxs(prev => prev.filter(t => t.id !== id));
  }

  // CSV
  const exportCSV = () => {
    const csv = buildCSV(txs);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hasaba-transacciones.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e: any) => setTxs(prev => [...parseCSV(e.target.result as string), ...prev]);
    reader.readAsText(file);
  };

  // Reports filters
  const [reportMonth, setReportMonth] = useState<string>(''); // '' => total
  const filteredTxs = useMemo(() => {
    if (!reportMonth) return txs;
    return txs.filter(t => monthKey(t.date) === reportMonth);
  }, [txs, reportMonth]);

  const gastosPorCuenta = useMemo(() => {
    const map: Record<string, number> = {};
    filteredTxs.filter(t => t.type === 'GASTO').forEach(t => {
      const acc = accounts.find(a => a.id === t.accountFromId)?.name || 'Cuenta';
      map[acc] = (map[acc] || 0) + t.amountCents;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filteredTxs, accounts]);

  const gastosPorCategoria = useMemo(() => {
    const map: Record<string, number> = {};
    filteredTxs.filter(t => t.type === 'GASTO').forEach(t => {
      const cat = categories.find(c => c.id === t.categoryId)?.name || 'Sin categoría';
      map[cat] = (map[cat] || 0) + t.amountCents;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filteredTxs, categories]);

  const gastosPorMes = useMemo(() => {
    const map: Record<string, number> = {};
    txs.filter(t => t.type === 'GASTO').forEach(t => {
      const k = monthKey(t.date);
      map[k] = (map[k] || 0) + t.amountCents;
    });
    const keys = Object.keys(map).sort().slice(-6);
    return keys.map(k => ({ name: k, value: map[k] }));
  }, [txs]);

  // ======= UI =======
  return (
    <div style={{ backgroundColor: PALETTE.bg, minHeight: '100vh', color: PALETTE.text }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, padding: 8, backdropFilter: 'blur(6px)' }}>
        <div style={{ display: 'flex', gap: 8, padding: 8, borderRadius: 16, background: 'rgba(255,255,255,0.35)' }}>
          {[{ id: 'dashboard', label: 'DASHBOARD' }, { id: 'reportes', label: 'REPORTES' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              style={{ flex: 1, height: 44, borderRadius: 14, color: tab === t.id ? 'white' : PALETTE.text, background: tab === t.id ? PALETTE.accent : '#FAFEFF', border: 'none', fontWeight: 600 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="container">
        {tab === 'dashboard' && (
          <section style={{ display: 'grid', gap: 16 }}>
            {/* Liquidez total */}
            <div className="card">
              <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>Liquidez total</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(summary.liquidez)}</div>
            </div>

            {/* Daviplata - Nequi */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {['daviplata','nequi'].map(id => {
                const x = summary.accounts.find(s => s.account.id === id)!;
                return (
                  <div key={id} className="card">
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                  </div>
                );
              })}
            </div>

            {/* Visa - Rotativo */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {['visa','rotativo'].map(id => {
                const x = summary.accounts.find(s => s.account.id === id)!;
                return (
                  <div key={id} className="card">
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                      Disponible {fmtCOP(x.creditAvailableCents)} · Cupo {fmtCOP(x.account.creditLimitCents || 0)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Empresa - Efectivo */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {['empresa','efectivo'].map(id => {
                const x = summary.accounts.find(s => s.account.id === id)!;
                return (
                  <div key={id} className="card">
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                  </div>
                );
              })}
            </div>

            {/* Ahorros - Inversión */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {['ahorros','inversion'].map(id => {
                const x = summary.accounts.find(s => s.account.id === id)!;
                return (
                  <div key={id} className="card">
                    <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{x.account.name}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(x.balanceCents)}</div>
                  </div>
                );
              })}
            </div>

            {/* Formulario */}
            <div className="card">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div className="label">Fecha</div>
                  <input type="date" value={form.date} onChange={(e) => onChange('date', e.target.value)} />
                </div>
                <div>
                  <div className="label">Monto (COP)</div>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    placeholder="0"
                    value={form.amount}
                    onKeyDown={(e) => { if (['e','E','+','-'].includes((e as any).key)) e.preventDefault(); }}
                    onChange={(e) => onChange('amount', (e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="label">Medio de pago</div>
                <select value={form.paymentMethod} onChange={(e) => onChange('paymentMethod', e.target.value)} disabled={isIngreso || isTransf}>
                  {PAYMENT_METHODS.map(m => (<option key={m.id} value={m.id}>{m.label}</option>))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                <div>
                  <div className="label">Cuenta origen</div>
                  <select value={form.accountFromId} onChange={(e) => onChange('accountFromId', e.target.value)} disabled={isIngreso || isGasto}>
                    {accounts.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
                  </select>
                </div>
                <div>
                  <div className="label">Cuenta destino</div>
                  <select value={form.accountToId} onChange={(e) => onChange('accountToId', e.target.value)} disabled={isGasto}>
                    {accounts.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                <div>
                  <div className="label">Categoría</div>
                  <select value={form.categoryId || ''} onChange={(e) => onChange('categoryId', e.target.value)} disabled={isTransf}>
                    {categories
                      .filter(c => (form.type === 'GASTO' && c.kind === 'GASTO') || (form.type === 'INGRESO' && c.kind === 'INGRESO'))
                      .map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                </div>
                <div>
                  <div className="label">Nota</div>
                  <input type="text" placeholder="Descripción" value={form.note} onChange={(e) => onChange('note', e.target.value)} />
                </div>
              </div>

              <div className="seg" style={{ marginTop: 12 }}>
                {['INGRESO', 'GASTO', 'TRANSFERENCIA'].map((t: any) => (
                  <button key={t} className={form.type === t ? 'active' : ''} onClick={() => onChange('type', t)}>
                    {t[0] + t.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>

              <button className="btn-primary" onClick={addTx}
                style={{ width: '100%', marginTop: 12, padding: '12px 16px', borderRadius: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Plus style={{ width: 18, height: 18 }} /> Guardar
              </button>
            </div>
          </section>
        )}

        {tab === 'reportes' && (
          <section style={{ display: 'grid', gap: 16 }}>
            {/* Controles */}
            <div className="card">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>Mes</div>
                  <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} />
                </div>
                <button onClick={() => setReportMonth('')} style={{ height: 44, borderRadius: 14 }}>Total</button>
                <button onClick={exportCSV} style={{ height: 44, borderRadius: 14, display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  <Download style={{ width: 16, height: 16 }} /> Exportar
                </button>
                <label style={{ height: 44, borderRadius: 14, display: 'inline-flex', gap: 8, alignItems: 'center', padding: '0 12px', cursor: 'pointer', background: '#FAFEFF' }}>
                  <Upload style={{ width: 16, height: 16 }} /> Importar
                  <input type="file" accept=".csv" style={{ display: 'none' }}
                    onChange={(e) => e.target.files && e.target.files[0] && importCSV(e.target.files[0])} />
                </label>
              </div>
            </div>

            {/* Gastos por cuenta */}
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Gastos por cuenta</div>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gastosPorCuenta}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis tickFormatter={(v: number) => COP.format(v / 100)} />
                    <Tooltip formatter={(v: any) => fmtCOP(v as number)} />
                    <Legend />
                    <Bar dataKey="value" name="Gastos" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Gastos por categoría */}
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Gastos por categoría</div>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie dataKey="value" data={gastosPorCategoria} label={(e: any) => e.name}>
                      {gastosPorCategoria.map((_, i) => (<Cell key={i} />))}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmtCOP(v as number)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Gastos por mes (últimos 6) */}
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Gastos por mes</div>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gastosPorMes}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis tickFormatter={(v: number) => COP.format(v / 100)} />
                    <Tooltip formatter={(v: any) => fmtCOP(v as number)} />
                    <Legend />
                    <Bar dataKey="value" name="Gastos" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tabla de transacciones */}
            <div className="card" style={{ padding: 16 }}>
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
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTxs.map((t: Tx) => (
                      <tr key={t.id} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                        <td style={{ padding: '8px 0', whiteSpace: 'nowrap' }}>{t.date}</td>
                        <td>{t.type}</td>
                        <td>{fmtCOP(t.amountCents)}</td>
                        <td>
                          {t.type === 'INGRESO' && (accounts.find(a => a.id === t.accountToId)?.name || '—')}
                          {t.type === 'GASTO' && (accounts.find(a => a.id === t.accountFromId)?.name || '—')}
                          {t.type === 'TRANSFERENCIA' && `${accounts.find(a => a.id === t.accountFromId)?.name || '—'} → ${accounts.find(a => a.id === t.accountToId)?.name || '—'}`}
                        </td>
                        <td>{categories.find(c => c.id === t.categoryId)?.name || '—'}</td>
                        <td title={t.note || ''} style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.note || ''}</td>
                        <td>
                          <button title="Eliminar" onClick={() => deleteTx(t.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Trash2 style={{ width: 16, height: 16 }} /> Borrar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredTxs.length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: PALETTE.text, opacity: 0.6, padding: 16 }}>Sin transacciones</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
