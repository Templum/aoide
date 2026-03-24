export class PromptestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptestError';
  }
}

export class ApiError extends PromptestError {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(`API_ERROR: ${message}`);
    this.name = 'ApiError';
  }
}

export class ParseError extends PromptestError {
  constructor(message: string) {
    super(`PARSE_ERROR: ${message}`);
    this.name = 'ParseError';
  }
}

export class JudgeError extends PromptestError {
  constructor(
    public readonly score: number,
    public readonly reasoning: string,
    threshold: number,
  ) {
    super(`JUDGE_FAILED (Score ${score.toFixed(2)} < ${threshold}): ${reasoning}`);
    this.name = 'JudgeError';
  }
}

export class SchemaError extends PromptestError {
  constructor(message: string) {
    super(`SCHEMA_ERROR: ${message}`);
    this.name = 'SchemaError';
  }
}
