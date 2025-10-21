import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { verifyTributeSignature } from './SignatureVerifier.js';
import {
  TributeConfigurationError,
  TributeDonationNotFoundError,
  TributeIntentNotFoundError,
  TributePlanNotFoundError,
  TributeSignatureError,
  TributeSubscriptionNotFoundError,
} from './errors.js';
import { SubscriptionStore } from './store/SubscriptionStore.js';

/**
 * @typedef {import('./types.js').TributePlan} TributePlan
 * @typedef {import('./types.js').SubscriptionIntent} SubscriptionIntent
 * @typedef {import('./types.js').TributeEventEnvelope} TributeEventEnvelope
 * @typedef {import('./types.js').StoredSubscription} StoredSubscription
 * @typedef {import('./types.js').SubscriptionEventResult} SubscriptionEventResult
 * @typedef {import('./types.js').DonationEventResult} DonationEventResult
 * @typedef {import('./types.js').StoredDonation} StoredDonation
 * @typedef {import('./types.js').PaymentListFilters} PaymentListFilters
 * @typedef {import('./types.js').ManualCancellationOptions} ManualCancellationOptions
 * @typedef {import('./types.js').TributeEventResult} TributeEventResult
 */

const DEFAULT_INTENT_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SUPPORTED_WEBHOOK_EVENTS = [
  'new_subscription',
  'cancelled_subscription',
  'new_donation',
  'recurrent_donation',
  'cancelled_donation',
];

/**
 * Subscription manager orchestrates plan selection, Telegram identity verification
 * and Tribute webhook processing.
 */
export class TributeSubscriptionManager extends EventEmitter {

  /**
   * @param {Object} options
   * @param {TributePlan[]} options.plans
   * @param {string} options.apiKey
   * @param {SubscriptionStore} options.store
   * @param {Console | { debug?: Function, info?: Function, warn?: Function, error?: Function }} [options.logger]
   * @param {number} [options.intentTtlMs]
   * @param {"hex"|"base64"} [options.signatureEncoding]
   * @param {string[]} [options.allowedWebhookEvents]
   * @param {(event: TributeEventResult) => (void|Promise<void>)} [options.eventPublisher]
   * @param {'throw'|'log'} [options.eventPublisherFailureMode]
  */
  constructor({
    plans,
    apiKey,
    store,
    logger = console,
    intentTtlMs = DEFAULT_INTENT_TTL_MS,
    signatureEncoding = 'hex',
    allowedWebhookEvents = SUPPORTED_WEBHOOK_EVENTS,
    eventPublisher,
    eventPublisherFailureMode = 'throw',
  }) {
    super();
    if (!Array.isArray(plans) || plans.length === 0) {
      throw new TributeConfigurationError('At least one subscription plan must be provided');
    }
    if (!apiKey) {
      throw new TributeConfigurationError('Tribute API key is required');
    }
    if (!(store instanceof SubscriptionStore)) {
      throw new TributeConfigurationError('store must extend SubscriptionStore');
    }
    this.plans = plans;
    this.apiKey = apiKey;
    this.store = store;
    this.logger = logger;
    this.intentTtlMs = intentTtlMs;
    this.signatureEncoding = signatureEncoding;
    if (!Array.isArray(allowedWebhookEvents) || allowedWebhookEvents.length === 0) {
      throw new TributeConfigurationError('allowedWebhookEvents must be a non-empty array');
    }
    for (const event of allowedWebhookEvents) {
      if (!SUPPORTED_WEBHOOK_EVENTS.includes(event)) {
        throw new TributeConfigurationError(`Unsupported Tribute webhook event: ${event}`);
      }
    }
    this.allowedWebhookEvents = new Set(allowedWebhookEvents);
    if (eventPublisher !== undefined && typeof eventPublisher !== 'function') {
      throw new TributeConfigurationError('eventPublisher must be a function when provided');
    }
    if (!['throw', 'log'].includes(eventPublisherFailureMode)) {
      throw new TributeConfigurationError('eventPublisherFailureMode must be either "throw" or "log"');
    }
    this.eventPublisher = eventPublisher ?? null;
    this.eventPublisherFailureMode = eventPublisherFailureMode;
  }

