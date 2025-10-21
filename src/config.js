import fs from 'node:fs';
import path from 'node:path';
import { TributeConfigurationError } from './errors.js';

const DEFAULT_INTENT_TTL_MINUTES = 15;
const SUPPORTED_SIGNATURE_ENCODINGS = ['hex', 'base64'];
const SUBSCRIPTION_EVENTS = ['new_subscription', 'cancelled_subscription'];
const DONATION_EVENTS = ['new_donation', 'recurrent_donation', 'cancelled_donation'];
const EVENT_PUBLISHER_FAILURE_MODES = ['throw', 'log'];

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  throw new TributeConfigurationError(`Cannot interpret boolean value from "${value}"`);
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new TributeConfigurationError(`Expected non-negative number, got "${value}"`);
  }
  return numberValue;
}

function loadPlansFromJson(json, source) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (error) {
    throw new TributeConfigurationError(`Failed to parse plans from ${source}: ${error instanceof Error ? error.message : error}`);
  }
  if (!Array.isArray(data)) {
    throw new TributeConfigurationError(`Plans in ${source} must be an array`);
  }
  data.forEach((plan, index) => {
    if (!plan || typeof plan !== 'object') {
      throw new TributeConfigurationError(`Plan at index ${index} in ${source} must be an object`);
    }
    if (!plan.id) {
      throw new TributeConfigurationError(`Plan at index ${index} in ${source} is missing required "id"`);
    }
    if (!plan.subscriptionLink) {
      throw new TributeConfigurationError(`Plan ${plan.id} in ${source} is missing required "subscriptionLink"`);
    }
    if (typeof plan.amount !== 'number' || plan.amount <= 0) {
      throw new TributeConfigurationError(`Plan ${plan.id} in ${source} must define positive numeric "amount"`);
    }
    if (!plan.currency) {
      throw new TributeConfigurationError(`Plan ${plan.id} in ${source} must define "currency"`);
    }
    if (!plan.period) {
      throw new TributeConfigurationError(`Plan ${plan.id} in ${source} must define "period"`);
    }
  });
  return data;
}

function loadPlans({ overrides, env, fsModule }) {
  if (Array.isArray(overrides.plans) && overrides.plans.length > 0) {
    return overrides.plans;
  }
  if (overrides.plansJson) {
    return loadPlansFromJson(overrides.plansJson, 'overrides.plansJson');
  }
  if (overrides.plansFile) {
    const filePath = path.resolve(overrides.plansFile);
    if (!fsModule.existsSync(filePath)) {
      throw new TributeConfigurationError(`Plans file not found: ${filePath}`);
    }
    const fileContents = fsModule.readFileSync(filePath, 'utf8');
    return loadPlansFromJson(fileContents, filePath);
  }
  if (env.TRIBUTE_PLANS) {
    return loadPlansFromJson(env.TRIBUTE_PLANS, 'TRIBUTE_PLANS');
  }
  if (env.TRIBUTE_PLANS_FILE) {
    const filePath = path.resolve(env.TRIBUTE_PLANS_FILE);
    if (!fsModule.existsSync(filePath)) {
      throw new TributeConfigurationError(`Plans file not found: ${filePath}`);
    }
    const fileContents = fsModule.readFileSync(filePath, 'utf8');
    return loadPlansFromJson(fileContents, filePath);
  }
  return [];
}

function resolveIntentTtl(overrides, env) {
  if (overrides.intentTtlMs) {
    return parseNumber(overrides.intentTtlMs, undefined);
  }
  if (env.TRIBUTE_INTENT_TTL_MS) {
    return parseNumber(env.TRIBUTE_INTENT_TTL_MS, undefined);
  }
  const minutes = overrides.intentTtlMinutes
    ?? env.TRIBUTE_INTENT_TTL_MINUTES
    ?? DEFAULT_INTENT_TTL_MINUTES;
  return parseNumber(minutes, DEFAULT_INTENT_TTL_MINUTES) * 60 * 1000;
}

function resolveSignatureEncoding(overrides, env) {
  const encoding = overrides.signatureEncoding ?? env.TRIBUTE_SIGNATURE_ENCODING ?? 'hex';
  if (!SUPPORTED_SIGNATURE_ENCODINGS.includes(encoding)) {
    throw new TributeConfigurationError(`Unsupported signature encoding: ${encoding}`);
  }
  return encoding;
}

