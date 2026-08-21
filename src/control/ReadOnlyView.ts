export interface ReadOnlyView {
  setHtml(nextHtml: string): void;
  setStatus(text: string): void;
  dispose(): void;
}

class DomReadOnlyView implements ReadOnlyView {
  private readonly shell: HTMLDivElement;
  private readonly preview: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private disposed = false;

  constructor(root: HTMLElement) {
    this.shell = document.createElement("div");
    this.shell.className = "rdx-readonly-shell";

    this.preview = document.createElement("div");
    this.preview.className = "rdx-readonly";

    this.status = document.createElement("div");
    this.status.className = "rdx-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.hidden = true;

    this.shell.append(this.preview, this.status);
    root.replaceChildren(this.shell);
  }

  setHtml(nextHtml: string): void {
    if (!this.disposed) {
      this.preview.innerHTML = nextHtml;
    }
  }

  setStatus(text: string): void {
    if (!this.disposed) {
      this.status.textContent = text;
      this.status.hidden = text.length === 0;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.shell.remove();
  }
}

export function createReadOnlyView(root: HTMLElement): ReadOnlyView {
  return new DomReadOnlyView(root);
}
