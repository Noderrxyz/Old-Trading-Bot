# Security Components

## Overview
The security layer provides protection against MEV, transaction manipulation, and other security threats. It includes components for MEV protection, transaction security, and rate limiting.

## MEV Protection

### Methods

#### protectTransaction
```typescript
async protectTransaction(tx: Transaction): Promise<ProtectedTransaction>
```

Protects a transaction against MEV attacks.

**Parameters:**
- `tx`: Transaction object to protect

**Returns:**
- `ProtectedTransaction` object containing:
  - `originalTx`: Original transaction
  - `protectedTx`: Protected transaction
  - `protectionType`: Type of protection applied
  - `estimatedSavings`: Estimated MEV savings

**Example:**
```typescript
const securityLayer = new SecurityLayer({
  flashbotsProvider: new FlashbotsProvider({...}),
  blocknativeProvider: new BlocknativeProvider({...})
});

const tx = {
  from: '0x123...',
  to: '0x456...',
  value: '1000000000000000000',
  data: '0x...'
};

try {
  const protected = await securityLayer.protectTransaction(tx);
  console.log('Protection type:', protected.protectionType);
  console.log('Estimated savings:', protected.estimatedSavings);
} catch (error) {
  console.error('Protection failed:', error);
}
```

#### simulateTransaction
```typescript
async simulateTransaction(tx: Transaction): Promise<SimulationResult>
```

Simulates a transaction to detect potential MEV attacks.

**Parameters:**
- `tx`: Transaction to simulate

**Returns:**
- `SimulationResult` object containing:
  - `success`: Simulation success
  - `gasUsed`: Gas used
  - `mevRisk`: MEV risk level
  - `warnings`: Array of warnings
  - `suggestions`: Array of suggestions

**Example:**
```typescript
const simulation = await securityLayer.simulateTransaction(tx);
if (simulation.mevRisk === 'HIGH') {
  console.warn('High MEV risk detected:', simulation.warnings);
}
```

## Transaction Security

### Methods

#### validateTransaction
```typescript
async validateTransaction(tx: Transaction): Promise<ValidationResult>
```

Validates a transaction for security issues.

**Parameters:**
- `tx`: Transaction to validate

**Returns:**
- `ValidationResult` object containing:
  - `valid`: Validation result
  - `issues`: Array of issues
  - `recommendations`: Array of recommendations

**Example:**
```typescript
const validation = await securityLayer.validateTransaction(tx);
if (!validation.valid) {
  console.error('Validation issues:', validation.issues);
  console.log('Recommendations:', validation.recommendations);
}
```

#### signTransaction
```typescript
async signTransaction(tx: Transaction): Promise<SignedTransaction>
```

Signs a transaction with security enhancements.

**Parameters:**
- `tx`: Transaction to sign

**Returns:**
- `SignedTransaction` object containing:
  - `transaction`: Original transaction
  - `signature`: Transaction signature
  - `securityMetadata`: Security metadata

**Example:**
```typescript
const signed = await securityLayer.signTransaction(tx);
console.log('Transaction signed with security metadata');
```

## Rate Limiting

### Methods

#### checkRateLimit
```typescript
async checkRateLimit(
  operation: string,
  identifier: string
): Promise<RateLimitResult>
```

Checks if an operation is within rate limits.

**Parameters:**
- `operation`: Operation type
- `identifier`: User or IP identifier

**Returns:**
- `RateLimitResult` object containing:
  - `allowed`: Whether operation is allowed
  - `remaining`: Remaining operations
  - `resetTime`: Time until limit reset

**Example:**
```typescript
const rateLimit = await securityLayer.checkRateLimit(
  'executeOrder',
  'user123'
);
if (!rateLimit.allowed) {
  console.log('Rate limit exceeded. Reset in:', rateLimit.resetTime);
}
```

#### updateRateLimit
```typescript
async updateRateLimit(
  operation: string,
  identifier: string,
  count: number
): Promise<void>
```

Updates rate limit counters.

**Parameters:**
- `operation`: Operation type
- `identifier`: User or IP identifier
- `count`: Operation count

**Example:**
```typescript
await securityLayer.updateRateLimit('executeOrder', 'user123', 1);
```

## Error Handling

The security layer uses standardized error types:

```typescript
class SecurityError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}
```

Common error codes:
- `MEV_PROTECTION_FAILED`: MEV protection failed
- `SIMULATION_FAILED`: Transaction simulation failed
- `VALIDATION_FAILED`: Transaction validation failed
- `RATE_LIMIT_EXCEEDED`: Rate limit exceeded
- `SIGNATURE_FAILED`: Transaction signing failed

## Security Considerations

1. **MEV Protection**
   - Use private RPC providers
   - Implement transaction bundling
   - Monitor MEV activity
   - Use flashbots when available

2. **Transaction Security**
   - Validate all inputs
   - Check for suspicious patterns
   - Implement timeouts
   - Use secure signing

3. **Rate Limiting**
   - Set appropriate limits
   - Monitor usage patterns
   - Implement backoff
   - Track violations

4. **Monitoring**
   - Log security events
   - Track error rates
   - Monitor system health
   - Alert on anomalies 