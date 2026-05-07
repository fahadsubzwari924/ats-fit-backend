import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';

export interface BatchEventEnvelope {
  batchId: string;
  eventName: string;
  data: Record<string, unknown>;
  eventId: number;
}

@Injectable()
export class BatchTailoringV2EventsGateway implements OnModuleDestroy {
  private readonly logger = new Logger(BatchTailoringV2EventsGateway.name);
  private readonly stream$ = new Subject<BatchEventEnvelope>();

  publish(envelope: BatchEventEnvelope): void {
    this.logger.debug(
      `[batch ${envelope.batchId}] publish ${envelope.eventName} #${envelope.eventId}`,
    );
    this.stream$.next(envelope);
  }

  forBatch(batchId: string): Observable<BatchEventEnvelope> {
    return this.stream$
      .asObservable()
      .pipe(filter((e) => e.batchId === batchId));
  }

  onModuleDestroy(): void {
    this.stream$.complete();
  }
}
