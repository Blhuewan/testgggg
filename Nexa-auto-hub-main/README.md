# Nexa Auto — Ghana vehicle services

A four-page site for Nexa, a vehicle services business in Accra, plus the PartHub
parts shop with a Paystack checkout.

| Page | What it does |
| --- | --- |
| `index.html` | Towing — roadside help and request form (car or motor, pickup and drop-off with live location) |
| `repairs.html` | Workshop repairs — four-step vehicle and fault form |
| `car-wash.html` | Car wash — service packages and booking form with A–Z brand and model lists |
| `parts.html` | PartHub — parts catalogue, cart, Paystack checkout, trade accounts and admin dashboard |

All four pages are linked by the "Nexa services" switcher pinned to the top of the
page. Requests are sent to WhatsApp on `+233 50 028 4031`.

## Running locally

You need [Node.js](https://nodejs.org) 18+ and a Cloudflare account for `wrangler`.

```bash
npm install
npx wrangler dev
```

Then open the URL wrangler prints (usually <http://localhost:8787>).

### Configuration

`wrangler.jsonc` declares three things the code needs:

- **`main`** — `src/main.js`, the Worker that handles the payment routes.
- **Static assets** — the HTML pages are served straight from the project root,
  except `/api/*`, which always goes to the Worker.
- **D1 database** — bound as `DB`, holds every order.

Create the database once, then copy the printed `database_id` into
`wrangler.jsonc`:

```bash
npx wrangler d1 create nexa-orders
npx wrangler d1 execute nexa-orders --remote --command "SELECT 1"
```

The `orders` and `trade_applications` tables are created automatically on first use.

## Trade accounts

"Apply for a trade account" on the shop page collects a name, phone number and
location, opens a pre-filled WhatsApp message to `050 028 4031`, and also saves a
copy of the application for the admin dashboard.

## Admin dashboard

Open it from the shop sidebar. It asks for the password (default `9113`, set as
`ADMIN_PASSCODE` in `wrangler.jsonc`) and then shows every paid order — order
number, customer name, item count, total and date — plus trade applications.
**Customer phone numbers are never included** in that response.

### Paystack key

Never commit the key. Set it as a secret in both places:

```bash
# local development
npx wrangler secret put PAYSTACK_SECRET_KEY

# when deployed
npx wrangler secret put PAYSTACK_SECRET_KEY --env production
```

Use your **test** secret key (`sk_test_...`) until you are ready to take real
money, then switch to the live key (`sk_live_...`).

In the Paystack dashboard, set the webhook URL to:

```
https://YOUR-DEPLOYED-DOMAIN/api/paystack/webhook
```

The webhook is optional but recommended: it confirms payments even if the
customer closes the browser before returning to the site.

## How the payment works

1. The browser sends only **product ids and quantities** — never prices.
2. The Worker re-prices the order from `src/catalog.js` and stores it as
   `pending`.
3. Paystack is asked to start a transaction for that exact amount.
4. The customer pays on Paystack's hosted page for card or mobile money.
5. On return, `/api/paystack/verify` asks Paystack for the real status and
   compares the amount before marking the order `paid`.
6. The page shows the order number and opens a pre-filled WhatsApp message so
   PartHub receives the delivery details.

Delivery fees are deliberately **not** charged through Paystack — PartHub
confirms and charges them separately, as stated on the checkout screen.

## Project layout

```
index.html          Towing page
repairs.html        Repairs page
car-wash.html       Car wash page
parts.html          PartHub shop + checkout, trade form and admin dashboard
vehicles.js         A–Z brand and model lists used by the car wash form
src/main.js         Worker: payment routes, trade applications, admin sales
src/catalog.js      Server-side prices (keep in sync with parts.html)
wrangler.jsonc      Worker, assets and D1 configuration
```

## Editing prices

Prices exist in two places and must match:

- `PRODUCTS` in `parts.html` — what shoppers see.
- `PRODUCTS` in `src/catalog.js` — what they are charged.

The server copy is the source of truth for payment. If they drift, customers
are charged the server price, so update both together.

## Photos

Photographs are loaded from Wikimedia Commons and each one shows its author and
licence. If an image cannot load, a drawn illustration appears instead.

## Deploying

```bash
npx wrangler deploy
```

Works on Cloudflare Workers. The repository also deploys to Vercel, but the
Paystack routes in `src/main.js` target the Workers runtime, so Vercel would
need that code ported before payments work there.
