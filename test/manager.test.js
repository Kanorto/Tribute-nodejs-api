import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { TributeSubscriptionManager, InMemorySubscriptionStore, TributeSignatureError, createTributeConfig } from '../src/index.js';

const SECRET = 'test-secret';
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

test('creates intents and processes new subscriptions', async (t) => {
  const store = new InMemorySubscriptionStore();
  const manager = new TributeSubscriptionManager({
    plans: [
      {
        id: 'monthly-10',
        title: 'Monthly 10 EUR',
        amount: 1000,
        currency: 'eur',
        period: 'monthly',
        subscriptionLink: 'https://t.me/tribute/app?startapp=plan10',
        tributeSubscriptionId: 1644,
        tributePeriodId: 1547,
      },
    ],
    apiKey: SECRET,
    store,
    logger: silentLogger,
  });

  const { intentId } = await manager.createSubscriptionIntent({ planId: 'monthly-10', telegramUserId: 123456 });
  const createdAt = new Date().toISOString();
  const body = Buffer.from(
    JSON.stringify({
      name: 'new_subscription',
      created_at: createdAt,
      sent_at: createdAt,
      payload: {
        subscription_id: 1644,
        period_id: 1547,
        period: 'monthly',
        price: 1000,
        amount: 1000,
        currency: 'eur',
        telegram_user_id: 123456,
        intent_id: intentId,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    })
  );

  const result = await manager.handleWebhook(body, sign(body));
  assert.equal(result?.category, 'subscription');
  assert.equal(result?.type, 'created');
  assert.equal(store.subscriptions.size, 1);
  const subscription = store.subscriptions.get(1644);
  assert(subscription, 'subscription stored');
  assert.equal(subscription.status, 'active');
  assert.equal(store.payments.length, 1);
  assert.equal(store.payments[0].kind, 'subscription');

  await t.test('duplicate subscription webhook is ignored', async () => {
    const duplicate = await manager.handleWebhook(body, sign(body));
    assert.equal(duplicate, undefined);
    assert.equal(store.payments.length, 1);
  });

  await t.test('renewal does not require intent', async () => {
    const renewalBody = Buffer.from(
      JSON.stringify({
        name: 'new_subscription',
        created_at: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
        sent_at: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
        payload: {
          subscription_id: 1644,
          period_id: 1547,
          period: 'monthly',
          price: 1000,
          amount: 1000,
          currency: 'eur',
          telegram_user_id: 123456,
          expires_at: new Date(Date.now() + 61 * 24 * 60 * 60 * 1000).toISOString(),
        },
      })
    );
    const renewal = await manager.handleWebhook(renewalBody, sign(renewalBody));
    assert.equal(renewal?.category, 'subscription');
    assert.equal(renewal?.type, 'renewed');
    assert.equal(store.payments.length, 2);

    const duplicateRenewal = await manager.handleWebhook(renewalBody, sign(renewalBody));
    assert.equal(duplicateRenewal, undefined);
    assert.equal(store.payments.length, 2);
  });

  await t.test('cancellation updates status', async () => {
    const cancelBody = Buffer.from(
      JSON.stringify({
        name: 'cancelled_subscription',
        created_at: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000).toISOString(),
        sent_at: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000).toISOString(),
        payload: {
          subscription_id: 1644,
          period_id: 1547,
          period: 'monthly',
          price: 1000,
          amount: 1000,
          currency: 'eur',
          telegram_user_id: 123456,
          cancel_reason: 'user_cancelled',
        },
      })
    );
    const cancelled = await manager.handleWebhook(cancelBody, sign(cancelBody));
    assert.equal(cancelled?.category, 'subscription');
    assert.equal(cancelled?.type, 'cancelled');
    const updated = store.subscriptions.get(1644);
    assert(updated);
    assert.equal(updated.status, 'cancelled');
    assert.equal(updated.cancelReason, 'user_cancelled');

    const duplicateCancel = await manager.handleWebhook(cancelBody, sign(cancelBody));
    assert.equal(duplicateCancel, undefined);
    assert.equal(store.subscriptions.get(1644)?.status, 'cancelled');
  });
});

