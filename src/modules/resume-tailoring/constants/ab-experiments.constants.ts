export interface AbVariant {
  name: string;
  weight: number; // 0–100, inclusive; sum of all variants must equal 100
}

export interface AbExperiment {
  key: string;
  variants: AbVariant[];
}

export const AB_EXPERIMENTS: AbExperiment[] = [
  {
    key: 'optimizer-constitutional-rubric',
    variants: [
      { name: 'control', weight: 50 },
      { name: 'with-rubric', weight: 50 },
    ],
  },
];

export const AB_EXPERIMENT_KEYS = {
  OPTIMIZER_CONSTITUTIONAL_RUBRIC: 'optimizer-constitutional-rubric',
} as const;
