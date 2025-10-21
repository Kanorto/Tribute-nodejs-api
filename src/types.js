/**
 * @typedef {Object} TributePlan
 * @property {string} id - Internal plan identifier.
 * @property {string} title
 * @property {number} amount - Amount in the smallest currency unit (e.g. cents).
 * @property {string} currency - Currency code.
 * @property {"monthly"|"yearly"|string} period
 * @property {string} subscriptionLink - Pre-created Tribute subscription link.
 * @property {number|string} [tributeSubscriptionId] - Expected Tribute subscription identifier.
 * @property {number|string} [tributePeriodId] - Expected Tribute period identifier.
 * @property {number} [price] - Convenience alias for Tribute's `price` field (if different from amount).
 * @property {Object} [metadata]
 */

/**
 * @typedef {Object} SubscriptionIntent
 * @property {string} id
 * @property {string} planId
 * @property {number|string} telegramUserId
 * @property {Date} createdAt
 * @property {Date} expiresAt
 * @property {Object} [metadata]
 */

/**
 * @typedef {Object} StoredSubscription
 * @property {string} planId
 * @property {number|string} tributeSubscriptionId
 * @property {number|string} tributePeriodId
 * @property {number|string} telegramUserId
 * @property {number|string|null} [userId]
 * @property {number} amount
 * @property {string} currency
 * @property {string} period
 * @property {'pending'|'active'|'cancelled'} status
 * @property {Date} createdAt
 * @property {Date} lastEventAt
 * @property {Date|null} expiresAt
 * @property {Date|null} cancelledAt
 * @property {string|null} cancelReason
 * @property {Object} [metadata]
 */

/**
 * @typedef {'subscription'|'donation'} PaymentKind
 */

/**
 * @typedef {Object} PaymentRecord
 * @property {PaymentKind} kind
 * @property {number|string|undefined} [tributeSubscriptionId]
 * @property {string|undefined} [planId]
 * @property {number|string|undefined} [donationRequestId]
 * @property {number|string} telegramUserId
 * @property {number|string|undefined} [userId]
 * @property {number} amount
 * @property {string} currency
 * @property {Date} paidAt
 * @property {Object} [payload]
 */

/**
 * @typedef {Object} PaymentListFilters
 * @property {number|string} [telegramUserId]
 * @property {PaymentKind|PaymentKind[]} [kind]
 * @property {Date|string|number} [since]
 * @property {Date|string|number} [until]
 * @property {number} [limit]
 */

/**
 * @typedef {Object} CancellationRecord
 * @property {Date} cancelledAt
 * @property {string|null} [cancelReason]
 * @property {Object} [payload]
 */

/**
 * @typedef {Object} StoredDonation
 * @property {number|string} donationRequestId
 * @property {string} donationName
 * @property {number|string} telegramUserId
 * @property {number|string|null} userId
 * @property {string} period
 * @property {number} amount
 * @property {string} currency
 * @property {boolean} anonymously
 * @property {string|null} message
 * @property {string|null} webAppLink
 * @property {'completed'|'active'|'cancelled'} status
 * @property {Date} createdAt
 * @property {Date} lastEventAt
 * @property {Date|null} cancelledAt
 * @property {Object} [metadata]
 */

/**
 * @typedef {Object} DonationCancellationRecord
 * @property {Date} cancelledAt
 * @property {Object} [payload]
 */

/**
 * @typedef {Object} TributeEventEnvelope
 * @property {string} name
 * @property {string} created_at
 * @property {string} sent_at
 * @property {Record<string, any>} payload
 */

/**
 * @typedef {Object} SubscriptionEventResult
 * @property {'subscription'} category
 * @property {"created"|"renewed"|"cancelled"} type
 * @property {StoredSubscription} subscription
 * @property {{ intent?: SubscriptionIntent, intentStatus?: 'matched'|'expired', previousSubscription?: StoredSubscription, cancellation?: any, event?: TributeEventEnvelope }} [context]
 */

/**
 * @typedef {Object} DonationEventResult
 * @property {'donation'} category
 * @property {'created'|'recurrent'|'cancelled'} type
 * @property {StoredDonation} donation
 * @property {Object} [context]
 */

/**
 * @typedef {SubscriptionEventResult | DonationEventResult} TributeEventResult
 */

/**
 * @typedef {Object} ManualCancellationOptions
 * @property {number|string} tributeSubscriptionId
 * @property {string|null} [cancelReason]
 * @property {Date|string|number} [cancelledAt]
 * @property {Object} [payload]
 */

export const __types = {};
