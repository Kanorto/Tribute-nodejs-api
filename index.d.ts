import { EventEmitter } from 'node:events';
import type { Buffer } from 'node:buffer';

export type TributeWebhookBody = Buffer | ArrayBuffer | ArrayBufferView | string;

export interface TributeConfigFsLike {
  readFileSync(path: string, encoding: 'utf8'): string | Buffer;
  existsSync(path: string): boolean;
}

export interface TributePlan {
  id: string;
  title: string;
  amount: number;
  currency: string;
  period: string;
  subscriptionLink: string;
  tributeSubscriptionId?: string | number;
  tributePeriodId?: string | number;
  price?: number;
  metadata?: Record<string, any>;
}

export interface SubscriptionIntent {
  id: string;
  planId: string;
  telegramUserId: string | number;
  createdAt: Date;
  expiresAt: Date;
  metadata?: Record<string, any>;
}

export interface StoredSubscription {
  planId: string;
  tributeSubscriptionId: string | number;
  tributePeriodId: string | number;
  telegramUserId: string | number;
  userId?: string | number | null;
  amount: number;
  currency: string;
  period: string;
  status: 'pending' | 'active' | 'cancelled';
  createdAt: Date;
  lastEventAt: Date;
  expiresAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  metadata?: Record<string, any>;
}

export type PaymentKind = 'subscription' | 'donation';

export interface PaymentRecord {
  kind: PaymentKind;
  tributeSubscriptionId?: string | number;
  planId?: string;
  donationRequestId?: string | number;
  telegramUserId: string | number;
  userId?: string | number | null;
  amount: number;
  currency: string;
  paidAt: Date;
  payload?: Record<string, any>;
}

export interface PaymentListFilters {
  telegramUserId?: string | number;
  kind?: PaymentKind | PaymentKind[];
  since?: Date | string | number;
  until?: Date | string | number;
  limit?: number;
}

export interface CancellationRecord {
  cancelledAt: Date;
  cancelReason?: string | null;
  payload?: Record<string, any>;
}

export interface StoredDonation {
  donationRequestId: string | number;
  donationName: string;
  telegramUserId: string | number;
  userId: string | number | null;
  period: string;
  amount: number;
  currency: string;
  anonymously: boolean;
  message: string | null;
  webAppLink: string | null;
  status: 'completed' | 'active' | 'cancelled';
  createdAt: Date;
  lastEventAt: Date;
  cancelledAt: Date | null;
  metadata?: Record<string, any>;
}

export interface DonationCancellationRecord {
  cancelledAt: Date;
  payload?: Record<string, any>;
}

export interface TributeEventEnvelope {
  name: string;
  created_at: string;
  sent_at: string;
  payload: Record<string, any>;
}

export interface SubscriptionEventContext extends Record<string, any> {
  intent?: SubscriptionIntent;
  intentStatus?: 'matched' | 'expired';
  previousSubscription?: StoredSubscription;
  cancellation?: Record<string, any>;
  event?: TributeEventEnvelope;
}

export interface SubscriptionEventResult {
  category: 'subscription';
  type: 'created' | 'renewed' | 'cancelled';
  subscription: StoredSubscription;
  context?: SubscriptionEventContext;
}

export interface DonationEventResult {
  category: 'donation';
  type: 'created' | 'recurrent' | 'cancelled';
  donation: StoredDonation;
  context?: Record<string, any>;
}

export type TributeEventResult = SubscriptionEventResult | DonationEventResult;

export abstract class SubscriptionStore {
  saveIntent(intent: SubscriptionIntent): Promise<void>;
  getIntentById(intentId: string): Promise<SubscriptionIntent | undefined>;
  consumeIntent(intentId: string): Promise<SubscriptionIntent | undefined>;
  upsertSubscription(subscription: StoredSubscription): Promise<{ previous?: StoredSubscription }>;
  getSubscriptionByTributeId(tributeSubscriptionId: string | number): Promise<StoredSubscription | undefined>;
  getSubscriptionByTelegramAndPlan(
    telegramUserId: string | number,
    planId: string
  ): Promise<StoredSubscription | undefined>;
  markSubscriptionCancelled(
    tributeSubscriptionId: string | number,
    cancellation: CancellationRecord
  ): Promise<StoredSubscription | undefined>;
  recordPayment(payment: PaymentRecord): Promise<void>;
  listPayments(filters?: PaymentListFilters): Promise<PaymentRecord[]>;
  upsertDonation(donation: StoredDonation): Promise<{ previous?: StoredDonation }>;
  getDonationByRequestId(donationRequestId: string | number): Promise<StoredDonation | undefined>;
  markDonationCancelled(
    donationRequestId: string | number,
    cancellation: DonationCancellationRecord
  ): Promise<StoredDonation | undefined>;
  consumeIntentByTelegramAndPlan?(telegramUserId: string | number, planId: string): Promise<SubscriptionIntent | undefined>;
}

