import Link from "next/link";

export const dynamic = "force-dynamic";

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-10 sm:py-16">
      <p className="section-mark">How it works</p>
      <h1
        className="display mt-4 text-4xl sm:text-5xl md:text-6xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Your <em>pod</em>, with code in it.
      </h1>
      <p
        className="mt-4 text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        Your code · <span style={{ color: "var(--accent)" }}>your context</span>{" "}
        · your pod.
      </p>
      <p className="mt-6 text-lg leading-relaxed text-[color:var(--ink-soft)]">
        Mind Codespaces gives you Git collaboration where{" "}
        <em>everything that matters</em> — your code, your issues, your AI
        memory, your published sites — lives inside your own Solid Pod. The
        bridge in the middle just translates protocols; it doesn&apos;t own
        your project.
      </p>

      <hr className="hairline my-14" />

      <Section title="What lives in your pod">
        <p className="mb-8 text-sm leading-relaxed text-[color:var(--ink-soft)]">
          A pod is a small piece of storage you own. With Mind Codespaces, four
          kinds of things go inside it — and nothing else needs to leave.
        </p>
        <PodCapsule />
      </Section>

      <hr className="hairline my-14" />

      <Section title="What happens when you push">
        <p className="mb-8 text-sm leading-relaxed text-[color:var(--ink-soft)]">
          The flow has three beats. There&apos;s some plumbing — a small bridge
          translates Git Smart HTTP into pod writes — but you only ever talk to
          two things: your terminal and your pod.
        </p>
        <PushFlow />
        <ol
          className="mt-8 grid gap-3 sm:grid-cols-3 text-sm"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <FlowStep
            n={1}
            title="You push"
            body="git push, like any other remote."
          />
          <FlowStep
            n={2}
            title="The bridge translates"
            body="Smart HTTP in, pod writes out. No project state stored here."
          />
          <FlowStep
            n={3}
            title="Your pod receives"
            body="Code, metadata, and the live site land under your WebID."
          />
        </ol>
      </Section>

      <hr className="hairline my-14" />

      <Section title="AI that asks before it reads">
        <p className="text-sm leading-relaxed text-[color:var(--ink-soft)]">
          The coder agent runs against the same pod the user owns, with the
          permissions the user granted. It reads what you let it read, writes
          where you let it write, and the conversation history — the thing AI
          tools usually keep in their own database — lands back in the pod
          alongside the code. If you revoke access, the agent stops. If you
          move pods, the memory comes with you.
        </p>
        <ul className="mt-6 grid gap-2 sm:grid-cols-2 text-sm">
          <AiPoint label="Reads">
            issue body, recent commits, files the prompt names — nothing else
            until you say so.
          </AiPoint>
          <AiPoint label="Writes">
            a branch in <em>your</em> repo, a pull request, screenshots and
            comments in <em>your</em> pod.
          </AiPoint>
          <AiPoint label="Remembers">
            the conversation, but the memory lives in the pod, not in an
            opaque vendor database.
          </AiPoint>
          <AiPoint label="Stops">
            the moment you revoke its permission — the bridge is a delegate,
            not an owner.
          </AiPoint>
        </ul>
      </Section>

      <hr className="hairline my-14" />

      <Section title="Why it&rsquo;s portable">
        <p className="mb-6 text-sm leading-relaxed text-[color:var(--ink-soft)]">
          The bridge can be replaced and your work survives, because nothing
          irreplaceable lives in the bridge.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <ScenarioCard
            heading="If the bridge shuts down"
            outcome="Spin up another one. Re-clone from anyone with a copy of the repo."
            kept={[
              "All code & history",
              "Issues, pulls, comments",
              "AI conversation memory",
              "Your published site",
            ]}
            lost={["A few revocable tokens"]}
          />
          <ScenarioCard
            heading="If you move pods"
            outcome="Point the bridge at the new pod URL. Carry on."
            kept={[
              "All code & history",
              "Project context",
              "Identity (re-bound to new WebID)",
              "AI memory",
            ]}
            lost={["Old absolute URLs (auto-rewritten)"]}
          />
        </div>
      </Section>

      <hr className="hairline my-14" />

      <p className="text-sm leading-relaxed text-[color:var(--ink-soft)]">
        Ready to see it for real?{" "}
        <Link href="/repos" className="link">
          Open the dashboard
        </Link>
        , or jump into a{" "}
        <Link href="/repos/alice/marked-blog" className="link">
          worked example
        </Link>
        .
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Layout helpers                                                       */
/* -------------------------------------------------------------------- */

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2
        className="display text-2xl sm:text-3xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------- */
