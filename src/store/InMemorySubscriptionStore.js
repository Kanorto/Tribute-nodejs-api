import { SubscriptionStore } from './SubscriptionStore.js';

/**
 * @typedef {import('../types.js').SubscriptionIntent} SubscriptionIntent
 * @typedef {import('../types.js').StoredSubscription} StoredSubscription
 * @typedef {import('../types.js').PaymentRecord} PaymentRecord
 * @typedef {import('../types.js').CancellationRecord} CancellationRecord
 */

/**
 * In-memory store for development and tests. Not persistent.
 */
export class InMemorySubscriptionStore extends SubscriptionStore {
  constructor() {
    super();
    /** @type {Map<string, SubscriptionIntent>} */
    this.intents = new Map();
    /** @type {Map<string|number, StoredSubscription>} */
    this.subscriptions = new Map();
    /** @type {PaymentRecord[]} */
    this.payments = [];
    /** @type {Map<string|number, import('../types.js').StoredDonation>} */
    this.donations = new Map();
  }

  async saveIntent(intent) {
    this.intents.set(intent.id, intent);
  }

  async getIntentById(intentId) {
    return this.intents.get(intentId);
  }

  async consumeIntent(intentId) {
    const intent = this.intents.get(intentId);
    this.intents.delete(intentId);
    return intent;
  }

  async consumeIntentByTelegramAndPlan(telegramUserId, planId) {
    const now = Date.now();
    for (const [intentId, intent] of this.intents.entries()) {
      if (intent.planId === planId && String(intent.telegramUserId) === String(telegramUserId)) {
        if (intent.expiresAt.getTime() < now) {
          this.intents.delete(intentId);
          continue;
        }
        this.intents.delete(intentId);
        return intent;
      }
    }
    return undefined;
  }

  async upsertSubscription(subscription) {
    const previous = this.subscriptions.get(subscription.tributeSubscriptionId);
    this.subscriptions.set(subscription.tributeSubscriptionId, subscription);
    return { previous };
  }

  async getSubscriptionByTributeId(tributeSubscriptionId) {
    return this.subscriptions.get(tributeSubscriptionId);
  }

  async getSubscriptionByTelegramAndPlan(telegramUserId, planId) {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.planId === planId && String(subscription.telegramUserId) === String(telegramUserId)) {
        return subscription;
      }
    }
    return undefined;
  }

  async markSubscriptionCancelled(tributeSubscriptionId, cancellation) {
    const subscription = this.subscriptions.get(tributeSubscriptionId);
    if (!subscription) {
      return undefined;
    }
    const lastEventAt = cancellation.payload?.sent_at
      ? (() => {
          const parsed = new Date(cancellation.payload.sent_at);
          return Number.isNaN(parsed.getTime()) ? cancellation.cancelledAt : parsed;
        })()
      : cancellation.cancelledAt;
    const updated = {
      ...subscription,
      status: 'cancelled',
      cancelledAt: cancellation.cancelledAt,
      cancelReason: cancellation.cancelReason ?? null,
      lastEventAt,
    };
    this.subscriptions.set(tributeSubscriptionId, updated);
    return updated;
  }

  async recordPayment(payment) {
    this.payments.push(payment);
  }

  async listPayments(filters = {}) {
    const kinds = Array.isArray(filters.kind)
      ? filters.kind
      : filters.kind
      ? [filters.kind]
      : undefined;
    const toDate = (value) => {
      if (value === undefined || value === null) {
        return undefined;
      }
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date;
    };
    const since = toDate(filters.since);
    const until = toDate(filters.until);

    const filtered = this.payments.filter((payment) => {
      if (filters.telegramUserId !== undefined && filters.telegramUserId !== null) {
        if (String(payment.telegramUserId) !== String(filters.telegramUserId)) {
          return false;
        }
      }
      if (kinds && !kinds.includes(payment.kind)) {
        return false;
      }
      if (since && payment.paidAt < since) {
        return false;
      }
      if (until && payment.paidAt > until) {
        return false;
      }
      return true;
    });

    filtered.sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
    const limited = typeof filters.limit === 'number' && filters.limit > 0 ? filtered.slice(0, filters.limit) : filtered;
    return limited.map((payment) => ({ ...payment }));
  }

  async upsertDonation(donation) {
    const key = donation.donationRequestId;
    const previous = this.donations.get(key);
    this.donations.set(key, donation);
    return { previous };
  }

  async getDonationByRequestId(donationRequestId) {
    return this.donations.get(donationRequestId);
  }

  async markDonationCancelled(donationRequestId, cancellation) {
    const existing = this.donations.get(donationRequestId);
    if (!existing) {
      return undefined;
    }
    const lastEventAt = cancellation.payload?.sent_at
      ? (() => {
          const parsed = new Date(cancellation.payload.sent_at);
          return Number.isNaN(parsed.getTime()) ? cancellation.cancelledAt : parsed;
        })()
      : cancellation.cancelledAt;
    const updated = {
      ...existing,
      status: 'cancelled',
      cancelledAt: cancellation.cancelledAt,
      lastEventAt,
    };
    this.donations.set(donationRequestId, updated);
    return updated;
  }

}
