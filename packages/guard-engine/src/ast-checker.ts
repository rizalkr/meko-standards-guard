import { execFileSync } from "node:child_process";
import type { GuardConfig, RuleDefinition } from "@meko-guard/core";
import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type SourceFile
} from "ts-morph";
import { getNodeLocation, makeViolation, toRepoRelative } from "./helpers.js";
import type { Violation } from "./types.js";

type FunctionLike =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunction
  | MethodDeclaration;

const MONEY_IDENT_RE =
  /cents|amount|price|fee|tax|total|subtotal|balance|payout|refund|payable|revenue|cost|discount/i;

const MONEY_ROUTE_RE = /^\/(invoices|payouts|refunds)\b|\/(capture|reverse|refund)\b/i;

const SQL_MUTATION_RE = /\b(UPDATE\s+ledger_entries|DELETE\s+FROM\s+ledger_entries)\b/i;

const INVOICE_GETTER_RE = /^(get|list|fetch|read|find).*Invoice/i;

function isMoneyContext(node: Node): boolean {
  if (MONEY_IDENT_RE.test(node.getText())) {
    return true;
  }
  const varDecl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (varDecl && MONEY_IDENT_RE.test(varDecl.getName())) {
    return true;
  }
  const propAssign = node.getFirstAncestorByKind(SyntaxKind.PropertyAssignment);
  if (propAssign && MONEY_IDENT_RE.test(propAssign.getName())) {
    return true;
  }
  const returnStmt = node.getFirstAncestorByKind(SyntaxKind.ReturnStatement);
  if (returnStmt) {
    const fn = getEnclosingFunction(returnStmt);
    const fnName = getFunctionName(fn);
    if (fnName && MONEY_IDENT_RE.test(fnName)) {
      return true;
    }
  }
  return false;
}

function getEnclosingFunction(node: Node): FunctionLike | undefined {
  let current = node.getParent();
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isArrowFunction(current) ||
      Node.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.getParent();
  }
  return undefined;
}

function getFunctionName(fn: FunctionLike | undefined): string | undefined {
  if (!fn) {
    return undefined;
  }
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn) || Node.isFunctionExpression(fn)) {
    const name = fn.getName();
    if (name) {
      return name;
    }
  }
  const parent = fn.getParent();
  if (Node.isVariableDeclaration(parent)) {
    return parent.getName();
  }
  if (Node.isPropertyAssignment(parent)) {
    return parent.getName();
  }
  return undefined;
}

function getCalleeName(call: CallExpression): string {
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) {
    return expr.getText();
  }
  if (Node.isPropertyAccessExpression(expr)) {
    return expr.getName();
  }
  return expr.getText();
}

function getCalleeFullText(call: CallExpression): string {
  return call.getExpression().getText();
}

function isFloatNumericLiteral(node: Node): boolean {
  return Node.isNumericLiteral(node) && node.getLiteralText().includes(".");
}

function isCurrencyScaleDivisorLiteral(node: Node): boolean {
  if (!Node.isNumericLiteral(node)) {
    return false;
  }
  const raw = node.getLiteralText().replace(/_/g, "");
  return raw === "100" || raw === "10000";
}

