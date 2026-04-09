/**
 * Arc Signal Market — standalone backend
 *
 * Pay-per-signal API for Solana DEX divergence signals.
 * Agents pay $0.001 USDC via Circle Nanopayments on Arc (chain ID 1516).
 *
 * Hackathon: Agentic Economy on Arc — Circle + Arc L1
 */

import express from "express";
import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pino from "pino";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = pino({ level: "info", transport: { target: "pino-pretty" } });
const app = express();
app.use(express.json());

// CORS for frontend dev
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Payment-Proof, X-Agent-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});

// ─── Config ───────────────────────────────────────────────────────────────────
const SIGNAL_PRICE_USDC    = 0.001;
const DATA_FEED_PRICE_USDC = 0.0003;
const ARC_CHAIN_ID         = 1516;
const PORT                 = parseInt(process.env["PORT"] ?? "8080");

// ─── Persistence ──────────────────────────────────────────────────────────────
const DATA_DIR = path.resolve(__dirname, "../../.data");
const TX_FILE  = path.join(DATA_DIR, "arc-transactions.json");

interface ArcTransaction {
  id: string;
  type: "signal_purchase" | "data_feed";
  fromAgent: string;
  toAgent: string;
  amountUsdc: number;
  signalId?: string;
  tokenSymbol?: string;
  spreadPct?: number;
  arcTxHash: string;
  blockNumber: number;
  timestamp: number;
}

function loadTxs(): ArcTransaction[] {
  try {
    if (fs.existsSync(TX_FILE)) return JSON.parse(fs.readFileSync(TX_FILE, "utf8")) as ArcTransaction[];
  } catch { /* ignore */ }
  return [];
}

function saveTxs(txs: ArcTransaction[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TX_FILE, JSON.stringify(txs, null, 2));
}

let transactions = loadTxs();
let simBlock = 8_000_000 + Math.floor(Math.random() * 50_000);

