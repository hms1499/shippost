# x402 trong ShipPost

## Vấn đề x402 giải quyết

Bình thường khi dùng AI API (Groq, fal.ai, Serper...), bạn phải:

1. Đăng ký tài khoản
2. Gắn credit card
3. Lấy API key
4. Gọi API

Đây là mô hình **subscription/prepaid** — con người setup thủ công, không thể tự động hóa hoàn toàn.

**x402 giải quyết câu hỏi:** *"Làm sao để một AI agent tự trả tiền cho service khác mà không cần con người giữ credit card?"*

x402 là một HTTP payment protocol — agent đính kèm thông tin thanh toán **ngay trong HTTP request header**, service nhận request đó tự verify payment trên blockchain rồi xử lý. Không cần signup, không cần API key cố định, pay-per-call thuần túy.

---

## Tại sao ShipPost phải tự build x402 proxy?

Groq, fal.ai, Serper **chưa hỗ trợ x402 natively**. Họ vẫn dùng API key truyền thống.

Nên ShipPost xây một **proxy layer** đứng giữa:

```
Agent Wallet  ──x402──►  ShipPost Proxy  ──API key──►  Groq / fal.ai / Serper
```

Proxy đóng vai trò "phiên dịch": nhận payment on-chain từ agent, rồi dùng API key của team để gọi service thật.

---

## Luồng hoạt động chi tiết

### Bước 0 — User trả tiền

```
User ──$0.05 cUSD──► ShipPostPayment.sol
                          │
                    split 50 / 40 / 10
                          │
              ┌───────────┴──────────┐
          AgentWallet          Treasury + Reserve
         (giữ $0.025)
```

`ShipPostPayment.sol` chia tiền ngay lúc nhận:
- **50%** → `AgentWallet` (budget cho x402 calls)
- **40%** → Treasury (doanh thu)
- **10%** → Reserve (dùng để refund nếu pipeline lỗi)

---

### Bước 1 — Orchestrator phát hiện event

Smart contract emit `ThreadRequested(user, threadId, mode, token)`. Backend lắng nghe event này và bắt đầu pipeline.

---

### Bước 2 — Agent ký và gọi x402 proxy

```
Orchestrator backend:

  1. Ký EIP-712 payment intent:
     {
       service: "groq",
       maxFee: $0.003,
       threadId: 42
     }
     bằng private key của AgentWallet

  2. Gửi HTTP POST tới /api/x402/groq
     Header: X-Payment: <EIP-712 signature>
     Body:   { topic, audience, length }
```

---

### Bước 3 — Proxy verify, forward, và settle

```
/api/x402/groq route:

  1. Đọc X-Payment header
  2. Verify chữ ký EIP-712 — đúng AgentWallet không?
  3. Check AgentWallet.spentToday + dailySpendCap — còn hạn mức không?
  4. Forward request tới Groq API (dùng GROQ_API_KEY của team)
  5. Nhận response từ Groq
  6. Settle: gọi AgentWallet.executeX402Call
             → pull cUSD từ AgentWallet vào proxy treasury
  7. Emit X402PaymentMade(service="groq", amount=$0.003, threadId=42)
  8. Trả Groq response về cho orchestrator
```

---

### Bước 4 — Pipeline lặp lại cho các service tiếp theo

Mỗi mode có một chuỗi bước khác nhau:

| Mode | Pipeline |
|---|---|
| **Educational** | Groq (viết) → Flux (thumbnail) |
| **Hot Take** | Serper (search) → CoinGecko (data) → Groq (viết) → Groq (fact-check) → Flux (thumbnail) |

Mỗi bước emit một `PipelineEvent` → SSE stream đẩy xuống client → UI cập nhật progress theatre realtime:

```
🔍 Searching news      ✓  $0.001
📊 Fetching price      ✓  $0.000
✍️  Writing thread     ⏳ ...
✅ Fact-checking        —
🎨 Creating thumbnail   —

Agent wallet spent: $0.011 / $0.025 budget
[View on Celoscan →]
```

---

## Sơ đồ tổng thể

```
MiniPay Browser
  └─► ShipPost UI
        └─► [User ký tx $0.05]
                │
                ▼
        ShipPostPayment.sol
          ├─ 50% ──► AgentWallet.sol
          ├─ 40% ──► Treasury
          └─ 10% ──► Reserve
                │
                │ emit ThreadRequested
                ▼
        Orchestrator (Next.js backend)
          └─► Pipeline runner
                ├─► POST /api/x402/groq    (X-Payment: sig)
                │     └─► Groq API ──► response
                │     └─► settle AgentWallet
                │
                ├─► POST /api/x402/flux    (X-Payment: sig)
                │     └─► fal.ai API ──► image
                │     └─► settle AgentWallet
                │
                └─► SSE stream ──► UI cập nhật từng bước
                          │
                          ▼
                    Thread preview + Share to X
```

---

## Tại sao cách này quan trọng

Mỗi thread tạo ra **4–6 transaction on-chain** thay vì chỉ 1. Bất kỳ ai cũng có thể mở Celoscan và thấy `AgentWallet` đang tự trả tiền cho từng AI service — đây là proof thực sự của mô hình AI agent kinh tế tự chủ, không phải chỉ là wrapper gọi API thông thường.

---

## Các file liên quan trong codebase

| File | Vai trò |
|---|---|
| `contracts/AgentWallet.sol` | Giữ budget, enforce daily cap, emit payment events |
| `contracts/ShipPostPayment.sol` | Nhận $0.05, split 50/40/10, emit `ThreadRequested` |
| `app/api/x402/groq/route.ts` | Proxy: verify → Groq → settle |
| `app/api/x402/flux/route.ts` | Proxy: verify → fal.ai → settle |
| `app/api/x402/serper/route.ts` | Proxy: verify → Serper → settle |
| `app/api/x402/fact-check/route.ts` | Proxy: verify → Groq (fact-check prompt) → settle |
| `app/api/generate/stream/route.ts` | SSE runner: chạy pipeline, stream events |
| `lib/pipeline/groqStep.ts` | Step logic cho Groq generation |
| `lib/pipeline/fluxStep.ts` | Step logic cho Flux thumbnail |
| `lib/pipeline/runModeA.ts` | Compose pipeline Mode A |
| `lib/pipeline/runModeB.ts` | Compose pipeline Mode B |
| `hooks/useThreadGeneration.ts` | Client: consume SSE, drive UI state |