  /**
   * Get public plans description for UI.
   * @returns {Array<{ id: string, title: string, amount: number, currency: string, period: string, subscriptionLink: string, metadata?: Object }>}
   */
  listPlans() {
    return this.plans.map(({ id, title, amount, currency, period, subscriptionLink, metadata }) => ({
      id,
      title,
      amount,
      currency,
      period,
      subscriptionLink,
      metadata: metadata ?? undefined,
    }));
  }

  /**
   * Retrieve previously created intent by id without consuming it.
   * Useful for manual verification flows.
   * @param {string} intentId
   * @returns {Promise<SubscriptionIntent | undefined>}
   */
  async getIntentById(intentId) {
    if (!intentId) {
      throw new TributeConfigurationError('intentId is required');
    }
    return this.store.getIntentById(intentId);
  }

  /**
   * Load subscription by Tribute subscription id.
   * @param {number|string} tributeSubscriptionId
   * @returns {Promise<StoredSubscription | undefined>}
   */
  async getSubscriptionByTributeId(tributeSubscriptionId) {
    if (tributeSubscriptionId === undefined || tributeSubscriptionId === null || tributeSubscriptionId === '') {
      throw new TributeConfigurationError('tributeSubscriptionId is required');
    }
    return this.store.getSubscriptionByTributeId(tributeSubscriptionId);
  }

  /**
   * Get last known subscription for Telegram user and plan.
   * @param {Object} params
   * @param {number|string} params.telegramUserId
   * @param {string} params.planId
   * @returns {Promise<StoredSubscription | undefined>}
   */
  async getSubscriptionForUser({ telegramUserId, planId }) {
    if (telegramUserId === undefined || telegramUserId === null || telegramUserId === '') {
      throw new TributeConfigurationError('telegramUserId is required');
    }
    if (!planId) {
      throw new TributeConfigurationError('planId is required');
    }
    if (typeof this.store.getSubscriptionByTelegramAndPlan === 'function') {
      return this.store.getSubscriptionByTelegramAndPlan(telegramUserId, planId);
    }
    // fallback for development store maps
    if (this.store.subscriptions instanceof Map) {
      for (const subscription of this.store.subscriptions.values()) {
        if (subscription.planId === planId && String(subscription.telegramUserId) === String(telegramUserId)) {
          return subscription;
        }
      }
    }
    return undefined;
  }

  /**
   * List payments recorded by the store (subscription renewals, donations, etc.).
   * @param {PaymentListFilters} [filters]
   * @returns {Promise<import('./types.js').PaymentRecord[]>}
   */
  async listPayments(filters = {}) {
    if (typeof this.store.listPayments !== 'function') {
      throw new TributeConfigurationError('SubscriptionStore.listPayments is not implemented');
    }
    return this.store.listPayments(filters);
  }

  /**
   * Cancel subscription locally (e.g. after admin action) without waiting for Tribute webhook.
   * @param {ManualCancellationOptions} options
   * @returns {Promise<SubscriptionEventResult>}
   */
  async cancelSubscriptionLocally(options) {
    const { tributeSubscriptionId, cancelReason = 'manual', cancelledAt = new Date(), payload } = options ?? {};
    if (tributeSubscriptionId === undefined || tributeSubscriptionId === null || tributeSubscriptionId === '') {
      throw new TributeConfigurationError('tributeSubscriptionId is required to cancel subscription');
    }
    const cancellationTimestamp = this.#ensureDate(cancelledAt, 'cancelledAt');
    const cancellation = {
      cancelledAt: cancellationTimestamp,
      cancelReason: cancelReason ?? null,
      payload: payload ?? undefined,
    };
    const updatedSubscription = await this.store.markSubscriptionCancelled(tributeSubscriptionId, cancellation);
    if (!updatedSubscription) {
      throw new TributeSubscriptionNotFoundError(tributeSubscriptionId);
    }
    if (!(updatedSubscription.lastEventAt instanceof Date) || updatedSubscription.lastEventAt.getTime() < cancellationTimestamp.getTime()) {
      updatedSubscription.lastEventAt = cancellationTimestamp;
    }
    const result = /** @type {SubscriptionEventResult} */ ({
      category: 'subscription',
      type: 'cancelled',
      subscription: updatedSubscription,
      context: { cancellation: { ...cancellation, source: 'manual' } },
    });
    this.emit('subscription.cancelled', result);
    this.emit('subscription.any', result);
    this.emit('event', result);
    await this.#publishEvent(result);
    return result;
  }

