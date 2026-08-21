/**
 * One-time scaffold: write every node from Appendix A that does not exist yet as
 * a `status: planned` MDX file.
 *
 * The map is supposed to let a learner see the shape of the road ahead. With
 * only the handful of written nodes in the database it shows the shape of
 * nothing, and prerequisite edges dangle. Creating all 40 up front makes the
 * graph complete and correct from day one; M5 then flips them to `published` one
 * at a time rather than creating them.
 *
 * Existing files are never touched. Re-running this is safe.
 *
 *   pnpm scaffold:planned
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Spec = {
  id: string;
  title: string;
  slug: string;
  prereqs: string[];
  /** The capability the learner will have. Stated now so the map means something. */
  goal: string;
  /** Appendix B detail, carried over so M5 does not have to rediscover it. */
  notes?: string;
};

const NODES: Spec[] = [
  // ---------------------------------------------------- phase 0, tooling floor
  { id: "0.1", title: "Python fundamentals", slug: "python-fundamentals", prereqs: [], goal: "" },
  {
    id: "0.2",
    title: "Numpy and vectorized thinking",
    slug: "numpy-and-vectorized-thinking",
    prereqs: ["0.1"],
    goal: "You can express a loop you already understand as an array operation, and say what it cost you in readability and gained you in speed.",
    notes:
      "Session should force a measured speed comparison against the pure-Python loop from 0.1, not an asserted one. Common wall: broadcasting rules applied by trial and error rather than understood.",
  },
  { id: "0.3", title: "Pandas", slug: "pandas", prereqs: ["0.2"], goal: "" },
  {
    id: "0.4",
    title: "Notebooks, environments, git",
    slug: "notebooks-environments-git",
    prereqs: ["0.1"],
    goal: "You can hand someone a repository they can run, and recover your own work after breaking it.",
    notes:
      "Checklist should require a genuinely reproduced environment on a clean checkout, and at least one deliberate `git reset` recovery. Common wall: notebook state that only works because of the order cells were run in.",
  },
  {
    id: "0.5",
    title: "Plotting to see, not to decorate",
    slug: "plotting-to-see",
    prereqs: ["0.3"],
    goal: "You use a plot to find something you did not already know, rather than to illustrate something you did.",
    notes:
      "Session should plant a distribution artefact that is invisible in summary statistics and obvious in a histogram. Carries the cleaned dataframe from 0.3 forward.",
  },

  // -------------------------------------------------- phase 1, math on demand
  {
    id: "1.1",
    title: "Linear algebra intuition",
    slug: "linear-algebra-intuition",
    prereqs: ["0.2"],
    goal: "You can say what a matrix multiplication is doing geometrically, and predict the shape of any product before running it.",
  },
  {
    id: "1.2",
    title: "Derivatives and the chain rule",
    slug: "derivatives-and-the-chain-rule",
    prereqs: ["1.1"],
    goal: "You can differentiate a composed function by hand and verify it numerically with a gradient-check helper you wrote yourself.",
    notes:
      "The gradient-check helper written here is reused in node 4.1 to verify the micrograd engine. Make it a real, reusable artifact, not a throwaway cell.",
  },
  {
    id: "1.3",
    title: "Probability and distributions",
    slug: "probability-and-distributions",
    prereqs: ["0.2"],
    goal: "You can pick the distribution that matches a data-generating process and say what it assumes that your data might violate.",
  },
  {
    id: "1.4",
    title: "Statistical inference and the p-value trap",
    slug: "statistical-inference",
    prereqs: ["1.3"],
    goal: "You can explain what a p-value does and does not tell you, having watched yourself generate false positives on purpose.",
    notes:
      "Session runs 100 A/A tests and counts false positives, expecting roughly 5% at alpha 0.05. This node exists to inoculate against p-hacking, so the reflection prompt matters more than the code.",
  },
  {
    id: "1.5",
    title: "Optimization: gradient descent by hand",
    slug: "gradient-descent-by-hand",
    prereqs: ["1.2"],
    goal: "You can implement gradient descent from scratch, make it diverge deliberately, and explain what the learning rate traded away.",
    notes:
      "Must include an intentional divergence run at a learning rate of 10, and the checklist should confirm the learner observed it. Common wall: not normalizing features, then blaming the algorithm.",
  },

  // --------------------------------------------- phase 2, supervised learning
  {
    id: "2.1",
    title: "Framing an ML problem",
    slug: "framing-an-ml-problem",
    prereqs: ["0.5", "1.5"],
    goal: "You can turn a vague business request into a prediction target, a unit of prediction, and a decision it will actually change.",
  },
  {
    id: "2.2",
    title: "Linear and logistic regression",
    slug: "linear-and-logistic-regression",
    prereqs: ["1.5", "2.1"],
    goal: "You can fit, read and defend a linear model, and say what its coefficients do and do not mean.",
  },
  { id: "2.3", title: "Train/val/test, cross-validation, leakage", slug: "validation-and-leakage", prereqs: ["2.2"], goal: "" },
  {
    id: "2.4",
    title: "Metrics that match the problem",
    slug: "metrics-that-match",
    prereqs: ["2.3"],
    goal: "You can choose a metric from the cost of being wrong, and spot a metric that is flattering a useless model.",
    notes:
      "Learner must identify the metric under which a majority-class-always classifier appears to win.",
  },
  {
    id: "2.5",
    title: "Decision trees and random forests",
    slug: "trees-and-forests",
    prereqs: ["2.3"],
    goal: "You can explain why averaging many overfit trees works, and read a feature importance without over-trusting it.",
  },
  {
    id: "2.6",
    title: "Gradient boosting",
    slug: "gradient-boosting",
    prereqs: ["2.5"],
    goal: "You can train a gradient boosting model that beats your linear baseline, and say what it cost you in interpretability and tuning time.",
  },
  {
    id: "2.7",
    title: "Model diagnosis: bias, variance, error analysis",
    slug: "model-diagnosis",
    prereqs: ["2.6"],
    goal: "You can look at a model's errors, group them, and name the single change most likely to help.",
  },

  // ------------------------------ phase 3, unsupervised and feature work
  {
    id: "3.1",
    title: "Feature engineering",
    slug: "feature-engineering",
    prereqs: ["2.3"],
    goal: "You can build features from raw transactional data without leaking the future across your cutoff date.",
    notes:
      "RFM features on transactional data, with the leakage discipline from 2.3 carried forward across the cutoff date.",
  },
  {
    id: "3.2",
    title: "Encoding and scaling",
    slug: "encoding-and-scaling",
    prereqs: ["3.1"],
    goal: "You can encode categoricals and scale numerics inside a pipeline, so nothing is ever fitted on data it should not see.",
  },
  {
    id: "3.3",
    title: "Clustering",
    slug: "clustering",
    prereqs: ["3.1"],
    goal: "You can cluster data and then honestly assess whether the clusters mean anything.",
  },
  {
    id: "3.4",
    title: "Dimensionality reduction",
    slug: "dimensionality-reduction",
    prereqs: ["1.1", "3.3"],
    goal: "You can reduce dimensions for the right reason and know which techniques are for looking and which are for modelling.",
    notes:
      "Checklist must enforce that t-SNE output is used only for visualization, never as model input.",
  },
  {
    id: "3.5",
    title: "Anomaly detection",
    slug: "anomaly-detection",
    prereqs: ["3.3"],
    goal: "You can find outliers and decide, case by case, whether each one is an error, a rare event, or the thing you were looking for.",
  },

  // ------------------------------------------------- phase 4, deep learning
  {
    id: "4.1",
    title: "Why nets, and tensors (build micrograd)",
    slug: "micrograd",
    prereqs: ["2.7"],
    goal: "You have written an autograd engine from scratch and verified its gradients against your own numerical check.",
    notes:
      "Build the autograd engine from scratch, then verify gradients against the gradient-check helper written back in node 1.2. Explicitly not skippable. Scheduled for the M8 execution runtime.",
  },
  {
    id: "4.2",
    title: "MLP from scratch, then in PyTorch",
    slug: "mlp-from-scratch",
    prereqs: ["4.1"],
    goal: "You can write a multilayer perceptron twice - once by hand, once in PyTorch - and get the same answer.",
  },
  {
    id: "4.3",
    title: "Training dynamics",
    slug: "training-dynamics",
    prereqs: ["4.2"],
    goal: "You overfit a single batch to near-zero loss before you ever start a real training run.",
    notes:
      "The overfit-one-batch discipline is the point. Checklist requires single-batch loss below 1e-3 before full training is attempted. Scheduled for the M8 execution runtime.",
  },
  {
    id: "4.4",
    title: "CNNs",
    slug: "cnns",
    prereqs: ["4.3"],
    goal: "You can say what convolution buys you over a dense layer, and compute the output shape of any layer by hand.",
  },
  {
    id: "4.5",
    title: "Sequences and attention",
    slug: "sequences-and-attention",
    prereqs: ["4.3"],
    goal: "You can implement scaled dot-product attention and explain what each of the three matrices is for.",
  },
  {
    id: "4.6",
    title: "Embeddings",
    slug: "embeddings",
    prereqs: ["4.5"],
    goal: "You can produce embeddings, inspect what they encode, and find a case where the similarity they report is misleading.",
  },

  // -------------------------------------------------- phase 5, applied LLM
  {
    id: "5.1",
    title: "Using LLM APIs properly",
    slug: "using-llm-apis",
    prereqs: ["4.6"],
    goal: "You can decide, with a measurement rather than an opinion, whether an LLM is the right tool for a given task.",
    notes:
      "Session compares a prompted classifier against the gradient boosting model from 2.6 on the same data. The intended conclusion is often that the LLM is the wrong tool.",
  },
  {
    id: "5.2",
    title: "Vector search and retrieval",
    slug: "vector-search",
    prereqs: ["4.6"],
    goal: "You can build a retrieval index and measure its recall, rather than assuming the results look fine.",
  },
  {
    id: "5.3",
    title: "RAG end to end",
    slug: "rag-end-to-end",
    prereqs: ["5.1", "5.2"],
    goal: "You can build a retrieval-augmented system and attribute each failure to retrieval or to generation.",
  },
  {
    id: "5.4",
    title: "Evaluating LLM systems",
    slug: "evaluating-llm-systems",
    prereqs: ["5.3"],
    goal: "You have a hand-labelled eval set you trust, and you know why a model-generated one would not do.",
    notes:
      "The deliverable is a hand-labeled 50-case eval set. Synthetic or model-generated eval sets do not count and the checklist should say so plainly.",
  },
  {
    id: "5.5",
    title: "Agents and tool use",
    slug: "agents-and-tool-use",
    prereqs: ["5.4"],
    goal: "You can build an agent that calls tools, and say where the loop fails and what it costs per run.",
  },

  // ------------------------------------------------------ phase 6, ship it
  {
    id: "6.1",
    title: "Serving a model",
    slug: "serving-a-model",
    prereqs: ["2.6"],
    goal: "You can put a trained model behind an HTTP endpoint that someone else can call.",
  },
  {
    id: "6.2",
    title: "Containerize and deploy",
    slug: "containerize-and-deploy",
    prereqs: ["6.1"],
    goal: "Your model runs somewhere that is not your laptop, from an image you can rebuild.",
  },
  {
    id: "6.3",
    title: "Experiment tracking and model registry",
    slug: "experiment-tracking",
    prereqs: ["2.7"],
    goal: "You can reproduce any past result from its recorded run, without relying on memory.",
  },
  {
    id: "6.4",
    title: "Pipelines and retraining",
    slug: "pipelines-and-retraining",
    prereqs: ["6.3"],
    goal: "You have a retraining pipeline that refuses to promote a model that fails its gate.",
    notes:
      "The pipeline must refuse to promote a model that fails the gate, and the checklist verifies this by deliberately feeding it a worse model.",
  },
  {
    id: "6.5",
    title: "Monitoring and drift",
    slug: "monitoring-and-drift",
    prereqs: ["6.2", "6.4"],
    goal: "You would find out that your model had degraded from a dashboard rather than from a complaint.",
  },
  {
    id: "6.6",
    title: "The system view",
    slug: "the-system-view",
    prereqs: ["6.5"],
    goal: "You can draw the whole system on one page and point at where it will break first.",
  },

  // ------------------------------------------------------ phase 7, capstone
  {
    id: "7.1",
    title: "Own problem, own data, shipped",
    slug: "capstone",
    prereqs: ["6.6"],
    goal: "You have shipped a system on a problem nobody set for you, and someone else has reviewed it.",
    notes:
      "Capstone requirements: a self-sourced dataset, a baseline that was beaten, a hand-written eval set, a deployed endpoint, a monitoring dashboard, and a README explaining what they would do with ten times the data. Peer reviewed.",
  },
];

