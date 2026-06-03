# ShipPost — Kiến trúc (bản đọc để hiểu lại)

> Tài liệu này giải thích *vì sao* hệ thống được dựng như vậy, không chỉ *cái gì* ở đâu.
> Mọi tham chiếu dạng `file:line` đều bấm vào nhảy thẳng tới code. Nếu code và tài liệu
> này lệch nhau, code là nguồn sự thật — hãy cập nhật lại file này.

ShipPost là app **trả-tiền-theo-lượt** viết thread X bằng AI, chạy như MiniApp trong ví
MiniPay của Opera. Người dùng trả **$0.05 cUSD/USDT/USDC mỗi thread**. Một ví agent
(ERC-8004) thực hiện 1–4 micro-payment x402 tới các dịch vụ AI (Groq, Serper, CoinGecko)
để sinh ra một thread sẵn-sàng-đăng.

---

## 1. Bức tranh tổng: hai lớp tách bạch

Toàn hệ thống chia làm **2 lớp**, nối nhau bằng đúng một thứ: `payTxHash` (bằng chứng đã trả).

```
NGƯỜI DÙNG (MiniPay webview)
   │ trả 0.05 cUSD  (payForThread)
   ▼
┌────────────────────────────────────────────────┐
│ LỚP 1 — On-chain (Celo)                          │
│  ShipPostPayment.payForThread(token, mode)        │
│   ├─ 50% → AgentWallet                            │
│   ├─ 40% → treasury                               │
│   └─ 10% → reservePool                            │
│  emit ThreadRequested(user, threadId, mode, …)    │
└────────────────────────────────────────────────┘
   │ payTxHash  (client gửi lên backend)
   ▼
┌────────────────────────────────────────────────┐
│ LỚP 2 — Backend (Next.js, SSE)                   │
│  POST /api/generate/stream                        │
│   1. verifyPayment(payTxHash)   ← cổng chặn 402   │
│   2. insert thread 'pending'    ← chống replay    │
│   3. pipeline → mỗi step:                          │
│        gọi API thật → settleX402Call()             │
│        (rút cUSD từ AgentWallet, cap-enforced)     │
│   4. emit tweets → cập nhật 'completed'            │
└────────────────────────────────────────────────┘
```

**Tư tưởng cốt lõi:** blockchain ở đây **không chạy AI**. Nó là *sổ kế toán bất biến*
cho cả thu (payForThread) lẫn chi (executeX402Call). Việc gọi AI diễn ra off-chain trong
backend. Tách rời như vậy nên contract đơn giản, rẻ, và không cần tin backend; backend
thì phải chứng minh lại mọi thứ từ chain.

---

## 2. Lớp 1 — Hai smart contract (`contracts/`)

Cả hai deploy trên Celo Sepolia testnet (chainId 11142220) và Celo mainnet (42220).
Alfajores đã bị Celo khai tử — dùng Celo Sepolia cho testnet.

### 2.1 `ShipPostPayment.sol` — máy chia tiền

Trái tim là `payForThread` (`contracts/ShipPostPayment.sol:92`):

```solidity
uint256 amount = requiredAmount(token);                 // giá theo decimals
IERC20(token).transferFrom(msg.sender, address(this), amount);
// chia 50/40/10 ngay trong cùng 1 tx
emit ThreadRequested(msg.sender, threadId, mode, token, amount);
```

Ba quyết định thiết kế đáng nhớ:

1. **Đa token, không hardcode decimals** (`:85`). `requiredAmount` đọc
   `IERC20Metadata(token).decimals()` rồi tính `5 * 10^(d-2)` = $0.05. cUSD=18,
   USDT/USDC=6 — cùng một hàm phục vụ cả hai. Đây là *key constraint* của dự án.
2. **Chia tiền tức thì, không giữ quỹ.** `reserveShare = amount - agentShare - treasuryShare`
   (`:105`) dùng phép trừ thay vì nhân basis-point lần nữa → wei lẻ do làm tròn luôn rơi
   vào reserve, **không thất thoát 1 wei**.
3. **Event là API thật.** `ThreadRequested` chính là cái backend đọc ngược để verify.
   Contract không gọi backend.

Phần vận hành an toàn: `Pausable` (kill-switch), `Ownable`, `ReentrancyGuard`, whitelist
token (`allowedTokens`), và các setter `setAgentWallet/setTreasury/setReservePool` — bỏ
`immutable` để đổi địa chỉ payout mà không phải redeploy (`:61`).

