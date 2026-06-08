export type RecordEventType =
  | "navigate"
  | "click"
  | "fill"
  | "select"
  | "submit"
  | "comment"
  | "checkpoint_hint";

/** Target resolved from an agent-browser `snapshot -i` at event time. */
export interface SnapshotTarget {
  ref: string;
  role?: string;
  name?: string;
  description: string;
}

export interface RecordEventBase {
  ts: number;
  snapshot?: SnapshotTarget;
}

export interface NavigateEvent extends RecordEventBase {
  type: "navigate";
  url: string;
}

export interface ClickEvent extends RecordEventBase {
  type: "click";
  role?: string;
  name?: string;
  label?: string;
  clientX?: number;
  clientY?: number;
}

export interface FillEvent extends RecordEventBase {
  type: "fill";
  role?: string;
  name?: string;
  value: string;
  redacted?: boolean;
  clientX?: number;
  clientY?: number;
}

export interface SelectEvent extends RecordEventBase {
  type: "select";
  name?: string;
  value: string;
  clientX?: number;
  clientY?: number;
}

export interface SubmitEvent extends RecordEventBase {
  type: "submit";
}

export interface CommentEvent extends RecordEventBase {
  type: "comment";
  text: string;
}

export interface CheckpointHintEvent extends RecordEventBase {
  type: "checkpoint_hint";
  text: string;
}

export type RecordEvent =
  | NavigateEvent
  | ClickEvent
  | FillEvent
  | SelectEvent
  | SubmitEvent
  | CommentEvent
  | CheckpointHintEvent;

export interface RecordingMeta {
  id: string;
  startedAt: string;
  endedAt?: string;
  startUrl?: string;
  sessionName: string;
  bridgePort: number;
  connectPort?: number;
}

export interface ActiveRecording {
  id: string;
  dir: string;
  bridgePort: number;
  sessionName: string;
  bridgeUrl: string;
  /** Detached bridge-worker PID (survives after `record start` exits). */
  bridgePid: number;
}
