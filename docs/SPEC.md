# Reins: product spec (v1)

This spec is written before the code. The test fixtures in `public/data/tests/` are written from it, then the engine is written to pass them. Where the spec turned out to be wrong, the fix is a commit that changes the spec and the fixture together, with the reason in the message.

## 1. Problem and first user

> People who want to hand routine purchases to an AI assistant cannot set exact spending limits, see why each payment happened, or undo a mistake. So they approve every payment by hand or do not delegate at all.

First user: a household in India that already pays for groceries, food delivery and mobile recharges through UPI. The alternative first user (people who rely on a local agent to book travel or buy insurance) is not built; the research found no demand data for it.

Three sub-problems the product answers:

1. **Say what the agent may spend.** People think in rules, such as a weekly grocery budget, named shops and nothing on weekends. The rail enforces a rupee block per merchant. The product turns rules into limits and says which ones only it can enforce.
2. **See why, and undo.** Every decision gets a plain-language receipt, with pause and undo.
3. **Earn more autonomy with evidence.** The agent starts at suggest-only and climbs an autonomy ladder only when shadow-mode results support it in every user segment.

## 2. What v1 is

A simulated trust layer. A user states a **mandate**; a shopping **agent** proposes an order; a deterministic **policy engine**, which lives outside any model, decides; the user gets a **receipt** with pause and undo; a **shadow-mode log** collects evidence by user segment; an **autonomy ladder** decides how much the agent may do.

```
 plain-language instruction
        |  (model reads it; a person confirms the structured result)
        v
     MANDATE ---> compile ---> rail blocks (per merchant) + layer-only rules
        |
 request --> AGENT (model) --> proposal (items from catalogue)
                                   |
                                   v
                          POLICY ENGINE (code)
                  allow / ask / block + reason codes
                                   |
                       autonomy rung decides routing
                                   |
              executed | awaiting approval | suggested | blocked
                                   |
                                   v
                       RECEIPT (built from the decision log)
                          pause, undo, metrics
```

Non-goals are in section 13.

## 3. The simulated rail (UPI Reserve Pay style)

The rail is simulated. Its rules are taken from public documentation where possible; assumptions are marked.

