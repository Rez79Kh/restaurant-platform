# Handover: سفارش میز (Table Orders), version 1

This guide is for the café or restaurant owner. It explains what you are
getting, how your team uses it from Monday, what it does not do yet, and
what we suggest building next.

---

## What you are getting

A web app that runs on your staff's phones and a kitchen tablet. There is
nothing to install: you open a link in the phone's browser. It is entirely
in Persian, with Persian numbers, Jalali dates and prices in Toman.

It covers one job from start to finish: **a table's order, from the first
item to the paid bill.**

- Waiters take orders on their phones. Several waiters can add to the same
  table at the same time, and nothing gets lost.
- The kitchen sees new items on its tablet within a few seconds, with the
  waiter's notes (for example «بدون شکر» or «سس جدا»).
- Waiters see when food is ready and mark it as served.
- Only a manager can give a discount or cancel an item the kitchen has
  already started. A reason is always required, and the app records who did
  it and when.
- The bill adds up the items, discount, service charge and VAT (currently
  set to 10%; please confirm the current rate with your accountant).
- Payment by card reader, cash, card-to-card transfer, or any mix of them.
  The bill can only be closed when the amounts paid exactly match the total.
- Menu prices you change later never change a bill that is open or already
  paid.
- A manager can photograph the printed menu and have the app read it into
  a draft. You check and correct every item before anything is saved.
- Your data is completely separate from every other restaurant using the
  platform. Automated checks prove this.

**Live address:** <https://restaurant-platform-bay.vercel.app/>

It currently holds two **demo** restaurants with a week of made-up history,
so you can try everything without affecting real data. Before you start for
real, we set up your own restaurant, menu, tables and staff, with new
personal PINs.

The build took 7 hours 20 minutes against a planned 6 hours. We chose to
deliver everything that was agreed rather than cut parts of it.

---

## How your team uses it on Monday

### Logging in (everyone)

1. Open <https://restaurant-platform-bay.vercel.app/> on the phone or tablet.
2. Enter the **restaurant code** (کد رستوران), your **mobile number**
   (شماره موبایل) and your **PIN** (رمز ورود). Then tap **ورود**.
3. You stay logged in for 12 hours, about one shift. After that, log in
   again.

**Demo logins** for trying it out. These are public, so never use them for
real service.

کافه نارنج (demo café in Shiraz), restaurant code `cafe-narenj`:

| Role | Name | Mobile | PIN |
|---|---|---|---|
| Manager | مریم کاظمی | 09170000001 | 1234 |
| Waiter | علی رضایی | 09170000002 | 1111 |
| Waiter | سارا احمدی | 09170000003 | 2222 |
| Waiter | حسین محمدی | 09170000004 | 3333 |
| Kitchen | نرگس حسینی | 09170000005 | 4444 |

رستوران کوچه (a second demo restaurant in Tehran), restaurant code
`kucheh`. Log in here to see that the two restaurants cannot see each
other's data.

| Role | Name | Mobile | PIN |
|---|---|---|---|
| Manager | رضا موسوی | 09120000001 | 5555 |
| Waiter | فاطمه کریمی | 09120000002 | 6666 |
| Kitchen | محمد جعفری | 09120000003 | 7777 |

### Waiter

1. **The tables screen (میزها)** shows every table. A table with ready food
   is shown in green.
2. **Start an order:**
   - **For a table:** tap a free table.
   - **For takeaway:** tap **سفارش بیرون‌بر جدید**.
   - If another waiter opened the same table a moment earlier, you are
     taken to their order instead, so there is never a duplicate.
3. **Add items:**
   1. Choose a category.
   2. Tap the items.
   3. Add a note if needed, using the quick notes or by typing.
   4. Tap **ارسال به آشپزخانه** (send to kitchen).
4. **If the Wi-Fi drops:**
   - The screen says the items were not sent, and keeps them.
   - Tap **ارسال دوباره** (send again) when the connection is back.
   - It is always safe to tap again: an item is never added twice.
