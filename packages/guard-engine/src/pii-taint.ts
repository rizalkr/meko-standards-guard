import type { RuleDefinition } from "@meko-guard/core";
import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type ObjectLiteralExpression,
  type SourceFile
} from "ts-morph";
import { getNodeLocation, makeViolation, toRepoRelative } from "./helpers.js";
import type { Violation } from "./types.js";

type FunctionLike =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunction
  | MethodDeclaration;

const PII_FIELDS = new Set([
  "bankAccountNumber",
  "bank_account_number",
  "routingNumber",
  "routing_number",
  "taxId",
  "tax_id"
]);

const SAFE_MERCHANT_FIELDS = new Set([
  "id",
  "name",
  "email",
  "feeBps",
  "taxRateBps",
  "createdAt"
]);

const SANITIZERS = new Set(["toPublicMerchantDto"]);

const LOG_SINK_CALLEES = new Set([
  "console.log",
  "console.info",
  "console.warn",
  "console.error",
  "console.debug",
  "logger.log",
  "logger.info",
  "logger.warn",
  "logger.error",
  "logger.debug"
]);

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

function containsSanitizerCall(node: Node): boolean {
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    const name = Node.isIdentifier(callee)
      ? callee.getText()
      : Node.isPropertyAccessExpression(callee)
        ? callee.getName()
        : "";
    if (SANITIZERS.has(name)) {
      return true;
    }
  }
  return node.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => {
    const callee = c.getExpression();
    const name = Node.isIdentifier(callee)
      ? callee.getText()
      : Node.isPropertyAccessExpression(callee)
        ? callee.getName()
        : "";
    return SANITIZERS.has(name);
  });
}