function resolveAllowedEvents(overrides, env) {
  if (overrides.allowedWebhookEvents) {
    if (!Array.isArray(overrides.allowedWebhookEvents) || overrides.allowedWebhookEvents.length === 0) {
      throw new TributeConfigurationError('allowedWebhookEvents override must be a non-empty array');
    }
    return overrides.allowedWebhookEvents;
  }
  const allowDonations = parseBoolean(overrides.allowDonations ?? env.TRIBUTE_ALLOW_DONATIONS, true);
  return allowDonations ? [...SUBSCRIPTION_EVENTS, ...DONATION_EVENTS] : [...SUBSCRIPTION_EVENTS];
}

function resolveEventPublisherFailureMode(overrides, env) {
  const candidate = overrides.eventPublisherFailureMode ?? env.TRIBUTE_EVENT_PUBLISHER_FAILURE_MODE ?? 'throw';
  const normalized = typeof candidate === 'string' ? candidate.trim().toLowerCase() : candidate;
  if (!EVENT_PUBLISHER_FAILURE_MODES.includes(normalized)) {
    throw new TributeConfigurationError('eventPublisherFailureMode must be either "throw" or "log"');
  }
  return normalized;
}

/**
 * Build configuration object for TributeSubscriptionManager.
 * Supports environment variables and JSON files to describe subscription plans.
 *
 * @param {Object} [overrides]
 * @param {import('./types.js').TributePlan[]} [overrides.plans]
 * @param {string|Object} [overrides.plansJson]
 * @param {string} [overrides.plansFile]
 * @param {string} [overrides.apiKey]
 * @param {number} [overrides.intentTtlMs]
 * @param {number} [overrides.intentTtlMinutes]
 * @param {"hex"|"base64"} [overrides.signatureEncoding]
 * @param {boolean} [overrides.allowDonations]
 * @param {string[]} [overrides.allowedWebhookEvents]
 * @param {(event: import('./types.js').TributeEventResult) => (void|Promise<void>)} [overrides.eventPublisher]
 * @param {'throw'|'log'} [overrides.eventPublisherFailureMode]
 * @param {Object} [overrides.logger]
 * @param {import('./store/SubscriptionStore.js').SubscriptionStore} [overrides.store]
 * @param {Object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof import('node:fs')} [options.fs]
 * @returns {{ plans: import('./types.js').TributePlan[], apiKey: string, intentTtlMs: number, signatureEncoding: "hex"|"base64", allowedWebhookEvents: string[], logger?: any, store?: any }}
 */
export function createTributeConfig(overrides = {}, options = {}) {
  const env = options.env ?? process.env;
  const fsModule = options.fs ?? fs;
  const plans = loadPlans({ overrides, env, fsModule });
  if (!plans.length) {
    throw new TributeConfigurationError('No subscription plans defined. Provide overrides.plans or TRIBUTE_PLANS');
  }
  const apiKey = overrides.apiKey ?? env.TRIBUTE_API_KEY;
  if (!apiKey) {
    throw new TributeConfigurationError('Tribute API key is required (set TRIBUTE_API_KEY or pass overrides.apiKey)');
  }
  const intentTtlMs = resolveIntentTtl(overrides, env);
  const signatureEncoding = resolveSignatureEncoding(overrides, env);
  const allowedWebhookEvents = resolveAllowedEvents(overrides, env);
  const eventPublisherFailureMode = resolveEventPublisherFailureMode(overrides, env);

  const config = { plans, apiKey, intentTtlMs, signatureEncoding, allowedWebhookEvents, eventPublisherFailureMode };
  if (overrides.logger) {
    config.logger = overrides.logger;
  }
  if (overrides.store) {
    config.store = overrides.store;
  }
  if (overrides.eventPublisher !== undefined) {
    if (typeof overrides.eventPublisher !== 'function') {
      throw new TributeConfigurationError('eventPublisher override must be a function');
    }
    config.eventPublisher = overrides.eventPublisher;
  }
  return config;
}

export const __config = {};
