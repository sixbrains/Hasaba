
import React, { useEffect, useMemo, useState } from "react";
import "./app.css";

// === Palette ===
const PALETTE = {
  bg: "#CDD2D3",
  card: "#F2F6F7",
  text: "#707070",
  line: "#92989A",
  accent: "#707070",
};

// === Money helpers (COP in cents) ===
const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
const fmtCOP = (cents?: number | null) => {
  const safe = Object.is(cents, -0) ? 0 : (cents ?? 0);
  return COP.format((safe as number) / 100);
};
const toCents = (str: string) => {
  if (!str) return 0;
  const s = ("" + str).replace(/[^0-9.,-]/g, "").replace(/,/g, ".");
  const v = parseFloat(s);
  if (isNaN(v)) return 0;
  return Math.round(v * 100);
};
const todayStr = () => new Date().toISOString().slice(0, 10);

// === Types ===
const ACCOUNT_TYPES = { CASH: "CASH", CREDIT: "CREDIT" } as const;
type AccountType = (typeof ACCOUNT_TYPES)[keyof typeof ACCOUNT_TYPES];

type Account = {
  id: string;
  name: string;
  type: AccountType;
  initialBalanceCents?: number; // for CASH
  creditLimitCents?: number; // for CREDIT
  initialDebtCents?: number; // for CREDIT
};

type Category = { id: string; name: string; kind: "GASTO" | "INGRESO" };

// === Constants ===
const PAYMENT_METHODS = [
  { id: "VISA", label: "Tarjeta de crédito Visa", accountName: "Tarjeta Visa" },
  { id: "DEBITO_AHORROS", label: "Tarjeta débito cuenta de ahorros", accountName: "Cuenta de ahorros" },
  { id: "NEQUI", label: "Nequi", accountName: "Nequi" },
  { id: "DAVIPLATA", label: "Daviplata", accountName: "Daviplata" },
  { id: "CUENTA_AHORROS", label: "Cuenta de ahorros", accountName: "Cuenta de ahorros" },
  { id: "EFECTIVO", label: "Efectivo", accountName: "Efectivo" },
];

const defaultAccounts: Account[] = [
  { id: "daviplata", name: "Daviplata", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: "nequi", name: "Nequi", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: "visa", name: "Tarjeta Visa", type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 300000000, initialDebtCents: 0 },
  { id: "rotativo", name: "Crédito rotativo", type: ACCOUNT_TYPES.CREDIT, creditLimitCents: 500000000, initialDebtCents: 0 },
  { id: "empresa", name: "Cuenta de la empresa", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: "efectivo", name: "Efectivo", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: "ahorros", name: "Cuenta de ahorros", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
  { id: "inversion", name: "Inversión - Ahorro", type: ACCOUNT_TYPES.CASH, initialBalanceCents: 0 },
];

const defaultCategories: Category[] = [
  // Gastos
  { id: "vivienda_servicios", name: "Vivienda - Servicios", kind: "GASTO" },
  { id: "mercado", name: "Mercado", kind: "GASTO" },
  { id: "restaurantes_ocio", name: "Restaurantes - Ocio", kind: "GASTO" },
  { id: "transporte", name: "Transporte", kind: "GASTO" },
  { id: "salud_bienestar", name: "Salud - bienestar", kind: "GASTO" },
  { id: "mascota", name: "Mascota", kind: "GASTO" },
  { id: "aseo_hogar", name: "Aseo - hogar", kind: "GASTO" },
  { id: "suscripciones", name: "Suscripciones", kind: "GASTO" },
  // Ingresos
  { id: "trabajos", name: "Trabajos", kind: "INGRESO" },
  { id: "ventas_reembolsos", name: "Ventas - reembolsos", kind: "INGRESO" },
  { id: "rendimientos", name: "Rendimientos", kind: "INGRESO" },
];

const LS_KEYS = { ACCOUNTS: "ga_accounts", CATEGORIES: "ga_categories", TXS: "ga_transactions" };

// === Storage hook with safety ===
function useLocalState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState] as const;
}

// === Data migration (adds missing accounts/categories) ===
function ensureAccounts(current: Account[]): Account[] {
  const byId = new Map(current.map((a) => [a.id, a]));
  let changed = false;
  for (const a of defaultAccounts) {
    if (!byId.has(a.id)) {
      byId.set(a.id, a);
      changed = true;
    }
  }
  const list = Array.from(byId.values());
  return changed ? list : current;
}
function ensureCategories(current: Category[]): Category[] {
  const have = new Set(current.map((c) => c.id));
  let changed = false;
  for (const c of defaultCategories) {
    if (!have.has(c.id)) {
      current.push(c);
      changed = true;
    }
  }
  return changed ? [...current] : current;
}