### 2.2 `AgentWallet.sol` — ví agent có hạn mức (ERC-8004)

Cốt lõi là **daily spend cap** trong `executeX402Call` (`contracts/AgentWallet.sol:57`):

```solidity
uint256 day = block.timestamp / 1 days;                 // cửa sổ 24h UTC
require(spentOnDay[day][token] + amount <= dailySpendCap[token], "CAP_EXCEEDED");
spentOnDay[day][token] += amount;
IERC20(token).transfer(service, amount);
```

→ Dù key orchestrator bị lộ, kẻ tấn công **chỉ rút được tối đa $50/token/ngày**.
Blast radius bị giới hạn bằng *code*, không bằng niềm tin.

Chi tiết tinh tế về `Pausable` (`:9-14`, `:72`): pause đóng băng `executeX402Call` và
`approveFacilitator`, **nhưng `emergencyWithdraw` cố tình vẫn chạy khi paused** — kill-switch
để chặn *chi sai*, không phải để *nhốt tiền*; owner phải luôn rút được ra.

---

## 3. Lớp 2 — Backend: `/api/generate/stream`

Đây là phần đáng học nhất, vì là bài tập "thiết kế khi mọi byte trong request body đều
là thù địch". `app/api/generate/stream/route.ts` spends cUSD thật mỗi lượt.

### 3.1 Bước 1 — `verifyPayment`: cổng trước mọi việc tốn tiền

`route.ts:100` gọi `verifyPayment` (`lib/agent/orchestrator.ts:67`) TRƯỚC khi mở stream
hay tiêu x402. Không tin một field nào trong body:

1. Lấy receipt của `payTxHash`, đòi `status === 'success'`.
2. **Quét log do *chính contract của mình* phát ra** (`:96` skip nếu `log.address` khác
   `ShipPostPayment`) — không tin `receipt.to` để chịu được router/multicall.
3. Khớp `threadId`, `user`, `token`, `mode` với event.
4. **Defense in depth** (`:136`): đọc lại `requiredAmount` on-chain, đòi `evt.amount === required`.
   Event giả mạo cũng không qua.

Trả về **số tiền on-chain** để backend lưu cái đó — **không bao giờ** lưu `amountPaidRaw`
từ client (`:39-42`). Refund sau này tính theo on-chain (`getOnChainPaidAmount`, `:43`),
không theo DB. Bất kỳ sai khớp nào → **402**, zero spend.

### 3.2 Bước 2 — Insert 'pending': chống replay

`route.ts:127` insert **trước** khi mở stream. Unique index `(chain_id, onchain_thread_id)`:
- Trùng → Postgres `23505` → **409**, không tiêu x402.
- Lỗi DB khác → **503 fail-closed**, cũng không tiêu x402.
- Supabase chết hẳn → **degraded mode** có chủ đích (`:122-126`): vẫn phục vụ, mất replay-guard,
  để DB outage không làm tê liệt generation. `verifyPayment` vẫn giới hạn lạm dụng về đúng
  người trả thật + cap.

### 3.3 Bước 3 — Pipeline + invariant "settle gates delivery"

Mô hình step ở `lib/pipeline/`. Hai mode:

| | Mode A (Educational) | Mode B (Hot Take) |
|---|---|---|
| Steps | `groqStep` | `serper → coingecko → groq → factCheck` |
| Hard/soft | groq = hard | serper/coingecko/factCheck = **soft-fail**, groq = **hard** |
| File | `runModeA.ts` | `runModeB.ts` |

Invariant cốt lõi nằm ở **thứ tự emit** (`groqStep.ts:26-33`, `runModeB.ts:85-92`):

```
generateDraft(...)   ← gọi Groq + settleX402Call BÊN TRONG, có boundThread validate
   ↓ (CHỈ khi settle xác nhận)
emit step_settled    ← báo đã trả x402
emit step_output     ← MỚI giao tweets
```

Không bao giờ emit nội dung trước khi settle — nếu không là lỗ "free content + refund".
Output rỗng/rác → `boundThread` throw *trước* settle → không tiêu tiền.

