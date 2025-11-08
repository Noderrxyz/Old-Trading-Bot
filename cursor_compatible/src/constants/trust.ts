/**
 * Trust System Constants
 * 
 * Defines thresholds and parameters for the trust system,
 * including slashing, quarantine, and recovery mechanisms.
 */

// Trust score thresholds
export const DEFAULT_TRUST_SCORE = 50;
export const MIN_TRUST_WEIGHT = 0.1;
export const MAX_TRUST_SCORE = 100;

// Health mode thresholds
export const HEALING_THRESHOLD = 35;
export const CRITICAL_THRESHOLD = 15;

// Slashing thresholds
export const TRUST_SLASH_THRESHOLD = 10;      // Points
export const TRUST_QUARANTINE_THRESHOLD = 5;  // Points
export const MAX_VIOLATIONS = 3;
export const VIOLATION_WINDOW_DAYS = 7;

// Timing parameters
export const QUARANTINE_DURATION_MS = 72 * 60 * 60 * 1000; // 72h
export const MIN_HEALING_TIME_MS = 15 * 60 * 1000;         // 15m
export const MIN_SUCCESS_COUNT = 5;

// Decay parameters
export const BASE_DAILY_DECAY_RATE = 1.0;
export const HIGH_TRUST_DECAY_MULTIPLIER = 1.5;
export const LOW_TRUST_DECAY_MULTIPLIER = 0.5;
export const MINIMUM_DECAY_LEVEL = 30;

// Slashing penalties
export const MINOR_VIOLATION_PENALTY = 5;
export const MODERATE_VIOLATION_PENALTY = 15;
export const SEVERE_VIOLATION_PENALTY = 30; 