function checkS1FloatMoney(
  sourceFile: SourceFile,
  relFile: string,
  rulesById: Map<string, RuleDefinition>
): Violation[] {
  const violations: Violation[] = [];

  for (const binExpr of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const op = binExpr.getOperatorToken().getKind();
    if (op !== SyntaxKind.AsteriskToken && op !== SyntaxKind.SlashToken) {
      continue;
    }

    const left = binExpr.getLeft();
    const right = binExpr.getRight();
    const text = binExpr.getText();
    if (text.includes("Date.now")) {
      continue;
    }

    const hasFloat = isFloatNumericLiteral(left) || isFloatNumericLiteral(right);
    const hasCurrencyDivisor =
      op === SyntaxKind.SlashToken && isCurrencyScaleDivisorLiteral(right);

    if ((hasFloat || hasCurrencyDivisor) && isMoneyContext(binExpr)) {
      const loc = getNodeLocation(binExpr);
      violations.push(
        makeViolation(rulesById, "S1", {
          file: relFile,
          ...loc,
          message: "Floating-point or decimal money arithmetic detected in financial calculation",
          remediation:
            "Use integer minor units (cents) and BigInt banker's rounding (multiplyBpsBankers) instead of floats or / 100."
        })
      );
    }
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const fullName = getCalleeFullText(call);
    const methodName = getCalleeName(call);

    if (fullName === "parseFloat" || fullName === "Number.parseFloat") {
      const loc = getNodeLocation(call);
      violations.push(
        makeViolation(rulesById, "S1", {
          file: relFile,
          ...loc,
          message: `${fullName}() converts money strings into binary floating-point numbers`,
          remediation:
            "Parse minor-unit integers explicitly and validate with assertSafeCents()."
        })
      );
      continue;
    }

    if (
      fullName === "Math.round" ||
      fullName === "Math.floor" ||
      fullName === "Math.ceil"
    ) {
      const argsText = call.getArguments().map((a) => a.getText()).join(" ");
      if (argsText.includes("Date.now")) {
        continue;
      }
      if (MONEY_IDENT_RE.test(argsText) || isMoneyContext(call)) {
        const loc = getNodeLocation(call);
        violations.push(
          makeViolation(rulesById, "S1", {
            file: relFile,
            ...loc,
            message: `${methodName}() used on monetary value instead of exact BigInt banker's rounding`,
            remediation:
              "Replace Math.round/floor/ceil on money values with multiplyBpsBankers(amountCents, bps)."
          })
        );
      }
    }
  }

  return violations;
}

function checkS2Idempotency(
  sourceFile: SourceFile,
  relFile: string,
  rulesById: Map<string, RuleDefinition>
): Violation[] {
  const violations: Violation[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) {
      continue;
    }
    const method = expr.getName();
    if (method !== "post" && method !== "put" && method !== "patch") {
      continue;
    }

    const args = call.getArguments();
    if (args.length < 2 || !Node.isStringLiteral(args[0])) {
      continue;
    }
    const routePath = args[0].getLiteralValue();
    if (routePath.startsWith("/webhooks") || !MONEY_ROUTE_RE.test(routePath)) {
      continue;
    }

    const middlewareArgs = args.slice(1, -1);
    const hasIdempotencyMiddleware = middlewareArgs.some((arg) =>
      arg.getText().includes("requireIdempotency")
    );

    if (!hasIdempotencyMiddleware) {
      const loc = getNodeLocation(call);
      violations.push(
        makeViolation(rulesById, "S2", {
          file: relFile,
          ...loc,
          message: `Money-mutating route ${method.toUpperCase()} "${routePath}" is missing requireIdempotency middleware`,
          remediation:
            "Pass requireIdempotency(db) as middleware before the route handler and read cached rawBody via c.get(\"rawBody\")."
        })
      );
    }
  }

  return violations;
}

function checkS3AppendOnlyLedger(
  sourceFile: SourceFile,
  relFile: string,
  rulesById: Map<string, RuleDefinition>
): Violation[] {
  const violations: Violation[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) {
      continue;
    }
    const method = expr.getName();
    if (method !== "update" && method !== "delete") {
      continue;
    }

    const targetArg = call.getArguments()[0];
    if (!targetArg) {
      continue;
    }
    const targetName = targetArg.getText();
    if (targetName === "ledgerEntries" || targetName.endsWith(".ledgerEntries")) {
      const loc = getNodeLocation(call);
      violations.push(
        makeViolation(rulesById, "S3", {
          file: relFile,
          ...loc,
          message: `Forbidden ${method}(ledgerEntries) call violates append-only ledger invariant`,
          remediation:
            "Never update or delete ledger_entries rows; append compensating REVERSAL rows via reverseLedgerGroup(tx, txGroupId, reason)."
        })
      );
    }
  }

  const stringNodes = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.TemplateHead)
  ];

  for (const strNode of stringNodes) {
    if (SQL_MUTATION_RE.test(strNode.getText())) {
      const loc = getNodeLocation(strNode);
      violations.push(
        makeViolation(rulesById, "S3", {
          file: relFile,
          ...loc,
          message: "Raw SQL UPDATE/DELETE targeting ledger_entries violates append-only ledger invariant",
          remediation:
            "Use reverseLedgerGroup() to append balanced REVERSAL entries instead of mutating ledger_entries."
        })
      );
    }
  }

  return violations;
}