function getObjectPropertyName(prop: Node): string | undefined {
  if (Node.isPropertyAssignment(prop)) {
    return prop.getName().replace(/^["']|["']$/g, "");
  }
  if (Node.isShorthandPropertyAssignment(prop)) {
    return prop.getName();
  }
  return undefined;
}

function hasDirectPiiProperty(obj: ObjectLiteralExpression): string | undefined {
  for (const prop of obj.getProperties()) {
    const name = getObjectPropertyName(prop);
    if (name && PII_FIELDS.has(name)) {
      return name;
    }
  }
  return undefined;
}

function isFullOrPiiMerchantSelect(expr: Node): boolean {
  const calls = [
    ...(Node.isCallExpression(expr) ? [expr] : []),
    ...expr.getDescendantsOfKind(SyntaxKind.CallExpression)
  ];

  const readsMerchants = calls.some((call) => {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "from") {
      return false;
    }
    const arg0 = call.getArguments()[0]?.getText() ?? "";
    return arg0 === "merchants" || arg0.endsWith(".merchants");
  });

  if (!readsMerchants) {
    return false;
  }

  const selectCall = calls.find((call) => {
    const callee = call.getExpression();
    return Node.isPropertyAccessExpression(callee) && callee.getName() === "select";
  });

  if (!selectCall || selectCall.getArguments().length === 0) {
    return true;
  }

  const selectArg = selectCall.getArguments()[0];
  if (Node.isObjectLiteralExpression(selectArg)) {
    const argText = selectArg.getText();
    return [...PII_FIELDS].some((field) => argText.includes(field));
  }

  return true;
}

function isSafeScalarAccessOnTainted(
  expr: Node,
  taintedVars: Map<string, string[]>
): boolean {
  if (Node.isPropertyAccessExpression(expr)) {
    const base = expr.getExpression();
    const field = expr.getName();
    return (
      Node.isIdentifier(base) &&
      taintedVars.has(base.getText()) &&
      SAFE_MERCHANT_FIELDS.has(field)
    );
  }
  return false;
}

function findReferencedTaintedVar(
  node: Node,
  taintedVars: Map<string, string[]>
): { name: string; trace: string[] } | undefined {
  if (containsSanitizerCall(node) && !Node.isObjectLiteralExpression(node)) {
    return undefined;
  }

  if (Node.isIdentifier(node)) {
    const trace = taintedVars.get(node.getText());
    return trace ? { name: node.getText(), trace } : undefined;
  }

  if (isSafeScalarAccessOnTainted(node, taintedVars)) {
    return undefined;
  }

  if (Node.isObjectLiteralExpression(node)) {
    for (const prop of node.getProperties()) {
      if (Node.isSpreadAssignment(prop)) {
        const hit = findReferencedTaintedVar(prop.getExpression(), taintedVars);
        if (hit) {
          return hit;
        }
      } else if (Node.isShorthandPropertyAssignment(prop)) {
        const trace = taintedVars.get(prop.getName());
        if (trace) {
          return { name: prop.getName(), trace };
        }
      } else if (Node.isPropertyAssignment(prop)) {
        const init = prop.getInitializer();
        if (init && !containsSanitizerCall(init)) {
          const hit = findReferencedTaintedVar(init, taintedVars);
          if (hit) {
            return hit;
          }
        }
      }
    }
    return undefined;
  }

  for (const ident of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const trace = taintedVars.get(ident.getText());
    if (!trace) {
      continue;
    }
    const parent = ident.getParent();
    if (
      parent &&
      Node.isPropertyAccessExpression(parent) &&
      parent.getExpression() === ident &&
      SAFE_MERCHANT_FIELDS.has(parent.getName())
    ) {
      continue;
    }
    return { name: ident.getText(), trace };
  }

  return undefined;
}

function isSinkCall(call: CallExpression): string | undefined {
  const full = call.getExpression().getText();
  if (full === "c.json" || full === "res.json") {
    return `${full}()`;
  }
  if (LOG_SINK_CALLEES.has(full)) {
    return `${full}()`;
  }
  return undefined;
}

function inspectSinkNode(
  node: Node,
  sinkName: string,
  taintedVars: Map<string, string[]>,
  relFile: string,
  rulesById: Map<string, RuleDefinition>,
  out: Violation[]
): void {
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    const fnName = Node.isIdentifier(callee)
      ? callee.getText()
      : Node.isPropertyAccessExpression(callee)
        ? callee.getName()
        : "";
    if (SANITIZERS.has(fnName)) {
      return;
    }
  }

  if (Node.isPropertyAccessExpression(node) && PII_FIELDS.has(node.getName())) {
    const loc = getNodeLocation(node);
    const baseText = node.getExpression().getText();
    const baseTrace = taintedVars.get(baseText) ?? [];
    out.push(
      makeViolation(rulesById, "S4", {
        file: relFile,
        ...loc,
        message: `Sensitive financial PII field "${node.getName()}" flows directly into ${sinkName}`,
        remediation:
          "Strip sensitive PII via toPublicMerchantDto() and never log or return bankAccountNumber, routingNumber, or taxId.",
        trace: [
          ...baseTrace,
          `Sink (${relFile}:${loc.line}): exposed "${node.getText()}" in ${sinkName}`
        ]
      })
    );
    return;
  }

  if (Node.isPropertyAssignment(node)) {
    const nameNode = node.getNameNode();
    if (Node.isComputedPropertyName(nameNode)) {
      inspectSinkNode(nameNode.getExpression(), sinkName, taintedVars, relFile, rulesById, out);
    }
    const init = node.getInitializer();
    if (init) {
      inspectSinkNode(init, sinkName, taintedVars, relFile, rulesById, out);
    }
    return;
  }

  if (Node.isPropertyAccessExpression(node)) {
    inspectSinkNode(node.getExpression(), sinkName, taintedVars, relFile, rulesById, out);
    return;
  }

  if (Node.isObjectLiteralExpression(node)) {
    const piiProp = hasDirectPiiProperty(node);
    if (piiProp) {
      const loc = getNodeLocation(node);
      out.push(
        makeViolation(rulesById, "S4", {
          file: relFile,
          ...loc,
          message: `Object containing sensitive PII property "${piiProp}" passed into ${sinkName}`,
          remediation:
            "Use toPublicMerchantDto() to project only non-sensitive merchant fields before calling HTTP/log sinks.",
          trace: [`Sink (${relFile}:${loc.line}): object literal with "${piiProp}" passed to ${sinkName}`]
        })
      );
      return;
    }
  }

  if (Node.isIdentifier(node)) {
    const name = node.getText();
    const varTrace = taintedVars.get(name);
    if (varTrace) {
      const parent = node.getParent();
      if (
        parent &&
        Node.isPropertyAccessExpression(parent) &&
        parent.getExpression() === node &&
        SAFE_MERCHANT_FIELDS.has(parent.getName())
      ) {
        return;
      }
      const loc = getNodeLocation(node);
      out.push(
        makeViolation(rulesById, "S4", {
          file: relFile,
          ...loc,
          message: `Unsanitized merchant PII carrier "${name}" flows into ${sinkName}`,
          remediation:
            "Transform merchant records through toPublicMerchantDto() before serializing to HTTP responses or logs.",
          trace: [
            ...varTrace,
            `Sink (${relFile}:${loc.line}): "${name}" passed to ${sinkName} without toPublicMerchantDto()`
          ]
        })
      );
      return;
    }
  }

  for (const child of node.getChildren()) {
    inspectSinkNode(child, sinkName, taintedVars, relFile, rulesById, out);
  }
}

