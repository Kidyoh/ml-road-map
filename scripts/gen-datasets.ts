/**
 * Deterministic session datasets.
 *
 * Non-negotiable 3 says checklist items must be numerically falsifiable -
 * "my cleaned dataframe has 8,432 rows" rather than "I understand joins". That
 * only works if we know the true number, which means we generate the data
 * ourselves from a seeded PRNG instead of linking a public dataset whose exact
 * counts we would have to take on faith (and which can rot).
 *
 * Run `pnpm gen:datasets`. Output is committed. The GROUND TRUTH block it
 * prints is what gets pasted into the MDX checklists - if you change the
 * generator, re-run it and update the MDX, or the checklists start lying.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "public", "datasets");

/* ------------------------------------------------------------------- prng */

/** mulberry32. Deterministic across machines and Node versions. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, xs: readonly T[]): T =>
  xs[Math.floor(rng() * xs.length)];

const intBetween = (rng: () => number, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1));

/** Box-Muller, so the numeric columns are not visibly uniform. */
function gaussian(rng: () => number, mean: number, sd: number) {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function toCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

function write(name: string, contents: string) {
  const path = join(OUT_DIR, name);
  writeFileSync(path, contents, "utf8");
  const hash = createHash("sha256").update(contents).digest("hex").slice(0, 12);
  console.log(
    `  ${name.padEnd(28)} ${String(contents.length).padStart(9)} bytes  sha256:${hash}`,
  );
}

/* ------------------------------------------- node 0.3 - the messy dataset */

/**
 * Appendix B: "a deliberately messy CSV: mixed date formats, duplicate keys,
 * numbers stored as strings, trailing whitespace. Checklist must include the
 * exact post-dedup row count. Common wall: silent row explosion on merge."
 */
function generatePandasDataset() {
  const rng = makeRng(20240303);

  const CHANNELS = ["web", "Web", "WEB ", " mobile", "Mobile", "in-store", "In-Store"];
  const CANONICAL_CHANNELS = 3; // web, mobile, in-store once cleaned
  const MISSING_TOKENS = ["", "NA", "N/A", "null", "  "];

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  /** One date, four ways of writing it. The learner has to unify them. */
  function formatDate(rng: () => number, y: number, m: number, d: number) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    switch (intBetween(rng, 0, 3)) {
      case 0:
        return iso;
      case 1:
        return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
      case 2:
        return `${MONTHS[m - 1]} ${d}, ${y}`;
      default:
        return `${iso}T${String(intBetween(rng, 0, 23)).padStart(2, "0")}:${String(
          intBetween(rng, 0, 59),
        ).padStart(2, "0")}:00Z`;
    }
  }

  const N_CUSTOMERS = 900;
  const BASE_TRANSACTIONS = 8000;

  // --- customers.csv, with duplicated ids that cause the merge explosion ---
  const customerIds = Array.from(
    { length: N_CUSTOMERS },
    (_, i) => `C${String(i + 1).padStart(5, "0")}`,
  );

  const SEGMENTS = ["consumer", "smb", "enterprise"];
  const REGIONS = ["north", "south", "east", "west"];

  const customerRows: Record<string, string>[] = [];
  // 120 customers appear twice in the dimension table - a stale row plus a
  // corrected one. Nothing about the file announces this.
  const DUPLICATED_CUSTOMERS = 120;
  const duplicatedIds = new Set(customerIds.slice(0, DUPLICATED_CUSTOMERS));

  for (const id of customerIds) {
    const signup = formatDate(rng, 2022, intBetween(rng, 1, 12), intBetween(rng, 1, 28));
    const base = {
      customer_id: id,
      signup_date: signup,
      segment: pick(rng, SEGMENTS),
      region: pick(rng, REGIONS),
    };
    customerRows.push(base);
    if (duplicatedIds.has(id)) {
      // Same key, different region: a real second row, not an exact duplicate,
      // so drop_duplicates() alone will not save you.
      customerRows.push({
        ...base,
        region: pick(rng, REGIONS.filter((r) => r !== base.region)),
      });
    }
  }

  // --- transactions ---
  type Txn = {
    transaction_id: string;
    customer_id: string;
    order_date: string;
    amount: string;
    quantity: string;
    channel: string;
  };

  const txns: Txn[] = [];
  /** Cents, parsed back out of the string we actually write, so the ground-truth
   *  total is the total of the file rather than of the numbers we meant to write. */
  const centsByTxn = new Map<string, number>();

  for (let i = 0; i < BASE_TRANSACTIONS; i++) {
    const txnId = `T${String(i + 1).padStart(6, "0")}`;
    const customerId = pick(rng, customerIds);
    const amount = Math.max(1, gaussian(rng, 120, 65));
    const fixed = amount.toFixed(2);
    centsByTxn.set(txnId, Math.round(Number(fixed) * 100));

    // Numbers stored as strings, three different ways.
    const amountStr =
      intBetween(rng, 0, 2) === 0
        ? `$${fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`
        : intBetween(rng, 0, 1) === 0
          ? ` ${fixed} `
          : fixed;

    txns.push({
      transaction_id: txnId,
      customer_id: intBetween(rng, 0, 9) === 0 ? ` ${customerId} ` : customerId,
      order_date: formatDate(rng, 2024, intBetween(rng, 1, 12), intBetween(rng, 1, 28)),
      amount: amountStr,
      quantity:
        intBetween(rng, 0, 19) === 0
          ? pick(rng, MISSING_TOKENS)
          : String(intBetween(rng, 1, 5)),
      channel: pick(rng, CHANNELS),
    });
  }

  // Exact duplicate rows: the same transaction appended verbatim.
  const EXACT_DUPLICATES = 432;
  const duplicatedTxnRows: Txn[] = [];
  for (let i = 0; i < EXACT_DUPLICATES; i++) {
    duplicatedTxnRows.push({ ...txns[intBetween(rng, 0, BASE_TRANSACTIONS - 1)] });
  }

  const allTxns = [...txns, ...duplicatedTxnRows];

  // Shuffle so the duplicates are not conveniently all at the bottom.
  for (let i = allTxns.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allTxns[i], allTxns[j]] = [allTxns[j], allTxns[i]];
  }

  write("messy-transactions.csv", toCsv(allTxns as unknown as Record<string, string>[]));
  write("customers.csv", toCsv(customerRows));

  // --- ground truth -------------------------------------------------------
  const rawRows = allTxns.length;

  // Exact-row duplicates, as pandas' drop_duplicates() would count them.
  const seenSerialized = new Set<string>();
  let exactDuplicateRows = 0;
  for (const t of allTxns) {
    const key = JSON.stringify(t);
    if (seenSerialized.has(key)) exactDuplicateRows++;
    else seenSerialized.add(key);
  }

  // Duplicates by business key, once customer_id whitespace is stripped. This
  // is the number that matters and it is NOT the same as the one above.
  const seenTxnIds = new Set<string>();
  for (const t of allTxns) seenTxnIds.add(t.transaction_id.trim());
  const uniqueTransactionIds = seenTxnIds.size;

  const uniqueCustomersInTxns = new Set(allTxns.map((t) => t.customer_id.trim())).size;

  // The merge explosion: inner join on customer_id against a dimension table
  // holding 120 duplicated keys.
  const customerRowCounts = new Map<string, number>();
  for (const c of customerRows) {
    customerRowCounts.set(c.customer_id, (customerRowCounts.get(c.customer_id) ?? 0) + 1);
  }
  const dedupedTxns = [...seenTxnIds];
  const txnById = new Map<string, Txn>();
  for (const t of allTxns) txnById.set(t.transaction_id.trim(), t);

  let explodedRows = 0;
  for (const id of dedupedTxns) {
    const cust = txnById.get(id)!.customer_id.trim();
    explodedRows += customerRowCounts.get(cust) ?? 0;
  }

  // Summed in integer cents so the figure is exact rather than dependent on
  // float accumulation order - the learner's pandas sum will round to this.
  const totalCents = dedupedTxns.reduce(
    (sum, id) => sum + (centsByTxn.get(id) ?? 0),
    0,
  );
  const totalRevenue = totalCents / 100;

  return {
    rawRows,
    exactDuplicateRows,
    rowsAfterExactDedup: rawRows - exactDuplicateRows,
    uniqueTransactionIds,
    uniqueCustomersInTxns,
    customerTableRows: customerRows.length,
    duplicatedCustomerIds: DUPLICATED_CUSTOMERS,
    rowsAfterNaiveMerge: explodedRows,
    canonicalChannels: CANONICAL_CHANNELS,
    totalRevenue,
  };
}

