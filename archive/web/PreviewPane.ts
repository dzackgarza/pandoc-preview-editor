let iframe: HTMLIFrameElement | null = null;

export function createPreview(container: HTMLIFrameElement): void {
  iframe = container;
}

export function updatePreview(html: string): void {
  if (!iframe) return;
  iframe.srcdoc = html;
}
