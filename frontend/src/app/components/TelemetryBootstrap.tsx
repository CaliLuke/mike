"use client";

import { useEffect } from "react";

import { initTelemetry } from "@/app/lib/telemetry";

export function TelemetryBootstrap(): null {
  useEffect(() => {
    initTelemetry();
  }, []);
  return null;
}
