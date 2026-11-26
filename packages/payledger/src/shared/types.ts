export type AppEnv = {
  Variables: {
    rawBody?: string;
    idempotencyKey?: string;
  };
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code = "VALIDATION_ERROR") {
    super(message, 400, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, code = "UNAUTHORIZED") {
    super(message, 401, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code = "NOT_FOUND") {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT") {
    super(message, 409, code);
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(message: string, code = "INSUFFICIENT_BALANCE") {
    super(message, 422, code);
  }
}

export class LedgerImbalanceError extends AppError {
  constructor(message: string, code = "LEDGER_IMBALANCE") {
    super(message, 500, code);
  }
}