Triết lý soft vs hard (`runModeB.ts`): Serper/CoinGecko/FactCheck lỗi → emit `step_failed`
(không terminal) + chạy tiếp với context null, người dùng *thấy* chất lượng giảm thay vì
âm thầm trả full giá. Groq lỗi → `throw` → cả run fail → refundable. CoinGecko free nên
**không settle** (`wrappedEmit` ở `:28` bỏ qua khi cộng `totalCost`).

### 3.4 Bước 4 — Deadline nội bộ: mọi lỗi đều refundable

`route.ts:35` đặt `maxDuration = 300`, nhưng pipeline tự đặt `PIPELINE_DEADLINE_MS = 150_000`
(`:44`). Lý do (`:38-43`): platform SIGKILL ở 300s là kill cứng, không emit `fatal`, thread
kẹt `'pending'` — trạng thái tệ nhất (đã trả, không có content, không tự refund được). Tự
race timeout sớm hơn → đi qua `catch` bình thường → thread `'failed'` + emit `fatal` →
**refundable**. Nguyên tắc: *mọi failure đều là một trạng thái sạch, refund được.*

`waitForTransactionReceipt` cũng bounded 90s (`orchestrator.ts:35`) — RPC chết không treo
cả generation.

---

## 4. Hai mô hình x402 (ĐỪNG nhầm lẫn)

Codebase có **hai cơ chế khác bản chất**, cùng tên "x402", chảy tiền ngược chiều nhau.

| | Model 1 — Celo in-process | Model 2 — `/api/x402/groq` |
|---|---|---|
| Vai trò | Mình **MUA** dịch vụ | Mình **BÁN** dịch vụ |
| Giao thức | Mô phỏng, không có header `X-Payment` | x402 **thật** qua `@x402/next` |
| Ai trả | AgentWallet chi cho service | **Người gọi** trả cho mình |
| Verify | `verifyPayment` đọc event Celo | `withX402` + CDP facilitator verify `X-Payment` |
| Settle về | sink/burn (`X402_SINK_ADDRESS`) | `X402_PAY_TO` treasury |
| Rủi ro nếu hở | Drain AgentWallet | Không — không trả thì không có content |
| Mạng | Celo (42220 / 11142220) | Base (84532 / mainnet) |

**Model 1** là luồng generate per-thread (mục 3). Mỗi pipeline step gọi `settleX402Call`
(`orchestrator.ts:7`) → `executeX402Call` cap-enforced trên Celo. Groq/Serper/CoinGecko
không hỗ trợ x402 thật nên đây là mô phỏng in-process; **không có HTTP proxy route** cho
luồng này.

**Model 2** (`app/api/x402/groq/route.ts`) là endpoint x402 thật: `withX402` trả 402 kèm
payment requirements, verify `X-Payment` của caller qua facilitator *trước* khi handler chạy,
settle chỉ sau khi handler trả 200 (Groq fail → 502, junk → 422 → không settle). **Không
chạm AgentWallet.** Không trả ⇒ không content ⇒ không charge → không có drain risk. Đã proof
trên Base mainnet 2026-06-03. CDP cần JWT request-scoped, không phải static bearer
(`lib/x402/server.ts`, fix ở commit `4c48a08`).

**Lịch sử:** route `/api/x402/*` *đời đầu* là proxy không xác thực gọi thẳng `settleX402Call`
— drain AgentWallet free, chỉ chặn bởi daily cap — đã bị xóa (`8f4c222`). Model 2 hiện tại
(`c8a796b`) là bản dựng lại an toàn. **Rule:** bất kỳ x402 surface công khai nào cũng phải
verify `X-Payment` trước khi chi, và không bao giờ expose `settleX402Call` mà thiếu verify đó.

Xem thêm: `docs/x402-explained.md`, `docs/x402-flow-diagrams.md`, `docs/x402-mainnet-proof.md`.

---

## 5. Frontend (`app/` + `components/` + `hooks/`)

Next.js 14 App Router, **mobile-only** (MiniPay webview), **dark mode** mặc định. Budget
bundle `<200KB gzipped` trên `/`. Luồng chính:

1. `lib/minipay.ts` — phát hiện `window.ethereum.isMiniPay`, auto-connect qua injected
   provider (không WalletConnect).
