# Reins: a short lead for AI shopping assistants

**Problem.** People who want to hand routine purchases to an AI assistant cannot set exact spending limits, see why each payment happened, or undo a mistake. So they approve every payment by hand, or do not delegate at all. First user: an urban Indian household that pays for groceries, food delivery and recharges by UPI ([sources](EVIDENCE.md)).

**What it is.** A simulation, with no real money. You set rules. An AI assistant proposes an order. A plain program outside the AI allows it, asks you, or blocks it. You get a receipt in ordinary words, with pause and undo. The assistant starts by only suggesting, and moves up only on evidence.

## Key decisions, and why

1. **The decision is code, not a prompt.** In a published marketplace simulation, fake reviews and prompt injection moved agents' payments. So the assistant sends product codes and quantities only. Reins reads the shop and price from the catalogue, and the assistant never sees which shops are verified.
2. **Say who enforces each rule.** The bank rail knows the shop, the amount and the end date. Kinds of purchase, weekends and per-order limits only Reins can enforce, so every rule is labelled "Bank + Reins" or "Reins only".
3. **Freedom is earned in every group.** Suggest, then approve each order (4+ weeks of evidence), then act within limits (8+ weeks and your consent). Every group needs 50+ orders and an override rate under 10%, so a good average cannot hide a struggling group; the app shows one that does. Taking freedom back needs no evidence. The thresholds are my choices.
4. **Tests that say how it did, case by case.** 246 labelled cases run in the browser and in Node, and five known gaps are recorded, not hidden. Putting 43 deliberate bugs into the engine, the first run caught 36; the 7 misses were closed. The final 43 of 43 is not independent, since those cases were written for those bugs.

## Not built

A real UPI or bank link, accounts, KYC; the local-agent persona (no demand data found); rules about single items; price and quantity checks; a Hindi interface; paise; more than one user.

## What can go wrong, and what the app does

| Risk | What happens |
|---|---|
| A listing tells the assistant to buy something else | It cannot set the shop or price, and look-alike shops are blocked. With a fully fooled scripted assistant, none of the 7 trap requests goes through automatically: 4 are blocked, 2 are put to you, 1 is refused. |
| A gift card or inflated quantity inside the limits | **Not caught** (known gaps KG3 and KG1). |
| The AI misreads your rules | It only fills in a form that you check. What it cannot map blocks activation until you fix it. |
| The free AI allowance runs out | The app says so and falls back to the form and a scripted assistant. |
| Invented evidence is read as real | It is labelled wherever it appears. |

**Results on the live AI: pending.** Mandate reader: ___ of 30 instructions fully right. Shopping agent: went for the trap in ___ of 7 hostile requests with the warning to the AI, and ___ without it.

## Trade-offs

Simulation over integration: every limit is tested exactly, but nothing is learned about real banks or real behaviour. A strict gate over speed. No framework over convenience: more hand-written code, but the tests run the code that ships. Labels written by the builder: they show the app matches the spec, not that the spec is right.

## With another week

1. Replace the invented record with a four-week shadow run on real households' shopping lists, with no payments.
2. Have someone else write or review the labels, and repeat the model runs on different days.
3. Close KG1 (a quantity baseline) and KG3 (rules about single items).
4. Measure the cost of a decision in the platform's own unit.
5. Replace the modelled rail assumptions with NPCI's agent framework once it is published.