/* ---------------------------------------- node 2.3 - the leaky dataset */

/**
 * Appendix B: "Three planted leaks: target encoding applied before the split,
 * a scaler fit on the full dataset, and a feature computed from future data."
 *
 * Leaks 1 and 2 are properties of the starter pipeline, not of the CSV. Leak 3
 * has to be baked into the data itself, so `days_since_last_login` is drawn
 * from near-disjoint ranges by outcome. We compute its exact separability here
 * so the checklist can state a real number rather than a vibe.
 */
function generateLeakageDataset() {
  const rng = makeRng(20230223);

  const N = 6000;
  const CHURN_RATE = 0.27;

  /** An ordinary, legitimate, low-cardinality feature. Not a leak. */
  const COHORTS = Array.from({ length: 36 }, (_, i) => {
    const year = 2021 + Math.floor(i / 12);
    const month = (i % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });

  const PLANS = ["basic", "plus", "pro", "enterprise"];

  /*
   * Leak 1 needs a HIGH-cardinality column to bite. Target-encoding a 36-level
   * cohort on the full dataset is barely detectable in the aggregate score - we
   * measured it at 0.55 AUC, which teaches nothing. Target-encoding a promo code
   * shared by about four customers means the encoded value is the mean of four
   * labels including the row's own, so a quarter of the answer is written
   * directly into the feature column. This is the realistic version of the
   * mistake too: people target-encode SKUs, zip codes and user ids, not months.
   */
  const PROMO_CODES = 1500;
  const promoAssignments: string[] = [];
  for (let i = 0; i < N; i++) {
    promoAssignments.push(`PROMO-${String(i % PROMO_CODES).padStart(4, "0")}`);
  }
  for (let i = promoAssignments.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [promoAssignments[i], promoAssignments[j]] = [
      promoAssignments[j],
      promoAssignments[i],
    ];
  }

  const rows: Record<string, string>[] = [];
  let churnCount = 0;
  let separableByLogin = 0;

  const LOGIN_THRESHOLD = 30;

  for (let i = 0; i < N; i++) {
    const churned = rng() < CHURN_RATE;
    if (churned) churnCount++;

    // Leak 3. Recorded AFTER the outcome window, so at prediction time this
    // column does not exist. It looks innocuous next to the others.
    const daysSinceLastLogin = churned
      ? Math.round(gaussian(rng, 52, 14))
      : Math.round(gaussian(rng, 9, 8));
    const clampedLogin = Math.min(180, Math.max(0, daysSinceLastLogin));
    if ((clampedLogin >= LOGIN_THRESHOLD) === churned) separableByLogin++;

    /*
     * Honest features. Weakly predictive on purpose: each one overlaps heavily
     * between the two classes, so an honest model lands somewhere in the high
     * 0.70s and the drop from the leaky score is unmistakable. They also sit on
     * wildly different scales - months, dollars, counts, percentages - which is
     * what makes leak 2 (one scaler fitted on everything) so tempting.
     */
    const tenureMonths = Math.max(1, Math.round(gaussian(rng, churned ? 13 : 18, 11)));
    const monthlySpend = Math.max(
      5,
      Math.round(gaussian(rng, churned ? 46 : 56, 28) * 100) / 100,
    );
    const supportTickets = Math.max(
      0,
      Math.round(gaussian(rng, churned ? 2.7 : 1.9, 2.4)),
    );
    const seats = Math.max(1, Math.round(gaussian(rng, churned ? 5 : 7, 5)));
    const featureUsePct =
      Math.round(Math.min(100, Math.max(0, gaussian(rng, churned ? 38 : 51, 24))) * 10) /
      10;

    rows.push({
      customer_id: `U${String(i + 1).padStart(6, "0")}`,
      promo_code: promoAssignments[i],
      signup_cohort: pick(rng, COHORTS),
      plan: pick(rng, PLANS),
      tenure_months: String(tenureMonths),
      seats: String(seats),
      monthly_spend: monthlySpend.toFixed(2),
      support_tickets_90d: String(supportTickets),
      feature_use_pct: featureUsePct.toFixed(1),
      days_since_last_login: String(clampedLogin),
      churned: churned ? "1" : "0",
    });
  }

  // Shuffle so cohort order carries no signal of its own.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  write("leaky-churn.csv", toCsv(rows));
  write("leaky_pipeline.py", LEAKY_PIPELINE_SOURCE);

  const promoCounts = new Map<string, number>();
  for (const r of rows) {
    promoCounts.set(r.promo_code, (promoCounts.get(r.promo_code) ?? 0) + 1);
  }
  const cohortLevels = new Set(rows.map((r) => r.signup_cohort)).size;

  return {
    rows: N,
    columns: Object.keys(rows[0]).length,
    churnCount,
    churnRatePct: Math.round((churnCount / N) * 1000) / 10,
    loginThreshold: LOGIN_THRESHOLD,
    separableByLogin,
    separablePct: Math.round((separableByLogin / N) * 1000) / 10,
    promoCodeLevels: promoCounts.size,
    medianRowsPerPromoCode:
      [...promoCounts.values()].sort((a, b) => a - b)[
        Math.floor(promoCounts.size / 2)
      ],
    cohortLevels,
  };
}

/** The starter pipeline handed to the learner. All three leaks are live. */
const LEAKY_PIPELINE_SOURCE = `"""
Node 2.3 - the leaky pipeline.

This script reports a cross-validated ROC AUC that looks excellent. It is wrong
in three separate places. Your job is to find all three, fix them, and watch the
score get WORSE.

Every line below is something a competent person has actually shipped. None of
it raises a warning.

Do not read the answer key before you have a number you believe.

    pip install pandas scikit-learn
    python leaky_pipeline.py
"""

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.preprocessing import StandardScaler

df = pd.read_csv("leaky-churn.csv")

y = df["churned"]
X = df.drop(columns=["churned", "customer_id"])

# --- encode the promo code ----------------------------------------------
# 1,500 distinct codes, so one-hot would be unwieldy. Replace each code with
# the average churn rate of customers who used it.
promo_means = df.groupby("promo_code")["churned"].mean()
X["promo_code"] = X["promo_code"].map(promo_means)

X = pd.get_dummies(X, columns=["plan", "signup_cohort"], drop_first=True)

# --- scale ---------------------------------------------------------------
# Logistic regression wants comparable scales, and these columns are months,
# dollars, counts and percentages.
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# --- evaluate ------------------------------------------------------------
model = LogisticRegression(max_iter=2000)
cv = cross_val_score(model, X_scaled, y, cv=5, scoring="roc_auc")

X_train, X_test, y_train, y_test = train_test_split(
    X_scaled, y, test_size=0.2, random_state=42, stratify=y
)
model.fit(X_train, y_train)
holdout = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])

print(f"cross-validated ROC AUC: {cv.mean():.4f}  (+/- {cv.std():.4f})")
print(f"held-out ROC AUC:        {holdout:.4f}")
print(f"gap:                     {abs(cv.mean() - holdout):.4f}")
print()
print("Feeling good about that number is the thing this node is testing.")
`;

/* ------------------------------------------- node 0.5 - plotting to see */

/**
 * Two files, both making the same argument from opposite directions.
 *
 * `anscombe.csv` is Anscombe's 1973 quartet verbatim: four series whose means,
 * variances, correlation and fitted line agree to two decimal places and which
 * look nothing like each other. It is the canonical demonstration that summary
 * statistics are not a summary.
 *
 * `sensor-readings.csv` makes the same point on data that looks modern and
 * boring: one sensor is stuck, reporting exactly 0.0 for a fixed share of its
 * readings. The mean barely moves. A histogram gives it away instantly.
 */
function generatePlottingDatasets() {
  const X_A = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
  const QUARTET: Record<string, { x: number[]; y: number[] }> = {
    I: {
      x: X_A,
      y: [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68],
    },
    II: {
      x: X_A,
      y: [9.14, 8.14, 8.74, 8.77, 9.26, 8.1, 6.13, 3.1, 9.13, 7.26, 4.74],
    },
    III: {
      x: X_A,
      y: [7.46, 6.77, 12.74, 7.11, 7.81, 8.84, 6.08, 5.39, 8.15, 6.42, 5.73],
    },
    IV: {
      x: [8, 8, 8, 8, 8, 8, 8, 19, 8, 8, 8],
      y: [6.58, 5.76, 7.71, 8.84, 8.47, 7.04, 5.25, 12.5, 5.56, 7.91, 6.89],
    },
  };

  const quartetRows: Record<string, string>[] = [];
  for (const [group, { x, y }] of Object.entries(QUARTET)) {
    x.forEach((xi, i) => {
      quartetRows.push({ dataset: group, x: String(xi), y: y[i].toFixed(2) });
    });
  }
  write("anscombe.csv", toCsv(quartetRows));

  // --- the stuck sensor -------------------------------------------------
  const rng = makeRng(505);
  const N_PER_SENSOR = 3000;
  const SENSORS = ["S-01", "S-02", "S-03", "S-04"];
  const STUCK_SENSOR = "S-03";
  const STUCK_FRACTION = 0.18;

  const rows: Record<string, string>[] = [];
  let stuckCount = 0;

  for (const sensor of SENSORS) {
    for (let i = 0; i < N_PER_SENSOR; i++) {
      let reading: number;
      if (sensor === STUCK_SENSOR && rng() < STUCK_FRACTION) {
        // Dropout: the sensor reports a hard zero rather than a measurement.
        reading = 0;
        stuckCount++;
      } else {
        // Bimodal on purpose: a day mode and a night mode. The mean sits in the
        // trough, where no actual reading ever lands.
        reading =
          rng() < 0.5 ? gaussian(rng, 18.5, 2.2) : gaussian(rng, 31.5, 2.4);
      }
      rows.push({
        sensor_id: sensor,
        hour: String(i % 24),
        reading_c: reading.toFixed(3),
      });
    }
  }

  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  write("sensor-readings.csv", toCsv(rows));

  const readings = rows.map((r) => Number(r.reading_c));
  const mean = readings.reduce((a, b) => a + b, 0) / readings.length;
  const stuck = rows.filter((r) => r.sensor_id === STUCK_SENSOR);
  const stuckReadings = stuck.map((r) => Number(r.reading_c));
  const stuckMean =
    stuckReadings.reduce((a, b) => a + b, 0) / stuckReadings.length;
  const healthy = rows.filter((r) => r.sensor_id !== STUCK_SENSOR);
  const healthyMean =
    healthy.reduce((a, r) => a + Number(r.reading_c), 0) / healthy.length;

  // How many readings fall in the trough between the two modes? Almost none -
  // which is why the overall mean describes nothing.
  const inTrough = readings.filter((r) => r > 23 && r < 27).length;

  return {
    quartetRows: quartetRows.length,
    sensorRows: rows.length,
    stuckSensor: STUCK_SENSOR,
    exactZeroReadings: stuckCount,
    overallMean: Math.round(mean * 1000) / 1000,
    stuckSensorMean: Math.round(stuckMean * 1000) / 1000,
    healthySensorMean: Math.round(healthyMean * 1000) / 1000,
    readingsBetween23and27: inTrough,
  };
}

/* ------------------------------- node 1.5 - the feature-scaling trap */

/**
 * Appendix B: "Common wall: not normalizing features, then blaming the
 * algorithm."
 *
 * Two features on wildly different scales - one in units, one in tens of
 * thousands. The loss surface is a long thin valley, so any learning rate small
 * enough to be stable along the steep axis is far too small to make progress
 * along the shallow one. Gradient descent appears broken. It is not; the
 * conditioning is.
 *
 * The fix is one line of normalisation, and the point of handing over a file
 * rather than letting the learner generate it is that the exact condition number
 * and the exact closed-form solution can go in the checklist.
 */
function generateScalingTrapDataset() {
  const rng = makeRng(150);
  const N = 2000;

  const TRUE_INTERCEPT = 12.0;
  const TRUE_W1 = 3.0; // on a feature with sd ~1
  const TRUE_W2 = 0.0004; // on a feature with sd ~20000

  const rows: Record<string, string>[] = [];
  const x1s: number[] = [];
  const x2s: number[] = [];
  const ys: number[] = [];

  for (let i = 0; i < N; i++) {
    const x1 = gaussian(rng, 0, 1);
    const x2 = gaussian(rng, 50000, 20000);
    const noise = gaussian(rng, 0, 0.5);
    const y = TRUE_INTERCEPT + TRUE_W1 * x1 + TRUE_W2 * x2 + noise;
    x1s.push(x1);
    x2s.push(x2);
    ys.push(y);
    rows.push({
      x1: x1.toFixed(6),
      x2: x2.toFixed(2),
      y: y.toFixed(6),
    });
  }

  write("scaling-trap.csv", toCsv(rows));

  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const sd = (v: number[]) => {
    const m = mean(v);
    return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  };

  /*
   * The numbers a learner will actually reproduce come from the design matrix
   * they build - ones column, x1, x2 - not from the centred covariance. Power
   * iteration on (X^T X)/n gives the largest eigenvalue, which is what bounds
   * the stable learning rate at 2/lambda_max. Verified against numpy's
   * eigvalsh; see the node body.
   */
  const design = rows.map((_, i) => [1, x1s[i], x2s[i]]);

  const gram = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const row of design) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) gram[a][b] += (row[a] * row[b]) / N;
    }
  }

  const powerIterate = (m: number[][], iters = 500) => {
    let v = [1, 1, 1];
    let lambda = 0;
    for (let it = 0; it < iters; it++) {
      const next = m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
      const norm = Math.hypot(...next);
      v = next.map((x) => x / norm);
      lambda = norm;
    }
    return lambda;
  };

  // Only the largest eigenvalue is reported. Power iteration converges to it
  // reliably; the smallest needs a proper solver, and a checklist number we
  // cannot compute correctly is worse than one we leave out. numpy's
  // eigvalsh puts the condition number near 2.2e10 - quoted in the node body
  // as context, not asserted in the checklist.
  const lambdaMax = powerIterate(gram);

  return {
    rows: N,
    x1Sd: Math.round(sd(x1s) * 1000) / 1000,
    x2Sd: Math.round(sd(x2s)),
    scaleRatio: Math.round(sd(x2s) / sd(x1s)),
    gramLambdaMax: lambdaMax.toExponential(3),
    /** Plain gradient descent diverges above 2 / lambda_max. */
    maxStableLrUnscaled: (2 / lambdaMax).toExponential(3),
    maxStableLrScaled: "1.895 (after standardising both features)",
    trueIntercept: TRUE_INTERCEPT.toFixed(2),
    trueW1: TRUE_W1.toFixed(2),
    trueW2: TRUE_W2.toFixed(6),
  };
}