export class InMemorySubscriptionStore extends SubscriptionStore {}

export interface TributeSubscriptionManagerOptions {
  plans: TributePlan[];
  apiKey: string;
  store: SubscriptionStore;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> | Console;
  intentTtlMs?: number;
  signatureEncoding?: 'hex' | 'base64';
  allowedWebhookEvents?: string[];
  eventPublisher?: (event: TributeEventResult) => void | Promise<void>;
  eventPublisherFailureMode?: 'throw' | 'log';
}

export interface TributeConfigOverrides {
  plans?: TributePlan[];
  plansJson?: string | Record<string, any>;
  plansFile?: string;
  apiKey?: string;
  intentTtlMs?: number;
  intentTtlMinutes?: number;
  signatureEncoding?: 'hex' | 'base64';
  allowDonations?: boolean;
  allowedWebhookEvents?: string[];
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> | Console;
  store?: SubscriptionStore;
  eventPublisher?: (event: TributeEventResult) => void | Promise<void>;
  eventPublisherFailureMode?: 'throw' | 'log';
}

export interface TributeConfigOptions {
  env?: Record<string, string | undefined>;
  fs?: TributeConfigFsLike;
}

export interface ManualCancellationOptions {
  tributeSubscriptionId: string | number;
  cancelReason?: string | null;
  cancelledAt?: Date | string | number;
  payload?: Record<string, any>;
}

export class TributeSubscriptionManager extends EventEmitter {
  constructor(options: TributeSubscriptionManagerOptions);
  listPlans(): Array<Pick<TributePlan, 'id' | 'title' | 'amount' | 'currency' | 'period' | 'subscriptionLink' | 'metadata'>>;
  getIntentById(intentId: string): Promise<SubscriptionIntent | undefined>;
  getSubscriptionByTributeId(tributeSubscriptionId: string | number): Promise<StoredSubscription | undefined>;
  getSubscriptionForUser(params: { telegramUserId: string | number; planId: string; }): Promise<StoredSubscription | undefined>;
  listPayments(filters?: PaymentListFilters): Promise<PaymentRecord[]>;
  cancelSubscriptionLocally(options: ManualCancellationOptions): Promise<SubscriptionEventResult>;
  createSubscriptionIntent(params: { planId: string; telegramUserId: string | number; metadata?: Record<string, any> }): Promise<{ 
    intentId: string;
    intentExpiresAt: Date;
    subscriptionLink: string;
    plan: TributePlan;
  }>;
  /**
   * Обрабатывает вебхук Tribute. Возвращает `undefined`, если событие устаревшее или повторное.
   */
  handleWebhook(rawBody: TributeWebhookBody, signatureHeader: string | undefined | null): Promise<TributeEventResult | undefined>;
}

export function createTributeConfig(
  overrides?: TributeConfigOverrides,
  options?: TributeConfigOptions
): Omit<TributeSubscriptionManagerOptions, 'store'> & { store?: SubscriptionStore };

export class TributeSignatureError extends Error {}
export class TributeConfigurationError extends Error {}
export class TributePlanNotFoundError extends Error { planId: string; }
export class TributeIntentNotFoundError extends Error { telegramUserId: string | number; planId: string; }
export class TributeSubscriptionNotFoundError extends Error { subscriptionId: string | number; }
export class TributeDonationNotFoundError extends Error { donationRequestId: string | number; }

export function verifyTributeSignature(rawBody: TributeWebhookBody, signatureHeader: string | undefined | null, apiKey: string, encoding?: 'hex' | 'base64'): boolean;
