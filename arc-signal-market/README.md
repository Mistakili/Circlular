# Arc Signal Market

> Pay-per-signal AI trading API — built for the **Agentic Economy on Arc** hackathon (Circle + Arc L1)

AI agents pay **$0.001 USDC** per Solana DEX divergence signal via Circle Nanopayments, settled on Arc (chain ID 1516). Every signal purchase automatically triggers a sub-payment to the underlying data-feed agent — creating a fully autonomous agent-to-agent payment loop, entirely on-chain.

---

## What it does

| Layer | Description |
|---|---|
| **Signal Gate** | `GET /arc/signal/latest` returns `402 Payment Required` with Arc/USDC payment details |
| **Circle Nanopayments** | Agent pays $0.001 USDC via Circle W3S — sends Circle TX ID as `X-Payment-Proof` header |
| **Verification** | Server calls Circle API to confirm TX state, amount, and destination before releasing signal |
| **Sub-payment** | Server auto-pays the data-feed agent $0.0003 USDC — logged on-chain |
| **Arc Settlement** | All payments settle on Arc (EVM L1 by Circle, chain ID 1516), ~0.4s finality, near-zero gas |

## Architecture

```
Trader Agent
    │
    │  GET /arc/signal/latest
    ▼
Signal Server ──── 402 Payment Required ────► Agent pays $0.001 USDC on Arc
    │                                          (Circle Nanopayment, X-Payment-Proof)
    │  Circle API verify TX
    ├─────────────────────────────────────────► ✓ Verified
    │
    │  Release signal + record Arc TX
    │
    └──► Sub-pay data-feed agent $0.0003 USDC (autonomous, on-chain)
```

## Quick Start

### Prerequisites

- Node.js 18+
- [Circle Developer account](https://console.circle.com) with API key
- Arc Testnet wallet with USDC

### Setup

```bash
# Clone and install
git clone https://github.com/your-org/arc-signal-market
cd arc-signal-market
npm install

# Configure environment
cp .env.example .env
# Fill in your Circle API key and wallet address

# Start backend
cd backend && npm run dev

# Start frontend (separate terminal)
cd frontend && npm run dev
```

### Environment Variables

```env
CIRCLE_API_KEY=your_circle_api_key
CIRCLE_WALLET_ID=your_circle_wallet_id
CIRCLE_WALLET_ADDRESS=your_arc_wallet_address
CIRCLE_ENTITY_SECRET_CIPHERTEXT=your_entity_secret_ciphertext
PORT=8080
```

## API Reference

### `GET /api/arc/signal/latest`

Without payment proof — returns 402:

```json
{
  "error": "Payment required",
  "paymentDetails": {
    "network": "arc",
    "chainId": 1516,
    "token": "USDC",
    "amount": 0.001,
    "recipient": "0xYourArcWalletAddress",
    "standard": "x402"
  }
}
```

With `X-Payment-Proof: <circle-tx-uuid>` header — returns signal:

```json
{
  "signalId": "sig_abc123",
  "amountUsdc": 0.001,
  "arcTxHash": "0x...",
  "chainId": 1516,
  "signals": [
    {
      "tokenSymbol": "WIF",
      "spreadPct": 3.2,
      "buyDex": "Raydium",
      "sellDex": "Orca",
      "confidence": 0.87
    }
  ],
  "dataFeedTxHash": "0x..."
}
```

### `GET /api/arc/transactions`

Returns the full on-chain transaction ledger.

### `GET /api/arc/stats`

Aggregate stats: total USDC settled, signal count, chain info.

### `GET /api/arc/config`

Returns whether real Circle verification is active.

## Agent Integration Example

```python
import requests

SIGNAL_API = "https://your-deployment.com/api/arc/signal/latest"
CIRCLE_API_KEY = "your_circle_api_key"
AGENT_WALLET_ID = "your_circle_wallet_id"

def buy_signal():
    # Step 1: discover payment requirements
    r = requests.get(SIGNAL_API)
    assert r.status_code == 402
    details = r.json()["paymentDetails"]

    # Step 2: pay on Arc via Circle Nanopayments
    tx = circle_pay(
        to=details["recipient"],
        amount=details["amount"],
        token="USDC",
        chain_id=details["chainId"]  # 1516 = Arc
    )

    # Step 3: claim signal with proof
    signal = requests.get(
        SIGNAL_API,
        headers={
            "X-Payment-Proof": tx["id"],
            "X-Agent-Id": "my-trading-agent-v1"
        }
    ).json()

    print(f"Got signal: {signal['signals'][0]}")
    print(f"Arc TX: {signal['arcTxHash']}")
    return signal
```

## Hackathon Details

- **Event**: Agentic Economy on Arc — Circle + Arc L1 hackathon
- **Track**: Pay-per-use agentic API with Circle Nanopayments on Arc
- **Chain**: Arc Testnet (Chain ID 1516) — EVM-compatible L1 by Circle
- **Token**: USDC native (no bridging)
- **Pattern**: x402 payment standard + agent-to-agent sub-payments
- **Submission deadline**: April 25, 2026

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React + Vite + Tailwind CSS
- **Payments**: Circle Web3 Services (W3S) Nanopayments
- **Chain**: Arc Testnet (EVM, chain ID 1516)
- **Signal source**: Live Solana DEX divergence scanner (Raydium, Orca, Jupiter)

## License

MIT
