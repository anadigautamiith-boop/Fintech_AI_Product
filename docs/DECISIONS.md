# Decisions and trade-offs

Each decision gives the reason and what it costs. The numbered ones are the ones a reader is most likely to disagree with. The one-page summary is [WRITEUP.md](WRITEUP.md); the evidence behind the problem is in [EVIDENCE.md](EVIDENCE.md).

## The product

**1. Build the control layer, not the shopping assistant.** The evidence shows the gap is control, not capability. People say they want approval, review and cancellation; interest runs far ahead of use; the bank rail offers one rupee limit per shop; and the regulator's questions are about limits, records of instructions and who approves. The assistant is the part anyone can swap. Cost: the assistant in this demo is a thin one, and the shops are invented.

**2. The decision is made by plain code outside the model.** In a published marketplace simulation, fake reviews and prompt injection moved agents' payments, so a rule that lives in a prompt is a request, not a rule. The code that decides (`public/js/core/`) has no AI in it. The assistant sends product codes and quantities only. The shop and the price come from the catalogue, and the assistant is never shown which shops are verified. Any other field in what it sends is ignored. Cost: the engine cannot catch what it cannot see. A basket inflated within the limits (KG1) and a gift card inside an allowed grocery shop (KG3) get through, and both are recorded as known gaps.

**3. Say who enforces each rule.** The bank rail knows three things: the shop, the amount and the end date. Kinds of purchase, blocked days, the per-order limit and "ask me above" can only be enforced by Reins. The Rules screen labels each rule "Bank + Reins" or "Reins only", and the limits ruler draws the two differently. Someone who believes the bank stops a weekend purchase is wrong, and a trust layer that lets them believe it is not one. Cost: the honest message is sometimes "you are relying on this app here".

**4. Over a limit is blocked. Odd is asked about.** A hard rule (a shop or kind not allowed, a blocked day, over the per-order or period limit, no money left on the bank's block) blocks, and a block never moves money at any level of freedom. Things that look wrong but are not forbidden (the same order twice within 30 minutes, orders split to slip under a limit within 60 minutes, a purchase that cannot be undone, a shop with no bank block, an amount above "ask me above") ask. Blocking should be rare and unarguable; asking keeps a person in the loop where a pattern is suspicious. Cost: some questions will be unnecessary.

**5. Receipts are templates, and every rupee figure is traced.** No model writes a receipt, because an explanation of a payment must not invent a fact. A test checks all 96 policy cases: every amount in the receipt must come from the decision's own figures. Cost: plainer language than a model would write.

**6. The assistant earns freedom, group by group.** It starts by only suggesting. It moves to "approve each order" after at least 4 weeks of evidence, and to "act within limits" after at least 8 weeks and the person's own consent. At each step every group of users needs at least 50 orders and an override rate strictly under 10%, and so does the overall rate. The reason for looking at every group is a case in the book this project grew from, where an 8% overall override rate hid more than 25% in one segment. The weeks, the 50 orders and the 10% are my choices, not sourced figures. A real team would set them from data. Taking freedom back needs no evidence and works at once, because going up and going down are not equally risky. Cost: the record on the Evidence screen is invented, so it shows how the gate works and nothing about real people.

**7. The model reads and chooses. It does not decide.** It has two jobs: turn a person's sentences into a form that the person then checks and activates, and choose items for an order. Both outputs go through code that validates them (`coerceParsed`, `buildProposal`). One consequence is deliberate friction: if the reader cannot map something, such as a shop that does not exist in the simulation, activation waits until the person fixes it or dismisses it on purpose. Dropping it silently could turn "only Zomato" into "any shop". Cost: one more click at set-up.

**8. Synthetic data is labelled wherever it is shown.** There are no real users, so the shops, prices, listings and the shadow-mode record are invented. The About page splits what is real, made up, modelled and never done. The invented record has a variant built to look healthy on average while one group struggles, so the gate's behaviour can be seen. Cost: no claim can be made about real behaviour, and none is made.

**9. The first user is a household, not the local-agent persona.** The persona from the podcast press release (people who book travel and insurance through local agents) has no demand data behind it in anything I could find. Households paying for groceries, food and recharges by UPI do: UPI volume is large and small payments dominate. Cost: the persona the founders talked about is not served.

## The build

**10. A simulated clock, IST only, whole rupees.** Limits, blocked days and undo windows read a clock that only moves when the reviewer moves it, so "Saturday" or "16 minutes later" takes seconds to test, and the tests are exact. Whole rupees and one time zone remove two kinds of bug that have nothing to do with the question. Cost: paise are ignored, and the undo windows (15 minutes for groceries, 3 for food, 60 for marketplace goods, none for recharges) are values I invented. They are not rail rules.

**11. No framework, no runtime dependencies, no build step.** The decision code is plain ES modules that the browser, the Worker and the Node tests all load, so the tests run the code that ships. There is nothing to install and `wrangler deploy` is the whole build. A strict content-security policy (no inline script or style, no third-party host, nothing that evaluates text as code) is possible because of this, and the browser smoke test fails if any page breaks it. Cost: more hand-written interface code than a component library would need.

**12. Cloudflare Workers with static assets, and Workers AI, on the free plan.** This is the hosting that was asked for. One deploy serves the site and the two AI calls, with no keys to manage. Cost: a daily AI allowance and a model that Cloudflare may change. When the AI is unavailable the app says so and falls back to the form and to a scripted assistant, and the Tests page records unanswered cases as errors, never as skipped.

**13. A scripted assistant that is fooled on purpose.** Whether the real model falls for hidden text in a listing is luck on any given day. So the Shop screen also offers a scripted assistant that always does what the hidden text says, to show what Reins does when the assistant is fully fooled. Cost: it shows the engine, not the model; the model's own behaviour is the separate "shopping agent" test.

## The tests

**14. Report case by case, and keep the known gaps in view.** The brief asks how well the app did on each case, so there are 246 labelled cases that run in the browser and in Node from the same files, plus 30 + 10 that run against the live AI. Five known gaps are asserted at the engine's current behaviour, so fixing one forces the spec to change. A mutation check breaks the engine in 43 small ways to see whether the cases notice: 36 of 43 were caught on the first run, and the 7 misses were closed with new cases. The final 43 of 43 is not independent, because those cases were written to catch those bugs; [eval/README.md](../eval/README.md) says so, and gives the figures.

**15. The labels are the builder's, not an outside party's.** The expected answers were written by the builder, an AI assistant, from the spec. They show that the system matches the spec, not that the spec is right. Cost: a reviewer who disagrees with the spec will disagree with the labels, and no one outside the build has checked them yet.

## Assumptions that are marked as assumptions

- A refund does not give the bank's payment block back. No source says this; it is the cautious reading.
- How many payment blocks a customer can hold at once. Pine Labs says many banks allow only one. The app lets you choose 1, 2 or 3 and starts at 2, so that both example shops are backed. At 1, the second shop has no bank block and its orders always ask. The starting value is my choice.
- The thresholds in decision 6 and the undo windows in decision 10.
- UPI Reserve Pay behaviour follows Pine Labs' public documentation, checked on 25 November 2026. NPCI's agent framework was reported as in preparation and is not published, so nothing here claims it exists.