  /**
   * Create subscription intent after user confirmed Telegram identity.
   * @param {Object} params
   * @param {string} params.planId
   * @param {number|string} params.telegramUserId
   * @param {Object} [params.metadata]
   * @returns {Promise<{ intentId: string, subscriptionLink: string, plan: TributePlan }>}
   */
  async createSubscriptionIntent({ planId, telegramUserId, metadata = {} }) {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) {
      throw new TributePlanNotFoundError(planId);
    }
    if (telegramUserId === undefined || telegramUserId === null || telegramUserId === '') {
      throw new TributeConfigurationError('telegramUserId is required to create subscription intent');
    }

    const now = new Date();
    /** @type {SubscriptionIntent} */
    const intent = {
      id: randomUUID(),
      planId: plan.id,
      telegramUserId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.intentTtlMs),
      metadata,
    };
    await this.store.saveIntent(intent);
    this.logger?.debug?.('Tribute intent created', intent);
    return {
      intentId: intent.id,
      subscriptionLink: plan.subscriptionLink,
      plan,
    };
  }

  /**
   * Verify webhook payload and dispatch to handlers.
   * Returns undefined when event is duplicate or older than the last processed one.
   * @param {Buffer} rawBody
   * @param {string} signatureHeader
   * @returns {Promise<TributeEventResult | undefined>}
  */
  async handleWebhook(rawBody, signatureHeader) {
    const isValid = verifyTributeSignature(rawBody, signatureHeader, this.apiKey, this.signatureEncoding);
    if (!isValid) {
      throw new TributeSignatureError();
    }
    /** @type {TributeEventEnvelope} */
    const event = JSON.parse(rawBody.toString('utf8'));
    if (!this.allowedWebhookEvents.has(event.name)) {
      this.logger?.debug?.('Ignoring Tribute event disabled by configuration', event.name);
      return undefined;
    }

    switch (event.name) {
      case 'new_subscription':
        return this.#handleNewSubscription(event);
      case 'cancelled_subscription':
        return this.#handleCancelledSubscription(event);
      case 'new_donation':
        return this.#handleNewDonation(event);
      case 'recurrent_donation':
        return this.#handleRecurrentDonation(event);
      case 'cancelled_donation':
        return this.#handleCancelledDonation(event);
      default:
        this.logger?.info?.('Unhandled Tribute event', event.name);
        return undefined;
    }
  }

  /**
   * @param {string | undefined | null} value
   * @param {string} fieldName
   * @returns {Date}
   */
  #parseDate(value, fieldName) {
    if (!value) {
      throw new TributeConfigurationError(`Tribute webhook is missing required "${fieldName}" timestamp`);
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new TributeConfigurationError(`Invalid "${fieldName}" timestamp: ${value}`);
    }
    return date;
  }

  /**
   * Normalize date-like input (Date instance or ISO string).
   * @param {Date|string|number|undefined|null} value
   * @param {string} fieldName
   * @returns {Date}
   */
  #ensureDate(value, fieldName) {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new TributeConfigurationError(`Invalid Date provided for "${fieldName}"`);
      }
      return value;
    }
    if (value === undefined || value === null) {
      return new Date();
    }
    if (typeof value === 'number') {
      return this.#ensureDate(new Date(value), fieldName);
    }
    if (typeof value === 'string') {
      return this.#parseDate(value, fieldName);
    }
    throw new TributeConfigurationError(`Unsupported value for "${fieldName}"`);
  }

  /**
   * @param {TributeEventEnvelope} event
   * @returns {Date}
   */
  #getEventTimestamp(event) {
    return event.sent_at ? this.#parseDate(event.sent_at, 'sent_at') : this.#parseDate(event.created_at, 'created_at');
  }

  /**
   * @param {TributeEventEnvelope} event
   * @returns {Date}
   */
  #getEventCreatedAt(event) {
    return this.#parseDate(event.created_at, 'created_at');
  }

  /**
   * @param {Date | null | undefined} previous
   * @param {Date} incoming
   * @returns {boolean}
   */
  #isOutdatedEvent(previous, incoming) {
    if (!(previous instanceof Date)) {
      return false;
    }
    return previous.getTime() >= incoming.getTime();
  }

  /**
   * @param {string} category
   * @param {Record<string, any>} identifiers
   * @param {Date} previous
   * @param {Date} incoming
   */
  #logDuplicateEvent(category, identifiers, previous, incoming) {
    this.logger?.info?.('Ignoring duplicate Tribute event', {
      category,
      ...identifiers,
      previousAt: previous.toISOString(),
      eventAt: incoming.toISOString(),
    });
  }

  /**
   * Load plan by matching webhook payload to plan metadata.
   * @param {Record<string, any>} payload
   * @returns {TributePlan | undefined}
   */
  #findPlanForPayload(payload) {
    return this.plans.find((plan) => {
      if (plan.tributeSubscriptionId !== undefined && plan.tributeSubscriptionId !== payload.subscription_id) {
        return false;
      }
      if (plan.tributePeriodId !== undefined && plan.tributePeriodId !== payload.period_id) {
        return false;
      }
      if (plan.price !== undefined && plan.price !== payload.price) {
        return false;
      }
      if (plan.currency !== undefined && plan.currency.toLowerCase() !== String(payload.currency ?? '').toLowerCase()) {
        return false;
      }
      if (plan.period && payload.period && String(plan.period) !== String(payload.period)) {
        return false;
      }
      if (plan.amount !== undefined && plan.amount !== payload.amount && plan.amount !== payload.price) {
        return false;
      }
      return true;
    });
  }

  /**
   * @param {TributeEventEnvelope} event
   * @returns {Promise<SubscriptionEventResult>}
   */
  async #handleNewSubscription(event) {
    const payload = event.payload ?? {};
    const plan = this.#findPlanForPayload(payload);
    if (!plan) {
      this.logger?.warn?.('Plan not found for new_subscription', payload);
      throw new TributePlanNotFoundError(String(payload.subscription_id ?? payload.period_id ?? payload.price));
    }

    const eventTimestamp = this.#getEventTimestamp(event);
    const createdAt = this.#getEventCreatedAt(event);
    const existingSubscription = payload.subscription_id
      ? await this.store.getSubscriptionByTributeId(payload.subscription_id)
      : undefined;

    if (existingSubscription && this.#isOutdatedEvent(existingSubscription.lastEventAt, eventTimestamp)) {
      this.#logDuplicateEvent(
        'subscription',
        { subscriptionId: payload.subscription_id, telegramUserId: payload.telegram_user_id },
        existingSubscription.lastEventAt,
        eventTimestamp,
      );
      return undefined;
    }

    let intent;
    let intentStatus;
    if (!existingSubscription) {
      const intentId = payload.intent_id ?? payload.metadata?.intent_id; // fallback if custom integration stored id
      if (intentId) {
        intent = await this.store.consumeIntent(String(intentId));
      } else {
        this.logger?.warn?.('Intent id missing in payload; falling back to telegram id matching');
      }

      if (!intent && payload.telegram_user_id !== undefined) {
        // attempt to find intent by telegram id + plan using store helper
        intent = await this.#consumeIntentByTelegramAndPlan(payload.telegram_user_id, plan.id);
      }

      if (!intent) {
        throw new TributeIntentNotFoundError(payload.telegram_user_id, plan.id);
      }

      ({ intent, status: intentStatus } = this.#evaluateIntent(intent, plan, eventTimestamp, payload.telegram_user_id));
    }

    const expiresAt = payload.expires_at
      ? this.#parseDate(payload.expires_at, 'payload.expires_at')
      : existingSubscription?.expiresAt ?? null;

    const subscriptionRecord = /** @type {StoredSubscription} */ ({
      planId: plan.id,
      tributeSubscriptionId: payload.subscription_id,
      tributePeriodId: payload.period_id,
      telegramUserId: payload.telegram_user_id ?? existingSubscription?.telegramUserId,
      userId: payload.user_id ?? existingSubscription?.userId ?? null,
      amount: payload.price ?? payload.amount ?? plan.amount,
      currency: payload.currency ?? plan.currency,
      period: payload.period ?? plan.period,
      status: 'active',
      createdAt: existingSubscription?.createdAt ?? createdAt,
      lastEventAt: eventTimestamp,
      expiresAt,
      cancelledAt: null,
      cancelReason: null,
      metadata: existingSubscription?.metadata ?? intent?.metadata ?? plan.metadata ?? {},
    });

    const { previous } = await this.store.upsertSubscription(subscriptionRecord);
    await this.store.recordPayment({
      kind: 'subscription',
      tributeSubscriptionId: subscriptionRecord.tributeSubscriptionId,
      planId: subscriptionRecord.planId,
      telegramUserId: subscriptionRecord.telegramUserId,
      userId: payload.user_id ?? existingSubscription?.userId,
      amount: subscriptionRecord.amount,
      currency: subscriptionRecord.currency,
      paidAt: createdAt,
      payload,
    });

    const context = { event };
    if (intent) {
      context.intent = intent;
      context.intentStatus = intentStatus ?? 'matched';
    }
    if (previous) {
      context.previousSubscription = previous;
    }

    const result = /** @type {SubscriptionEventResult} */ ({
      category: 'subscription',
      type: previous ? 'renewed' : 'created',
      subscription: subscriptionRecord,
      context,
    });

    this.emit(`subscription.${result.type}`, result);
    this.emit('subscription.any', result);
    this.emit('event', result);
    await this.#publishEvent(result);
    return result;
  }

  /**
   * @param {TributeEventEnvelope} event
   * @returns {Promise<SubscriptionEventResult>}
   */
  async #handleCancelledSubscription(event) {
    const payload = event.payload ?? {};
    const plan = this.#findPlanForPayload(payload);
    if (!plan) {
      this.logger?.warn?.('Plan not found for cancelled_subscription', payload);
      throw new TributePlanNotFoundError(String(payload.subscription_id ?? payload.period_id ?? payload.price));
    }
    const eventTimestamp = this.#getEventTimestamp(event);
    const cancellationAt = this.#getEventCreatedAt(event);
    const existingSubscription = payload.subscription_id
      ? await this.store.getSubscriptionByTributeId(payload.subscription_id)
      : undefined;

    if (existingSubscription) {
      if (
        existingSubscription.cancelledAt instanceof Date &&
        this.#isOutdatedEvent(existingSubscription.cancelledAt, cancellationAt)
      ) {
        this.#logDuplicateEvent(
          'subscription.cancelled',
          { subscriptionId: payload.subscription_id, telegramUserId: payload.telegram_user_id },
          existingSubscription.cancelledAt,
          cancellationAt,
        );
        return undefined;
      }
      if (this.#isOutdatedEvent(existingSubscription.lastEventAt, eventTimestamp)) {
        this.#logDuplicateEvent(
          'subscription.cancelled',
          { subscriptionId: payload.subscription_id, telegramUserId: payload.telegram_user_id },
          existingSubscription.lastEventAt,
          eventTimestamp,
        );
        return undefined;
      }
    }
    const cancellation = {
      cancelledAt: cancellationAt,
      cancelReason: payload.cancel_reason ?? null,
      payload: { ...payload, sent_at: event.sent_at },
    };
    const updatedSubscription = await this.store.markSubscriptionCancelled(payload.subscription_id, cancellation);
    if (!updatedSubscription) {
      throw new TributeSubscriptionNotFoundError(payload.subscription_id);
    }

    if (!(updatedSubscription.lastEventAt instanceof Date) || updatedSubscription.lastEventAt.getTime() < eventTimestamp.getTime()) {
      updatedSubscription.lastEventAt = eventTimestamp;
    }

    const result = /** @type {SubscriptionEventResult} */ ({
      category: 'subscription',
      type: 'cancelled',
      subscription: updatedSubscription,
      context: { cancellation, event },
    });
    this.emit('subscription.cancelled', result);
    this.emit('subscription.any', result);
    this.emit('event', result);
    await this.#publishEvent(result);
    return result;
  }

  /**
   * @param {TributeEventEnvelope} event
   * @returns {Promise<DonationEventResult>}
   */
  async #handleNewDonation(event) {
    const payload = event.payload ?? {};
    const donationRequestId = payload.donation_request_id;
    if (donationRequestId === undefined || donationRequestId === null) {
      throw new TributeConfigurationError('donation_request_id is required for donation events');
    }
    if (payload.telegram_user_id === undefined || payload.telegram_user_id === null) {
      throw new TributeConfigurationError('telegram_user_id is required for donation events');
    }

    const existing = await this.store.getDonationByRequestId(donationRequestId);
    const period = payload.period ?? existing?.period ?? 'once';
    const eventTimestamp = this.#getEventTimestamp(event);
    const createdAt = existing?.createdAt ?? this.#getEventCreatedAt(event);

    if (existing && this.#isOutdatedEvent(existing.lastEventAt, eventTimestamp)) {
      this.#logDuplicateEvent(
        'donation',
        { donationRequestId },
        existing.lastEventAt,
        eventTimestamp,
      );
      return undefined;
    }

    const donationRecord = /** @type {StoredDonation} */ ({
      donationRequestId,
      donationName: payload.donation_name ?? existing?.donationName ?? '',
      telegramUserId: payload.telegram_user_id ?? existing?.telegramUserId,
      userId: payload.user_id ?? existing?.userId ?? null,
      period,
      amount: payload.amount ?? existing?.amount ?? 0,
      currency: payload.currency ?? existing?.currency ?? '',
      anonymously:
        typeof payload.anonymously === 'boolean'
          ? payload.anonymously
          : existing?.anonymously ?? false,
      message: payload.message ?? existing?.message ?? null,
      webAppLink: payload.web_app_link ?? existing?.webAppLink ?? null,
      status: period === 'once' ? 'completed' : 'active',
      createdAt,
      lastEventAt: eventTimestamp,
      cancelledAt: null,
      metadata: existing?.metadata ?? {},
    });

    await this.store.upsertDonation(donationRecord);
    await this.store.recordPayment({
      kind: 'donation',
      donationRequestId,
      telegramUserId: donationRecord.telegramUserId,
      userId: donationRecord.userId ?? undefined,
      amount: donationRecord.amount,
      currency: donationRecord.currency,
      paidAt: createdAt,
      payload,
    });

    const result = /** @type {DonationEventResult} */ ({
      category: 'donation',
      type: 'created',
      donation: donationRecord,
      context: { event },
    });

    this.emit('donation.created', result);
    this.emit('donation.any', result);
    this.emit('event', result);
    await this.#publishEvent(result);
    return result;
  }

  /**
   * @param {TributeEventEnvelope} event
   * @returns {Promise<DonationEventResult>}
   */
  async #handleRecurrentDonation(event) {
    const payload = event.payload ?? {};
    const donationRequestId = payload.donation_request_id;
    if (donationRequestId === undefined || donationRequestId === null) {
      throw new TributeConfigurationError('donation_request_id is required for donation events');
    }
    if (payload.telegram_user_id === undefined || payload.telegram_user_id === null) {
      throw new TributeConfigurationError('telegram_user_id is required for donation events');
    }

    const existing = await this.store.getDonationByRequestId(donationRequestId);
    if (!existing) {
      this.logger?.warn?.('Donation not found for recurrent_donation, creating new record', payload);
    }
    const eventTimestamp = this.#getEventTimestamp(event);
    const createdAt = existing?.createdAt ?? this.#getEventCreatedAt(event);

    if (existing && this.#isOutdatedEvent(existing.lastEventAt, eventTimestamp)) {
      this.#logDuplicateEvent(
        'donation.recurrent',
        { donationRequestId },
        existing.lastEventAt,
        eventTimestamp,
      );
      return undefined;
    }

    const donationRecord = /** @type {StoredDonation} */ ({
      donationRequestId,
      donationName: payload.donation_name ?? existing?.donationName ?? '',
      telegramUserId: payload.telegram_user_id ?? existing?.telegramUserId,
      userId: payload.user_id ?? existing?.userId ?? null,
      period: payload.period ?? existing?.period ?? 'monthly',
      amount: payload.amount ?? existing?.amount ?? 0,
      currency: payload.currency ?? existing?.currency ?? '',
      anonymously:
        typeof payload.anonymously === 'boolean'
          ? payload.anonymously
          : existing?.anonymously ?? false,
      message: existing?.message ?? (payload.message ?? null),
      webAppLink: payload.web_app_link ?? existing?.webAppLink ?? null,
      status: existing?.status === 'cancelled' ? 'cancelled' : 'active',
      createdAt,
      lastEventAt: eventTimestamp,
      cancelledAt: existing?.cancelledAt ?? null,
      metadata: existing?.metadata ?? {},
    });

    await this.store.upsertDonation(donationRecord);
    await this.store.recordPayment({
      kind: 'donation',
      donationRequestId,
      telegramUserId: donationRecord.telegramUserId,
      userId: donationRecord.userId ?? undefined,
      amount: donationRecord.amount,
      currency: donationRecord.currency,
      paidAt: createdAt,
      payload,
    });

    const result = /** @type {DonationEventResult} */ ({
      category: 'donation',
      type: 'recurrent',
      donation: donationRecord,
      context: { event },
    });

    this.emit('donation.recurrent', result);
    this.emit('donation.any', result);
    this.emit('event', result);
    await this.#publishEvent(result);
    return result;
  }

  /**
   * @param {TributeEventEnvelope} event
   * @returns {Promise<DonationEventResult>}
   */
  async #handleCancelledDonation(event) {
    const payload = event.payload ?? {};
    const donationRequestId = payload.donation_request_id;
    if (donationRequestId === undefined || donationRequestId === null) {
      throw new TributeConfigurationError('donation_request_id is required for donation events');
    }
    const eventTimestamp = this.#getEventTimestamp(event);
    const cancelledAt = this.#getEventCreatedAt(event);
    const existing = await this.store.getDonationByRequestId(donationRequestId);

    if (existing) {
      if (existing.cancelledAt instanceof Date && this.#isOutdatedEvent(existing.cancelledAt, cancelledAt)) {
        this.#logDuplicateEvent(
          'donation.cancelled',
          { donationRequestId },
          existing.cancelledAt,
          cancelledAt,
        );
        return undefined;
      }
      if (this.#isOutdatedEvent(existing.lastEventAt, eventTimestamp)) {
        this.#logDuplicateEvent(
          'donation.cancelled',
          { donationRequestId },
          existing.lastEventAt,
          eventTimestamp,
        );
        return undefined;
      }
    }

    const cancellation = { cancelledAt, payload: { ...payload, sent_at: event.sent_at } };
    const donation = await this.store.markDonationCancelled(donationRequestId, cancellation);
    if (!donation) {
      throw new TributeDonationNotFoundError(donationRequestId);
    }

    if (!(donation.lastEventAt instanceof Date) || donation.lastEventAt.getTime() < eventTimestamp.getTime()) {
      donation.lastEventAt = eventTimestamp;
    }

    const result = /** @type {DonationEventResult} */ ({
      category: 'donation',
      type: 'cancelled',
      donation,
      context: { cancellation, event },
    });
    this.emit('donation.cancelled', result);
    this.emit('donation.any', result);
    this.emit('event', result);
    await this.#publishEvent(result);
    return result;
  }

  /**
   * Forward processed event to optional external publisher.
   * @param {TributeEventResult} result
   */
  async #publishEvent(result) {
    if (!this.eventPublisher) {
      return;
    }
    try {
      await this.eventPublisher(result);
    } catch (error) {
      this.logger?.error?.('Tribute event publisher failed', {
        category: result.category,
        type: result.type,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
      if (this.eventPublisherFailureMode === 'throw') {
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
  }


  async #consumeIntentByTelegramAndPlan(telegramUserId, planId) {
    // fallback for stores that expose intents map (e.g. in-memory) or implement search method.
    if (typeof this.store.consumeIntentByTelegramAndPlan === 'function') {
      return this.store.consumeIntentByTelegramAndPlan(telegramUserId, planId);
    }
    // If store exposes intents Map (dev mode) we can scan it.
    if (this.store.intents instanceof Map) {
      const now = Date.now();
      for (const [intentId, intent] of this.store.intents.entries()) {
        if (intent.planId === planId && String(intent.telegramUserId) === String(telegramUserId)) {
          if (intent.expiresAt.getTime() < now) {
            this.store.intents.delete(intentId);
            continue;
          }
          this.store.intents.delete(intentId);
          return intent;
        }
      }
    }
    return undefined;
  }

  #evaluateIntent(intent, plan, eventTimestamp, telegramUserId) {
    let status = 'matched';
    if (intent.expiresAt instanceof Date && intent.expiresAt.getTime() < eventTimestamp.getTime()) {
      status = 'expired';
      this.logger?.warn?.('Tribute intent expired before webhook', {
        intentId: intent.id,
        planId: plan.id,
        expiresAt: intent.expiresAt,
        eventTimestamp,
      });
    }
    if (intent.planId && intent.planId !== plan.id) {
      this.logger?.warn?.('Intent plan mismatch detected', { intentPlanId: intent.planId, webhookPlanId: plan.id });
    }
    if (telegramUserId !== undefined && telegramUserId !== null) {
      if (String(intent.telegramUserId) !== String(telegramUserId)) {
        this.logger?.warn?.('Intent telegram user mismatch detected', {
          intentTelegramUserId: intent.telegramUserId,
          webhookTelegramUserId: telegramUserId,
        });
      }
    }
    return { intent, status };
  }
}