function isTransactionCallback(fn: FunctionLike): boolean {
  const parentCall = fn.getParentIfKind(SyntaxKind.CallExpression);
  if (!parentCall) {
    return false;
  }
  const expr = parentCall.getExpression();
  return Node.isPropertyAccessExpression(expr) && expr.getName() === "transaction";
}

function findEnclosingTransactionCall(
  node: Node,
  boundaryFn: FunctionLike
): CallExpression | undefined {
  let current = node.getParent();
  while (current && current !== boundaryFn) {
    if (Node.isCallExpression(current)) {
      const expr = current.getExpression();
      if (Node.isPropertyAccessExpression(expr) && expr.getName() === "transaction") {
        return current;
      }
    }
    current = current.getParent();
  }
  return undefined;
}

function isLedgerInsertCall(call: CallExpression): boolean {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== "insert") {
    return false;
  }
  const argText = call.getArguments()[0]?.getText() ?? "";
  return argText === "ledgerEntries" || argText.endsWith(".ledgerEntries");
}

function checkS5AtomicTransaction(
  sourceFile: SourceFile,
  relFile: string,
  rulesById: Map<string, RuleDefinition>
): Violation[] {
  const violations: Violation[] = [];
  const fnNodes: FunctionLike[] = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)
  ];

  const isPayoutOrRefundFile = /payout|refund/i.test(relFile);

  for (const fn of fnNodes) {
    if (isTransactionCallback(fn)) {
      continue;
    }

    // Inspect calls directly inside this function or inside its inline db.transaction(...) callbacks.
    const fnName = getFunctionName(fn) ?? "";
    const calls = fn.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
      const owner = getEnclosingFunction(call);
      if (owner === fn) {
        return true;
      }
      return (
        owner !== undefined &&
        isTransactionCallback(owner) &&
        getEnclosingFunction(owner) === fn
      );
    });

    const balanceCalls = calls.filter(
      (c) => getCalleeName(c) === "getMerchantBalanceCents"
    );
    const writeCalls = calls.filter((c) => {
      const name = getCalleeName(c);
      return (
        name === "postBalancedEntries" ||
        name === "reverseLedgerGroup" ||
        isLedgerInsertCall(c)
      );
    });

    if (writeCalls.length === 0) {
      continue;
    }

    if (balanceCalls.length > 0) {
      let emittedForFn = false;
      for (const writeCall of writeCalls) {
        const writeTx = findEnclosingTransactionCall(writeCall, fn);
        for (const balCall of balanceCalls) {
          const balTx = findEnclosingTransactionCall(balCall, fn);
          if (!balTx || !writeTx || balTx !== writeTx) {
            const loc = getNodeLocation(writeCall);
            violations.push(
              makeViolation(rulesById, "S5", {
                file: relFile,
                ...loc,
                message:
                  "Balance check (getMerchantBalanceCents) and ledger mutation are not enclosed in the same db.transaction(..., { behavior: \"immediate\" })",
                remediation:
                  "Move both getMerchantBalanceCents(tx, merchantId) and ledger writes inside the same immediate transaction callback."
              })
            );
            emittedForFn = true;
            break;
          }
        }
        if (emittedForFn) {
          break;
        }
      }
      continue;
    }

    const isTxHelper =
      /InTx$/i.test(fnName) ||
      fn.getParameters().some((p) => p.getName() === "tx");
    const isPayoutOrRefundFn = /^(create|process)(Payout|Refund)/i.test(fnName);

    if ((isPayoutOrRefundFile || isPayoutOrRefundFn) && !isTxHelper) {
      for (const writeCall of writeCalls) {
        if (!findEnclosingTransactionCall(writeCall, fn)) {
          const loc = getNodeLocation(writeCall);
          violations.push(
            makeViolation(rulesById, "S5", {
              file: relFile,
              ...loc,
              message:
                "Payout or refund ledger write executes outside an immediate database transaction",
              remediation:
                "Wrap the operation in db.transaction((tx) => ..., { behavior: \"immediate\" })."
            })
          );
          break;
        }
      }
    }
  }

  return violations;
}

