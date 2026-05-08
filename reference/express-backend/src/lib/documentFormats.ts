export const ALLOWED_DOCUMENT_TYPES = new Set([
  "pdf",
  "docx",
  "doc",
  "md",
  "markdown",
  "txt",
]);

export const ALLOWED_DOCUMENT_TYPES_LABEL = "pdf, docx, doc, md, markdown, txt";

const TEXT_DOCUMENT_TYPES = new Set(["md", "markdown", "txt"]);

export function isTextDocumentType(fileType: string | null | undefined): boolean {
  return TEXT_DOCUMENT_TYPES.has((fileType ?? "").toLowerCase());
}

export function contentTypeForDocument(fileType: string): string {
  switch (fileType.toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "md":
    case "markdown":
      return "text/markdown; charset=utf-8";
    case "txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export function decodeTextDocument(content: ArrayBuffer | Buffer): string {
  const bytes =
    content instanceof Buffer ? content : Buffer.from(new Uint8Array(content));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
