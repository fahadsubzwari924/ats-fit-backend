import { Injectable, OnModuleInit } from '@nestjs/common';
import { AB_EXPERIMENTS } from '../constants/ab-experiments.constants';

@Injectable()
export class PromptVariantResolverService implements OnModuleInit {
  onModuleInit() {
    for (const exp of AB_EXPERIMENTS) {
      const total = exp.variants.reduce((s, v) => s + v.weight, 0);
      if (total !== 100) {
        throw new Error(
          `A/B experiment "${exp.key}" weights sum to ${total}, expected 100`,
        );
      }
    }
  }

  resolve(userId: string, experimentKey: string): string {
    const experiment = AB_EXPERIMENTS.find(e => e.key === experimentKey);
    if (!experiment) return 'control';

    const hash = this.djb2Hash(userId + experimentKey) % 100;
    let cumulative = 0;
    for (const variant of experiment.variants) {
      cumulative += variant.weight;
      if (hash < cumulative) return variant.name;
    }
    return experiment.variants[experiment.variants.length - 1].name;
  }

  private djb2Hash(input: string): number {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    }
    return Math.abs(hash);
  }
}
