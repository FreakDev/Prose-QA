import { killAllBashProcesses } from "../agent/bash.js";
import type { Scenario } from "../types/scenario.js";
import {
  assertNotOverlayStopped,
  buildSyntheticOverlayStopVerdict,
  OverlayStopSyntheticFailError,
} from "./overlay-stop.js";
import {
  startOverlayControlBridge,
  type OverlayControlAction,
  type OverlayControlBridge,
} from "./control-bridge.js";

export class OverlayControlSession {
  readonly abortController = new AbortController();
  readonly abortSignal: AbortSignal;
  private bridge: OverlayControlBridge | null = null;
  private paused = false;
  private stoppedFlag = false;
  private pauseWaiters: Array<() => void> = [];

  constructor(private readonly scenario: Scenario) {
    this.abortSignal = this.abortController.signal;
  }

  async start(): Promise<string> {
    this.bridge = await startOverlayControlBridge({
      onControl: (action) => this.handleControl(action),
    });
    return this.bridge.url;
  }

  async close(): Promise<void> {
    await this.bridge?.close();
    this.bridge = null;
  }

  get stopped(): boolean {
    return this.stoppedFlag;
  }

  private handleControl(action: OverlayControlAction): void {
    if (this.stoppedFlag) return;

    if (action === "pause") {
      this.paused = true;
      return;
    }

    if (action === "play") {
      this.paused = false;
      this.releasePauseWaiters();
      return;
    }

    this.stoppedFlag = true;
    this.paused = false;
    this.abortController.abort(
      new OverlayStopSyntheticFailError(
        buildSyntheticOverlayStopVerdict(this.scenario),
      ),
    );
    killAllBashProcesses();
    this.releasePauseWaiters();
  }

  private releasePauseWaiters(): void {
    for (const release of this.pauseWaiters.splice(0)) {
      release();
    }
  }

  async waitAtTurnGate(): Promise<void> {
    assertNotOverlayStopped(this.stoppedFlag, this.scenario);
    while (this.paused && !this.stoppedFlag) {
      await new Promise<void>((resolve) => {
        if (!this.paused || this.stoppedFlag) {
          resolve();
          return;
        }
        this.pauseWaiters.push(resolve);
      });
    }
    assertNotOverlayStopped(this.stoppedFlag, this.scenario);
  }

  assertNotStopped(): void {
    assertNotOverlayStopped(this.stoppedFlag, this.scenario);
  }
}
