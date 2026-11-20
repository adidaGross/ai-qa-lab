// The numbers of the benchmark.
//   Mutation metrics: how good the TEST SUITE is (does it catch the changes?)
//   AI metrics:       how good the AI TRIAGE is (accuracy with a confidence range, confusion
//                     matrix, accuracy per change type and per reported confidence, speed)

export type Judgment = {
  mutantId: string;
  target: "app" | "test";
  operator: string;
  test: string;
  truth: "app-bug" | "test-bug";
  predicted: "app-bug" | "test-bug" | "environment" | "error";
  confidence: "high" | "medium" | "low" | null;
  summary: string;
  durationMs: number;
};

type MutantLike = { id: string; target: string; status: string; operator: string; file: string; line: number; before: string; after: string };
type Rate = { correct: number; total: number; rate: number };

// Wilson score interval: a 95% confidence range for a percentage measured on a sample.
// With few cases the range is wide; more cases make it narrower.
export function wilson(correct: number, total: number, z = 1.96) {
  if (total === 0) return { low: 0, high: 0 };
  const p = correct / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

function rateOf(list: Judgment[]): Rate {
  const correct = list.filter((j) => j.predicted === j.truth).length;
  return { correct, total: list.length, rate: list.length ? correct / list.length : 0 };
}

export function computeMutationMetrics(mutants: MutantLike[]) {
  const app = mutants.filter((m) => m.target === "app");
  const test = mutants.filter((m) => m.target === "test");
  const caught = (list: MutantLike[]) => list.filter((m) => m.status !== "survived").length;
  return {
    mutationScore: { killed: caught(app), total: app.length, rate: app.length ? caught(app) / app.length : 0 },
    testMutantsDetected: { killed: caught(test), total: test.length },
    survivors: mutants
      .filter((m) => m.status === "survived")
      .map(({ id, target, operator, file, line, before, after }) => ({ id, target, operator, file, line, before, after })),
  };
}

export function computeAiMetrics(judgments: Judgment[]) {
  const accuracy = rateOf(judgments);
  const predictedLabels = ["app-bug", "test-bug", "environment", "error"] as const;
  const confusion = Object.fromEntries(
    (["app-bug", "test-bug"] as const).map((truth) => [
      truth,
      Object.fromEntries(predictedLabels.map((p) => [p, judgments.filter((j) => j.truth === truth && j.predicted === p).length])),
    ])
  );
  const group = (key: (j: Judgment) => string) => Object.fromEntries([...Map.groupBy(judgments, key)].map(([k, list]) => [k, rateOf(list)]));
  // "error" = the model failed to return a valid answer (a technical failure, not a wrong judgment).
  // We report it separately: how often it answers, and how accurate it is when it does.
  const answered = judgments.filter((j) => j.predicted !== "error");
  const answeredRate = rateOf(answered);

  return {
    accuracy: { ...accuracy, ...wilson(accuracy.correct, accuracy.total) },
    answerRate: { answered: answered.length, total: judgments.length, rate: judgments.length ? answered.length / judgments.length : 0 },
    accuracyWhenAnswered: { ...answeredRate, ...wilson(answeredRate.correct, answeredRate.total) },
    byTruth: { "app-bug": rateOf(judgments.filter((j) => j.truth === "app-bug")), "test-bug": rateOf(judgments.filter((j) => j.truth === "test-bug")) },
    byOperator: group((j) => `${j.target}: ${j.operator}`),
    byConfidence: group((j) => j.confidence ?? "none"),
    confusion,
    avgSeconds: answered.length ? answered.reduce((s, j) => s + j.durationMs, 0) / answered.length / 1000 : 0,
  };
}