function checkS6WebhookOrder(
  sourceFile: SourceFile,
  relFile: string,
  rulesById: Map<string, RuleDefinition>
): Violation[] {
  const violations: Violation[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== "post") {
      continue;
    }
    const args = call.getArguments();
    if (args.length < 2 || !Node.isStringLiteral(args[0])) {
      continue;
    }
    const routePath = args[0].getLiteralValue();
    if (!routePath.startsWith("/webhooks")) {
      continue;
    }

    const handler = args[args.length - 1];
    if (!Node.isArrowFunction(handler) && !Node.isFunctionExpression(handler)) {
      continue;
    }

    const handlerCalls = handler.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const reqJsonCall of handlerCalls) {
      if (reqJsonCall.getExpression().getText() === "c.req.json") {
        const loc = getNodeLocation(reqJsonCall);
        violations.push(
          makeViolation(rulesById, "S6", {
            file: relFile,
            ...loc,
            message: `Webhook route "${routePath}" calls c.req.json() before HMAC signature verification`,
            remediation:
              "Read raw body with await c.req.text() and verify signature via verifyWebhookSignature() before JSON parsing."
          })
        );
      }
    }

    const verifyCalls = handlerCalls.filter((c) => {
      const name = getCalleeName(c);
      return name === "verifyWebhookSignature" || name === "timingSafeEqual";
    });
    const parseCalls = handlerCalls.filter((c) => getCalleeFullText(c) === "JSON.parse");

    if (parseCalls.length === 0) {
      continue;
    }

    const earliestVerifyStart =
      verifyCalls.length > 0
        ? Math.min(...verifyCalls.map((c) => c.getStart()))
        : Number.POSITIVE_INFINITY;

    for (const parseCall of parseCalls) {
      if (parseCall.getStart() < earliestVerifyStart) {
        const loc = getNodeLocation(parseCall);
        const reason =
          verifyCalls.length === 0
            ? `Webhook route "${routePath}" parses JSON without verifying HMAC signature`
            : `Webhook route "${routePath}" calls JSON.parse() before verifyWebhookSignature()`;
        violations.push(
          makeViolation(rulesById, "S6", {
            file: relFile,
            ...loc,
            message: reason,
            remediation:
              "Verify X-Signature and X-Timestamp against await c.req.text() using verifyWebhookSignature() prior to calling JSON.parse()."
          })
        );
      }
    }
  }

  return violations;
}

