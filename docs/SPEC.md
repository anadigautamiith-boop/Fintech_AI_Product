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

Details the tests rely on:

- Each error is `{code, field, message}`, where `field` is the raw field name (`BAD_AMOUNT` is reported per field: `perOrderCap`, `periodCap` or `askAbove`). Each warning is `{code, field, message}` with `field` possibly `null`.
- Merchant and category ids are matched exactly: no trimming, no case folding. The mandate reader (section 11) maps names to ids before this step.
- A missing field is treated as `null`. Unknown fields are dropped, not copied.
- `[]` for merchants or categories becomes `null`. Duplicates are removed, keeping first-seen order. `blockedWeekdays` is returned in week order.
- `periodCap` must be `null` or `{amount, period}`. Anything else, or a period other than `day`, `week`, `month`, is `BAD_PERIOD`; a bad `amount` inside it is `BAD_AMOUNT`.
- `autoApproveIrreversible` is `false` when missing or `null`; any other non-boolean is `BAD_FLAG`.
- `durationDays` must be a whole number of 1 or more. `null` becomes 30 (`DURATION_DEFAULTED`); above 90 becomes 90 (`DURATION_CLAMPED`); anything else is `BAD_DURATION`.
- When there are errors, `mandate` is `null` and `warnings` is empty.

## 5. Compile: mandate to rail blocks

`compileMandate(mandate, bank)` where `bank = {maxActiveBlocks}`.

- `potentialSpend`: if `periodCap` is set, `ceil(days / periodLength) * cap`, where days is the inclusive length of the mandate, and `periodLength` is 1 (day), 7 (week) or 30 (month). Otherwise `null`.
- Block size per merchant: `min(10000, potentialSpend ?? 10000)`.
- The first `maxActiveBlocks` merchants in the mandate order get a block. The rest are `unbacked`.
- `merchants = null`: no block can be set.
- `renewalsNeeded`: `max(0, ceil(potentialSpend / 10000) - 1)` when `potentialSpend` is known and at least one block exists; otherwise `null`.

Warnings: `ANY_MERCHANT_NOT_RAIL_BACKABLE`, `BANK_BLOCK_LIMIT` (some merchants unbacked), `NO_PERIOD_CAP` (blocks exist but no period cap, so only the ₹10,000 block limits total spend), `RAIL_EXPOSURE_EXCEEDS_MANDATE` (the blocks together allow more than `potentialSpend`; only the layer enforces the lower cap), `BLOCK_RENEWALS_NEEDED`.

`rules` lists each set field with who enforces it: `rail+layer` for the merchant list (backed merchants) and expiry; `layer` for the rest. Each entry is `{field, enforcedBy}`; `field` is one of `merchants`, `categories`, `perOrderCap`, `periodCap`, `blockedWeekdays`, `askAbove`, `autoApproveIrreversible` (listed only when true) or `duration`. When some merchants are backed and some are not, `merchants` appears twice, once for each group (with `merchantIds`). `duration` is `rail+layer` when at least one block exists and `layer` otherwise.

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

For every evaluation that reaches step 5, the decision carries `figures`: amount, merchant name, category, `perOrderCap`, `askAbove`, the period figures (`kind`, `cap`, `spentBefore`, `remainingBefore`, `remainingAfter`) and the rail figures (`limit`, `used`, `remainingBefore`, `remainingAfter`). Receipts read numbers only from `figures`. An evaluation that stops earlier (steps 1 to 4) has `figures: null`.

`remainingBefore = max(0, cap - spentBefore)` and `remainingAfter = max(0, cap - spentBefore - amount)`, for both the period and the rail. A merchant with no block has `limit`, `remainingBefore` and `remainingAfter` all `null`; `used` is still reported. `figures.undo` is `{reversible, windowMin}` from the category.

A decision is `{verdict, outcome, reasons, figures}`.

### 6.5 State changes

The engine only reads state. These functions change it, and return a new state each time.