/* ------------------- nodes 2.1 and 3.1 - retail events with a cutoff */

/**
 * A year of transactions for 3,000 customers, generated so that pre-cutoff
 * behaviour genuinely predicts post-cutoff behaviour.
 *
 * Node 2.1 uses it to practise framing: choosing the prediction unit, the label
 * window and the cutoff date, then measuring a baseline. Node 3.1 builds RFM
 * features from it and has to keep every feature strictly behind the cutoff -
 * the leakage discipline from 2.3, applied where it is easiest to get wrong.
 *
 * Each customer has a latent activity rate and a latent lifetime. Customers who
 * churn stop transacting partway through the year, which is what makes recency
 * informative. Nothing about the file states any of this.
 */
function generateRetailDataset() {
  const rng = makeRng(210);

  const N_CUSTOMERS = 3000;
  const DAYS = 365;
  const CUTOFF_DAY = 274; // 2024-10-01 (2024 is a leap year, so Jan 1 + 274 days)
  const START = Date.UTC(2024, 0, 1);

  const CATEGORIES = ["grocery", "home", "apparel", "electronics", "beauty"];
  const CHANNELS = ["web", "mobile", "in-store"];

  const isoDay = (day: number) =>
    new Date(START + day * 86400000).toISOString().slice(0, 10);

  type Row = Record<string, string>;
  const rows: Row[] = [];

  let txnId = 0;
  const activeAfter = new Set<string>();
  const preCutoffCustomers = new Set<string>();

  for (let c = 0; c < N_CUSTOMERS; c++) {
    const customerId = `R${String(c + 1).padStart(5, "0")}`;

    // Latent rate: transactions per day. Heavily skewed - most customers are
    // light, a few are very heavy.
    const rate = Math.exp(gaussian(rng, -3.6, 0.9)); // ~0.027/day median

    // 45% of customers churn at some point during the year.
    const churns = rng() < 0.45;
    const churnDay = churns ? Math.floor(rng() * DAYS) : DAYS + 1;

    const basket = gaussian(rng, 55, 20);

    for (let day = 0; day < DAYS; day++) {
      if (day >= churnDay) break;
      if (rng() >= rate) continue;

      const amount = Math.max(3, gaussian(rng, basket, basket * 0.35));
      txnId++;
      rows.push({
        transaction_id: `X${String(txnId).padStart(6, "0")}`,
        customer_id: customerId,
        order_date: isoDay(day),
        amount: amount.toFixed(2),
        category: pick(rng, CATEGORIES),
        channel: pick(rng, CHANNELS),
      });

      if (day < CUTOFF_DAY) preCutoffCustomers.add(customerId);
      else activeAfter.add(customerId);
    }
  }

  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  write("retail-events.csv", toCsv(rows));

  // --- ground truth ------------------------------------------------------
  const population = [...preCutoffCustomers];
  const positives = population.filter((c) => activeAfter.has(c)).length;

  // RFM at the cutoff, and how well recency alone separates the label. Recency
  // is the honest, strong baseline that a first model has to beat.
  const lastDay = new Map<string, number>();
  const count = new Map<string, number>();
  const spend = new Map<string, number>();

  for (const r of rows) {
    const day = Math.round((Date.parse(r.order_date) - START) / 86400000);
    if (day >= CUTOFF_DAY) continue;
    const c = r.customer_id;
    lastDay.set(c, Math.max(lastDay.get(c) ?? -1, day));
    count.set(c, (count.get(c) ?? 0) + 1);
    spend.set(c, (spend.get(c) ?? 0) + Number(r.amount));
  }

  const scored = population.map((c) => ({
    recency: CUTOFF_DAY - (lastDay.get(c) ?? 0),
    label: activeAfter.has(c) ? 1 : 0,
  }));

  // Rank-based AUC for "lower recency means more likely to return".
  const sorted = [...scored].sort((a, b) => a.recency - b.recency);
  let rank = 1;
  let posRankSum = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].recency === sorted[i].recency) j++;
    const avgRank = (rank + (rank + (j - i))) / 2;
    for (let k = i; k <= j; k++) if (sorted[k].label === 1) posRankSum += avgRank;
    rank += j - i + 1;
    i = j + 1;
  }
  const nPos = positives;
  const nNeg = population.length - positives;
  const aucLowRecency = (posRankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);

  const recencies = population.map((c) => CUTOFF_DAY - (lastDay.get(c) ?? 0));
  const freqs = population.map((c) => count.get(c) ?? 0);
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  return {
    transactions: rows.length,
    distinctCustomers: new Set(rows.map((r) => r.customer_id)).size,
    cutoffDate: isoDay(CUTOFF_DAY),
    txnsBeforeCutoff: [...count.values()].reduce((a, b) => a + b, 0),
    modellingPopulation: population.length,
    positives,
    baseRate: Math.round((positives / population.length) * 10000) / 10000,
    medianRecencyDays: median(recencies),
    medianFrequency: median(freqs),
    recencyOnlyAuc: Math.round(Math.max(aucLowRecency, 1 - aucLowRecency) * 10000) / 10000,
  };
}

