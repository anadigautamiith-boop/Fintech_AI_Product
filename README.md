# Reins

A delegated-spend trust layer for AI shopping agents, built as a product-management portfolio project for fintech.

**Status: work in progress.** This is a simulation. No real money, no real bank or UPI connection, no real personal data.

## The problem

People who want to hand routine purchases to an AI assistant cannot set exact spending limits, see why each payment happened, or undo a mistake. So they approve every payment by hand or do not delegate at all.

## What this repo will contain

- `docs/SPEC.md`: the product spec the tests are written from
- `docs/EVIDENCE.md`: the sourced evidence behind the problem statement
- `public/`: the static app, hosted on Cloudflare
- `src/worker/`: the Worker that calls Workers AI
- `tests/` and `public/data/tests/`: the test set and runners

More detail is added as the build progresses; see the commit history.