// === Calculations ===
type Tx = {
  id: string;
  type: "INGRESO" | "GASTO" | "TRANSFERENCIA";
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

function computeBalances(accounts: Account[], txs: Tx[]) {
  const ef: Record<string, number> = {};
  const debt: Record<string, number> = {};
  accounts.forEach((a) => {
    if (a.type === ACCOUNT_TYPES.CASH) ef[a.id] = a.initialBalanceCents || 0;
    else debt[a.id] = a.initialDebtCents || 0;
  });

  for (const t of txs || []) {
    if (!t || typeof t !== "object") continue;
    const amount = Number(t.amountCents || 0);
    if (!amount) continue;

    if (t.type === "INGRESO") {
      if (t.accountToId && t.accountToId in ef) ef[t.accountToId] += amount;
    } else if (t.type === "GASTO") {
      const from = accounts.find((a) => a.id === t.accountFromId);
      if (!from) continue;
      if (from.type === ACCOUNT_TYPES.CREDIT) {
        debt[from.id] = (debt[from.id] || 0) + amount;
      } else {
        ef[from.id] = (ef[from.id] || 0) - amount;
      }
    } else if (t.type === "TRANSFERENCIA") {
      const from = accounts.find((a) => a.id === t.accountFromId);
      const to = accounts.find((a) => a.id === t.accountToId);
      if (!from || !to || from.id === to.id) continue;
      if (to.type === ACCOUNT_TYPES.CREDIT) {
        debt[to.id] = (debt[to.id] || 0) - amount;
        if (from.type === ACCOUNT_TYPES.CASH) ef[from.id] = (ef[from.id] || 0) - amount;
      } else if (from.type === ACCOUNT_TYPES.CASH && to.type === ACCOUNT_TYPES.CASH) {
        ef[from.id] = (ef[from.id] || 0) - amount;
        ef[to.id] = (ef[to.id] || 0) + amount;
      }
    }
  }

  let creditoDisponibleTotal = 0;
  const perAccount = accounts.map((a) => {
    if (a.type === ACCOUNT_TYPES.CREDIT) {
      const d = debt[a.id] || 0;
      const disp = (a.creditLimitCents || 0) - d;
      creditoDisponibleTotal += disp;
      return { account: a, balanceCents: -d, creditAvailableCents: disp };
    }
    return { account: a, balanceCents: ef[a.id] || 0, creditAvailableCents: null as number | null };
  });
  const efectivoTotal = Object.values(ef).reduce((acc, n) => acc + n, 0);
  return { accounts: perAccount, efectivoTotal, creditoDisponibleTotal };
}

function monthKey(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// === CSV ===
function buildCSV(txs: Tx[]) {
  const header = "id,type,date,amountCents,accountFromId,accountToId,categoryId,paymentMethod,note";
  const rows = (txs || []).map((t) =>
    [
      t.id,
      t.type,
      t.date,
      t.amountCents,
      t.accountFromId || "",
      t.accountToId || "",
      t.categoryId || "",
      t.paymentMethod || "",
      (t.note || "").replace(/,/g, ";"),
    ].join(",")
  );
  return [header, ...rows].join("\n");
}
function parseCSV(text: string): Tx[] {
  const clean = (text || "").replace(/\r/g, "");
  const lines = clean.split("\n").filter(Boolean);
  if (lines.length <= 1) return [];
  return lines.slice(1).map((line) => {
    const [id, type, date, amountCents, accountFromId, accountToId, categoryId, paymentMethod, note] = line.split(",");
    return {
      id: id || crypto.randomUUID?.() || String(Math.random()),
      type: (type as any) || "GASTO",
      date: date || todayStr(),
      amountCents: Number(amountCents || 0),
      accountFromId: accountFromId || null,
      accountToId: accountToId || null,
      categoryId: categoryId || null,
      paymentMethod: paymentMethod || null,
      note: note || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  });
}

// === Error boundary to avoid blank screen ===
class ErrorBoundary extends React.Component<{ children: any }, { hasError: boolean; msg: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, msg: "" };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, msg: String(error?.message || error) };
  }
  componentDidCatch(error: any, info: any) {
    console.error("UI error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, color: "#333" }}>
          <h3>Ups, algo salió mal.</h3>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Detalle: {this.state.msg}</div>
          <button
            style={{ marginTop: 12 }}
            onClick={() => {
              this.setState({ hasError: false, msg: "" });
              location.reload();
            }}
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// === App ===
export default function App() {
  // State
  const [accountsRaw, setAccounts] = useLocalState<Account[]>(LS_KEYS.ACCOUNTS, defaultAccounts);
  const [categoriesRaw, setCategories] = useLocalState<Category[]>(LS_KEYS.CATEGORIES, defaultCategories);
  const [txs, setTxs] = useLocalState<Tx[]>(LS_KEYS.TXS, []);
  const [tab, setTab] = useState<"dashboard" | "reportes">("dashboard");

  // Migrations / safety
  useEffect(() => {
    const fixedA = ensureAccounts(Array.isArray(accountsRaw) ? accountsRaw : []);
    if (fixedA !== accountsRaw) setAccounts(fixedA);
    const fixedC = ensureCategories(Array.isArray(categoriesRaw) ? categoriesRaw : []);
    if (fixedC !== categoriesRaw) setCategories(fixedC);
  }, []); // eslint-disable-line

  const accounts = ensureAccounts(accountsRaw || []);
  const categories = ensureCategories(categoriesRaw || []);

  // Form
  const [form, setForm] = useState<any>({
    type: "TRANSFERENCIA",
    date: todayStr(),
    amount: "0",
    accountFromId: "visa",
    accountToId: "ahorros",
    paymentMethod: "VISA",
    categoryId: null,
    note: "",
  });
  const onChange = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (form.type !== "GASTO") return;
    const pm = PAYMENT_METHODS.find((m) => m.id === form.paymentMethod);
    if (!pm) return;
    const target = accounts.find((a) => a.name.includes(pm.accountName));
    if (target && form.accountFromId !== target.id) setForm((f: any) => ({ ...f, accountFromId: target.id }));
  }, [form.paymentMethod, form.type, accounts]);

  useEffect(() => {
    if (form.type === "TRANSFERENCIA") {
      if (form.categoryId) setForm((f: any) => ({ ...f, categoryId: null }));
      return;
    }
    const allowed = categories.filter((c) => (form.type === "GASTO" && c.kind === "GASTO") || (form.type === "INGRESO" && c.kind === "INGRESO"));
    if (!allowed.some((c) => c.id === form.categoryId)) {
      const first = allowed[0]?.id || null;
      setForm((f: any) => ({ ...f, categoryId: first }));
    }
  }, [form.type, categories]);

  const isIngreso = form.type === "INGRESO";
  const isGasto = form.type === "GASTO";
  const isTransf = form.type === "TRANSFERENCIA";

  const summary = useMemo(() => computeBalances(accounts, txs), [accounts, txs]);

  // Liquidez total (solo cuentas CASH seleccionadas)
  const liquidezIds = ["daviplata", "nequi", "empresa", "efectivo", "ahorros"];
  const liquidezCents = useMemo(() => {
    let total = 0;
    for (const id of liquidezIds) {
      const s = summary.accounts.find((x) => x.account.id === id);
      if (s) total += s.balanceCents;
    }
    return total;
  }, [summary]);

  // Add transaction
  const addTx = () => {
    const amountCents = toCents(form.amount);
    if (amountCents <= 0) {
      alert("Monto inválido");
      return;
    }
    const base = {
      id: crypto.randomUUID?.() || String(Math.random()),
      amountCents,
      date: form.date,
      note: (form.note || "").trim() || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      categoryId: null as string | null,
      paymentMethod: null as string | null,
      accountFromId: null as string | null,
      accountToId: null as string | null,
    };
    let tx: Tx;
    if (isIngreso) tx = { ...(base as any), type: "INGRESO", accountToId: form.accountToId, categoryId: form.categoryId };
    else if (isGasto) tx = { ...(base as any), type: "GASTO", accountFromId: form.accountFromId, categoryId: form.categoryId, paymentMethod: form.paymentMethod };
    else tx = { ...(base as any), type: "TRANSFERENCIA", accountFromId: form.accountFromId, accountToId: form.accountToId };
    setTxs((prev) => [tx, ...(prev || [])]);
    setForm((f: any) => ({ ...f, amount: "0", note: "" }));
  };

  // Export / Import
  const exportCSV = () => {
    const csv = buildCSV(txs || []);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hasaba-transacciones.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e: any) => setTxs((prev) => [...parseCSV(e.target.result as string), ...(prev || [])]);
    reader.readAsText(file);
  };

  // Reports helpers
  const last12 = Array.from({ length: 12 }).map((_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [reportMonth, setReportMonth] = useState<string>("__all__");
  const txsFiltered = useMemo(() => {
    if (reportMonth === "__all__") return txs;
    return (txs || []).filter((t) => monthKey(t.date) === reportMonth);
  }, [txs, reportMonth]);

  const gastosPorCuenta = useMemo(() => {
    const map: Record<string, number> = {};
    (txsFiltered || []).forEach((t) => {
      if (t.type !== "GASTO") return;
      const acc = accounts.find((a) => a.id === t.accountFromId);
      const name = acc?.name || "—";
      map[name] = (map[name] || 0) + t.amountCents;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [txsFiltered, accounts]);

  const gastosPorCategoria = useMemo(() => {
    const map: Record<string, number> = {};
    (txsFiltered || []).forEach((t) => {
      if (t.type !== "GASTO") return;
      const cat = categories.find((c) => c.id === t.categoryId)?.name || "Sin categoría";
      map[cat] = (map[cat] || 0) + t.amountCents;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [txsFiltered, categories]);

  const gastosPorMes = useMemo(() => {
    const map: Record<string, number> = {};
    (txs || []).forEach((t) => {
      if (t.type !== "GASTO") return;
      const k = monthKey(t.date);
      map[k] = (map[k] || 0) + t.amountCents;
    });
    const keys = Object.keys(map).sort().slice(-6);
    return keys.map((k) => ({ name: k, value: map[k] }));
  }, [txs]);

  // UI helpers
  const cardFor = (id: string) => {
    const s = summary.accounts.find((x: any) => x.account.id === id);
    if (!s) return null;
    return (
      <div className="card" key={id}>
        <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>{s.account.name}</div>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(s.balanceCents)}</div>
        {s.account.type === "CREDIT" && (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
            Disponible {fmtCOP(s.creditAvailableCents)} · Cupo {fmtCOP(s.account.creditLimitCents || 0)}
          </div>
        )}
      </div>
    );
  };

  return (
    <ErrorBoundary>
      <div style={{ backgroundColor: PALETTE.bg, minHeight: "100vh", color: PALETTE.text }}>
        {/* Tabs */}
        <div style={{ position: "sticky", top: 0, zIndex: 10, padding: 8, backdropFilter: "blur(6px)" }}>
          <div style={{ display: "flex", gap: 8, padding: 8, borderRadius: 16, background: "rgba(255,255,255,0.35)" }}>
            {[
              { id: "dashboard", label: "DASHBOARD" },
              { id: "reportes", label: "REPORTES" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id as any)}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 14,
                  color: tab === t.id ? "white" : PALETTE.text,
                  background: tab === t.id ? PALETTE.accent : "#FAFEFF",
                  border: "none",
                  fontWeight: 600,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="container">
          {tab === "dashboard" && (
            <section style={{ display: "grid", gap: 16 }}>
              {/* Liquidez total */}
              <div className="card">
                <div style={{ opacity: 0.7, fontSize: 14, marginBottom: 6 }}>Liquidez total</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCOP(liquidezCents)}</div>
              </div>

              {/* Daviplata - Nequi */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {cardFor("daviplata")}
                {cardFor("nequi")}
              </div>
              {/* Visa - Rotativo */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {cardFor("visa")}
                {cardFor("rotativo")}
              </div>
              {/* Empresa - Efectivo */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {cardFor("empresa")}
                {cardFor("efectivo")}
              </div>
              {/* Ahorros - Inversión */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {cardFor("ahorros")}
                {cardFor("inversion")}
              </div>

              {/* Formulario */}
              <div className="card">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>Fecha</div>
                    <input type="date" value={form.date} onChange={(e) => onChange("date", e.target.value)} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>Monto (COP)</div>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="0"
                      value={form.amount}
                      onKeyDown={(e) => ["e", "E", "+", "-"].includes(e.key) && e.preventDefault()}
                      onChange={(e) => onChange("amount", e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>Medio de pago</div>
                  <select
                    value={form.paymentMethod}
                    onChange={(e) => onChange("paymentMethod", e.target.value)}
                    disabled={isIngreso || isTransf}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>Cuenta origen</div>
                    <select
                      value={form.accountFromId}
                      onChange={(e) => onChange("accountFromId", e.target.value)}
                      disabled={isIngreso || isGasto}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>Cuenta destino</div>
                    <select value={form.accountToId} onChange={(e) => onChange("accountToId", e.target.value)} disabled={isGasto}>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>Categoría</div>
                    <select
                      value={form.categoryId || ""}
                      onChange={(e) => onChange("categoryId", e.target.value)}
                      disabled={isTransf}
                    >
                      {categories
                        .filter((c) => (form.type === "GASTO" && c.kind === "GASTO") || (form.type === "INGRESO" && c.kind === "INGRESO"))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>Nota</div>
                    <input type="text" placeholder="Descripción" value={form.note} onChange={(e) => onChange("note", e.target.value)} />
                  </div>
                </div>

                <div className="seg" style={{ marginTop: 12 }}>
                  {["INGRESO", "GASTO", "TRANSFERENCIA"].map((t) => (
                    <button key={t} className={form.type === t ? "active" : ""} onClick={() => onChange("type", t)}>
                      {t[0] + t.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>

                <button
                  className="btn-primary"
                  onClick={addTx}
                  style={{
                    width: "100%",
                    marginTop: 12,
                    padding: "12px 16px",
                    borderRadius: 16,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  + Guardar
                </button>
              </div>
            </section>
          )}

          {tab === "reportes" && (
            <section style={{ display: "grid", gap: 16 }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select value={reportMonth} onChange={(e) => setReportMonth(e.target.value)}>
                    <option value="__all__">Todos los meses</option>
                    {last12.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button onClick={exportCSV}>Exportar</button>
                  <label style={{ cursor: "pointer" }}>
                    Importar CSV
                    <input
                      type="file"
                      accept=".csv"
                      style={{ display: "none" }}
                      onChange={(e) => e.target.files && e.target.files[0] && importCSV(e.target.files[0])}
                    />
                  </label>
                </div>

                {/* Totales */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
                  <div className="card">
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>Gastos por cuenta</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {gastosPorCuenta.map((g) => (
                        <li key={g.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${PALETTE.line}` }}>
                          <span>{g.name}</span>
                          <strong>{fmtCOP(g.value)}</strong>
                        </li>
                      ))}
                      {gastosPorCuenta.length === 0 && <div style={{ opacity: 0.6 }}>Sin datos</div>}
                    </ul>
                  </div>
                  <div className="card">
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>Gastos por categoría</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {gastosPorCategoria.map((g) => (
                        <li key={g.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${PALETTE.line}` }}>
                          <span>{g.name}</span>
                          <strong>{fmtCOP(g.value)}</strong>
                        </li>
                      ))}
                      {gastosPorCategoria.length === 0 && <div style={{ opacity: 0.6 }}>Sin datos</div>}
                    </ul>
                  </div>
                </div>

                {/* Tabla */}
                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 14 }}>
                    <thead>
                      <tr style={{ color: PALETTE.text, opacity: 0.8 }}>
                        <th style={{ textAlign: "left", padding: "8px 0" }}>Fecha</th>
                        <th style={{ textAlign: "left" }}>Tipo</th>
                        <th style={{ textAlign: "left" }}>Monto</th>
                        <th style={{ textAlign: "left" }}>Cuenta</th>
                        <th style={{ textAlign: "left" }}>Categoría</th>
                        <th style={{ textAlign: "left" }}>Nota</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(txsFiltered || []).map((t) => (
                        <tr key={t.id} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                          <td style={{ padding: "8px 0", whiteSpace: "nowrap" }}>{t.date}</td>
                          <td>{t.type}</td>
                          <td>{fmtCOP(t.amountCents)}</td>
                          <td>
                            {t.type === "INGRESO" && (accounts.find((a) => a.id === t.accountToId)?.name || "—")}
                            {t.type === "GASTO" && (accounts.find((a) => a.id === t.accountFromId)?.name || "—")}
                            {t.type === "TRANSFERENCIA" &&
                              `${accounts.find((a) => a.id === t.accountFromId)?.name || "—"} → ${accounts.find((a) => a.id === t.accountToId)?.name || "—"}`}
                          </td>
                          <td>{categories.find((c) => c.id === t.categoryId)?.name || "—"}</td>
                          <td title={t.note || ""} style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.note || ""}
                          </td>
                          <td>
                            <button onClick={() => setTxs((prev) => (prev || []).filter((x) => x.id !== t.id))}>Borrar</button>
                          </td>
                        </tr>
                      ))}
                      {(!txsFiltered || txsFiltered.length === 0) && (
                        <tr>
                          <td colSpan={7} style={{ textAlign: "center", color: PALETTE.text, opacity: 0.6, padding: 16 }}>
                            Sin transacciones
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Gastos por mes (últimos 6)</div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {gastosPorMes.map((g) => (
                    <li key={g.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${PALETTE.line}` }}>
                      <span>{g.name}</span>
                      <strong>{fmtCOP(g.value)}</strong>
                    </li>
                  ))}
                  {gastosPorMes.length === 0 && <div style={{ opacity: 0.6 }}>Sin datos</div>}
                </ul>
              </div>
            </section>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
