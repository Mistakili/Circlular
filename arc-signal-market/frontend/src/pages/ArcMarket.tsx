import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ArcTx {
  id: string;
  type: "signal_purchase" | "data_feed";
  fromAgent: string;
  toAgent: string;
  amountUsdc: number;
  tokenSymbol?: string;
  spreadPct?: number;
  arcTxHash: string;
  blockNumber: number;
  timestamp: number;
}

interface ArcStats {
  totalTransactions: number;
  signalPurchases: number;
  dataFeedPayments: number;
  totalUsdcSettled: number;
  signalPriceUsdc: number;
  dataFeedPriceUsdc: number;
  chainId: number;
  chainName: string;
  latestBlock: number;
  marginComparison: {
    hypotheticalEthGasPer: number;
    arcFeePer: number;
    breakEvenSignals: number;
  };
}

interface DemoResult {
  ok: boolean;
  signalTx: ArcTx;
  dataFeedTx: ArcTx;
  signals: Array<{ tokenSymbol: string; spreadPct: number; cheapDex: string; expensiveDex: string }>;
}

interface ArcConfig {
  circleApiConfigured: boolean;
  circleWalletConfigured: boolean;
  realVerificationActive: boolean;
  signalPriceUsdc: number;
  chainId: number;
  chainName: string;
  proofFormat: string;
}

interface FlowStep {
  id: number;
  label: string;
  detail: string;
  color: string;
}

const FLOW_STEPS: FlowStep[] = [
  { id: 1, label: "Agent Request",   detail: "GET /arc/signal/latest",               color: "text-violet-400" },
  { id: 2, label: "402 Response",    detail: "$0.001 USDC · Arc · x402",             color: "text-amber-400" },
  { id: 3, label: "Pay on Arc",      detail: "USDC tx broadcasted · ~0.4s finality", color: "text-blue-400"  },
  { id: 4, label: "Verify Payment",  detail: "Circle Nanopayments confirmation",      color: "text-purple-400"},
  { id: 5, label: "Sub-pay DataFeed", detail: "$0.0003 USDC to data-feed agent",      color: "text-teal-400"  },
  { id: 6, label: "Signal Released", detail: "Divergence signal returned · done",    color: "text-green-400" },
];