5. **When food is ready,** serve it and tap **سرو شد** (served).
6. **More items** can be added at any time, the same way.
7. **To cancel an item the kitchen hasn't started,** tap **لغو آیتم** and
   choose a reason. Once the kitchen has started it, only a manager can
   cancel it.
8. **Payment (پرداخت):**
   1. Check the bill: total (جمع), discount, service charge (حق سرویس), VAT
      (مالیات بر ارزش افزوده) and the amount to pay (مبلغ قابل پرداخت).
   2. Enter how the guest paid: **کارتخوان** (card reader), **نقد** (cash)
      or **کارت به کارت** (card-to-card). Split across several methods if
      needed.
   3. When the amounts add up exactly, the screen says **مبلغ کامل است**
      (amount complete).
   4. Tap **ثبت پرداخت و بستن حساب** (record payment and close the bill).
   5. The table becomes free.
9. **If you see a message that someone else changed something,** read it,
   tap **باشه**, and look at the order again. The app never overwrites
   another person's change without telling you.

### Kitchen

1. Log in on the kitchen tablet. It opens on the kitchen screen
   (آشپزخانه).
2. Each order is a card. The oldest is first. Notes are shown in bold.
3. **A card's colour shows how long it has waited:** amber after 10
   minutes, red after 20.
4. **Moving an item along:**
   - Tap **شروع** (start) when you begin making it.
   - Tap **آماده شد** (ready) when it is done. The waiter sees it on their
     tables screen.
5. **A cancelled item** stays on the card for 15 minutes, crossed out in
   red, so you don't make something that is no longer wanted.
6. Keep the kitchen screen open and the tablet awake. **There is no sound**
   when a new order arrives.

The kitchen never sees prices or totals.

### Manager

The manager can do everything a waiter can, plus:

1. **Discount:** on the order screen, use **تخفیف (مدیر)**.
   - It can be a percentage or a Toman amount, and you must give a reason.
   - A percentage discount stays correct if more items are added later.
   - **To remove a discount,** you also give a reason.
2. **Cancel any item,** even after the kitchen has started it or it has
   been served (for example after a complaint). You must give a reason.
3. **See the kitchen screen** from the link on the tables screen.
4. **Import the menu from a photo:**
   1. Tap **ورود منو** on the tables screen.
   2. Take or choose a photo of the printed menu (JPEG, PNG or WebP, up
      to 4 MB).
   3. Wait up to about 20 seconds while it is read.
   4. **Check every row.** Prices the app thinks are suspicious are
      flagged, for example a menu written in thousands of Toman or in Rial.
   5. Fix anything wrong.
   6. Confirm. Nothing reaches the menu until you confirm.
   - **If reading fails,** or there is no internet to the AI service, tap
     **ورود دستی** (manual entry) and type the items into the same table.
   - **Importing again** updates the prices of items that already exist.
5. **Every discount, cancellation, closed bill and failed login** is
   recorded with who did it and when. There is no screen to view this
   record yet; ask us for it.

---

## Known limitations

Please read this section in full. These are real gaps in version 1, not
small print.

**Internet and availability**

- **No offline mode.** If your café's internet drops:
  - Staff cannot send orders, mark items or take payments in the app until
    it comes back.
  - The screen clearly says nothing was saved, and taps can be safely
    repeated afterwards.
  - Orders taken during the outage must be written on paper and entered
    later.
- **The app is hosted outside Iran** (in Frankfurt, Germany). We checked
  that it opens from Iran without a VPN.
  - **If Iran's international internet is cut, the app stops working for
    you entirely** until it is restored. This has happened before.
  - Slow or throttled international connections will also make it slow.
  - Keep a paper fallback ready.
- **The menu photo import needs the internet and an outside AI service.**
  If either is unavailable, use manual entry.

**Payments and bills**

