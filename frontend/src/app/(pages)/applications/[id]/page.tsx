"use client";

import { use } from "react";

import { ApplicationPage } from "@/app/components/applications/ApplicationPage";

interface Props {
  params: Promise<{ id: string }>;
}

export default function ApplicationDetailPage({ params }: Props) {
  const { id } = use(params);
  return <ApplicationPage applicationId={id} />;
}
