import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  const enabled = process.env.BRIDGE_ENABLE_SIGNUP === "1";
  const podBase = process.env.POD_BASE_URL ?? "http://localhost:3011/";

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-10 sm:py-16">
      <p className="section-mark">
        Sign up <span style={{ color: "var(--accent)" }}>/ new pod</span>
      </p>
      <h1
        className="display mt-3 text-3xl sm:text-4xl md:text-5xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Create an <em>account</em>.
      </h1>
      <p className="mt-4 max-w-2xl text-[color:var(--ink-soft)]">
        Pick an email + a pod name. The pod server at{" "}
        <code className="kbd">{podBase}</code> will create your account, your
        pod, and your WebID. After that you&apos;ll authorize the bridge
        through your pod&apos;s own login — the bridge never sees your
        password.
      </p>

      <hr className="hairline my-10" />

      {enabled ? (
        <SignupForm />
      ) : (
        <div className="rounded-md border border-dashed border-[color:var(--ink-faint)] p-6 text-sm text-[color:var(--ink-soft)]">
          Signup is disabled on this bridge. Set{" "}
          <code className="kbd">BRIDGE_ENABLE_SIGNUP=1</code> in the operator
          environment to enable it, or ask the operator for an account.
        </div>
      )}
    </div>
  );
}
