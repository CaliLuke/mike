"use client";

import { useParams } from "next/navigation";

import { AppScopedChat } from "./AppScopedChat";

export default function ApplicationAssistantNextPage() {
  const params = useParams();
  // params.id is the URL-encoded segment when it contains reserved
  // characters like `:` (Surreal record IDs are `applications:foo`).
  // Decode so it matches the canonical form stored on chat rows.
  const applicationId = decodeURIComponent(params.id as string);
  return <AppScopedChat applicationId={applicationId} />;
}
