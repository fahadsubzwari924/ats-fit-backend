import { Injectable } from '@nestjs/common';
import { OpenAIService } from './open_ai.service';

@Injectable()
export class EmbeddingService {
  constructor(private openAIService: OpenAIService) {}

  async getEmbedding(text: string): Promise<number[]> {
    return this.openAIService.getSingleEmbedding(text);
  }

  async getMultipleEmbeddings(texts: string[]): Promise<number[][]> {
    return this.openAIService.getMultipleEmbeddings(texts);
  }

  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must be of equal length');
    }

    const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }
}
