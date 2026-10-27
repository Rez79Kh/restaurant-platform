# SCOPE — Restaurant Platform, Version 1

**Prepared for:** abrnoc
**Date:** 1405/08/05 (27 October 2026)
**Status:** Draft for agreement

---

## 1. Summary

Version 1 replaces paper order notes and shouted kitchen calls with one shared,
live view of every table's order, from the first item to the settled bill.

It is built to survive a real, busy shift: several staff can work on the same
table at the same time without anything being lost or overwritten.

We are deliberately starting with this one workflow because every other part of
the platform — reports, inventory, online payments — depends on the order data
it produces. Building those first would mean building on guesswork.

---

## 2. The problem, as it shows up during a shift

Today a café runs on a patchwork: printed menus, a basic POS, paper notes for
table orders, a messaging app between staff, a separate card reader, and
reporting done by hand at the end of the month.

During a busy shift, that patchwork fails in specific ways, ranked by what we
believe costs you the most:

1. **Items are served but never billed.** A drink added verbally or on a
   separate note never reaches the bill. This is direct revenue loss, and it
   is invisible.
2. **Discounts and cancellations can't be traced.** There's no record of who
   gave a discount or removed an item, or why.
3. **The kitchen doesn't know what's new or changed.** Orders arrive on paper or
   by voice; changes and cancellations get missed, so dishes are wrong or late.
4. **Paper notes get lost or misread.** A guest gets the wrong dish or waits
   for one that was never ordered.
5. **End-of-month reconciliation is manual.** Card-reader slips, cash, and
   notes are matched by hand, and errors are found weeks later, if ever.

---

## 3. Who uses it

| Role | Who in practice | Can do | Cannot do |
|---|---|---|---|
| Manager | Owner or shift manager | Everything: discounts, cancelling items the kitchen has started, menu, setup | — |
| Staff | Waiters, who also take payment | Open tables, add items, mark items served, record payment, close the bill | Give discounts, cancel items the kitchen has started, change the menu |
| Kitchen | Cook or barista station | See incoming items, mark them preparing / ready | See prices or totals, change orders |

**Why only three roles:** in most small Iranian cafés the waiter also takes
payment, so a separate cashier role would add a login and a configuration step
without matching how you actually work. Every extra role is something to set
up and get wrong. If a larger restaurant needs a dedicated cashier later, it
can be added without changing the rest of the system.

---

## 4. The workflow we will deliver

1. A staff member opens a table, or starts a takeaway order.
2. Staff add items, with notes like «بدون شکر» or «سس جدا». Several people can
   add to the same table at the same time, from different phones.
3. The kitchen sees new items within a few seconds, and marks them
   **preparing**, then **ready**.
4. Staff see what's ready and mark it **served**. More items can still be
   added at any point.
5. If needed, a manager applies a discount or cancels an item, with a reason.
   The system records who did it.
6. The bill shows: subtotal, discount, service charge, VAT, and total — in
   Toman.
7. Staff record how the guest paid: **card reader**, **cash**, **card-to-card
   transfer**, or a split across several of these.
8. The bill can only be closed when the amount paid exactly matches the total.
   The table is then free, and the order is kept in the history.

---

## 5. What "done" means

We'll consider version 1 complete when it behaves like this during a real
shift — these are the tests we'll hold it to:

- Two staff adding items to the same table at the same moment → **both items
  are on the bill.**
- The kitchen changes an item's status while a waiter is working on the same
  order → **neither change is lost.** If two changes genuinely conflict, staff
  see a clear message; nothing is silently overwritten.
- A double-tap, or a request resent on weak Wi-Fi, **never creates a duplicate
  item.**
- A bill **cannot be closed** if the recorded payments don't match the total.
- Changing a price on the menu **never changes** the price on an open or past
  bill.
- One restaurant can **never** see or change anything belonging to another
  restaurant on the platform — and we provide automated tests that prove it.
- A new staff member can take a complete order without training in under
  10 minutes.

---

## 6. Working in Iran — requirements we identified

- **Language:** fully in Persian, right-to-left, with Persian digits and Jalali
  (Solar Hijri) dates throughout.