- **No partial payments.**
  - Payment is recorded only when the whole bill is closed.
  - If one guest pays early while the table keeps ordering, the app
    cannot record it yet. Staff must keep track of it themselves until
    the bill is closed.
- **A closed bill cannot be edited, reopened or refunded.**
  - If a mistake is found after closing, it cannot be corrected in the
    app.
  - Note it separately and correct it in your accounts.
- **No connection to your card reader.**
  - The card reader works exactly as today, and staff type the amount
    into the app themselves.
  - Card-to-card transfers are not checked against your bank either.
  - The app records what staff say was paid.
- **No change calculation for cash,** and no printed or digital receipt
  for the guest. The card reader's slip is the guest's receipt.
- **No splitting by guest.** You can split the payment across methods and
  amounts, but not assign items to individual guests.
- **Prices are whole Toman only.** VAT is set to 10% and must be confirmed
  for the current year. The app does not submit anything to the tax
  system (سامانه مودیان).

**Kitchen**

- **No printers.** The kitchen uses a tablet screen only.
- **No sound alert** for new orders.
- **One kitchen screen** for everything. Bar and kitchen orders are not
  separated.

**Setup and day-to-day management**

- **No reports yet.** No daily sales, no totals by payment method and no
  staff performance. All the data is recorded from day one, so reports
  can be added without losing history. Today, ask us for an export.
- **No setup screens.** You cannot do any of the following in the app
  yourself:
  - add or remove staff, or reset a PIN;
  - add or rename tables;
  - change VAT or the service charge;
  - change a single item's price, or mark an item as sold out for the day.

  Prices can be updated by importing the menu again, but **there is no
  "sold out" button**, so staff must remember what has run out. Everything
  else needs us.
- **One branch only.** The system is built to support more branches later,
  but there are no screens for it.
- **No table moves or merges.** You cannot move an order to another table
  or join two tables. An order opened on the wrong table can be cancelled
  only after each of its items has been cancelled.

**Security**

- **PIN-only login.**
  - Anyone who knows a staff member's mobile number and PIN can log in as
    them, and PINs are short. Staff must not share their PINs.
  - There is no SMS code.
  - After 5 wrong PINs, that login is locked for 15 minutes.
  - **If a phone is lost,** it stays logged in for up to 12 hours, and you
    cannot log it out from the app. Contact us to block that staff member
    immediately.

**Menu import**

- **The menu photo import makes mistakes.**
  - In our test it misread one price out of five (۱۳۰ as ۱۲۰).
  - It is a starting point that saves typing, not a finished menu.
  - **Check every row before confirming.**

**Testing**

- **No automated tests of the screens.**
  - The parts that handle money, orders arriving at the same time, and
    keeping restaurants separate have 137 automated tests.
  - The screens themselves were checked by hand, not by automated tests.
  - The goal that a new staff member can take an order within 10 minutes
    without training has not yet been tested with real staff. We would
    like to do that with your team in the first week.

**Backups**

- **We rely on the hosting provider's restore feature.** There is no
  separate copy of your data yet.

---

## What we suggest building next

Ranked by how much each one matters to a working café.

1. **Setup screens for the manager.**
   - **What:** staff and PINs (including blocking a lost phone), a
     "sold out today" switch, single price changes, tables, and VAT and
     service charge.
   - **Why first:** these affect every shift. Today each one needs us,
     and a sold-out item that staff can still order causes daily mistakes.
2. **Partial payments, and corrections to closed bills.**
   - **What:** record a payment the moment it happens. Let a manager
     reopen or refund a closed bill, with a reason, recorded like
     discounts are.
   - **Why:** without it, staff keep track of early payments outside the
     app. That is exactly the kind of untracked money this system exists
     to remove.
3. **Hosting inside Iran.**
   - **What:** move the app and its data to an Iranian provider.
   - **Why:** an international internet cut today stops the app
     completely. The app is built from standard parts, so this is a move,
     not a rebuild. It also makes the next step for live updates cheaper
     (see below).
