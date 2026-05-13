# Competition Requirements — Proof of Ship (MiniPay MiniApp)

## Official Requirements

Source: https://github.com/celo-org/celopedia-skills

> "To qualify, your agent must:
> → Be registered with ERC-8004
> → Be registered with @Selfxyz Agent ID
> → Have a wallet with onchain transactions"

---

## Current Status

| Requirement | Status | Notes |
|---|---|---|
| ERC-8004 registered | ✅ Step 1 done / ❌ Step 2 stuck | agentId 9057 minted on Celo mainnet |
| Self.xyz Agent ID | ❌ Not started | No code needed — passport scan only |
| Onchain wallet txs | ✅ Done | AgentWallet has real txs on mainnet |

---

## Requirement 1 — ERC-8004 Agent Identity Registration

**What it means:** Register the ShipPost AI agent with the on-chain ERC-8004 Identity Registry. This gives the agent a verified on-chain identity (`agentId`) backed by metadata describing its capabilities, endpoints, and payment wallet.

**Source reference:** `skills/celopedia-skill/references/ai-agents.md` in https://github.com/celo-org/celopedia-skills

**Registry contracts:**
- Celo Mainnet: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Celo Sepolia: `0x8004A818BFB912233c491871b3d84c89A494BD9e`

**Full registration flow:**
1. Call `register(agentURI)` on the Identity Registry → returns `agentId` (ERC-721 NFT mint)
2. Call `setAgentWallet(agentId, walletAddress, deadline, signature)` → links the payment EOA to the agent identity

### Step 1 — DONE

- `register("https://shippost.vercel.app/agent.json")` → **agentId: 9057**
- Tx: `0xce7930f4a67b675b3f124f350306ce69ca54cf0656b7397e1dd69d002ae321ce`
- Script: `scripts/register-erc8004.ts`

### Step 2 — STUCK: `setAgentWallet`

`setAgentWallet(agentId, deployerEOA, deadline, signature)` is reverting with `invalid wallet sig`.

**Root cause found:**
- The deployed contract is a **UUPS proxy**, implementation at `0x7274e874ca62410a93bd8bf61c69d8045e399c02`
- The deployed bytecode **differs from the GitHub source** at `selfxyz/self-agent-id`
- Actual EIP-712 domain name in bytecode: **`"ERC8004IdentityRegistry"`** (not `"SelfAgentRegistry"` as in GitHub)
- Actual `AGENT_WALLET_SET_TYPEHASH` in bytecode: `0x5f9ce34815f8e11431c7bb75a8e6886a91478f7ffc1dbb0a98dc240fddd76b75`
- The corresponding type string has **not been found yet** (brute force did not match)
- Contract enforces `deadline <= block.timestamp + 300s` ("deadline too far" if exceeded)

**Options to fix `setAgentWallet`:**

Option A — Find the correct type string:
1. Inspect the JS bundle of `selfagentid.xyz` to extract the exact EIP-712 signing logic
2. Or open a GitHub issue / ask in the selfxyz Discord for the deployed contract ABI

Option B — Use the web UI instead of the script:
1. Go to **https://app.ai.self.xyz** (the docs still reference `selfagentid.xyz` but that domain is NXDOMAIN — the live frontend moved to `app.ai.self.xyz`, confirmed in the [self-agent-id repo README](https://github.com/selfxyz/self-agent-id))
2. Connect the deployer wallet (`0xcfab15c950093391fa1ca3b9810880839b05bcbc`) on Celo Mainnet
3. Use the UI to link the wallet to agentId 9057 — the UI will use the correct type string

Option C — Skip `setAgentWallet` (acceptable):
- `register()` succeeded = agent **is registered with ERC-8004**
- `setAgentWallet` is optional metadata linking, not the core registration requirement

**Recommendation: Try Option B first (fastest). If the UI does not support claiming an existing agentId, fall back to Option A.**

---

## Requirement 2 — Self.xyz Agent ID

**What it means:** Bind the ShipPost agent's deployer EOA to a verified human identity using zero-knowledge passport proofs. The result is a soulbound ERC-721 NFT on Celo that proves the AI agent is backed by a real, verified human — preventing Sybil attacks and enabling trustless accountability.

**Source reference:** https://docs.celo.org/build-on-celo/build-with-self and https://app.ai.self.xyz (live frontend; the older `selfagentid.xyz` URL referenced in some docs is NXDOMAIN)

**Self.xyz contracts:**
- Celo Mainnet: `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944`
- Celo Sepolia: `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379`

### How to register (no code required)

1. Download the **Self app** on iOS or Android
2. Open **https://app.ai.self.xyz** in a browser (note: `selfagentid.xyz` referenced in older docs is NXDOMAIN)
3. Connect the deployer wallet (`0xcfab15c950093391fa1ca3b9810880839b05bcbc`)
4. Scan your **passport** via NFC on your phone inside the Self app
5. The app generates a ZK proof locally (no personal data leaves the device)
6. The proof is verified on-chain → a soulbound NFT is minted binding the deployer address to a unique human nullifier → **Agent ID complete**

**Note:** The passport must support NFC (biometric chip). Vietnamese passports issued after 2022 typically have NFC. If unavailable, the Self app may also support NFC-enabled national ID cards (CCCD gắn chip).

---

## Related Files

| File | Description |
|---|---|
| `scripts/register-erc8004.ts` | ERC-8004 registration script (deadline and domain fixed) |
| `public/agent.json` | ShipPost agent metadata served by Next.js |
| `deployments/celoSepolia.json` | Testnet deployment addresses |

## Commands

```bash
# Run only setAgentWallet (skip register which is already done)
ERC8004_AGENT_ID=9057 pnpm register:erc8004:mainnet

# Run on testnet first if needed
ERC8004_AGENT_ID=<testnet_id> pnpm register:erc8004:testnet
```
