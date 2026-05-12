"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { SiteLogo } from "@/components/site-logo";
import { Button } from "@/components/ui/button";

export default function SignupPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/assistant-next");
  }, [router]);

  return (
    <div className="relative flex min-h-dvh items-start justify-center bg-white px-6 pt-32 pb-10 md:pt-40">
      <div className="absolute top-4 left-1/2 -translate-x-1/2 md:top-8">
        <SiteLogo size="md" className="md:text-4xl" asLink />
      </div>
      <div className="w-full max-w-md rounded-lg border border-gray-200 p-8">
        <h1 className="mb-3 font-serif text-2xl">Local Workbench</h1>
        <p className="mb-6 text-sm text-gray-600">Account creation is not needed for local mode.</p>
        <Button
          onClick={() => router.push("/assistant-next")}
          className="w-full bg-black text-white hover:bg-gray-900"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