4. **End-of-shift report.**
   - **What:** totals by card reader, cash and card-to-card, plus
     discounts and cancellations by staff member.
   - **Why:** this replaces matching slips and notes by hand, the fifth
     problem in our original scope. The data is already being recorded.
5. **Kitchen improvements.**
   - **What:** a sound when a new order arrives, separate screens for the
     bar and the kitchen, and ticket printing if you prefer paper (this
     depends on your printer model).
   - **Why:** a missed order in a busy kitchen costs time and guests.

**Not on this list: full offline mode.** It is the hardest feature to get
right, because two phones offline at the same time can disagree about the
same bill. Hosting inside Iran fixes the larger risk, an international cut,
at a fraction of the cost. We would revisit offline mode if your Wi-Fi
proves unreliable during service.

---

## How far this design goes as the platform grows

This section explains what would need attention as more restaurants join,
so there are no surprises. It is not a plan to build for growth that
doesn't exist yet.

**How it works today, in plain terms:** every open screen (waiters' phones,
the kitchen tablet) asks the server "anything new?" every 2.5 seconds.
Hidden screens stop asking. Each question uses one short server task and
about six small database lookups. Most answers are "nothing new". All
restaurants share one database in Frankfurt, and every record is labelled
with the restaurant it belongs to.

Assume about 5 screens are open per restaurant during service. All
restaurants in Iran are busiest at the same time, Thursday evening.

### 10 restaurants: about 20 questions a second at peak

- **The technology is comfortably fine.** Hosting costs stay small.
- **The bottleneck is people, not machines:**
  - Every new restaurant, staff change, PIN reset, table change or VAT
    change needs a developer, because there are no setup screens.
  - Ten restaurants means a steady stream of small requests to us.
- **One international internet cut takes all ten down at once.**
- **Housekeeping records pile up without cleanup:** login attempts, retry
  records and expired logins. This is harmless at this size, but the
  cleanup should be added now, while it is easy.

### 1,000 restaurants: about 2,000 questions a second at the Thursday peak

That is roughly 12,000 database lookups a second, mostly to answer "nothing
new".

- **The "anything new?" checks become the main cost.**
  - Hosting cost grows with the number of open screens, not with the
    number of orders.
  - The fix is for the server to push updates to screens when something
    changes, instead of being asked. That needs an always-on server. Our
    current hosting can't hold one, but a server inside Iran (suggestion 3)
    can.
- **Every request looks up the staff member's login in the database.**
  With a short-term memory (a cache) in front of that lookup, most of
  these database trips go away.
- **The shared database needs a larger plan and the cleanup jobs.**
  - The retry records keep a copy of every response, so they grow fastest.
  - The cap on simultaneous database connections has to be managed.
- **Setting up and supporting restaurants must be self-service.** Doing it
  by hand stops being possible.
- **Hosting must be inside Iran by this point.** An international cut
  taking 1,000 businesses offline at once is not acceptable.
- **The AI menu import is not a concern.** Each import costs well under one
  US cent and happens once per restaurant, not every shift.

### 100,000 restaurants: about 200,000 questions a second at peak

- **Asking "anything new?" every few seconds no longer works at all.**
  Pushing updates from the server is required, not optional.
- **One database cannot carry the Thursday-evening writes:** new items,
  retry records and the audit record of every discount and cancellation.
  - Because every record is already labelled with its restaurant,
    restaurants can be divided across several databases without changing
    how the data is organised.
  - That would be the first structural change, made when the numbers
    call for it.
- **Order history and audit records would need archiving.** Older years
  would move to cheaper storage.
- **Running it would need a proper operations team:** monitoring and
  alerts (today there are only logs), on-call cover, and our own backups
  beyond the hosting provider's restore window.

None of this needs to be built now. The design choices that matter for
growth are already in place: records are labelled by restaurant,
restaurants are kept separate inside the database itself, and the app is
built from standard parts that can run on any hosting.
