import type { ApiErrorCode as SharedErrorCode, DeviceErrorCode, StationErrorCode } from "@7xen/shared";

/** API error codes, plus the station's (phase 4b) and the streaming devices' (phase 6), both additive. */
export type ApiErrorCode = SharedErrorCode | StationErrorCode | DeviceErrorCode;

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SLOTS_FULL: 409,
  REGISTRATION_CLOSED: 409,
  RATE_LIMITED: 429,
  EXTRACTOR_OFFLINE: 503,
  OFFSET_MISMATCH: 409,
  STORAGE_FULL: 507,
  STATION_OFFLINE: 503,
  DEVICE_KEY_INVALID: 401,
  // phase 5: players & teams
  NO_TEAM: 403,
  LEADER_ONLY: 403,
  ALREADY_IN_TEAM: 409,
  TEAM_FULL: 409,
  BGMI_ID_REQUIRED: 400,
  BGMI_ID_TAKEN: 409,
  INVITE_INVALID: 404,
  JOIN_REQUEST_PENDING: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
    status?: number,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status ?? STATUS[code];
  }
}

/** 409 OFFSET_MISMATCH for resumable uploads: the body carries `offset`, plus an `Upload-Offset` header. */
export class OffsetMismatchError extends AppError {
  constructor(
    public readonly offset: number,
    message = "The upload is out of sync. Resume from the server's offset.",
  ) {
    super("OFFSET_MISMATCH", message);
  }
}

export const notFound = (message = "Not found") => new AppError("NOT_FOUND", message);
export const conflict = (message: string) => new AppError("CONFLICT", message);
export const unauthenticated = (message = "Please log in to continue") => new AppError("UNAUTHENTICATED", message);
export const forbidden = (message = "You don't have access to this") => new AppError("FORBIDDEN", message);