/* "What lives in your pod" — a capsule with 4 things inside            */
/* -------------------------------------------------------------------- */

function PodCapsule() {
  // One big rounded capsule (the pod) with four labeled glyph nodes
  // inside it, plus a subtle "your WebID" anchor at the top. A faint
  // dotted ring outside the capsule reads as the boundary the bridge
  // sits on top of — the bridge is implied, not centered.
  const items = [
    { icon: <CodeGlyph />, label: "Code", sub: "git history" },
    { icon: <IssueGlyph />, label: "Issues", sub: "+ pulls" },
    { icon: <BrainGlyph />, label: "AI memory", sub: "permissioned" },
    { icon: <PagesGlyph />, label: "Pages", sub: "your live site" },
  ];
  return (
    <div className="relative">
      {/* Outer faint ring — the "outside world" containing the pod. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[2.5rem]"
        style={{
          border: "1px dashed var(--ink-trace)",
          margin: "-12px",
        }}
      />
      <div
        className="relative rounded-[2rem] border p-8 sm:p-10"
        style={{
          borderColor: "var(--accent)",
          background:
            "color-mix(in srgb, var(--accent) 6%, var(--paper-soft))",
          boxShadow:
            "0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent), 0 20px 60px -30px color-mix(in srgb, var(--accent) 40%, transparent)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <p
            className="text-[10px] uppercase tracking-[0.22em]"
            style={{
              fontFamily: "var(--font-mono-src)",
              color: "var(--accent)",
            }}
          >
            Your Pod
          </p>
          <p
            className="truncate text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
            title="The WebID is the lock; you hold the key."
          >
            owned by your WebID
          </p>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {items.map((it) => (
            <div
              key={it.label}
              className="rounded-xl border p-4 transition-colors"
              style={{
                borderColor: "var(--ink-trace)",
                background: "var(--paper)",
              }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{
                  background:
                    "color-mix(in srgb, var(--accent) 14%, transparent)",
                  color: "var(--accent)",
                }}
              >
                {it.icon}
              </div>
              <p
                className="mt-3 text-sm"
                style={{ color: "var(--ink)", fontWeight: 500 }}
              >
                {it.label}
              </p>
              <p
                className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
                style={{ fontFamily: "var(--font-mono-src)" }}
              >
                {it.sub}
              </p>
            </div>
          ))}
        </div>
      </div>
      <p
        className="mt-3 text-center text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        // everything else (the bridge) is just protocol glue
      </p>
    </div>
  );
}

function CodeGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 6 3 12 8 18" />
      <polyline points="16 6 21 12 16 18" />
    </svg>
  );
}

function IssueGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BrainGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5 a3 3 0 0 0 -3 3 v3 a3 3 0 0 0 0 6 v1 a3 3 0 0 0 3 3" />
      <path d="M15 5 a3 3 0 0 1 3 3 v3 a3 3 0 0 1 0 6 v1 a3 3 0 0 1 -3 3" />
      <path d="M12 5 v14" />
      <circle cx="10" cy="10" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PagesGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <circle cx="6" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* -------------------------------------------------------------------- */
/* "What happens when you push" — minimalist three-beat flow            */
/* -------------------------------------------------------------------- */

function PushFlow() {
  // Two big nodes (laptop, pod), one thin bridge label on the connecting
  // line, plus an animated traveling token. The point isn't to teach
  // the architecture — the point is to show: you, then your pod.
  return (
    <div className="card overflow-x-auto p-6">
      <svg
        viewBox="0 0 720 220"
        className="w-full"
        style={{ minWidth: 560 }}
        role="img"
        aria-label="Flow: laptop pushes to pod; the bridge sits invisibly on the line"
      >
        <defs>
          <marker
            id="hi-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
          <path
            id="hi-flowPath"
            d="M140 110 L 580 110"
          />
        </defs>

        {/* Laptop node */}
        <g>
          <rect
            x={40}
            y={70}
            width={130}
            height={80}
            rx={12}
            fill="var(--paper)"
            stroke="var(--ink-trace)"
            strokeWidth="1.5"
          />
          <text
            x={105}
            y={102}
            textAnchor="middle"
            fontSize="14"
            fill="var(--ink)"
            style={{ fontFamily: "var(--font-mono-src)", fontWeight: 500 }}
          >
            you
          </text>
          <text
            x={105}
            y={122}
            textAnchor="middle"
            fontSize="10"
            fill="var(--ink-faint)"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            git push
          </text>
        </g>

        {/* Pod node — capsule shape echoing the pod section above */}
        <g>
          <rect
            x={550}
            y={50}
            width={140}
            height={120}
            rx={28}
            fill="color-mix(in srgb, var(--accent) 8%, var(--paper))"
            stroke="var(--accent)"
            strokeWidth="1.5"
          />
          <text
            x={620}
            y={97}
            textAnchor="middle"
            fontSize="14"
            fill="var(--ink)"
            style={{ fontFamily: "var(--font-mono-src)", fontWeight: 500 }}
          >
            your pod
          </text>
          <text
            x={620}
            y={117}
            textAnchor="middle"
            fontSize="10"
            fill="var(--ink-faint)"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            code · context · pages
          </text>
          <text
            x={620}
            y={137}
            textAnchor="middle"
            fontSize="10"
            fill="var(--accent)"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            ◯ owned by you
          </text>
        </g>

        {/* The connecting line + bridge label */}
        <g
          stroke="var(--accent)"
          strokeWidth="1.5"
          fill="none"
          markerEnd="url(#hi-arrow)"
          style={{ color: "var(--accent)" }}
        >
          <path d="M170 110 L 580 110" strokeDasharray="6 5" opacity="0.5" />
        </g>

        {/* Bridge label sitting on the line */}
        <g>
          <rect
            x={325}
            y={94}
            width={100}
            height={32}
            rx={6}
            fill="var(--paper)"
            stroke="var(--ink-trace)"
            strokeWidth="1.5"
          />
          <text
            x={375}
            y={108}
            textAnchor="middle"
            fontSize="10"
            fill="var(--ink-soft)"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            bridge
          </text>
          <text
            x={375}
            y={120}
            textAnchor="middle"
            fontSize="9"
            fill="var(--ink-faint)"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            translates protocols
          </text>
        </g>

        {/* Animated push token */}
        <g fill="var(--accent)">
          <circle r="5">
            <animateMotion dur="3.5s" repeatCount="indefinite">
              <mpath href="#hi-flowPath" />
            </animateMotion>
            <animate
              attributeName="opacity"
              values="0;1;1;1;0"
              keyTimes="0;0.05;0.45;0.92;1"
              dur="3.5s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
      </svg>
    </div>
  );
}

function FlowStep({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <li
      className="rounded border p-4"
      style={{
        borderColor: "var(--ink-trace)",
        background: "var(--paper-soft)",
      }}
    >
      <p
        className="text-[10px] uppercase tracking-[0.22em]"
        style={{ color: "var(--accent)" }}
      >
        0{n}
      </p>
      <p
        className="mt-2 text-sm"
        style={{ color: "var(--ink)", fontWeight: 500 }}
      >
        {title}
      </p>
      <p
        className="mt-1.5 text-xs leading-relaxed text-[color:var(--ink-soft)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {body}
      </p>
    </li>
  );
}

/* -------------------------------------------------------------------- */
/* "AI" section                                                         */
/* -------------------------------------------------------------------- */

function AiPoint({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className="flex items-baseline gap-3 rounded border px-3 py-3"
      style={{
        borderColor: "var(--ink-trace)",
        background: "var(--paper-soft)",
      }}
    >
      <span
        className="shrink-0 text-[10px] uppercase tracking-[0.22em]"
        style={{
          fontFamily: "var(--font-mono-src)",
          color: "var(--accent)",
          width: "4.5rem",
        }}
      >
        {label}
      </span>
      <span className="text-[color:var(--ink-soft)]">{children}</span>
    </li>
  );
}

/* -------------------------------------------------------------------- */
/* Portability cards                                                    */
/* -------------------------------------------------------------------- */

function ScenarioCard({
  heading,
  outcome,
  kept,
  lost,
}: {
  heading: string;
  outcome: string;
  kept: string[];
  lost: string[];
}) {
  return (
    <div
      className="rounded border p-5"
      style={{
        borderColor: "var(--ink-trace)",
        background: "var(--paper-soft)",
      }}
    >
      <p
        className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        Scenario
      </p>
      <h3
        className="mt-1 text-lg"
        style={{ color: "var(--ink)", fontWeight: 500 }}
      >
        {heading}
      </h3>
      <p className="mt-2 text-sm italic text-[color:var(--ink-soft)]">
        {outcome}
      </p>
      <ul
        className="mt-4 space-y-1.5 text-xs"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {kept.map((item) => (
          <li
            key={item}
            className="flex items-baseline gap-2 text-[color:var(--ink)]"
          >
            <span style={{ color: "var(--accent)" }}>kept</span>
            <span>{item}</span>
          </li>
        ))}
        {lost.map((item) => (
          <li
            key={item}
            className="flex items-baseline gap-2 text-[color:var(--ink-faint)]"
          >
            <span>lost</span>
            <span className="line-through">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
