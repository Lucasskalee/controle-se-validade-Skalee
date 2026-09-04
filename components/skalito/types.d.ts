export type SkalitoState = "idle" | "thinking" | "talking" | "happy" | "alert";
export type SkalitoLook = "center" | "left" | "right" | "up" | "down";
export type SkalitoEvent = "wave" | "blink" | "point" | "celebrate";

export interface SkalitoAnimatedOptions {
  state?: SkalitoState;
  look?: SkalitoLook;
  size?: number;
  label?: string;
}

export interface SkalitoAnimatedElement extends HTMLElement {
  state: SkalitoState;
  look: SkalitoLook;
  size: number;
  setState(state: SkalitoState): void;
  lookAt(look: SkalitoLook): void;
  wave(): void;
  blink(): void;
  point(): void;
  celebrate(): void;
}
