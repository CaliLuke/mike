export const DOCUMENT_UPLOAD_ACCEPT =
    ".pdf,.docx,.doc,.md,.markdown,.txt";

export function documentExtension(filename?: string | null): string {
    return filename?.split(".").pop()?.toLowerCase() ?? "";
}

export function isDocxDocumentType(args: {
    fileType?: string | null;
    filename?: string | null;
}): boolean {
    const ft = (args.fileType ?? "").toLowerCase();
    if (ft === "docx" || ft === "doc") return true;
    const ext = documentExtension(args.filename);
    return ext === "docx" || ext === "doc";
}

export function isTextDocumentType(args: {
    fileType?: string | null;
    filename?: string | null;
}): boolean {
    const ft = (args.fileType ?? "").toLowerCase();
    if (ft === "md" || ft === "markdown" || ft === "txt") return true;
    const ext = documentExtension(args.filename);
    return ext === "md" || ext === "markdown" || ext === "txt";
}