const yamlString = (value: string) => JSON.stringify(value);

function render(spec: Spec): string {
  const phase = Number(spec.id.split(".")[0]);
  const orderIndex = Number(spec.id.split(".")[1]);

  const lines = [
    "---",
    `id: ${yamlString(spec.id)}`,
    `phase: ${phase}`,
    `order_index: ${orderIndex}`,
    `title: ${yamlString(spec.title)}`,
    `slug: ${yamlString(spec.slug)}`,
    `prereqs: [${spec.prereqs.map(yamlString).join(", ")}]`,
    `status: "planned"`,
    `goal: ${yamlString(spec.goal)}`,
  ];

  if (spec.notes) lines.push(`notes: ${yamlString(spec.notes)}`);

  lines.push(
    "---",
    "",
    `This node is planned but not written yet.`,
    "",
    `Its position in the graph is settled - what it depends on and what it should`,
    `leave you able to do - but the resources, session, checklist and questions`,
    `are still to come.`,
    "",
  );

  return lines.join("\n");
}

async function main() {
  const contentDir = join(process.cwd(), "content");
  let written = 0;
  let skipped = 0;

  for (const spec of NODES) {
    const phase = spec.id.split(".")[0];
    const dir = join(contentDir, `phase-${phase}`);
    const path = join(dir, `${spec.id}-${spec.slug}.mdx`);

    if (existsSync(path)) {
      skipped++;
      continue;
    }

    if (!spec.goal) {
      console.error(
        `  ${spec.id} has no goal and no existing file - refusing to write a node with an empty goal.`,
      );
      continue;
    }

    await mkdir(dir, { recursive: true });
    await writeFile(path, render(spec), "utf8");
    console.log(`  wrote  ${spec.id}  ${spec.title}`);
    written++;
  }

  console.log(
    `\n${written} planned node(s) written, ${skipped} already existed. ${NODES.length} total in Appendix A.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