| Rule | Value | Status |
|---|---|---|
| A block is set per merchant | one limit per merchant | Documented ([Pine Labs](https://www.pinelabs.com/docs/online-payments/upi-reserve-pay)) |
| Block cap | ₹10,000 | Documented (Pine Labs) |
| Block validity | up to 90 days | Documented (Pine Labs) |
| Active blocks per customer | many banks allow one; the default bank profile uses 1 | Documented (Pine Labs); profile is an assumption |
| Revocation | through the merchant (Pine Labs); Razorpay describes instant revocation ([Business Today](https://www.businesstoday.in/amp/technology/news/story/razorpay-npci-launch-agentic-payments-on-anthropics-claude-zomato-swiggy-zepto-go-live-517307-2026-02-20)) | Documented, sources differ |
| A refund restores the block | **no** | Assumption, unverified, conservative |
| The rail enforces | merchant, amount, expiry only | Reading of the documentation |

Everything else (category, per-order cap, period cap, blocked days, ask-above, irreversible-purchase approval) can only be enforced by the layer.

## 4. Mandate

Raw fields (from a form, or from the model reader after a person confirms):

| Field | Type | Meaning |
|---|---|---|
| `merchants` | array of merchant ids, or `null` | Allowed shops. `null` or `[]` means none named. |
| `categories` | array of category ids, or `null` | Allowed kinds of purchase. |
| `perOrderCap` | integer ₹ or `null` | Hard limit for one order. |
| `periodCap` | `{amount, period}` or `null` | Hard limit per `day`, `week` or `month`. |
| `blockedWeekdays` | array of `mon`..`sun` | No purchases on these days. |
| `askAbove` | integer ₹ or `null` | Orders above this need the person's approval. |
| `autoApproveIrreversible` | boolean | Allow non-refundable purchases (a recharge) without asking. Default `false`. |
| `durationDays` | integer or `null` | How long the mandate lasts. |

All amounts are whole rupees. Paise are ignored in v1.

### 4.1 Normalisation

`normalizeMandate(raw, {today, catalogue})` returns `{ok, mandate, errors, warnings}`. `today` is an IST date (`YYYY-MM-DD`). `validFrom = today`; `validUntil = today + durationDays - 1` (inclusive).

Errors (the mandate is not created): `UNKNOWN_MERCHANT`, `MERCHANT_UNVERIFIED`, `UNKNOWN_CATEGORY`, `BAD_AMOUNT`, `BAD_PERIOD`, `BAD_WEEKDAY`, `ALL_DAYS_BLOCKED`, `BAD_FLAG`, `BAD_DURATION`, `BAD_MERCHANTS`, `BAD_CATEGORIES`.

Warnings (created, shown to the person): `DURATION_DEFAULTED` (null becomes 30), `DURATION_CLAMPED` (above 90 becomes 90), `NO_SPEND_CAP` (neither `perOrderCap` nor `periodCap`), `ORDER_CAP_ABOVE_PERIOD_CAP`, `ASK_ABOVE_NOT_BELOW_CAP` (ask-above is at or above the per-order cap, so it never triggers), `MERCHANT_OUTSIDE_CATEGORIES` (a named merchant sells a category the mandate does not allow, so it would always be blocked).

Amounts must be integers from 1 to 1,000,000.

## 5. Compile: mandate to rail blocks

`compileMandate(mandate, bank)` where `bank = {maxActiveBlocks}`.

- `potentialSpend`: if `periodCap` is set, `ceil(days / periodLength) * cap`, where days is the inclusive length of the mandate, and `periodLength` is 1 (day), 7 (week) or 30 (month). Otherwise `null`.
- Block size per merchant: `min(10000, potentialSpend ?? 10000)`.
- The first `maxActiveBlocks` merchants in the mandate order get a block. The rest are `unbacked`.
- `merchants = null`: no block can be set.
- `renewalsNeeded`: `max(0, ceil(potentialSpend / 10000) - 1)` when `potentialSpend` is known and at least one block exists; otherwise `null`.

Warnings: `ANY_MERCHANT_NOT_RAIL_BACKABLE`, `BANK_BLOCK_LIMIT` (some merchants unbacked), `NO_PERIOD_CAP` (blocks exist but no period cap, so only the ₹10,000 block limits total spend), `RAIL_EXPOSURE_EXCEEDS_MANDATE` (the blocks together allow more than `potentialSpend`; only the layer enforces the lower cap), `BLOCK_RENEWALS_NEEDED`.

`rules` lists each set field with who enforces it: `rail+layer` for the merchant list (backed merchants) and expiry; `layer` for the rest.

## 6. Policy engine

`evaluate({mandate, compiled, state, proposal, now, catalogue, rung})`.

### 6.1 Inputs and what is ignored

A proposal is read only for `merchantId` and `amount`. Every other field (a claimed category, a claimed approval, a claimed rung, a claimed time, notes) is ignored. Category comes from the catalogue record of the merchant. Time comes from `now`, supplied by the app clock. The rung comes from the caller.

`state = {paused, ledger, railUsed}`. A ledger order is `{id, merchantId, category, amount, ts, status}` with status `paid` or `refunded`. `railUsed[merchantId]` is gross: refunds do not reduce it.

### 6.2 Time

All times are IST (UTC+05:30, no daylight saving). A **day** is a calendar day. A **week** runs Monday 00:00 to Sunday 23:59:59. A **month** is a calendar month. The mandate is active from `validFrom` 00:00 to `validUntil` 23:59:59.999, inclusive.

### 6.3 Order of checks

1. Invalid proposal: `merchantId` is not a non-empty string, or `amount` is not a positive safe integer. Block `INVALID_PROPOSAL`, stop.
2. `state.paused`: block `MANDATE_PAUSED`, stop.
3. Before `validFrom`: block `MANDATE_NOT_STARTED`, stop. After `validUntil`: block `MANDATE_EXPIRED`, stop.
4. The merchant must be an own property of the catalogue with `verified: true`. Otherwise block `MERCHANT_UNVERIFIED`, stop. No trimming, no case folding.
5. **Hard rules.** All that apply are reported, in this order:
   `MERCHANT_NOT_ALLOWED`, `CATEGORY_NOT_ALLOWED`, `BLOCKED_DAY`, `OVER_ORDER_CAP` (amount above `perOrderCap`), `OVER_PERIOD_CAP` (paid spend in the current window plus the amount is above the cap), `RAIL_BLOCK_EXHAUSTED` (the merchant has a block and the amount is above what is left).
   If any apply, the verdict is **block** and only these reasons are reported.
6. **Soft rules.** All that apply are reported:
   `ASK_ABOVE_THRESHOLD` (amount above `askAbove`), `ASK_POSSIBLE_DUPLICATE` (a paid order with the same merchant and amount in the last 30 minutes, inclusive), `ASK_SPLIT_PATTERN` (`perOrderCap` is set, at least one paid order at the same merchant in the last 60 minutes, inclusive, and their sum plus this amount is above `perOrderCap`), `ASK_IRREVERSIBLE` (the category cannot be undone and `autoApproveIrreversible` is false), `ASK_NO_RAIL_BACKING` (the compiled mandate has no block for this merchant).
   If any apply, the verdict is **ask**.
7. Otherwise the verdict is **allow**.

Comparisons against caps are strict (`amount > cap` blocks; `amount == cap` does not). `ask-above` is strict too.

### 6.4 Figures

For every evaluation that reaches step 5, the decision carries `figures`: amount, merchant name, category, `perOrderCap`, `askAbove`, the period figures (`cap`, `spentBefore`, `remainingBefore`, `remainingAfter`, `kind`) and the rail figures (`limit`, `used`, `remainingBefore`, `remainingAfter`). Receipts read numbers only from `figures`.

## 7. Autonomy ladder

The book's ladder (chapter 14, table 14.2) has four rungs. Rung 0 (analytics only) is not part of this product, so Reins uses rungs 1 to 3.

| Rung | Reins name | allow | ask | block |
|---|---|---|---|---|
| 1 | `suggest` | `suggested` | `suggested` | `blocked` |
| 2 | `approve_each` | `awaiting_approval` | `awaiting_approval` | `blocked` |
| 3 | `bounded` | `executed` | `awaiting_approval` | `blocked` |

A block never executes, at any rung. A person approving an `awaiting_approval` outcome re-runs the checks; if the verdict is now block, nothing executes.

### 7.1 Promotion gate

Promotion is a decision, not a toggle. It needs shadow-mode evidence.

| Move | Needs |
|---|---|
| `suggest` to `approve_each` | at least 4 weeks of shadow events; every segment has at least 50 events; overall and every segment override rate below 10% |
| `approve_each` to `bounded` | at least 8 weeks; the same evidence rules; the person's explicit consent |

The override rate must be **below** 10% (a segment at exactly 10% fails). Failure codes: `TOP_RUNG`, `TOO_SHORT`, `INSUFFICIENT_DATA` (per segment), `SEGMENT_OVER_THRESHOLD` (per segment), `OVERALL_OVER_THRESHOLD`, `NO_CONSENT`.

The reason for gating on every segment is the book's MoneyGro case (chapter 15): an 8% override rate hid a rate above 25% for customers with several products. The shadow period there was too short and the sample too narrow.

## 8. Receipts

A receipt is built from the decision and its `figures`, by templates. No model writes receipt text, because a payment explanation must never invent a fact. Every `₹` amount in a receipt must come from `figures`; a test checks this for every policy case.

A receipt has a headline, a list of plain-language lines (what was decided, why, which limits applied and what is left, undo), and actions.

Undo rules:

| Category | Reversible | Undo window |
|---|---|---|
| groceries | yes | 15 minutes |
| food delivery | yes | 3 minutes |
| general merchandise | yes | 60 minutes |
| mobile recharge | no | none |
| gift cards | no | none |

Undo marks the order `refunded`. The period spend drops. The rail block does not recover (section 3).

## 9. Shadow mode (synthetic)

There is no real user data. The shadow log is generated with a seeded random generator (mulberry32) over 8 weeks and 4 segments. Each event is `{week, segment, overridden, reason}`.

| Segment | Share of events | Override probability, hidden-gap set | Override probability, healthy set |
|---|---|---|---|
| single adult | 35% | 3% | 3% |
| couple | 25% | 4% | 4% |
| family (multi-cart) | 20% | 26% | 6% |
| new user | 20% | 5% | 5% |

The hidden-gap set is built to look healthy overall (below 10%) while one segment fails, the way the book describes. Its purpose is to show why the gate looks at every segment. It is labelled synthetic wherever it is shown, and it says nothing about real users.

## 10. Metrics

- North star: **share of agent-made purchases the person keeps without undo** (kept orders / executed orders).
- Guardrails: **reversal rate** (refunded / executed), **override rate in every segment** (from shadow mode), **complaints per 10,000 decisions** (not measurable without real users; shown as not measured).
- Also reported: cost per decision for the model calls (from the model's token counts when the platform returns them).

## 11. Model components

Two model calls exist. Both are untrusted: their output is validated by code, and the engine never takes a model's word.

**Mandate reader** (`POST /api/parse-mandate`): plain text in, structured fields out. Only what the text states; `null` otherwise. Amounts in rupees; "2k" is 2000; a week is 7 days, a month 30. Output goes through `coerceParsed`, which maps shop and category names to ids, rejects anything it cannot map into `unresolved`, and never invents a value. A person always confirms the result in a form; the model never activates a mandate.

**Shopping agent** (`POST /api/agent`): a request and a slice of the catalogue in, `{items: [{sku, qty}], note}` out. The merchant is derived from the SKUs; mixed-merchant orders are invalid. The total is computed from catalogue prices, never taken from the model. The catalogue contains listing text from sellers, some of it hostile (the injection test set).

If the platform has no AI available (quota, binding missing), both endpoints return `ai_unavailable` and the app falls back to the form and to a scripted agent.

## 12. Test strategy

The aim of the test set is to say, per case, how the app did, and to be honest about what it does not do.

| Suite | Cases | Kind | What it measures |
|---|---|---|---|
| `policy` | 55 | deterministic | The engine's verdict, outcome and reason codes, including boundaries, IST handling, windows, rungs |
| `normalize` | 18 | deterministic | Mandate validation, errors and warnings |
| `compile` | 9 | deterministic | Rail blocks, bank limits, renewals, exposure warnings |
| `injection` | 13 | deterministic | Hostile or spoofed proposals and sequences against the engine |
| `receipts` | 8 + a property check on every policy case | deterministic | Receipt content; every amount comes from the decision |
| `shadow` | 10 | deterministic | Promotion gate, including the MoneyGro-shaped case |
| `known-gaps` | 4 | deterministic | Things the engine does not catch in v1, recorded as gaps rather than hidden |
| `parse` | 30 | model | Mandate reader accuracy on labelled instructions (field-level and case-level), including Hinglish, typos, contradictions and an injection attempt |
| `agent` | 10 | model | Agent behaviour on listings with hostile text: how often it is steered, and whether the engine still stops the order |

Deterministic suites run in Node (`npm test`) and in the browser on the Tests page, from the same code. Model suites run only against the deployed app, from the Tests page; results are exported as JSON and committed under `eval/results/`.

**Known gaps** are cases where the engine's verdict differs from the ideal one. They are asserted at the engine's current behaviour, so a change makes the test fail and forces the spec to be updated.

**What the labels are.** The expected answers were written by the builder (an AI assistant) from this spec, then reviewed by the product owner. They test that the system matches the spec, not that the spec matches reality.

## 13. Not built

Real UPI, bank or merchant integration; KYC; accounts and authentication; multi-user or multi-device sync; real payments or refunds; the local-agent persona; cross-border, wearables, tipping and negotiation; item-level policy (categories per item); price-anomaly or quantity-anomaly detection; Hindi UI; paise. Each is a deliberate cut, listed again in the write-up.
