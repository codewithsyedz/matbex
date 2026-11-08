import html2canvas from "html2canvas";

export interface RenderHtmlToCanvasOptions {
  backgroundColor?: string;
  scale?: number;
  sandboxWidth?: string;
}

async function waitForImages(root: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

export async function renderHtmlToCanvas(
  html: string,
  options: RenderHtmlToCanvasOptions = {},
): Promise<HTMLCanvasElement> {
  if (typeof document === "undefined") {
    throw new Error("Receipt image rendering requires a browser context (no DOM available).");
  }

  const {
    backgroundColor = "#ffffff",
    scale = 2,
    sandboxWidth = "80mm",
  } = options;

  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  const sandbox = document.createElement("div");
  sandbox.setAttribute("aria-hidden", "true");
  sandbox.style.position = "fixed";
  sandbox.style.left = "-10000px";
  sandbox.style.top = "0";
  sandbox.style.width = sandboxWidth;
  sandbox.style.background = backgroundColor;
  sandbox.style.zIndex = "-1";
  sandbox.style.pointerEvents = "none";

  const styleEls = Array.from(parsed.head.querySelectorAll("style"));
  for (const styleEl of styleEls) {
    const cloned = document.createElement("style");
    cloned.textContent = styleEl.textContent;
    sandbox.appendChild(cloned);
  }

  const content = document.createElement("div");
  content.innerHTML = parsed.body.innerHTML;
  sandbox.appendChild(content);
  document.body.appendChild(sandbox);

  try {
    const fontSet = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fontSet?.ready) {
      await fontSet.ready.catch(() => undefined);
    }

    await waitForImages(sandbox);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const width = Math.max(1, Math.ceil(sandbox.scrollWidth || sandbox.clientWidth));
    const height = Math.max(1, Math.ceil(sandbox.scrollHeight || sandbox.clientHeight));

    return await html2canvas(sandbox, {
      backgroundColor,
      scale,
      useCORS: true,
      logging: false,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
    });
  } finally {
    sandbox.remove();
  }
}

export async function renderHtmlToImageDataUrl(
  html: string,
  options: RenderHtmlToCanvasOptions = {},
): Promise<{ dataUrl: string; width: number; height: number }> {
  const canvas = await renderHtmlToCanvas(html, options);
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}