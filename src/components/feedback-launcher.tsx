"use client";

import { FeedbackWidget } from "@mind-studio/core/feedback";

/**
 * Mounts the floating 💬 feedback widget on every Codespaces page.
 *
 * Codespaces holds its pod session server-side (cookie + OIDC refresh, see
 * `src/lib/auth/session.ts`) — there is no client-side DPoP `fetch` to hand the
 * widget. The feedback inbox is a public-append container, so the widget submits
 * anonymously (no `fetch`/`webId`), which the inbox accepts. The inbox URL is
 * build-time inlined via `NEXT_PUBLIC_FEEDBACK_INBOX`.
 */
const feedbackInbox =
  process.env.NEXT_PUBLIC_FEEDBACK_INBOX ??
  "http://localhost:3011/alice/codespaces-feedback/";

export function FeedbackLauncher() {
  return (
    <FeedbackWidget appKey="codespaces" inbox={feedbackInbox} variant="floating" />
  );
}