const BASE = "";

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function shortHash(h: string) {
  return h.slice(0, 6) + "…" + h.slice(-4);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ArcMarket() {
  const [stats, setStats]       = useState<ArcStats | null>(null);
  const [txs, setTxs]           = useState<ArcTx[]>([]);
  const [arcConfig, setArcConfig] = useState<ArcConfig | null>(null);
  const [flowStep, setFlowStep] = useState(0);
  const [demoBuying, setDemoBuying] = useState(false);
  const [demoResult, setDemoResult] = useState<DemoResult | null>(null);
  const [floaters, setFloaters] = useState<Array<{ id: number; text: string }>>([]);
  const floaterIdRef = useRef(0);
  const demoLoopRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── API helpers ─────────────────────────────────────────────────────────────
  const loadStats = useCallback(() => {
    fetch(`${BASE}/api/arc/stats`).then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const loadTxs = useCallback(() => {
    fetch(`${BASE}/api/arc/transactions`).then(r => r.json()).then((d: { transactions: ArcTx[] }) => setTxs(d.transactions ?? [])).catch(() => {});
  }, []);

  const loadConfig = useCallback(() => {
    fetch(`${BASE}/api/arc/config`).then(r => r.json()).then(setArcConfig).catch(() => {});
  }, []);

  useEffect(() => {
    loadStats(); loadTxs(); loadConfig();
    const t = setInterval(() => { loadStats(); loadTxs(); }, 5000);
    return () => clearInterval(t);
  }, [loadStats, loadTxs, loadConfig]);

  // ── Payment flow animation ───────────────────────────────────────────────────
  const animateFlow = useCallback(async () => {
    for (let i = 1; i <= FLOW_STEPS.length; i++) {
      setFlowStep(i);
      await new Promise(r => setTimeout(r, 650));
    }
    setTimeout(() => setFlowStep(0), 1500);
  }, []);

  // ── Demo purchase ────────────────────────────────────────────────────────────
  const runDemoPurchase = useCallback(async () => {
    if (demoBuying) return;
    setDemoBuying(true);
    animateFlow();
    try {
      const r = await fetch(`${BASE}/api/arc/demo/purchase`, { method: "POST" });
      const d = await r.json() as DemoResult;
      setDemoResult(d);
      loadStats(); loadTxs();
      // float-up effect
      const fid = ++floaterIdRef.current;
      setFloaters(prev => [...prev, { id: fid, text: "-$0.001 USDC on Arc" }]);
      setTimeout(() => setFloaters(prev => prev.filter(f => f.id !== fid)), 2000);
    } catch { /* ignore */ }
    setDemoBuying(false);
  }, [demoBuying, animateFlow, loadStats, loadTxs]);

  // ── Auto demo loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    // Seed a few transactions on mount if there are none
    const seed = async () => {
      const r = await fetch(`${BASE}/api/arc/stats`).then(x => x.json()).catch(() => ({ totalTransactions: 0 }));
      if ((r as ArcStats).totalTransactions < 3) {
        for (let i = 0; i < 5; i++) {
          await fetch(`${BASE}/api/arc/demo/purchase`, { method: "POST" }).catch(() => {});
          await new Promise(r => setTimeout(r, 300));
        }
        loadStats(); loadTxs();
      }
    };
    seed();
    // Auto-run a purchase every 30s to keep the demo alive
    demoLoopRef.current = setInterval(() => {
      fetch(`${BASE}/api/arc/demo/purchase`, { method: "POST" }).then(() => { loadStats(); loadTxs(); }).catch(() => {});
    }, 30_000);
    return () => { if (demoLoopRef.current) clearInterval(demoLoopRef.current); };
  }, [loadStats, loadTxs]);

  const totalTxs   = stats?.totalTransactions ?? 0;
  const totalUsdc  = stats?.totalUsdcSettled ?? 0;
  const latestBlock = stats?.latestBlock ?? 0;

  // ── Signal ticker data ───────────────────────────────────────────────────────
  const signalTxs = txs.filter(t => t.type === "signal_purchase").slice(0, 12);
  const tickerItems = signalTxs.length > 0 ? [...signalTxs, ...signalTxs] : [];

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full arc-glow bg-primary flex items-center justify-center text-xs font-black text-white">⬡</div>
            <span className="font-bold text-sm tracking-tight">Soliris <span className="text-primary">Arc</span></span>
            <span className="text-muted-foreground/50 text-xs hidden sm:inline">|</span>
            <span className="text-muted-foreground text-xs hidden sm:inline">Pay-Per-Signal · Settled on Arc · USDC</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {arcConfig?.realVerificationActive && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-violet-500/30 bg-violet-500/10 text-violet-400">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                Circle API Live
              </div>
            )}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-green-500/30 bg-green-500/10 text-green-400">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Arc Testnet
            </div>
            <span className="text-muted-foreground font-mono hidden sm:inline">Block #{latestBlock.toLocaleString()}</span>
          </div>
        </div>
      </header>

      {/* ── Signal Ticker ───────────────────────────────────────────────────── */}
      {tickerItems.length > 0 && (
        <div className="bg-muted/30 border-b border-border/30 py-1.5 ticker-wrap">
          <div className="ticker-inner gap-8 text-xs text-muted-foreground font-mono">
            {tickerItems.map((t, i) => (
              <span key={`${t.id}-${i}`} className="px-4 flex items-center gap-2">
                <span className="text-green-400">●</span>
                <span className="text-foreground/80">{t.tokenSymbol ?? "SIG"}</span>
                {t.spreadPct && <span className="text-violet-400">+{t.spreadPct.toFixed(1)}% spread</span>}
                <span className="text-muted-foreground/50">·</span>
                <span className="text-accent font-bold">$0.001 USDC</span>
                <span className="text-muted-foreground/50">·</span>
                <span>{shortHash(t.arcTxHash)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* ── Hero Stats ──────────────────────────────────────────────────────── */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight">
            <span className="gradient-text">Pay $0.001 USDC per Signal.</span>
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto text-sm sm:text-base">
            Soliris Arc exposes real Solana DEX divergence signals via a pay-per-request API.
            AI agents pay in USDC via Circle Nanopayments, settled on Arc in under a second.
            Every purchase triggers a sub-payment to the data-feed agent — fully on-chain.
          </p>
        </div>

        {/* ── Stat Cards ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Arc Transactions", value: totalTxs.toString(), sub: "on-chain · all signal purchases", color: "text-violet-400" },
            { label: "USDC Settled",     value: `$${totalUsdc.toFixed(4)}`,   sub: "zero gas overhead",             color: "text-green-400"  },
            { label: "Signal Price",     value: "$0.001",                      sub: "per signal · sub-cent",         color: "text-blue-400"   },
            { label: "Arc Chain ID",     value: "1516",                        sub: "EVM-compatible · Circle L1",    color: "text-amber-400"  },
          ].map(s => (
            <div key={s.label} className="glass rounded-xl p-4 space-y-1">
              <div className={`text-2xl font-black font-mono ${s.color}`}>{s.value}</div>
              <div className="text-xs font-semibold text-foreground/80">{s.label}</div>
              <div className="text-xs text-muted-foreground">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Main Grid ───────────────────────────────────────────────────────── */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Payment Flow Visualizer */}
          <div className="glass rounded-2xl p-5 space-y-4 lg:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm text-foreground/90">Payment Flow</h2>
              <span className="text-xs text-muted-foreground">x402 standard</span>
            </div>
            <div className="space-y-2">
              {FLOW_STEPS.map(step => (
                <div
                  key={step.id}
                  className={`rounded-lg border p-3 transition-all duration-400 ${
                    flowStep === step.id
                      ? "step-active"
                      : flowStep > step.id
                      ? "border-green-500/20 bg-green-500/5"
                      : "border-border/30 bg-muted/20"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      flowStep > step.id ? "bg-green-500/20 text-green-400" :
                      flowStep === step.id ? "bg-primary/30 text-primary animate-pulse" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {flowStep > step.id ? "✓" : step.id}
                    </div>
                    <div className="min-w-0">
                      <div className={`text-xs font-semibold ${flowStep === step.id ? step.color : flowStep > step.id ? "text-green-400" : "text-muted-foreground"}`}>
                        {step.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 font-mono truncate">{step.detail}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Demo button */}
            <div className="relative">
              <button
                onClick={runDemoPurchase}
                disabled={demoBuying}
                className="w-full py-2.5 rounded-lg font-bold text-sm bg-primary text-white hover:bg-primary/90 disabled:opacity-60 transition-all arc-glow"
              >
                {demoBuying ? "Purchasing…" : "▶ Run Demo Purchase"}
              </button>
              {floaters.map(f => (
                <div key={f.id} className="absolute left-1/2 -translate-x-1/2 -top-2 text-xs font-bold text-green-400 float-up pointer-events-none">
                  {f.text}
                </div>
              ))}
            </div>

            {demoResult?.signals?.[0] && (
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 space-y-1">
                <div className="text-xs font-semibold text-green-400">Signal received</div>
                <div className="text-xs font-mono text-foreground/80">
                  {demoResult.signals[0].tokenSymbol} · +{demoResult.signals[0].spreadPct?.toFixed(2) ?? "—"}% spread
                </div>
                <div className="text-[10px] text-muted-foreground/60">
                  {demoResult.signals[0].cheapDex} → {demoResult.signals[0].expensiveDex}
                </div>
              </div>
            )}
          </div>

          {/* Transaction Feed */}
          <div className="glass rounded-2xl p-5 space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm text-foreground/90">Arc Transaction Feed</h2>
              <div className="flex items-center gap-1.5 text-xs text-green-400">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Live
              </div>
            </div>
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
              {txs.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-xs">No transactions yet — click Run Demo Purchase</div>
              )}
              {txs.map(tx => (
                <div key={tx.id} className={`rounded-lg border p-2.5 text-xs flex items-center gap-3 ${
                  tx.type === "signal_purchase"
                    ? "border-violet-500/20 bg-violet-500/5"
                    : "border-teal-500/20 bg-teal-500/5"
                }`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${tx.type === "signal_purchase" ? "bg-violet-400" : "bg-teal-400"}`} />
                  <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5">
                    <span className="font-mono text-foreground/70 truncate col-span-2 sm:col-span-1">
                      {shortHash(tx.arcTxHash)}
                    </span>
                    <span className={`font-semibold truncate ${tx.type === "signal_purchase" ? "text-violet-400" : "text-teal-400"}`}>
                      {tx.type === "signal_purchase" ? "Signal" : "DataFeed"}
                    </span>
                    <span className="text-green-400 font-mono font-bold">
                      ${tx.amountUsdc.toFixed(4)}
                    </span>
                    <span className="text-muted-foreground/60">{timeAgo(tx.timestamp)}</span>
                  </div>
                  {tx.tokenSymbol && (
                    <span className="text-muted-foreground/60 flex-shrink-0">{tx.tokenSymbol}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Agent-to-Agent Diagram ───────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6">
          <h2 className="font-bold text-sm text-foreground/90 mb-5">Agent-to-Agent Payment Loop</h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-0">
            {[
              { name: "Trader Agent",       role: "Autonomous buyer",       color: "border-violet-500/40 bg-violet-500/10 text-violet-400", icon: "🤖" },
              { name: "→  $0.001 USDC",     role: "Arc · x402 · <1s",       color: "border-transparent bg-transparent text-muted-foreground", icon: "" },
              { name: "Soliris Signal API", role: "Signal server (you)",    color: "border-primary/40 bg-primary/10 text-primary",           icon: "⬡" },
              { name: "→  $0.0003 USDC",    role: "Arc · sub-payment",      color: "border-transparent bg-transparent text-muted-foreground", icon: "" },
              { name: "DexScreener Agent",  role: "Data-feed provider",     color: "border-teal-500/40 bg-teal-500/10 text-teal-400",         icon: "📡" },
            ].map((node, i) => (
              node.icon ? (
                <div key={i} className={`rounded-xl border px-4 py-3 text-center min-w-[140px] ${node.color}`}>
                  <div className="text-xl mb-1">{node.icon}</div>
                  <div className="font-bold text-xs">{node.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{node.role}</div>
                </div>
              ) : (
                <div key={i} className={`text-xs font-mono text-center px-2 ${node.color}`}>
                  <div>{node.name}</div>
                  <div className="text-[10px]">{node.role}</div>
                </div>
              )
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-4 max-w-xl mx-auto">
            Every signal purchase triggers two Arc transactions: one from the trader agent to the signal server,
            and a sub-payment from the signal server to the data-feed agent. Pure machine-to-machine commerce.
          </p>
        </div>

        {/* ── Margin Calculator ────────────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-sm text-foreground/90">Why This Model Fails on Ethereum (and Works on Arc)</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                label: "Ethereum Mainnet",
                icon: "⛽",
                color: "border-red-500/30 bg-red-500/5 text-red-400",
                rows: [
                  ["Gas per tx",     "~$0.30–$5.00"],
                  ["Signal price",   "$0.001"],
                  ["Feasible?",      "No — gas > revenue by 300–5000×"],
                  ["50k signals",    "~$15,000 gas cost"],
                ],
              },
              {
                label: "Arc Testnet (Circle L1)",
                icon: "⬡",
                color: "border-green-500/30 bg-green-500/5 text-green-400",
                rows: [
                  ["Gas per tx",     "~$0.000015 (USDC-native)"],
                  ["Signal price",   "$0.001"],
                  ["Gas overhead",   "1.5% of revenue"],
                  ["50k signals",    "~$50 gas cost"],
                ],
              },
              {
                label: "Business Model",
                icon: "📈",
                color: "border-blue-500/30 bg-blue-500/5 text-blue-400",
                rows: [
                  ["Revenue per signal", "$0.001"],
                  ["Data-feed cost",     "$0.0003"],
                  ["Net per signal",     "$0.0007"],
                  ["At 1M signals/mo",   "$700 margin"],
                ],
              },
            ].map(card => (
              <div key={card.label} className={`rounded-xl border p-4 space-y-3 ${card.color}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xl">{card.icon}</span>
                  <span className="font-bold text-xs">{card.label}</span>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {card.rows.map(([k, v]) => (
                      <tr key={k}>
                        <td className="text-muted-foreground py-0.5 pr-2">{k}</td>
                        <td className="font-mono font-semibold text-foreground/90 text-right">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>

        {/* ── Integration Code Snippet ─────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 space-y-3">
          <h2 className="font-bold text-sm text-foreground/90">Integrate Any AI Agent in 3 Lines</h2>
          <p className="text-xs text-muted-foreground">
            Any agent that speaks HTTP can buy signals. The x402 standard makes payment automatic — no wallets to configure in the agent.
          </p>
          <pre className="rounded-lg bg-muted/40 border border-border/40 p-4 text-xs font-mono text-foreground/90 overflow-x-auto leading-relaxed">{`// 1. Request signal
const res = await fetch("https://soliris-arc.replit.app/api/arc/signal/latest");

// 2. Handle 402 — pay with Circle Nanopayments on Arc
if (res.status === 402) {
  const { paymentDetails } = await res.json();
  const proof = await circleWallet.nanopay(paymentDetails); // $0.001 USDC on Arc
  const signal = await fetch(url, { headers: { "X-Payment-Proof": proof } });
  console.log(await signal.json()); // ← divergence signal delivered
}`}</pre>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <footer className="text-center text-xs text-muted-foreground/50 py-4 border-t border-border/20">
          Soliris Arc · Built for Agentic Economy on Arc Hackathon · Circle Nanopayments + Arc L1 + USDC
        </footer>
      </div>
    </div>
  );
}
