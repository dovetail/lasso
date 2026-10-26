import Link from "next/link";

export default function SignedOut() {
  return (
    <div className="mx-auto mt-24 max-w-sm text-center">
      <h1 className="text-xl font-semibold">You are signed out</h1>
      <Link href="/auth/login" className="mt-4 inline-block text-indigo-700 hover:underline">
        Sign in again
      </Link>
    </div>
  );
}
