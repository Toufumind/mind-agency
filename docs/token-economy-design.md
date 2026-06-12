# Token Economy Design for Mind Agency

## Executive Summary

This document outlines the design for a fair and sustainable token economy system for Mind Agency's multi-agent collaboration platform. The design draws from real-world implementations (one-api, new-api, LiteLLM) and incorporates game theory principles for incentive alignment.

## Current State Analysis

### Existing Implementation (`token-economy.ts`)

**Strengths:**
- Basic account management (balance, earned, spent)
- Transfer, deposit, withdraw operations
- Leaderboard and transaction history
- Task-based rewards with quality multipliers

**Gaps:**
- No pre-paid credit system
- No per-agent pricing differentiation
- No anti-abuse mechanisms
- No budget enforcement
- No real-time cost tracking on API calls

## Proposed Architecture

### 1. Pre-Paid Credit System

**Inspired by:** one-api's redemption code system

```typescript
interface CreditSystem {
  // Redemption codes
  generateRedemptionCode(amount: number, expiry: number): string;
  redeemCode(agent: string, code: string): boolean;
  
  // Pre-paid balances
  getBalance(agent: string): number;
  deductBalance(agent: string, amount: number, reason: string): boolean;
  
  // Budget management
  setBudgetLimit(agent: string, limit: number, period: 'daily' | 'weekly' | 'monthly'): void;
  getBudgetUsage(agent: string, period: string): BudgetUsage;
}
```

**Key Features:**
- Redemption codes for credit distribution
- Budget caps with configurable periods (daily/weekly/monthly)
- Real-time balance deduction on API calls
- Rollover policies for unused budgets

### 2. Per-Agent Pricing Structure

**Inspired by:** one-api's group multiplier system

```typescript
interface AgentPricing {
  agent: string;
  role: 'researcher' | 'coder' | 'reviewer' | 'coordinator';
  multiplier: number;  // 0.5 - 2.0
  skillBonuses: Record<string, number>;  // Specialized skills
  volumeDiscounts: VolumeDiscount[];
}

interface VolumeDiscount {
  threshold: number;  // Tokens used
  discount: number;   // 0.1 = 10% discount
}
```

**Pricing Tiers:**

| Role | Base Multiplier | Rationale |
|------|----------------|-----------|
| Researcher | 1.0 | Standard usage |
| Coder | 1.2 | Higher token consumption |
| Reviewer | 0.8 | Lower token usage |
| Coordinator | 1.5 | Orchestration overhead |

**Skill Bonuses:**
- Specialized knowledge: +0.2 multiplier
- Language expertise: +0.1 multiplier
- Domain authority: +0.3 multiplier

### 3. Task Reward Mechanisms

**Inspired by:** Game theory incentive design

```typescript
interface TaskReward {
  // Fixed rewards
  baseReward: number;
  
  // Quality multipliers
  qualityMultipliers: {
    normal: 1.0,
    good: 1.2,
    excellent: 1.5,
    poor: 0.5,
  };
  
  // Time bonuses
  timeBonuses: {
    earlyCompletion: 1.3,  // <50% estimated time
    onTime: 1.0,
    late: 0.8,             // >150% estimated time
  };
  
  // Streak bonuses
  streakMultipliers: {
    3_tasks: 1.1,
    5_tasks: 1.2,
    10_tasks: 1.5,
  };
}
```

**Reward Calculation:**
```
TotalReward = BaseReward × QualityMultiplier × TimeBonus × StreakMultiplier
```

### 4. Anti-Abuse Strategies

**Inspired by:** Sybil resistance and anomaly detection

```typescript
interface AntiAbuseSystem {
  // Rate limiting
  rateLimits: {
    maxTokensPerHour: number;
    maxTransactionsPerMinute: number;
    cooldownPeriod: number;  // ms between deposits
  };
  
  // Anomaly detection
  anomalyRules: {
    suddenSpikes: boolean;  // >3x normal usage
    rapidCycles: boolean;   // deposit-withdraw loops
    suspiciousPatterns: boolean;  // Unusual transaction sequences
  };
  
  // Audit logging
  auditTrail: {
    logAllTransactions: boolean;
    retentionDays: number;
    alertThresholds: AlertThreshold[];
  };
}
```

**Implementation:**
- Sliding window rate limiting
- Z-score anomaly detection for spending patterns
- Mandatory cooldown between deposit and withdrawal
- Complete audit trail with 90-day retention

### 5. Real-Time Cost Tracking

**Inspired by:** LiteLLM's automatic cost calculation