2. `lib/useBalances.ts` — đọc balance cUSD/USDT/USDC, mặc định chọn token cao nhất.
3. `lib/usePayForThread.ts` — gửi tx `payForThread` qua wagmi.
4. `hooks/useThreadGeneration.ts` — consumer SSE, state machine có kiểu, lái UI.
5. `components/GeneratingStatus.tsx` — "progress theatre": cost x402 từng step + link Celoscan.
6. `components/ThreadPreview.tsx` — card tweet, sửa inline.
7. `components/ShareToX.tsx` — deep link `twitter://post`, fallback web.

`hooks/useThreadGeneration.ts` chỉ coi `fatal` là kết thúc lỗi; `step_failed` (soft) chỉ
hiển thị degraded → khớp với triết lý soft/hard ở mục 3.3.

---

## 6. Dữ liệu (Supabase) — `supabase/migrations/`

Server-side only. Schema: `0001_threads.sql`. Lưu wallet address + metadata thread (no PII).
History/analytics đọc qua edge-runtime API routes (`/api/public/analytics`, `/api/public/threads`),
trang `/app/history`, `/app/stats`. **Mọi truy cập dùng service role** (`getSupabaseServer()`)
bypass RLS — không có anon client. `refund_requests` bật RLS không có policy permissive (0005):
anon bị từ chối, service role không ảnh hưởng.

---

## 7. Refund (runbook tóm tắt)

Hai đường settlement, đều gọi `refundThread` (`orchestrator.ts:159`):
- HTTP một-lần `/api/refund` (`x-admin-key`).
- Queue worker `pnpm refund:process <requestId>`.

**Invariant:** `threads.refund_tx_hash` là nguồn sự thật duy nhất — đã set ⇒ đã trả, không
bao giờ gửi lại. Cả hai đường đều từ chối nếu nó đã set.

Tính chất an toàn (đừng regress):
- **Số tiền refund đọc on-chain** (`getOnChainPaidAmount`), không từ `amount_paid_raw`
  (client-supplied). Partial bị cap ở số đã trả on-chain.
- **Lock `refund_requests` là compare-and-swap**: `refund:process` chỉ tiếp tục nếu UPDATE
  `pending → processing` trả về đúng 1 row. Concurrent an toàn.
- **Send lỗi không bao giờ tự revert về `pending`** — tx có thể đã broadcast. Row để
  `processing` + lỗi trong `rejection_reason`. Chỉ reset `pending` sau khi xác nhận on-chain
  rằng KHÔNG có transfer nào landed (nếu không là đường double-refund).

`refundThread` còn balance-check nguồn refund (`:179`) và báo rõ shortfall thay vì revert
ERC20 mờ mịt.

> ⚠️ **Accounting caveat** (`orchestrator.ts:149-158`): contract chỉ route 10% vào reserve,
> nhưng full refund trả 100%. Phần chênh đang lấy từ balance của deployer EOA, **không bền vững**.
> Fix đúng là một `refund()` on-chain rút từ reserve tích lũy. Đừng scale full-refund trên path này.

---

## 8. Chain config (`lib/`)

- `lib/chains.ts` — `getChain`, `explorerBase`, `isSupportedChain` (Celoscan/Blockscout).
- `lib/wagmi.ts` — connectors Celo mainnet (42220) + Celo Sepolia (11142220).
- `lib/tokens.ts` — địa chỉ + decimals token cho cả hai chain.
- `lib/contracts.ts` — địa chỉ ShipPostPayment + AgentWallet cho cả hai chain.

---

## 9. Năm bài học thiết kế rút ra

1. **On-chain = sổ kế toán bất biến, không phải máy tính.** Thu và chi đều để lại event/tx;
   AI chạy off-chain.
2. **Không tin client — verify lại từ chain.** `verifyPayment` + amount đọc on-chain là khuôn
   mẫu chống forge; mọi field trong body là thù địch.
3. **Giới hạn blast radius bằng code:** daily cap, Pausable, whitelist token, insert fail-closed.
4. **Settle trước, giao hàng sau** — invariant chống "free content + refund".
5. **Mọi lỗi phải refundable**, kể cả timeout — deadline nội bộ thay vì để platform kill cứng.

---

## 10. Lệnh hay dùng

```bash
pnpm dev                 # dev server
pnpm build               # production build
pnpm test:contracts      # Hardhat tests
pnpm compile             # compile Solidity
pnpm deploy:testnet      # deploy Celo Sepolia (11142220)
pnpm refund:list         # liệt kê refund_requests đang pending
pnpm refund:process <id> # settle một refund đã queue
```
