# Build log

## Who did what

The product owner (the person submitting this) set the brief and the constraints: a fintech product for an AI product-manager portfolio, hosted on Cloudflare's free plan, with the code in this GitHub repository. Claude, an AI assistant (Claude Sonnet 5.5, in a Claude Code cloud session), did the research, and wrote the spec, the code, the tests and these documents, and ran the checks. The product owner wrote five messages in total. The code and the labelled test cases have not yet been reviewed by anyone but the assistant.

> Product owner: add here your own hands-on time and any decision of yours that is not recorded above.

## Tools

- **Claude (Sonnet 5.5)** in a Claude Code cloud session: shell, file editing, web search and fetch, git. It wrote everything in this repository.
- **Node.js 22** and its built-in test runner (`node --test`) for the Node tests. No test framework is installed.
- **Playwright with headless Chrome** to open the real pages, click through the flows, check layouts at desktop and phone width, and catch console errors and security-policy violations. It is used by `scripts/ui-smoke.mjs` but is not a project dependency.
- **Fontsource npm packages** for the two fonts (Anek Latin and Newsreader, both under the SIL Open Font Licence), subset to the characters the app uses, about 100 KB in total. **Python with Pillow** to crop screenshots while checking layouts.
- **Git and GitHub** for the history.
- **Cloudflare Workers, static assets and Workers AI**, the hosting that was asked for. The build workspace cannot reach Cloudflare, so the Worker was run in Node against a stand-in for the AI, and **the real model has not been run yet**.

## Rough time

Clock times are Japan time, 25 and 26 November 2026, taken from the session and from `git log`.

| Stage | When | About |
|---|---|---|
| Reading the book, research, problem statement and evidence | 21:30 to 22:31 | 1 hour |
| Spec, catalogue, labelled cases, decision code, Worker, tests | 22:40 to about 23:30 | 50 minutes |
| Design system, app logic and state, the five screens | about 23:30 to 00:10 | 40 minutes |
| Browser checks, fixes, documents | 00:10 onwards | in progress |

Most of this was the assistant working alone. The first commit is at 22:40 and the numbers are wall-clock, not effort.

## One moment where AI saved a lot of time

The decision engine and its tests. Between about 22:40 and 23:30 the assistant turned the spec's rules into labelled cases (96 for the policy engine alone: every limit at, just under and just over its boundary, the edges of an IST day, week and month, undo windows to the minute, and further cases for hostile inputs, validation, rail blocks, receipts, the gate, proposals and the reader), wrote the code that passes them, and built a harness that breaks the code in 43 small ways to see whether the cases notice. That harness showed the cases were thin in 7 places.

## One moment where AI led astray

A UPI fraud figure in the research. The assistant labelled ₹485 crore as the figure for FY24. The source gave it for April to September 2024; the figure for FY24 is ₹1,087 crore. It was caught by fetching the source again and reading the period, and corrected in [EVIDENCE.md](EVIDENCE.md). A statistic without its period is the kind of thing a product decision can rest on without anyone noticing.

Three smaller things the assistant got wrong and a check caught, all after the build looked finished:

- **A claim of review that had not happened.** The spec said the labelled expected answers were "reviewed by the product owner". Nobody had reviewed them. It now says that no one but the builder has.
- **Its own mutation score.** A commit message and the Tests page said the first run caught 35 of 43. Re-running the script against the earlier test set gives 36 of 43 ([eval/README.md](../eval/README.md)).
- **A broken skip link.** The browser smoke test showed that the "Skip to the page" link sent keyboard users on any page back to the Rules page.

## How the history was made

Every commit is a logical unit, and nothing was squashed. Several were made together at the end of a stretch of work, so their timestamps cluster (for example, nine commits between 23:05 and 23:08) and do not show the minute each file was written. The commit messages record the decisions and, where a check changed the plan, what the check found.
