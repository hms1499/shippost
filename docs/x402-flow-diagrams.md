# ShipPost x402 Flow Diagrams

## 1. Payment Distribution Flow (Bước 0)

```mermaid
flowchart TD
    User["👤 User in MiniPay"] -->|pays $0.05 cUSD| SP["ShipPostPayment.sol"]
    SP -->|splits| Split["Payment Splitter"]
    Split -->|50% $0.025| AW["💰 AgentWallet<br/>x402 budget"]
    Split -->|40% $0.02| TR["📊 Treasury<br/>team revenue"]
    Split -->|10% $0.005| RS["🔒 Reserve<br/>refund buffer"]
    
    AW -->|event: ThreadRequested| OR["🤖 Orchestrator"]
    
    style AW fill:#4f46e5
    style TR fill:#7c3aed
    style RS fill:#db2777
    style OR fill:#059669
```

## 2. x402 Proxy Verification & Settlement Flow

```mermaid
flowchart LR
    A["Orchestrator<br/>Backend"] -->|1. Sign EIP-712<br/>payment intent| B["Private Key<br/>AgentWallet"]
    B -->|2. Generate signature| C["EIP-712 Signed<br/>X-Payment header"]
    C -->|3. POST to proxy<br/>Header: X-Payment| D["🔐 /api/x402/groq"]
    
    D -->|4. Verify signature| E{✓ Valid?}
    E -->|No| E1["❌ Reject"]
    E -->|Yes| E2["5. Check daily cap<br/>spentToday + fee?"]
    
    E2 -->|Exceeded| E3["❌ Reject<br/>over limit"]
    E2 -->|OK| E4["6. Forward to<br/>Groq API"]
    
    E4 -->|7. Get response| E5["Groq API<br/>Response"]
    E5 -->|8. Settle: pull<br/>cUSD from wallet| E6["AgentWallet<br/>executeX402Call"]
    
    E6 -->|9. Emit payment event| E7["X402PaymentMade"]
    E7 -->|10. Return response| A
    
    style D fill:#f59e0b
    style E6 fill:#4f46e5
    style E7 fill:#10b981
```

## 3. Full Pipeline Execution Flow

```mermaid
flowchart TD
    User["👤 User"] -->|Pay $0.05| Pay["💳 ShipPostPayment"]
    Pay -->|$0.025| AW["AgentWallet"]
    Pay -->|ThreadRequested event| OR["🤖 Orchestrator"]
    
    OR -->|Check mode| Mode{Mode?}
    
    Mode -->|Educational| ModeA["📚 Mode A"]
    Mode -->|Hot Take| ModeB["🔥 Mode B"]
    
    ModeA -->|1️⃣ Groq| GA["Generate thread<br/>x402 cost: $0.003"]
    GA -->|SSE event| UI["📱 UI Progress"]
    
    ModeB -->|1️⃣ Serper| SA["Search news<br/>x402 cost: $0.001"]
    SA -->|SSE event| UI
    SA -->|2️⃣ CoinGecko| CA["Fetch price data<br/>x402 cost: $0.000"]
    CA -->|SSE event| UI
    CA -->|3️⃣ Groq| GB["Generate thread<br/>x402 cost: $0.003"]
    GB -->|SSE event| UI
    GB -->|4️⃣ Groq Fact-Check| FC["Verify & fact-check<br/>x402 cost: $0.002"]
    FC -->|SSE event| UI
    
    UI -->|Total spent| Check["$0.025 spent<br/>from AgentWallet"]
    Check -->|Thread ready| Share["Share to X"]
    
    style AW fill:#4f46e5
    style OR fill:#059669
    style ModeA fill:#8b5cf6
    style ModeB fill:#ec4899
    style UI fill:#06b6d4
    style Check fill:#10b981
```

## 4. SSE Stream & UI Progress Theatre

```mermaid
flowchart LR
    subgraph Pipeline["Pipeline Execution"]
        S1["Serper Step"] -->|emit event| E1["{ step: 'serper', cost: $0.001 }"]
        S2["CoinGecko Step"] -->|emit event| E2["{ step: 'coingecko', cost: $0.000 }"]
        S3["Groq Write"] -->|emit event| E3["{ step: 'groq', cost: $0.003 }"]
        S4["Groq Fact-Check"] -->|emit event| E4["{ step: 'factcheck', cost: $0.002 }"]
    end
    
    subgraph Stream["SSE Stream"]
        ES["event: pipeline<br/>data: { step, status, cost }"]
    end
    
    subgraph UI["UI (useThreadGeneration)"]
        UI1["🔍 Searching news  ✓  $0.001"]
        UI2["📊 Fetching price  ✓  $0.000"]
        UI3["✍️  Writing thread  ⏳ ..."]
        UI4["✅ Fact-checking     —"]
        UI5["Total: $0.004 / $0.025"]
    end
    
    E1 --> ES
    E2 --> ES
    E3 --> ES
    E4 --> ES
    
    ES -->|realtime update| UI1
    ES -->|realtime update| UI2
    ES -->|realtime update| UI3
    ES -->|realtime update| UI4
    ES -->|realtime update| UI5
    
    style ES fill:#f59e0b
    style UI5 fill:#34d399
```

## 5. Agent Wallet Daily Spend Cap Enforcement

```mermaid
flowchart TD
    Request["x402 Request<br/>amount: $0.003"] --> Check["Check daily cap"]
    
    Check -->|Read state| State["spentToday[token]"]
    State -->|cUSD spent: $0.045| Calc["$0.045 + $0.003 = $0.048"]
    
    Calc -->|vs cap| Cap["dailySpendCap<br/>cUSD = $50"]
    
    Cap -->|$0.048 ≤ $50| OK["✓ Within limit"]
    OK -->|Execute| Execute["executeX402Call<br/>pull $0.003 from wallet"]
    
    Cap -->|Exceeds cap| BLOCK["❌ Block request"]
    BLOCK -->|Return| Err["Error: daily cap exceeded"]
    
    Execute -->|Update| New["spentToday[token] = $0.048"]
    New -->|Continue| Proxy["Proxy forwards<br/>to AI service"]
    
    style OK fill:#10b981
    style BLOCK fill:#ef4444
    style Execute fill:#3b82f6
```

## 6. Smart Contract Settlement Flow

```mermaid
sequenceDiagram
    participant User as 👤 User
    participant SCP as ShipPostPayment
    participant AW as AgentWallet
    participant Proxy as x402 Proxy
    participant Groq as Groq API

    User->>SCP: payForThread($0.05 cUSD)
    SCP->>SCP: Split 50/40/10
    SCP->>AW: Transfer $0.025
    SCP-->>Proxy: emit ThreadRequested
    
    Proxy->>Groq: POST /api/x402/groq<br/>(X-Payment: signed)
    Groq-->>Proxy: response (thread)
    
    Proxy->>AW: executeX402Call<br/>amount=$0.003, service="groq"
    AW->>AW: spentToday[cUSD] += $0.003
    AW->>Proxy: pull cUSD via ERC-20 transfer
    AW-->>Proxy: emit X402PaymentMade
    
    Proxy-->>User: return thread + cost breakdown
```

---

## File Structure Reference

- **Payment Entry:** `contracts/ShipPostPayment.sol`
- **Budget & Cap:** `contracts/AgentWallet.sol`
- **Proxy Routes:** `app/api/x402/[groq|serper|coingecko|fact-check]/route.ts`
- **Pipeline Logic:** `lib/pipeline/[runModeA|runModeB].ts`
- **UI State Machine:** `hooks/useThreadGeneration.ts`
- **SSE Stream:** `app/api/generate/stream/route.ts`