test('rejects invalid signatures', async () => {
  const manager = new TributeSubscriptionManager({
    plans: [
      {
        id: 'plan',
        title: 'Plan',
        amount: 500,
        currency: 'usd',
        period: 'monthly',
        subscriptionLink: 'https://t.me/tribute/app?startapp=plan',
        tributeSubscriptionId: 1,
      },
    ],
    apiKey: SECRET,
    store: new InMemorySubscriptionStore(),
    logger: silentLogger,
  });
  const body = Buffer.from(JSON.stringify({ name: 'new_subscription', payload: {} }));
  await assert.rejects(() => manager.handleWebhook(body, 'wrong-signature'), TributeSignatureError);
});

test('processes donation and donation lifecycle events', async (t) => {
  const store = new InMemorySubscriptionStore();
  const manager = new TributeSubscriptionManager({
    plans: [
      {
        id: 'placeholder',
        title: 'Placeholder',
        amount: 500,
        currency: 'usd',
        period: 'monthly',
        subscriptionLink: 'https://t.me/tribute/app?startapp=placeholder',
      },
    ],
    apiKey: SECRET,
    store,
    logger: silentLogger,
  });

  const createdAt = new Date().toISOString();
  const donationBody = Buffer.from(
    JSON.stringify({
      name: 'new_donation',
      created_at: createdAt,
      sent_at: createdAt,
      payload: {
        donation_request_id: 501,
        donation_name: 'Support project',
        period: 'monthly',
        amount: 1000,
        currency: 'usd',
        anonymously: false,
        telegram_user_id: 987654,
        user_id: 555,
        message: 'Thanks!',
      },
    })
  );

  const donationResult = await manager.handleWebhook(donationBody, sign(donationBody));
  assert.equal(donationResult?.category, 'donation');
  assert.equal(donationResult?.type, 'created');
  const donation = store.donations.get(501);
  assert(donation);
  assert.equal(donation.status, 'active');
  assert.equal(store.payments.at(-1)?.kind, 'donation');

  await t.test('duplicate donation webhook is ignored', async () => {
    const duplicate = await manager.handleWebhook(donationBody, sign(donationBody));
    assert.equal(duplicate, undefined);
    assert.equal(store.payments.filter((p) => p.kind === 'donation').length, 1);
  });

  await t.test('recurrent donation updates last event', async () => {
    const recurrentBody = Buffer.from(
      JSON.stringify({
        name: 'recurrent_donation',
        created_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        sent_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        payload: {
          donation_request_id: 501,
          donation_name: 'Support project',
          period: 'monthly',
          amount: 1000,
          currency: 'usd',
          anonymously: false,
          telegram_user_id: 987654,
          user_id: 555,
        },
      })
    );
    const recurrent = await manager.handleWebhook(recurrentBody, sign(recurrentBody));
    assert.equal(recurrent?.category, 'donation');
    assert.equal(recurrent?.type, 'recurrent');
    assert.equal(store.payments.filter((p) => p.kind === 'donation').length, 2);

    const duplicateRecurrent = await manager.handleWebhook(recurrentBody, sign(recurrentBody));
    assert.equal(duplicateRecurrent, undefined);
    assert.equal(store.payments.filter((p) => p.kind === 'donation').length, 2);
  });

  await t.test('cancelled donation updates status', async () => {
    const cancelBody = Buffer.from(
      JSON.stringify({
        name: 'cancelled_donation',
        created_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        sent_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        payload: {
          donation_request_id: 501,
        },
      })
    );
    const cancelled = await manager.handleWebhook(cancelBody, sign(cancelBody));
    assert.equal(cancelled?.category, 'donation');
    assert.equal(cancelled?.type, 'cancelled');
    assert.equal(store.donations.get(501)?.status, 'cancelled');

    const duplicateCancel = await manager.handleWebhook(cancelBody, sign(cancelBody));
    assert.equal(duplicateCancel, undefined);
    assert.equal(store.donations.get(501)?.status, 'cancelled');
  });
});

test('manager ignores disabled webhook categories', async () => {
  const store = new InMemorySubscriptionStore();
  const manager = new TributeSubscriptionManager({
    plans: [
      {
        id: 'placeholder',
        title: 'Placeholder',
        amount: 500,
        currency: 'usd',
        period: 'monthly',
        subscriptionLink: 'https://t.me/tribute/app?startapp=placeholder',
      },
    ],
    apiKey: SECRET,
    store,
    allowedWebhookEvents: ['new_subscription', 'cancelled_subscription'],
    logger: silentLogger,
  });

  const donationBody = Buffer.from(
    JSON.stringify({
      name: 'new_donation',
      created_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      payload: {
        donation_request_id: 700,
        period: 'monthly',
        amount: 1000,
        currency: 'usd',
        telegram_user_id: 1,
      },
    })
  );

  const result = await manager.handleWebhook(donationBody, sign(donationBody));
  assert.equal(result, undefined);
  assert.equal(store.payments.filter((p) => p.kind === 'donation').length, 0);
});

