// About: the problem, what is real and what is made up, how a decision is made,
// and what was left out. Plain prose; the long versions are the documents on GitHub.

import { h } from '../ui/dom.js';

const REPO = 'https://github.com/anadigautamiith-boop/Fintech_AI_Product';
const PINE = 'https://www.pinelabs.com/docs/online-payments/upi-reserve-pay';

const doc = (path, label) => h('a', { href: `${REPO}/blob/main/${path}` }, label);

export function mount(root, ctx) {
  root.append(h('div', null,
    h('header', { class: 'page-head' },
      h('h1', null, 'Why Reins exists'),
      h('p', { class: 'lede' }, 'People who want to hand routine purchases to an AI assistant cannot set exact spending limits, see why each payment happened, or undo a mistake. So they approve every payment by hand, or they do not delegate at all.')),

    h('div', { class: 'prose' },
      h('p', null, 'Reins is a working model of a layer that sits between an AI assistant and a UPI-style payment rail. You set the rules. The assistant proposes an order. A plain program, outside the AI, decides whether the order goes ahead, waits for you, or stops. Every order gets a receipt in ordinary words, and you can pause or undo. The assistant starts by only suggesting, and moves up one step at a time when the record shows people rarely overrule it, in every group of users.'),
      h('p', null, 'The first user in this build is an urban household that pays for groceries, food delivery and mobile recharges through UPI.'),

      h('h2', null, 'What is real, and what is made up'),
      h('dl', { class: 'facts' },
        h('dt', null, 'Real'),
        h('dd', null, 'The code that decides: the rules, the limits, the receipts and the gate that decides when the assistant may move up. It has no AI in it and runs in your browser and on the server. When the AI is connected, a language model reads your sentences and chooses the items. The test results on the Tests page are real runs.'),
        h('dt', null, 'Made up'),
        h('dd', null, 'Every shop, price, product listing and person. The money. The bank. The record on the Evidence page comes from a seeded random-number generator.'),
        h('dt', null, 'Modelled'),
        h('dd', null, 'The bank’s payment blocks follow the public description of UPI Reserve Pay: one limit per shop, up to ₹10,000, for up to 90 days ', h('a', { href: PINE }, '(Pine Labs documentation, checked 25 November 2026)'), '. That a refund does not give a block back is my assumption, not from any source.'),
        h('dt', null, 'Never'),
        h('dd', null, 'No bank, UPI or card is connected, and no real money moves. No account is needed and no personal data is asked for. The sentences you type into the reader and the requests you send to the AI are sent to Cloudflare’s AI service to be answered. Everything else stays in this browser.')),

      h('h2', null, 'How an order is decided'),
      h('ol', null,
        h('li', null, 'The assistant chooses items, by product code and quantity. It cannot set a price or name a shop: Reins reads both from the catalogue.'),
        h('li', null, 'Reins checks, in this order: is it a real order, are payments paused, are your rules in date, is the shop verified, then your limits (shops, kinds of purchase, blocked days, most for one order, spending limit, the bank’s block), and last the reasons to ask you (above your ask-me amount, a possible duplicate, orders split to dodge a limit, a purchase that cannot be undone, no bank block for the shop).'),
        h('li', null, 'What happens next depends on how much freedom you have given the assistant: a suggestion, an order that waits for your OK, or a payment within your limits. A blocked order never moves money at any step.'),
        h('li', null, 'You get a receipt in plain words with the figures that mattered, and Undo for as long as the kind of purchase allows. A mobile recharge cannot be undone, so by default it always waits for you.')),

      h('h2', null, 'What it does not do'),
      h('ul', null,
        h('li', null, 'It does not connect to a bank, UPI, a card or a real shop.'),
        h('li', null, 'It has one user and no accounts, and no seller side.'),
        h('li', null, 'It cannot tell a seller who lies about what a product is. It only knows the catalogue it is given.'),
        h('li', null, 'The evidence behind “more freedom” is invented here. With real people it would need weeks of real orders first.'),
        h('li', null, 'It does not measure complaints, because there are no real users to complain.')),
      h('p', null, 'The full list of what was left out, and why, is in ', doc('docs/WRITEUP.md', 'the one-page write-up'), '.'),

      h('h2', null, 'Read more'),
      h('ul', null,
        h('li', null, doc('docs/SPEC.md', 'The specification'), ': every rule the engine follows.'),
        h('li', null, doc('docs/EVIDENCE.md', 'The evidence behind the problem'), ', with sources and dates.'),
        h('li', null, doc('docs/DECISIONS.md', 'Decisions and trade-offs'), '.'),
        h('li', null, doc('docs/BUILD_LOG.md', 'The build log'), '.'),
        h('li', null, h('a', { href: REPO }, 'The code and its full commit history'), '.')))));
  return null;
}
