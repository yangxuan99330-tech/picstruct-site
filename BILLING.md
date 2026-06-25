# PicStruct Billing Setup

PicStruct currently supports MVP billing through hosted checkout links.

## Recommended MVP path

Use one of these:

- Stripe Payment Links: https://docs.stripe.com/payment-links
- Paddle Checkout: https://developer.paddle.com/build/checkout/build-overlay-checkout/
- Lemon Squeezy checkout links: create these from the Lemon Squeezy dashboard
- Crypto checkout links or invoices from Coinbase Commerce, NOWPayments, or another provider you can legally use
- WeChat Pay and Alipay through Stripe, Adyen, a local merchant account, or manual QR payment while testing

Create products for:

- Starter: `$7/month`, 100 conversions
- Pro: `$15/month`, 500 conversions
- Optional credits: one-time credit pack

Then paste the public checkout URLs into `config.js`:

```js
window.PICSTRUCT_CONFIG = {
  starterCheckoutUrl: "https://...",
  proCheckoutUrl: "https://...",
  creditPackCheckoutUrl: "https://...",
  contactEmail: "hello@picstruct.com"
};
```

For multi-method checkout, prefer the structured `paymentLinks` object:

```js
window.PICSTRUCT_CONFIG = {
  paymentLinks: {
    starter: {
      card: "https://...",
      paddle: "https://...",
      crypto: "https://...",
      wechat: "https://...",
      alipay: "https://...",
      manual: "mailto:hello@picstruct.com"
    },
    pro: {
      card: "https://...",
      paddle: "https://...",
      crypto: "https://...",
      wechat: "https://...",
      alipay: "https://...",
      manual: "mailto:hello@picstruct.com"
    }
  }
};
```

Keep `starterCheckoutUrl` and `proCheckoutUrl` as fallback card links if you only
want one hosted checkout provider.

## Information you usually need for payment onboarding

Payment providers usually ask for:

- Legal name or business name
- Country/region
- Email and phone
- Website or product URL
- Bank account or payout account
- Tax information
- Business category and product description
- Identity or business verification documents, depending on region

Do not send this information to Codex, and do not store it in this repository.
Enter it only inside the payment provider's official dashboard.

For the fastest market test, use hosted checkout links first. This lets PicStruct
show paid plans without storing card details, bank details, or subscription logic
in the site itself.

## MVP paid access codes

Before full accounts and webhooks are ready, use temporary access codes:

```env
FREE_DAILY_PARSE_LIMIT=3
STARTER_ACCESS_CODE=generate-a-private-code
PRO_ACCESS_CODE=generate-a-private-code
STARTER_MONTHLY_PARSE_LIMIT=100
PRO_MONTHLY_PARSE_LIMIT=500
```

Workflow:

- User pays through a hosted checkout link.
- You send them the matching access code manually.
- They paste it into the "Already paid?" box on the pricing section.
- The browser stores it locally and sends it to `/api/parse` as `X-PicStruct-Access-Code`.
- The API checks the code server-side and applies Starter or Pro monthly limits.

This is enough for a small paid test. Do not treat one shared access code as a
long-term account system; replace it with user accounts and webhooks after users
prove they are willing to pay.

## What belongs in code

Public checkout URLs are okay in `config.js`.

These do not belong in frontend code:

- Secret API keys
- Webhook signing secrets
- Bank account numbers
- Tax IDs
- Identity documents

## Later production upgrade

After users show willingness to pay, move from static checkout links to:

- User accounts
- Server-side credits
- Payment webhooks
- Real subscription status
- Persistent usage limits
- Per-user access instead of shared access codes

Until then, hosted checkout links are enough to test whether users click upgrade.