test('exposes query helpers and manual cancellation workflow', async () => {
  const store = new InMemorySubscriptionStore();
  const manager = new TributeSubscriptionManager({
    plans: [
      {
        id: 'pro',
        title: 'Pro Plan',
        amount: 1500,
        currency: 'usd',
        period: 'monthly',
        subscriptionLink: 'https://t.me/tribute/app?startapp=pro',
        tributeSubscriptionId: 2001,
        tributePeriodId: 2101,
      },
    ],
    apiKey: SECRET,
    store,
    intentTtlMs: 0,
    logger: silentLogger,
  });

  const intent = await manager.createSubscriptionIntent({ planId: 'pro', telegramUserId: 789, metadata: { feature: 'beta' } });
  const savedIntent = await manager.getIntentById(intent.intentId);
  assert(savedIntent);
  assert.equal(savedIntent.planId, 'pro');

  const futureTimestamp = new Date(Date.now() + 60 * 1000).toISOString();
  const body = Buffer.from(
    JSON.stringify({
      name: 'new_subscription',
      created_at: futureTimestamp,
      sent_at: futureTimestamp,
      payload: {
        subscription_id: 2001,
        period_id: 2101,
        period: 'monthly',
        price: 1500,
        amount: 1500,
        currency: 'usd',
        telegram_user_id: 789,
        intent_id: intent.intentId,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
    })
  );

  const result = await manager.handleWebhook(body, sign(body));
  assert.equal(result?.context?.intentStatus, 'expired');

  const byId = await manager.getSubscriptionByTributeId(2001);
  assert(byId);
  assert.equal(byId?.telegramUserId, 789);

  const byUser = await manager.getSubscriptionForUser({ telegramUserId: 789, planId: 'pro' });
  assert(byUser);
  assert.equal(byUser?.tributeSubscriptionId, 2001);

  const payments = await manager.listPayments({ telegramUserId: 789 });
  assert.equal(payments.length, 1);
  assert.equal(payments[0].kind, 'subscription');
  assert(payments[0].paidAt instanceof Date);

  const manualCancelledAt = new Date(Date.now() + 2 * 60 * 1000);
  const cancelResult = await manager.cancelSubscriptionLocally({
    tributeSubscriptionId: 2001,
    cancelReason: 'user_request',
    cancelledAt: manualCancelledAt,
  });
  assert.equal(cancelResult.subscription.status, 'cancelled');
  assert.equal(cancelResult.context?.cancellation.cancelReason, 'user_request');
  assert.equal(cancelResult.context?.cancellation.source, 'manual');

  const updated = await manager.getSubscriptionByTributeId(2001);
  assert(updated);
  assert.equal(updated?.status, 'cancelled');
  assert(updated?.lastEventAt.getTime() >= manualCancelledAt.getTime());

  const filteredPayments = await manager.listPayments({ telegramUserId: 789, kind: 'subscription', limit: 1 });
  assert.equal(filteredPayments.length, 1);
  assert.equal(filteredPayments[0].kind, 'subscription');
});

test('event publisher integration and failure modes', async (t) => {
  await t.test('dispatches processed events to external publisher', async () => {
    const store = new InMemorySubscriptionStore();
    const captured = [];
    const manager = new TributeSubscriptionManager({
      plans: [
        {
          id: 'publisher-plan',
          title: 'Publisher Plan',
          amount: 800,
          currency: 'eur',
          period: 'monthly',
          subscriptionLink: 'https://t.me/tribute/app?startapp=publisher',
          tributeSubscriptionId: 3101,
          tributePeriodId: 3201,
        },
      ],
      apiKey: SECRET,
      store,
      logger: silentLogger,
      eventPublisher(event) {
        captured.push(event);
      },
    });

    const createdAt = new Date().toISOString();
    const body = Buffer.from(
      JSON.stringify({
        name: 'new_subscription',
        created_at: createdAt,
        sent_at: createdAt,
        payload: {
          subscription_id: 3101,
          period_id: 3201,
          period: 'monthly',
          price: 800,
          amount: 800,
          currency: 'eur',
          telegram_user_id: 5551,
        },
      })
    );

    await manager.createSubscriptionIntent({ planId: 'publisher-plan', telegramUserId: 5551 });
    const result = await manager.handleWebhook(body, sign(body));
    assert.equal(result?.type, 'created');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].category, 'subscription');
    assert.equal(captured[0].type, 'created');
  });

  await t.test('throwing publisher propagates error by default', async () => {
    const store = new InMemorySubscriptionStore();
    const manager = new TributeSubscriptionManager({
      plans: [
        {
          id: 'publisher-plan-throw',
          title: 'Publisher Plan Throw',
          amount: 900,
          currency: 'eur',
          period: 'monthly',
          subscriptionLink: 'https://t.me/tribute/app?startapp=publisher-throw',
          tributeSubscriptionId: 4101,
          tributePeriodId: 4201,
        },
      ],
      apiKey: SECRET,
      store,
      logger: silentLogger,
      eventPublisher() {
        throw new Error('queue offline');
      },
    });

    const createdAt = new Date(Date.now() + 1000).toISOString();
    const body = Buffer.from(
      JSON.stringify({
        name: 'new_subscription',
        created_at: createdAt,
        sent_at: createdAt,
        payload: {
          subscription_id: 4101,
          period_id: 4201,
          period: 'monthly',
          price: 900,
          amount: 900,
          currency: 'eur',
          telegram_user_id: 5552,
        },
      })
    );

    await manager.createSubscriptionIntent({ planId: 'publisher-plan-throw', telegramUserId: 5552 });
    await assert.rejects(() => manager.handleWebhook(body, sign(body)), /queue offline/);
    assert.equal(store.payments.length, 1);
    assert.equal(store.payments[0].kind, 'subscription');
  });

  await t.test('log failure mode keeps webhook successful while logging error', async () => {
    const store = new InMemorySubscriptionStore();
    const logged = [];
    const manager = new TributeSubscriptionManager({
      plans: [
        {
          id: 'publisher-plan-log',
          title: 'Publisher Plan Log',
          amount: 1000,
          currency: 'eur',
          period: 'monthly',
          subscriptionLink: 'https://t.me/tribute/app?startapp=publisher-log',
          tributeSubscriptionId: 5101,
          tributePeriodId: 5201,
        },
      ],
      apiKey: SECRET,
      store,
      logger: {
        ...silentLogger,
        error(message, details) {
          logged.push({ message, details });
        },
      },
      eventPublisherFailureMode: 'log',
      eventPublisher() {
        throw new Error('queue offline');
      },
    });

    const createdAt = new Date(Date.now() + 2000).toISOString();
    const body = Buffer.from(
      JSON.stringify({
        name: 'new_subscription',
        created_at: createdAt,
        sent_at: createdAt,
        payload: {
          subscription_id: 5101,
          period_id: 5201,
          period: 'monthly',
          price: 1000,
          amount: 1000,
          currency: 'eur',
          telegram_user_id: 5553,
        },
      })
    );

    await manager.createSubscriptionIntent({ planId: 'publisher-plan-log', telegramUserId: 5553 });
    const result = await manager.handleWebhook(body, sign(body));
    assert.equal(result?.type, 'created');
    assert.equal(store.payments.length, 1);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].message, 'Tribute event publisher failed');
    assert.equal(logged[0].details.category, 'subscription');
  });
});

test('createTributeConfig loads plans and options from environment', () => {
  const plans = [
    {
      id: 'env-plan',
      title: 'ENV Plan',
      amount: 900,
      currency: 'eur',
      period: 'monthly',
      subscriptionLink: 'https://t.me/tribute/app?startapp=env-plan',
    },
  ];
  const env = {
    TRIBUTE_PLANS: JSON.stringify(plans),
    TRIBUTE_API_KEY: 'env-secret',
    TRIBUTE_INTENT_TTL_MINUTES: '2',
    TRIBUTE_SIGNATURE_ENCODING: 'base64',
    TRIBUTE_ALLOW_DONATIONS: 'false',
    TRIBUTE_EVENT_PUBLISHER_FAILURE_MODE: 'log',
  };

  const config = createTributeConfig({}, { env });
  assert.deepEqual(config.plans, plans);
  assert.equal(config.apiKey, 'env-secret');
  assert.equal(config.intentTtlMs, 2 * 60 * 1000);
  assert.equal(config.signatureEncoding, 'base64');
  assert.deepEqual(config.allowedWebhookEvents, ['new_subscription', 'cancelled_subscription']);
  assert.equal(config.store, undefined);
  assert.equal(config.eventPublisherFailureMode, 'log');
});