- **Currency:** prices shown and stored in Toman as whole numbers. No decimals,
  no conversion.
- **Frequent price changes:** with high inflation, menu prices change often.
  Every bill keeps the price at the time the item was ordered.
- **VAT and service charge:** VAT (currently 10% — to be confirmed for the
  current year) and an optional service charge (حق سرویس), both configurable
  per restaurant.
- **Card readers:** card payments are taken on a standalone bank card reader
  (کارتخوان) that doesn't connect to other systems. Version 1 records how each
  bill was paid; it does not integrate with the reader.
- **Card-to-card transfers:** a normal payment method here, supported from day
  one, including bills split across methods.
- **Unreliable internet:** connections can be slow, throttled, or cut. The app
  must stay usable on weak connections, show clearly when something hasn't
  been saved, and allow safe retries.
- **Blocked or sanctioned foreign services:** fonts are hosted with the app
  rather than loaded from Google, and the AI feature is never required for
  service to continue.
- **Weekly rhythm:** the busiest times are Thursday evening and Friday; the demo
  data reflects this.

---

## 7. AI in version 1

**One capability: importing the menu from a photo of the printed menu.**

The manager photographs the existing printed menu. The system reads the
categories, item names, and prices, and presents them as a draft. The manager
checks and corrects every item before anything is saved.

**Why this one:** the system is useless until the menu is in it, and typing
80 items by hand is exactly where setting up a new system stalls.

**Why it's safe:** it's used once during setup, not during service. If the AI
is slow or unavailable — which is likely at times, given international
connectivity — nothing in a shift is affected, and the manager can enter
items manually.

**What we deliberately did not build:** AI order-taking by voice or free text
during service. A restaurant is noisy, service needs to be fast, a
misunderstood order costs real money, and it would stop working whenever the
internet does.

---

## 8. Not included in version 1

| Not included | Why not now |
|---|---|
| Online payment gateway | Guests pay in person by card reader or cash; this isn't where you're losing money |
| Guest QR self-ordering | Changes how the café operates; the staff workflow comes first |
| Kitchen ticket printers | Version 1 uses a tablet display; printer support depends on your specific hardware |
| Inventory / stock | Needs reliable sales data first, which this version produces |
| Reports and dashboards | The data is captured from day one; reports are the next step |
| Moadian (سامانه مودیان) tax submission | Needs your tax registration details and a legal review |
| Delivery apps (Snappfood, etc.) | A separate integration project |
| Multiple branches in the app | The system is built to support branches; the screens come later |
| Working with no internet at all | Hard to do correctly in this timeframe; see Risks |

---

## 9. Assumptions

- One branch goes live first.
- Staff use their own phones or a shared tablet; the kitchen has one tablet.
- The café has Wi-Fi of usable quality during service.
- Staff log in with their phone number and a personal PIN. No SMS codes in
  version 1.
- The manager will check the imported menu before the first shift.

---

## 10. Questions for you

1. Do waiters also take payment, or is there a dedicated cashier?
2. Who is allowed to give discounts, and should there be a maximum?
3. Do you charge a service fee, and should it appear on the bill?
4. Does your kitchen prefer paper tickets or a screen?
5. How often do your menu prices change?

---

## 11. Risks

- **Your Wi-Fi drops during service.** Staff can't save new orders until it
  reconnects. The screen will say so clearly, and nothing is lost silently,
  but orders must be retried once the connection returns.
- **The app is hosted outside Iran.** For speed of delivery, version 1 runs on
  international hosting. If Iran's international internet connection is cut,
  the app is unavailable. Moving hosting inside Iran is the first fix if this
  proves to be a real problem.
- **Several devices change the same bill at once.** Conflicts are detected and
  shown rather than silently resolved, so staff will occasionally need to
  re-check an order after a conflict message.
- **The AI misreads the menu.** Prices or names may be wrong in the draft; the
  manager's review before saving is the safeguard.

---

## 12. Delivery

**What you'll receive:**

- A live link you can open on any phone or tablet
- Logins for each role
- A demo café with a realistic menu, staff, and a week of order history
- A plain-language guide your staff can follow on their first day

**Timebox:** 6 hours of build time.