function checkS7InvoiceSnapshots(
  sourceFile: SourceFile,
  relFile: string,
  rulesById: Map<string, RuleDefinition>
): Violation[] {
  const violations: Violation[] = [];
  const fnNodes: FunctionLike[] = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)
  ];

  for (const fn of fnNodes) {
    const fnName = getFunctionName(fn) ?? "";
    let isInvoiceRead = INVOICE_GETTER_RE.test(fnName);

    if (!isInvoiceRead) {
      const parentCall = fn.getParentIfKind(SyntaxKind.CallExpression);
      const expr = parentCall?.getExpression();
      if (
        parentCall &&
        expr &&
        Node.isPropertyAccessExpression(expr) &&
        expr.getName() === "get"
      ) {
        const routeArg = parentCall.getArguments()[0];
        if (routeArg && Node.isStringLiteral(routeArg) && routeArg.getLiteralValue().startsWith("/invoices")) {
          isInvoiceRead = true;
        }
      }
    }

    if (!isInvoiceRead) {
      continue;
    }

    for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const name = getCalleeName(call);
      const arg0 = call.getArguments()[0]?.getText() ?? "";
      const readsMerchantRates =
        (name === "from" || name === "innerJoin" || name === "leftJoin") &&
        (arg0 === "merchants" || arg0.endsWith(".merchants"));
      const recalculatesBps = name === "multiplyBpsBankers";

      if (readsMerchantRates || recalculatesBps) {
        const loc = getNodeLocation(call);
        violations.push(
          makeViolation(rulesById, "S7", {
            file: relFile,
            ...loc,
            message:
              "Invoice retrieval reads live merchant rates or recalculates fee/tax instead of reading immutable invoice snapshot columns",
            remediation:
              "Read persisted taxRateBps, taxCents, feeBps, feeCents, and totalCents directly from the invoices table."
          })
        );
      }
    }
  }

  return violations;
}

/**
 * Runs deterministic AST invariant checks (S1, S2, S3, S5, S6, S7) across parsed ts-morph SourceFiles.
 */
export function runAstChecks(
  sourceFiles: readonly SourceFile[],
  rootDir: string,
  rulesById: Map<string, RuleDefinition>
): Violation[] {
  const violations: Violation[] = [];

  for (const sourceFile of sourceFiles) {
    const relFile = toRepoRelative(rootDir, sourceFile.getFilePath());
    violations.push(
      ...checkS1FloatMoney(sourceFile, relFile, rulesById),
      ...checkS2Idempotency(sourceFile, relFile, rulesById),
      ...checkS3AppendOnlyLedger(sourceFile, relFile, rulesById),
      ...checkS5AtomicTransaction(sourceFile, relFile, rulesById),
      ...checkS6WebhookOrder(sourceFile, relFile, rulesById),
      ...checkS7InvoiceSnapshots(sourceFile, relFile, rulesById)
    );
  }

  return violations;
}

function getGitChangedFiles(rootDir: string): string[] {
  const files = new Set<string>();
  const cmds: string[][] = [
    ["diff", "--name-only", "HEAD"],
    ["diff", "--cached", "--name-only"]
  ];

  for (const args of cmds) {
    try {
      const stdout = execFileSync("git", args, {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          files.add(trimmed.replace(/\\/g, "/"));
        }
      }
    } catch {
      return [];
    }
  }

  return [...files].sort();
}

/**
 * Flags unapproved modifications to standards ADRs or guard.config.json (S8).
 */
export function checkGovernanceDiff(
  rootDir: string,
  config: GuardConfig,
  changedFiles?: string[],
  allowPolicyEdit = false
): Violation[] {
  if (allowPolicyEdit) {
    return [];
  }

  const rulesById = new Map(config.rules.map((r) => [r.id, r]));
  const filesToCheck = changedFiles ?? getGitChangedFiles(rootDir);
  const standardsPrefix = `${config.standardsDir.replace(/^\/+|\/+$/g, "")}/`;
  const violations: Violation[] = [];

  for (const rawFile of filesToCheck) {
    const normalized = rawFile.replace(/\\/g, "/").replace(/^\.\//, "");
    const isStandardsAdr =
      normalized.startsWith(standardsPrefix) && normalized.endsWith(".md");
    const isGuardConfig = normalized === "guard.config.json";

    if (isStandardsAdr || isGuardConfig) {
      violations.push(
        makeViolation(rulesById, "S8", {
          file: normalized,
          line: 1,
          message: `Unapproved modification to protected governance file "${normalized}"`,
          remediation:
            "Revert agent edits to standards/ or guard.config.json, or re-run with explicit maintainer authorization (--allow-policy-edit)."
        })
      );
    }
  }

  return violations;
}