/* ---------------------------------- node 2.4 - metrics under imbalance */

/**
 * Appendix B: "Learner must identify the metric under which a majority-class-
 * always classifier appears to win."
 *
 * 50,000 card transactions with a 0.4% fraud rate. Predicting "not fraud" for
 * every single row scores 99.6% accuracy, which is higher than most real fraud
 * models achieve and is worth exactly nothing. There is real signal in the
 * features, so a model that actually tries can be compared against it.
 */
function generateFraudDataset() {
  const rng = makeRng(240);

  const N = 50000;
  const FRAUD_RATE = 0.004;

  const COUNTRIES = ["US", "GB", "DE", "FR", "CA", "AU", "JP", "BR"];
  const MCC = ["grocery", "fuel", "electronics", "travel", "gambling", "digital"];

  const rows: Record<string, string>[] = [];
  let frauds = 0;

  for (let i = 0; i < N; i++) {
    const isFraud = rng() < FRAUD_RATE;
    if (isFraud) frauds++;

    // Fraud skews to larger amounts, odd hours, foreign countries and a couple
    // of merchant categories - but every one of those overlaps heavily with
    // legitimate behaviour, so no single rule separates them.
    const amount = isFraud
      ? Math.exp(gaussian(rng, 5.1, 1.1))
      : Math.exp(gaussian(rng, 3.4, 1.0));

    const hour = isFraud
      ? (rng() < 0.55 ? intBetween(rng, 0, 5) : intBetween(rng, 0, 23))
      : intBetween(rng, 6, 23);

    const foreign = isFraud ? rng() < 0.45 : rng() < 0.08;
    const category = isFraud
      ? rng() < 0.4
        ? pick(rng, ["gambling", "digital", "electronics"])
        : pick(rng, MCC)
      : pick(rng, MCC);

    rows.push({
      transaction_id: `F${String(i + 1).padStart(6, "0")}`,
      amount: Math.min(9999, amount).toFixed(2),
      hour: String(hour),
      country: foreign ? pick(rng, COUNTRIES.slice(1)) : "US",
      category,
      distinct_cards_on_device_24h: String(
        isFraud ? intBetween(rng, 1, 6) : intBetween(rng, 1, 2),
      ),
      is_fraud: isFraud ? "1" : "0",
    });
  }

  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  write("fraud-transactions.csv", toCsv(rows));

  const negatives = N - frauds;
  return {
    rows: N,
    fraudRows: frauds,
    fraudRatePct: Math.round((frauds / N) * 100000) / 1000,
    alwaysNegativeAccuracy: Math.round((negatives / N) * 100000) / 100000,
    alwaysNegativeRecall: 0,
    alwaysNegativeRocAuc: 0.5,
    /** PR-AUC for a constant classifier is the positive rate, not 0.5. */
    alwaysNegativePrAuc: Math.round((frauds / N) * 100000) / 100000,
    costOfMissingAllFraud: "every one of the " + frauds + " fraudulent charges",
  };
}

