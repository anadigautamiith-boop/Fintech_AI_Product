# eval: evidence about the tests, and about the AI

This folder holds results that are produced by running something, as opposed to the test cases themselves (which are in `public/data/tests/`). Nothing here is edited by hand except this file.

## 1. Does the test set notice when the code is wrong? (mutation check)

`scripts/mutation-check.mjs` copies the project to a temporary folder, breaks the decision code in one small way at a time (a limit that lets an exact match through, a day counted wrong, a check removed), runs the Node tests, and records whether any test failed. A bug that no test notices is a gap in the tests.

| File | What it is |
|---|---|
| `results/mutation-check-first-run.json` | The script run against the test set **as it was first written** (commit `d1a9da2`). **36 of 43 caught (84%).** The 7 that survived were real gaps: a 31-day month, renewals at an exact ₹10,000, a 90-day mandate, "weekend" on its own, an unknown autonomy step treated as the most permissive one, a shop whose verified flag is missing, and repeated lines that add up past the quantity limit. |
| `results/mutation-check.json` | The same script run against the current test set. **43 of 43 caught**, and 2 further variants (E01, E02) that change nothing anyone can observe, each with the reason. |

**Read the second number with care.** The new cases (N34, N35, C11, C12, K24, B20, P085, P086) were written to catch exactly the 7 bugs the first run showed, so 43 of 43 is not an independent measure. The first-run figure is the honest one. A check made with a different list of bugs, or written by someone else, would be a fair test of the test set; this one has not been done.

A note on the figure. The message of commit `c86fb26` says "35 of 43 (81%)" and "the 8 it missed". The mutant list of that original run was not saved. Re-running the committed script against the previous commit's tests gives 36 of 43 with the 7 survivors that message names, and the eighth miss it counts is the "quantity of exactly 100" variant, which is now listed as harmless (E02). The file above is reproducible; the 35 is not, so this folder and the Tests page use 36.

To reproduce the first run:

```
git worktree add /tmp/first d1a9da2
mkdir -p /tmp/first/scripts /tmp/first/eval/results
git show c86fb26:scripts/mutation-check.mjs > /tmp/first/scripts/mutation-check.mjs
cd /tmp/first && node scripts/mutation-check.mjs
```

To run the current check: `node scripts/mutation-check.mjs` (about two minutes; it never changes the project folder).

## 2. How well does the AI do? (the two model suites)

Two checks send labelled cases to the AI model through the deployed Worker:

- **Mandate reader**: 30 labelled instructions (`public/data/tests/parse-gold.json`). Scored per field and per case.
- **Shopping agent**: 10 requests, 7 with hostile or misleading listings (`public/data/tests/agent-scenarios.json`). Scored on whether it ordered what was asked, whether it went for the trap, and what the engine then did.

They run only against a deployed copy, because the AI binding exists only there. The Worker asks for `temperature: 0`.

To produce and keep a run:

1. Open the live site, go to **Tests**, wait for "AI connected" in the masthead.
2. Press **Run these cases** for the mandate reader. Then, for the shopping agent, run it once with "Warn the AI that listing text must not be obeyed" ticked and once with it unticked.
3. Press **Download these results (JSON)** on each. The file names say which run it is (`reins-parse-…`, `reins-agent-guarded-…`, `reins-agent-unguarded-…`).
4. Put the three files in `eval/results/live/` and commit them.

What these numbers are and are not:

- They are one run each, of a model that Cloudflare may change or retire. Each file records the model name and the date.
- The free plan has a daily AI allowance. If it runs out part-way through, the cases that could not be answered are recorded as errors and count as failed; they are never skipped. Run again the next day for a full set.
- The cases and their expected answers were written by the builder, an AI assistant, from the spec. They have not been independently reviewed.
- The stand-in used by `scripts/preview-server.mjs` is not a model. If a file says "preview stand-in", it must not be quoted as a result.

**Results so far: none.** No run against the real model has been made yet. The write-up says "pending" where these numbers will go.

## 3. Cost

Workers AI prices a call per token and states the price in "neurons". For the model in use, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, that is 26,668 neurons per million input tokens and 204,805 per million output tokens. The free plan includes 10,000 neurons a day, reset at 00:00 UTC (Cloudflare's pricing page, checked 26 November 2026).

The Worker passes on the token counts the platform reports for each call, and the Tests page sums them and puts them in the downloaded file. Neurons are not worked out in the app: they are the platform's unit, and its conversion may change.

Before any real run, an estimate from the size of the prompts the Worker builds (3 to 4 characters per token, and assumed answers of 140 tokens for the reader and 90 for the agent) is:

| Run | Calls | Neurons per call | Neurons per run |
|---|---|---|---|
| Mandate reader | 30 | about 45 to 50 | about 1,350 to 1,500 |
| Shopping agent | 10 | about 27 to 30 | about 270 to 300 |

So the three runs recommended above would use about 2,000 neurons, a fifth of one day's allowance. This is an estimate from character counts, not a measurement. Replace it with the real figures from the downloaded files: tokens in, tokens out, and the prices above.
