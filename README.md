# Reins

A short lead for AI shopping assistants: a delegated-spend trust layer, built as a product-management portfolio project for fintech.

**This is a simulation.** Every shop, price and person is invented. Nothing connects to a bank, UPI or a real shop, no real money moves, and no personal data is collected.

**Live app:** _the link is added here after the first deploy; see "Deploy to Cloudflare" below._

## The problem

People who want to hand routine purchases to an AI assistant cannot set exact spending limits, see why each payment happened, or undo a mistake. So they approve every payment by hand, or they do not delegate at all.

The first user is an urban Indian household that pays for groceries, food delivery and mobile recharges through UPI. The evidence behind the problem, with sources and dates, is in [docs/EVIDENCE.md](docs/EVIDENCE.md).

## What it does

You set rules. An AI assistant proposes an order. A plain program, outside the AI, decides whether the order goes ahead, waits for you, or stops. Every order gets a receipt in ordinary words, with pause and undo. The assistant starts by only suggesting, and moves up one step at a time when the record shows people rarely overrule it, in every group of users and not just on average.

| Screen | What you can do there |
|---|---|
| **Rules** | Write your rules in words and let an AI model fill in the form (it only reads; you check and activate), or fill the form in yourself. See which rules the bank can enforce and which only Reins can. |
| **Shop** | Ask the assistant to buy something, including requests with a trap (hidden text in a product listing). Approve, decline, undo, pause. Move a simulated clock to test limits, blocked days and undo windows. |
| **Evidence** | The autonomy ladder and the gate that decides whether the assistant may move up it. The record is invented, and includes a case where a good average hides one struggling group. |
| **Tests** | Every labelled test case and how the app did on each one, run in your browser. The two checks that use the AI model run on request and can be downloaded. |
| **About** | What is real, what is made up, what is modelled, and what is not done. |

## Run it

No build step and no runtime dependencies. Node 20 or later.

```
npm test                          the labelled test cases and the app logic, in Node (no network, no browser)
node scripts/preview-server.mjs   the whole site on http://127.0.0.1:8788 with a stand-in for the AI
node scripts/preview-server.mjs --ai=off    the same, with no AI connected
npm run smoke                     walks the main flows in headless Chrome (needs Playwright; skips if it is missing)
```

The stand-in AI in the preview server is a few regular expressions, **not a model**. It exists so the screens can be tried offline. Nothing it produces says anything about how the real model does.

The browser smoke test needs Playwright and a Chrome binary, which are not project dependencies:

```
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_PATH=/usr/bin/google-chrome npm run smoke
```

## Deploy to Cloudflare (free plan)

The site is a Worker with static assets: `public/` is the site and `src/worker/` answers `/api/*`, calling Workers AI. There is nothing to build.

1. In the Cloudflare dashboard, go to **Workers & Pages**, choose **Create application**, choose **GitHub**, let Cloudflare read this repository, and select it.
2. Set the project (Worker) name to **`reins-fintech-ai-product`**. It must match `name` in `wrangler.jsonc`, or the build fails.
3. Leave the build command empty. The deploy command is `npx wrangler deploy` (the default) and the branch is `main` (the default). Choose **Save and Deploy**.
4. Open the `*.workers.dev` address it shows. The masthead says "AI connected" when the AI binding works. If it says "AI not connected", the two AI features fall back to the form and to the scripted assistant.

Every later push to `main` deploys again. `wrangler.jsonc` already names the static folder and the AI binding. From a computer with Wrangler logged in, `npm run dev` runs the same thing locally and `npm run deploy` deploys it. Cloudflare's own pages for these steps: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) and [build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/); dashboard wording changes now and then.

What the free plan means here (Cloudflare documentation, checked 26 November 2026):

