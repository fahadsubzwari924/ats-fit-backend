import { Injectable, Logger } from '@nestjs/common';

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerOptions {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private circuits = new Map<string, CircuitBreakerInstance>();

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    circuitName: string,
    operation: () => Promise<T>,
    options: Partial<CircuitBreakerOptions> = {},
  ): Promise<T> {
    const circuit = this.getOrCreateCircuit(circuitName, options);
    return circuit.execute(operation);
  }

  /**
   * Get circuit breaker status
   */
  getCircuitStatus(circuitName: string): {
    state: CircuitBreakerState;
    failureCount: number;
    lastFailureTime?: number;
  } | null {
    const circuit = this.circuits.get(circuitName);
    if (!circuit) return null;

    return {
      state: circuit.state,
      failureCount: circuit.failureCount,
      lastFailureTime: circuit.lastFailureTime,
    };
  }

  /**
   * Reset circuit breaker to closed state
   */
  resetCircuit(circuitName: string): void {
    const circuit = this.circuits.get(circuitName);
    if (circuit) {
      circuit.reset();
      this.logger.log(`Circuit breaker ${circuitName} has been reset`);
    }
  }

  private getOrCreateCircuit(
    name: string,
    options: Partial<CircuitBreakerOptions>,
  ): CircuitBreakerInstance {
    if (!this.circuits.has(name)) {
      const defaultOptions: CircuitBreakerOptions = {
        failureThreshold: 5,
        recoveryTimeout: 60000, // 1 minute
        monitoringPeriod: 10000, // 10 seconds
      };

      const circuitOptions = { ...defaultOptions, ...options };
      this.circuits.set(
        name,
        new CircuitBreakerInstance(name, circuitOptions, this.logger),
      );
    }

    const circuit = this.circuits.get(name);
    if (!circuit) {
      throw new Error(`Circuit ${name} should exist after creation`);
    }
    return circuit;
  }
}

class CircuitBreakerInstance {
  public state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  public failureCount = 0;
  public lastFailureTime?: number;
  private nextAttemptTime = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions,
    private readonly logger: Logger,
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error(
          `Circuit breaker ${this.name} is OPEN. Next attempt allowed at ${new Date(
            this.nextAttemptTime,
          ).toISOString()}`,
        );
      }
      // Move to half-open state
      this.state = CircuitBreakerState.HALF_OPEN;
      this.logger.warn(`Circuit breaker ${this.name} moved to HALF_OPEN state`);
    }

    try {
      const result = await operation();

      // Success - reset failure count and close circuit if it was half-open
      if (this.state === CircuitBreakerState.HALF_OPEN) {
        this.reset();
        this.logger.log(
          `Circuit breaker ${this.name} recovered to CLOSED state`,
        );
      }

      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.nextAttemptTime = Date.now() + this.options.recoveryTimeout;

      this.logger.error(
        `Circuit breaker ${this.name} opened due to ${this.failureCount} failures. ` +
          `Next attempt allowed at ${new Date(this.nextAttemptTime).toISOString()}`,
      );
    } else {
      this.logger.warn(
        `Circuit breaker ${this.name} recorded failure ${this.failureCount}/${this.options.failureThreshold}`,
      );
    }
  }

  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = undefined;
    this.nextAttemptTime = 0;
  }
}