- `recordOrder(state, {merchantId, amount, ts}, catalogue)`: adds a `paid` order with the next id (`O1`, `O2`, ...) and adds `amount` to `railUsed[merchantId]`.
- `undoOrder(state, orderId, now, catalogue)`: returns `{ok: true, state}` or `{ok: false, reason}`. Checks run in this order: `UNKNOWN_ORDER`, `ALREADY_REFUNDED`, `NOT_REVERSIBLE` (category cannot be undone), `UNDO_WINDOW_CLOSED` (more than the category's window since the order; exactly at the window is still allowed). On success the order becomes `refunded`. `railUsed` does not change.
- `approveOrder({mandate, compiled, state, proposal, now, catalogue})`: a person approves a proposal that was `awaiting_approval` or `suggested`. The checks run again at `now`. A `block` verdict executes nothing and returns `{executed: false, decision}`. An `allow` or `ask` verdict records the order and returns `{executed: true, decision, state}`.
- `setPaused(state, paused)`.

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

Undo marks the order `refunded`. The period spend drops. The rail block does not recover (section 3). Rules for undo are in section 6.5.

Gift cards are not a category in v1, because policy is not item-level (section 13). A gift card sold by a grocery merchant is treated as groceries, with a 15-minute undo window that a real gift card would not have. This is recorded as known gap KG3.

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

**Mandate reader** (`POST /api/parse-mandate`): plain text in, structured fields out. Only what the text states; `null` otherwise. Amounts in rupees; "2k" is 2000; a week is 7 days, a month 30. If the text contradicts itself on a field, the field is `null` and the model adds a note. Output goes through `coerceParsed(modelOutput, catalogue)`, which returns `{fields, unresolved, notes}`:

- It reads only the known keys, so extra keys, `__proto__` and similar are ignored. Output that is not an object gives all-null fields.
- Shop and category names are matched to ids ignoring case and extra spaces, using the catalogue's aliases. A name it cannot match goes to `unresolved` and is left out of `fields`.
- Amounts: a whole number, or text such as `₹2,000`, `Rs. 1.5k`, `2k`. Anything else, including non-integers and number words, goes to `unresolved`.
- Periods: `day`, `daily`, `week`, `weekly`, `per week`, `month`, `monthly`, `per month` and similar map to `day`, `week`, `month`; anything else is unresolved.
- Weekdays: day names and short names, with `weekend` meaning Saturday and Sunday. Unknown words are unresolved.
- `autoApproveIrreversible` is `true` only when the model returns the boolean `true`.
- A lone string where a list is expected is treated as a list of one.

Dropping an unmatched shop could widen a mandate (a text that says "only Zomato" would become "any shop"). So the app does not let a person activate a mandate while `unresolved` has entries; each must be fixed in the form or dismissed on purpose. A person always confirms the result in a form; the model never activates a mandate.

**Shopping agent** (`POST /api/agent`): a request and a slice of the catalogue in, `{items: [{sku, qty}], note}` out. The slice shows names, prices and seller listing text, not the `verified` flag. `buildProposal(catalogue, agentOutput)` turns this into a proposal and checks it:

- `items` must be a non-empty array of at most 20 lines. Every `sku` must be an own property of the catalogue's items (`UNKNOWN_SKU`). Every `qty` must be a whole number from 1 to 99 (`BAD_QTY`).
- The merchant is derived from the SKUs; mixed-merchant orders are invalid (`MIXED_MERCHANTS`). Lines with the same SKU are merged.
- The amount is the sum of catalogue price times quantity. Prices, totals and any other fields in the model output are ignored.
- Errors: `NO_ITEMS`, `TOO_MANY_LINES`, `UNKNOWN_SKU`, `BAD_QTY`, `MIXED_MERCHANTS`. The builder does not judge the merchant; an order for an unverified shop is built, and the policy engine blocks it.

The catalogue contains listing text from sellers, some of it hostile (the injection test set).

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

## Appendix A. Module shapes the tests use

All modules are ES modules under `public/js/core/`, with no dependencies and no browser or Node APIs, so the browser, the Worker and Node run the same code.

| Module | Exports |
|---|---|
| `time.js` | `parseInstant(isoOrMs)`, `istDate(ms)`, `istWeekday(ms)` (`mon`..`sun`), `addDays(date, n)`, `dayStart(date)`, `dayEnd(date)`, `windowFor(period, ms)` (`{start, end}` for the IST day, Monday-to-Sunday week or month) |
| `money.js` | `isMandateAmount(n)`, `isPositiveSafeInt(n)`, `formatRupees(n)` (`₹1,200`; Indian grouping above 99,999, so `₹1,00,000`) |
| `catalogue.js` | `getMerchant(cat, id)` (own property only), `categoryOf(cat, merchantId)`, `matchMerchantName(cat, text)`, `matchCategoryName(cat, text)` |
| `mandate.js` | `normalizeMandate(raw, {today, catalogue})` |
| `rail.js` | `compileMandate(mandate, bank)` returning `{days, potentialSpend, blockSize, blocks: [{merchantId, limit}], unbacked, renewalsNeeded, warnings: [{code, message}], rules}` |
| `policy.js` | `evaluate({mandate, compiled, state, proposal, now, catalogue, rung})`, `routeOutcome(verdict, rung)` |
| `state.js` | `newState()`, `recordOrder`, `undoOrder`, `approveOrder`, `setPaused` |
| `receipt.js` | `buildReceipt(decision, {catalogue})` returning `{headline, tone, lines, actions, undo}` |
| `ladder.js` | `checkPromotion({from, weeks, segments, consent})` returning `{allowed, to, failures: [{code, segment}], overall, bySegment}` |
| `shadow.js` | `generateShadowEvents({set, seed, weeks, eventsPerWeek})`, `summarizeEvents(events)` |
| `proposal.js` | `buildProposal(catalogue, agentOutput)` |
| `coerce.js` | `coerceParsed(modelOutput, catalogue)` |
| `suites.js` | `runSuite(id, data, shared)`: runs the labelled cases for one deterministic suite and returns one result per case; used by `npm test` and by the Tests page |

`now`, `ts` and every instant in the engine are milliseconds since the epoch; fixtures write them as ISO-8601 strings with an explicit offset and the suite runner converts them.