- Requests for the static files are free and unlimited ([billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). The Worker, which serves only the three `/api/` routes, is limited to 100,000 requests a day and 10 ms of CPU per request ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
- Workers AI includes 10,000 neurons a day, reset at 00:00 UTC (09:00 in Japan, 05:30 in India). After that, AI calls fail with an error and the app falls back ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)). The model used, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, costs 26,668 neurons per million input tokens and 204,805 per million output tokens. An estimate from the prompt sizes (3 to 4 characters a token) puts a reader call at roughly 45 to 50 neurons and an agent call at roughly 27 to 30, so one run of each model suite (see [eval/README.md](eval/README.md)) is about 2,000 neurons, a fifth of a day's allowance. The real token counts are in the files the Tests page downloads.
- `public/_headers` (the security headers) applies to the static files only. Cloudflare does not apply it to responses from the Worker ([docs](https://developers.cloudflare.com/workers/static-assets/headers/)), so the API sets its own.

## Tests

The tests exist to say, case by case, how the app did.

| Suite | Cases | What it checks |
|---|---|---|
| Policy engine | 96 | Verdict, outcome and reasons for each order, including every limit at, just under and just over its boundary, IST time, windows, rungs, undo and approval |
| Hostile and spoofed proposals | 13 | Fields the engine must ignore, look-alike ids, orders built to slip under a limit |
| Known gaps | 5 | What v1 does not catch, recorded as gaps so a change forces the spec to be updated |
| Mandate validation | 35 | Errors, warnings and cleaning of a raw mandate |
| Rail blocks | 12 | How a mandate maps onto per-shop bank blocks, and who enforces each rule |
| Receipts | 16 | Exact receipt text, and a check that every rupee amount comes from the decision |
| Shadow mode and promotion gate | 15 | When the assistant may move up, including the case where the average hides a weak group |
| Agent output to proposal | 20 | Shop and amount come from the catalogue, never from the model |
| Mandate-reader output to form | 24 | Untrusted model output is mapped to ids; what cannot be mapped is reported, not guessed |
| If the agent is fooled | 10 | The order a fully steered assistant would send for each sample, checked against the engine |
| **Mandate reader (model)** | 30 | Labelled instructions run through the live AI. Includes Hinglish, typos, contradictions and an injection attempt. |
| **Shopping agent (model)** | 10 | Ten requests, seven with hostile or misleading listings, run through the live AI |

The first ten (246 cases) need no AI: they run in Node and in the browser, from the same labelled files in `public/data/tests/` and the same code. The last two need the deployed site. Open the **Tests** page, press the run buttons, and use "Download these results" to keep each run; results are committed under `eval/results/` (see [eval/README.md](eval/README.md)).

The files in `tests/` run those labelled suites and also test the screens' logic, the Worker and the scoring code, all without a browser. `scripts/mutation-check.mjs` breaks the engine on purpose in 43 small ways to see whether the cases notice; its history, and what it does and does not show, are in [eval/README.md](eval/README.md).

The expected answers were written by the builder (an AI assistant) from [docs/SPEC.md](docs/SPEC.md). They test that the system matches the spec, not that the spec matches reality.

## Where things are

```
public/                the site (served as static files)
  index.html, css/, fonts/, favicon.svg, _headers (security headers)
  js/core/             the decision code: no dependencies, no browser or Node APIs, shared by browser, Worker and tests
  js/views/, js/ui/    the five screens and their parts
  js/store.js, logic.js, api.js, app.js    state, screen logic, API calls, router
  data/tests/          the labelled test cases (JSON)
src/worker/            the Worker: /api/health, /api/parse-mandate, /api/agent
tests/                 Node tests
scripts/               preview server, browser smoke test, mutation check
eval/                  results of runs against the live AI and of the mutation check
docs/                  SPEC, EVIDENCE, DECISIONS, BUILD_LOG, WRITEUP
```

## Documents

- [docs/WRITEUP.md](docs/WRITEUP.md): the one-page write-up (key decisions, what was not built, what can go wrong, trade-offs, another week)
- [docs/DECISIONS.md](docs/DECISIONS.md): each decision with its reason and what it costs
- [docs/BUILD_LOG.md](docs/BUILD_LOG.md): tools used, rough time, and where AI saved time or led astray
- [docs/SPEC.md](docs/SPEC.md): the specification the tests are written from
- [docs/EVIDENCE.md](docs/EVIDENCE.md): the evidence behind the problem, with sources and dates

## Licences

Code: not yet licensed (all rights reserved until a licence is added). Fonts: Anek Latin and Newsreader, subsetted, under the SIL Open Font Licence; the licence texts are in `public/fonts/`.