/* ------------------------------------------------------------------- main */

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("\nWriting datasets to public/datasets\n");
  const pandas = generatePandasDataset();
  const leakage = generateLeakageDataset();
  const plotting = generatePlottingDatasets();
  const scaling = generateScalingTrapDataset();
  const retail = generateRetailDataset();
  const fraud = generateFraudDataset();

  console.log("\n" + "=".repeat(72));
  console.log("GROUND TRUTH - paste these into the MDX checklists");
  console.log("=".repeat(72));

  // One list, so adding a dataset cannot silently forget to report itself.
  const sections: [string, Record<string, string | number>][] = [
    ["node 0.3 - messy-transactions.csv + customers.csv", pandas],
    ["node 0.5 - anscombe.csv + sensor-readings.csv", plotting],
    ["node 1.5 - scaling-trap.csv", scaling],
    ["nodes 2.1 and 3.1 - retail-events.csv", retail],
    ["node 2.3 - leaky-churn.csv", leakage],
    ["node 2.4 - fraud-transactions.csv", fraud],
  ];

  for (const [title, values] of sections) {
    console.log(`\n${title}`);
    for (const [k, v] of Object.entries(values)) {
      console.log(
        `  ${k.padEnd(26)} ${typeof v === "number" ? v.toLocaleString("en-US") : v}`,
      );
    }
  }
  console.log();
}

main();