```typescript
interface CostTracker {
  // Model pricing (similar to model_prices_and_context_window.json)
  modelPricing: Record<string, {
    inputCostPerToken: number;
    outputCostPerToken: number;
    cacheHitDiscount: number;
  }>;
  
  // Automatic deduction
  trackAPICall(agent: string, model: string, inputTokens: number, outputTokens: number): CostResult;
  
  // Budget enforcement
  checkBudget(agent: string, estimatedCost: number): boolean;
}
```

**Integration Points:**
- Hook into `chat.ts` API call flow
- Deduct from agent balance on each API call
- Return cost in response headers (`x-mind-response-cost`)
- Log to audit trail

## Data Model

### Agent Account (Enhanced)

```typescript
interface AgentAccount {
  agent: string;
  balance: number;
  earned: number;
  spent: number;
  transactions: Transaction[];
  
  // New fields
  budgetLimits: BudgetLimit[];
  pricing: AgentPricing;
  reputation: number;  // 0-100
  streakCount: number;
  lastActiveAt: number;
}
```

### Transaction Types

```typescript
type TransactionType = 
  | 'deposit'
  | 'withdrawal'
  | 'transfer-in'
  | 'transfer-out'
  | 'task-reward'
  | 'api-cost'
  | 'penalty'
  | 'streak-bonus'
  | 'time-bonus';
```

### Budget Limits

```typescript
interface BudgetLimit {
  period: 'daily' | 'weekly' | 'monthly';
  limit: number;
  used: number;
  resetAt: number;
}
```

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)

1. **Enhanced Account Model**
   - Add budget limits and pricing fields
   - Migrate existing accounts

2. **Budget Enforcement**
   - Implement period-based limits
   - Real-time deduction on API calls

3. **Basic Anti-Abuse**
   - Rate limiting
   - Audit logging

### Phase 2: Pricing & Rewards (Week 3-4)

1. **Per-Agent Pricing**
   - Role-based multipliers
   - Skill bonuses

2. **Task Rewards**
   - Quality multipliers
   - Time bonuses
   - Streak system

3. **Leaderboard Enhancement**
   - Add reputation scores
   - Show streak information

### Phase 3: Advanced Features (Week 5-6)

1. **Pre-Paid Credits**
   - Redemption code system
   - Bulk generation

2. **Anomaly Detection**
   - Spending pattern analysis
   - Alert system

3. **Analytics Dashboard**
   - Cost breakdown by model
   - Usage trends
   - Budget forecasts

## API Endpoints

### Economy Management

```
POST /api/economy/deposit          # Add credits
POST /api/economy/transfer         # Transfer between agents
GET  /api/economy/account/:agent   # Get account details
GET  /api/economy/leaderboard      # Get rankings
GET  /api/economy/usage/:agent     # Get usage stats
POST /api/economy/budget           # Set budget limits
GET  /api/economy/redeem/:code     # Redeem credit code
```

### Task Rewards

```
POST /api/economy/task-reward      # Award task completion
POST /api/economy/streak           # Update streak count
GET  /api/economy/reputation/:agent # Get reputation score
```

## Metrics & Monitoring

### Key Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Average cost per task | <100 tokens | >200 tokens |
| Budget utilization | 70-90% | >95% or <30% |
| Anomaly detection rate | >95% | <90% |
| Transaction latency | <100ms | >500ms |

### Monitoring Dashboard

- Real-time balance tracking
- Budget utilization graphs
- Anomaly alerts
- Cost breakdown by model/agent

## Security Considerations

1. **Transaction Integrity**
   - Atomic operations with rollback
   - Double-spending prevention
   - Balance consistency checks

2. **Access Control**
   - Role-based permissions
   - Admin-only operations (deposit, budget limits)
   - Agent self-service (balance check, transfer)

3. **Audit Trail**
   - Immutable transaction log
   - Cryptographic hashing for integrity
   - 90-day retention policy

## Integration with Existing Systems

### Chat System (`chat.ts`)

```typescript
// Before API call
const costEstimate = estimateCost(model, estimatedTokens);
const hasBudget = checkBudget(agentName, costEstimate);
if (!hasBudget) throw new Error('Budget exceeded');

// After API call
const actualCost = calculateCost(model, inputTokens, outputTokens);
deductBalance(agentName, actualCost, `API call: ${model}`);
```

### MCP Tools

- Add `token_budget_check` tool
- Add `token_analytics` tool
- Enhance existing tools with cost information

### Frontend Dashboard

- Real-time balance display
- Budget utilization progress bars
- Transaction history with filters
- Cost breakdown charts

## Conclusion

This design provides a comprehensive token economy system that is:
- **Fair**: Role-based pricing and quality rewards
- **Sustainable**: Budget limits and anti-abuse mechanisms
- **Transparent**: Complete audit trail and analytics
- **Scalable**: Modular architecture for future enhancements

The system balances flexibility (per-agent customization) with control (budget limits, anti-abuse) to create a healthy multi-agent collaboration environment.
