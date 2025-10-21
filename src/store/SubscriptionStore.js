/**
 * Abstract storage used by TributeSubscriptionManager to persist subscriptions and intents.
 * Implement this interface to hook the module into your billing system.
 */
export class SubscriptionStore {
  /**
   * Persist a newly created subscription intent.
   * @param {import('../types.js').SubscriptionIntent} intent
   * @returns {Promise<void>}
   */
  async saveIntent(intent) {
    throw new Error('saveIntent is not implemented');
  }

  /**
   * Load an intent by its id.
   * @param {string} intentId
   * @returns {Promise<import('../types.js').SubscriptionIntent | undefined>}
   */
  async getIntentById(intentId) {
    throw new Error('getIntentById is not implemented');
  }

  /**
   * Consume (delete) an intent by its id.
   * @param {string} intentId
   * @returns {Promise<import('../types.js').SubscriptionIntent | undefined>}
   */
  async consumeIntent(intentId) {
    throw new Error('consumeIntent is not implemented');
  }

  /**
   * Optionally consume intent by telegram id + plan id pair.
   * Override for efficient lookups in persistent stores.
   * @param {number|string} telegramUserId
   * @param {string} planId
   * @returns {Promise<import('../types.js').SubscriptionIntent | undefined>}
   */
  async consumeIntentByTelegramAndPlan(telegramUserId, planId) {
    void telegramUserId;
    void planId;
    return undefined;
  }

  /**
   * Persist subscription state.
   * @param {import('../types.js').StoredSubscription} subscription
   * @returns {Promise<{ previous?: import('../types.js').StoredSubscription }>} - previous state if existed
   */
  async upsertSubscription(subscription) {
    throw new Error('upsertSubscription is not implemented');
  }

  /**
   * Load subscription by Tribute subscription id if supported.
   * @param {number|string} tributeSubscriptionId
   * @returns {Promise<import('../types.js').StoredSubscription | undefined>}
   */
  async getSubscriptionByTributeId(tributeSubscriptionId) {
    void tributeSubscriptionId;
    return undefined;
  }

  /**
   * Load subscription by telegram user id and plan id if supported.
   * @param {number|string} telegramUserId
   * @param {string} planId
   * @returns {Promise<import('../types.js').StoredSubscription | undefined>}
   */
  async getSubscriptionByTelegramAndPlan(telegramUserId, planId) {
    void telegramUserId;
    void planId;
    return undefined;
  }

  /**
   * Mark subscription as cancelled.
   * @param {number|string} tributeSubscriptionId
   * @param {import('../types.js').CancellationRecord} cancellation
   * @returns {Promise<import('../types.js').StoredSubscription | undefined>}
   */
  async markSubscriptionCancelled(tributeSubscriptionId, cancellation) {
    throw new Error('markSubscriptionCancelled is not implemented');
  }

  /**
   * Store payment record.
   * @param {import('../types.js').PaymentRecord} payment
   * @returns {Promise<void>}
   */
  async recordPayment(payment) {
    throw new Error('recordPayment is not implemented');
  }

  /**
   * List stored payments.
   * @param {import('../types.js').PaymentListFilters} filters
   * @returns {Promise<import('../types.js').PaymentRecord[]>}
   */
  async listPayments(filters = {}) {
    void filters;
    throw new Error('listPayments is not implemented');
  }

  /**
   * Store or update donation information.
   * @param {import('../types.js').StoredDonation} donation
   * @returns {Promise<{ previous?: import('../types.js').StoredDonation }>}
   */
  async upsertDonation(donation) {
    throw new Error('upsertDonation is not implemented');
  }

  /**
   * Load donation by donation request id if supported.
   * @param {number|string} donationRequestId
   * @returns {Promise<import('../types.js').StoredDonation | undefined>}
   */
  async getDonationByRequestId(donationRequestId) {
    void donationRequestId;
    return undefined;
  }

  /**
   * Mark donation as cancelled.
   * @param {number|string} donationRequestId
   * @param {import('../types.js').DonationCancellationRecord} cancellation
   * @returns {Promise<import('../types.js').StoredDonation | undefined>}
   */
  async markDonationCancelled(donationRequestId, cancellation) {
    void donationRequestId;
    void cancellation;
    throw new Error('markDonationCancelled is not implemented');
  }

}
