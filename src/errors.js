export class TributeSignatureError extends Error {
  constructor(message = 'Invalid Tribute webhook signature') {
    super(message);
    this.name = 'TributeSignatureError';
  }
}

export class TributeConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TributeConfigurationError';
  }
}

export class TributePlanNotFoundError extends Error {
  constructor(planId) {
    super(`Subscription plan with id "${planId}" was not found`);
    this.name = 'TributePlanNotFoundError';
    this.planId = planId;
  }
}

export class TributeIntentNotFoundError extends Error {
  constructor(telegramUserId, planId) {
    super(`Pending intent was not found for telegramUserId=${telegramUserId} planId=${planId}`);
    this.name = 'TributeIntentNotFoundError';
    this.telegramUserId = telegramUserId;
    this.planId = planId;
  }
}

export class TributeSubscriptionNotFoundError extends Error {
  constructor(subscriptionId) {
    super(`Subscription with Tribute id "${subscriptionId}" was not found`);
    this.name = 'TributeSubscriptionNotFoundError';
    this.subscriptionId = subscriptionId;
  }
}

export class TributeDonationNotFoundError extends Error {
  constructor(donationRequestId) {
    super(`Donation with request id "${donationRequestId}" was not found`);
    this.name = 'TributeDonationNotFoundError';
    this.donationRequestId = donationRequestId;
  }
}

