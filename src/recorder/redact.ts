import { createEnvRedactor } from "../redact/env-secrets.js";
import type { FillEvent, RecordEvent } from "../types/recorder.js";

const PASSWORD_HINT =
  /password|passwd|secret|token|api[_-]?key|credential/i;

export function isSensitiveFieldName(name?: string): boolean {
  if (!name) return false;
  return PASSWORD_HINT.test(name);
}

export function redactFillValue(
  value: string,
  fieldName?: string,
  sensitiveEnvVars: string[] = [],
): { value: string; redacted: boolean } {
  if (isSensitiveFieldName(fieldName)) {
    return { value: "[REDACTED]", redacted: true };
  }
  const redactor = createEnvRedactor(process.env, sensitiveEnvVars);
  const redacted = redactor.redact(value);
  if (redacted !== value) {
    return { value: redacted, redacted: true };
  }
  return { value, redacted: false };
}

export function sanitizeRecordEvent(
  event: RecordEvent,
  sensitiveEnvVars: string[] = [],
): RecordEvent {
  if (event.type !== "fill") return event;
  const fill = event as FillEvent;
  const { value, redacted } = redactFillValue(
    fill.value,
    fill.name,
    sensitiveEnvVars,
  );
  return { ...fill, value, redacted: redacted || fill.redacted };
}