function makeHash(): string {
  return "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function makeSignalId(): string {
  return "sig_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Mock divergence signals ───────────────────────────────────────────────────
const PAIRS = [
  { tokenSymbol: "WIF", buyDex: "Raydium", sellDex: "Orca" },
  { tokenSymbol: "BONK", buyDex: "Jupiter", sellDex: "Raydium" },
  { tokenSymbol: "POPCAT", buyDex: "Orca", sellDex: "Jupiter" },
  { tokenSymbol: "PYTH", buyDex: "Raydium", sellDex: "Meteora" },
  { tokenSymbol: "JTO", buyDex: "Jupiter", sellDex: "Orca" },
];

function getMockDivergences() {
  return PAIRS.map(p => ({
    ...p,
    spreadPct: parseFloat((Math.random() * 4 + 0.5).toFixed(2)),
    confidence: parseFloat((Math.random() * 0.3 + 0.7).toFixed(2)),
    buyPrice: parseFloat((Math.random() * 10).toFixed(6)),
    sellPrice: parseFloat((Math.random() * 10 + 0.05).toFixed(6)),
    timestamp: Date.now(),
  })).sort((a, b) => b.spreadPct - a.spreadPct);
}

// ─── Circle verification ───────────────────────────────────────────────────────
const USDC_MIN = SIGNAL_PRICE_USDC; // $0.001

interface CircleTxResponse {
  data?: {
    transaction?: {
      state: string;
      txHash?: string;
      blockHeight?: number;
      amounts?: Array<{ amount: string }>;
      destinationAddress?: string;
    };
  };
}

async function verifyPayment(
  proof: string | undefined
): Promise<{ valid: boolean; txHash: string; blockNumber: number; real?: boolean }> {
  const apiKey   = process.env["CIRCLE_API_KEY"];
  const walletId = process.env["CIRCLE_WALLET_ID"];

  // Real verification: proof is a UUID-format Circle transaction ID
  if (apiKey && proof && proof !== "demo" && /^[0-9a-f-]{36}$/i.test(proof)) {
    try {
      const resp = await fetch(`https://api.circle.com/v1/w3s/transactions/${proof}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await resp.json() as CircleTxResponse;
      const tx   = data?.data?.transaction;

      if (!tx) return { valid: false, txHash: "", blockNumber: 0 };

      const amt      = parseFloat(tx.amounts?.[0]?.amount ?? "0");
      const destOk   = !walletId || tx.destinationAddress?.toLowerCase() === walletId.toLowerCase();
      const complete = tx.state === "COMPLETE" || tx.state === "CONFIRMED";
      const amtOk    = amt >= USDC_MIN;

      logger.info({ proof, state: tx.state, amt, destOk }, "Circle tx verified");

      if (complete && amtOk && destOk) {
        return { valid: true, txHash: tx.txHash ?? proof, blockNumber: tx.blockHeight ?? simBlock, real: true };
      }
      return { valid: false, txHash: "", blockNumber: 0 };
    } catch (err) {
      logger.warn({ err }, "Circle API error, falling back to demo");
    }
  }

  // Demo mode: always valid
  simBlock += Math.floor(Math.random() * 3) + 1;
  return { valid: true, txHash: makeHash(), blockNumber: simBlock };
}

// ─── Routes ───────────────────────────────────────────────────────────────────
const router = Router();

// GET /api/arc/signal/latest — 402-gated signal endpoint
router.get("/signal/latest", async (req, res) => {
  const proof = req.headers["x-payment-proof"] as string | undefined;

  if (!proof) {
    res.status(402).json({
      error: "Payment required",
      paymentDetails: {
        network: "arc",
        chainId: ARC_CHAIN_ID,
        token: "USDC",
        amount: SIGNAL_PRICE_USDC,
        recipient: process.env["CIRCLE_WALLET_ADDRESS"] ?? "0xYourArcWalletAddress",
        memo: "arc-signal-v1",
        standard: "x402",
      },
    });
    return;
  }

  const { valid, txHash, blockNumber } = await verifyPayment(proof);
  if (!valid) {
    res.status(402).json({ error: "Payment verification failed" });
    return;
  }

  const signals  = getMockDivergences();
  const signalId = makeSignalId();

  const signalTx: ArcTransaction = {
    id: signalId,
    type: "signal_purchase",
    fromAgent: (req.headers["x-agent-id"] as string) ?? "anonymous-agent",
    toAgent: "arc-signal-server",
    amountUsdc: SIGNAL_PRICE_USDC,
    signalId,
    tokenSymbol: signals[0]?.tokenSymbol ?? "N/A",
    spreadPct: signals[0]?.spreadPct,
    arcTxHash: txHash,
    blockNumber,
    timestamp: Date.now(),
  };

  simBlock += 1;
  const dataFeedTx: ArcTransaction = {
    id: "df_" + Date.now().toString(36),
    type: "data_feed",
    fromAgent: "arc-signal-server",
    toAgent: "dexscreener-data-agent",
    amountUsdc: DATA_FEED_PRICE_USDC,
    signalId,
    arcTxHash: makeHash(),
    blockNumber: simBlock,
    timestamp: Date.now() + 50,
  };

  transactions = [signalTx, dataFeedTx, ...transactions].slice(0, 500);
  saveTxs(transactions);

  res.json({
    signalId,
    purchasedAt: Date.now(),
    amountUsdc: SIGNAL_PRICE_USDC,
    arcTxHash: txHash,
    blockNumber,
    chainId: ARC_CHAIN_ID,
    signals: signals.slice(0, 5),
    dataFeedTxHash: dataFeedTx.arcTxHash,
  });
});

// GET /api/arc/transactions
router.get("/transactions", (_req, res) => {
  res.json({ transactions: transactions.slice(0, 100), total: transactions.length });
});

// GET /api/arc/stats
router.get("/stats", (_req, res) => {
  const totalUsdc = transactions.reduce((s, t) => s + t.amountUsdc, 0);
  res.json({
    totalTransactions: transactions.length,
    signalPurchases: transactions.filter(t => t.type === "signal_purchase").length,
    dataFeedPayments: transactions.filter(t => t.type === "data_feed").length,
    totalUsdcSettled: Math.round(totalUsdc * 1_000_000) / 1_000_000,
    signalPriceUsdc: SIGNAL_PRICE_USDC,
    dataFeedPriceUsdc: DATA_FEED_PRICE_USDC,
    chainId: ARC_CHAIN_ID,
    chainName: "Arc Testnet",
    latestBlock: simBlock,
    marginComparison: {
      hypotheticalEthGasPer: 0.30,
      arcFeePer: SIGNAL_PRICE_USDC * 0.02,
      breakEvenSignals: 50000,
    },
  });
});

// POST /api/arc/demo/purchase — demo agent purchase (no 402, for UI demo)
router.post("/demo/purchase", async (req, res) => {
  const { valid, txHash, blockNumber } = await verifyPayment("demo");
  if (!valid) { res.status(500).json({ error: "demo failed" }); return; }

  const signals  = getMockDivergences();
  const signalId = makeSignalId();

  const signalTx: ArcTransaction = {
    id: signalId,
    type: "signal_purchase",
    fromAgent: "demo-trader-agent",
    toAgent: "arc-signal-server",
    amountUsdc: SIGNAL_PRICE_USDC,
    signalId,
    tokenSymbol: signals[0]?.tokenSymbol ?? "DEMO",
    spreadPct: signals[0]?.spreadPct ?? 3.2,
    arcTxHash: txHash,
    blockNumber,
    timestamp: Date.now(),
  };

  simBlock += 1;
  const dataFeedTx: ArcTransaction = {
    id: "df_" + Date.now().toString(36),
    type: "data_feed",
    fromAgent: "arc-signal-server",
    toAgent: "dexscreener-data-agent",
    amountUsdc: DATA_FEED_PRICE_USDC,
    signalId,
    arcTxHash: makeHash(),
    blockNumber: simBlock,
    timestamp: Date.now() + 50,
  };

  transactions = [signalTx, dataFeedTx, ...transactions].slice(0, 500);
  saveTxs(transactions);

  res.json({ ok: true, signalTx, dataFeedTx, signals: signals.slice(0, 3) });
});

// GET /api/arc/config
router.get("/config", (_req, res) => {
  res.json({
    circleApiConfigured: !!process.env["CIRCLE_API_KEY"],
    circleWalletConfigured: !!process.env["CIRCLE_WALLET_ID"],
    realVerificationActive: !!(process.env["CIRCLE_API_KEY"] && process.env["CIRCLE_WALLET_ID"]),
    signalPriceUsdc: SIGNAL_PRICE_USDC,
    chainId: ARC_CHAIN_ID,
    chainName: "Arc Testnet",
    proofFormat: "Circle transaction ID (UUID) sent as X-Payment-Proof header",
  });
});

app.use("/api/arc", router);
app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  logger.info(`Arc Signal Market backend running on port ${PORT}`);
  logger.info(`Circle API: ${process.env["CIRCLE_API_KEY"] ? "configured" : "demo mode"}`);
});
