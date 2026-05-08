"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SiteLogo } from "@/components/site-logo";

export default function SignupPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/assistant");
    }, [router]);

    return (
        <div className="min-h-dvh bg-white flex items-start justify-center px-6 pt-32 md:pt-40 pb-10 relative">
            <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2">
                <SiteLogo size="md" className="md:text-4xl" asLink />
            </div>
            <div className="w-full max-w-md border border-gray-200 rounded-lg p-8">
                <h1 className="text-2xl font-serif mb-3">Local Workbench</h1>
                <p className="text-sm text-gray-600 mb-6">
                    Account creation is not needed for local mode.
                </p>
                <Button
                    onClick={() => router.push("/assistant")}
                    className="w-full bg-black hover:bg-gray-900 text-white"
                >
                    Continue
                </Button>
            </div>
        </div>
    );
}