function analyzeScope(
  scopeNode: FunctionLike | SourceFile,
  relFile: string,
  rulesById: Map<string, RuleDefinition>
): Violation[] {
  const taintedVars = new Map<string, string[]>();
  const ownerMatches = (n: Node): boolean =>
    Node.isSourceFile(scopeNode)
      ? getEnclosingFunction(n) === undefined
      : getEnclosingFunction(n) === scopeNode;

  const varDecls = scopeNode
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter(ownerMatches)
    .sort((a, b) => a.getStart() - b.getStart());

  for (const decl of varDecls) {
    const init = decl.getInitializer();
    if (!init) {
      continue;
    }
    const declLine = decl.getSourceFile().getLineAndColumnAtPos(decl.getStart()).line;
    const nameNode = decl.getNameNode();

    if (Node.isIdentifier(nameNode)) {
      const varName = nameNode.getText();
      if (isFullOrPiiMerchantSelect(init)) {
        taintedVars.set(varName, [
          `Source (${relFile}:${declLine}): queried merchants table into "${varName}"`
        ]);
        continue;
      }

      if (Node.isObjectLiteralExpression(init)) {
        const piiProp = hasDirectPiiProperty(init);
        if (piiProp) {
          taintedVars.set(varName, [
            `Source (${relFile}:${declLine}): object "${varName}" contains PII field "${piiProp}"`
          ]);
          continue;
        }
      }

      const upstream = findReferencedTaintedVar(init, taintedVars);
      if (upstream) {
        taintedVars.set(varName, [
          ...upstream.trace,
          `Propagation (${relFile}:${declLine}): copied tainted "${upstream.name}" into "${varName}"`
        ]);
      }
    } else if (Node.isObjectBindingPattern(nameNode)) {
      const upstream = findReferencedTaintedVar(init, taintedVars);
      if (!upstream) {
        continue;
      }
      for (const el of nameNode.getElements()) {
        const propName = el.getPropertyNameNode()?.getText() ?? el.getNameNode().getText();
        const boundName = el.getNameNode().getText();
        if (el.getDotDotDotToken() || PII_FIELDS.has(propName)) {
          taintedVars.set(boundName, [
            ...upstream.trace,
            `Propagation (${relFile}:${declLine}): destructured PII into "${boundName}"`
          ]);
        }
      }
    }
  }

  const violations: Violation[] = [];
  const sinkCalls = scopeNode
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(ownerMatches)
    .sort((a, b) => a.getStart() - b.getStart());

  for (const call of sinkCalls) {
    const sinkName = isSinkCall(call);
    if (!sinkName) {
      continue;
    }
    for (const arg of call.getArguments()) {
      inspectSinkNode(arg, sinkName, taintedVars, relFile, rulesById, violations);
    }
  }

  return violations;
}

/**
 * Performs intra-procedural data-flow taint analysis for financial PII leakage (S4 / ADR-004).
 */
export function runPiiTaintAnalysis(
  sourceFiles: readonly SourceFile[],
  rootDir: string,
  rulesById: Map<string, RuleDefinition>
): Violation[] {
  const violations: Violation[] = [];

  for (const sourceFile of sourceFiles) {
    const relFile = toRepoRelative(rootDir, sourceFile.getFilePath());
    const scopes: Array<FunctionLike | SourceFile> = [
      sourceFile,
      ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)
    ];

    for (const scope of scopes) {
      violations.push(...analyzeScope(scope, relFile, rulesById));
    }
  }

  return violations;
}
