"use client";

import { use } from "react";

import { FileView } from "@/app/components/files/FileView";

interface Props {
  params: Promise<{ id: string }>;
}

export default function FilePage({ params }: Props) {
  const { id } = use(params);
  return <FileView fileId={id} />;
}
