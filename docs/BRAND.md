# Mind Codespaces — brand guide

The working brand for this product. Distilled from the longer-form brief
into the parts contributors actually need: name, voice, visual direction,
and the messaging boundaries we don't cross.

> **A note on naming.** The product is **Mind Codespaces** today.
> *MindShell* is the eventual umbrella brand once the four sibling
> prototypes (`mind-market-v0`, `codespaces`, `mind-os-v0`,
> `mind-social-network-v0`) unify into one platform. Until that
> consolidation happens, everything user-facing in this codebase uses
> **Mind Codespaces**. The brand values — user-owned data, calm voice,
> the turtle metaphor — apply now.

---

## The product, in one sentence

**Mind Codespaces** is an AI-native Git collaboration platform where
your code, project context, and AI memory live in your own Solid Pod —
not a centralized service.

### What it actually is

Git is the foundation for code. Solid Pods are the foundation for
user-owned project data. AI is a helpful layer on top that works with
permissioned context instead of platform-owned data.

That's the whole idea. Repos, issues, pulls, agents, and the publishing
bridge are features in service of it.

---

## Naming

| | |
|---|---|
| Product name (today) | **Mind Codespaces** |
| Eventual umbrella | MindShell (deferred) |
| Mascot | **Shelly** — a turtle |

**Mind** = intelligence, project memory, AI assistance.
**Codespaces** = the developer's environment around the code.

The turtle isn't a gimmick. It's the cleanest visual shorthand for "Solid
Pod" we have: the animal that carries its home. The mascot belongs to
the family, so it works under either name.

---

## Taglines

**Primary (EN):** Your code. Your context. Your pod.
**Primary (DE):** Dein Code. Dein Kontext. Deine Kontrolle.

The German version drops the pod metaphor (less crisp in translation)
and leans into *Kontrolle* — the more emotionally legible word for the
German/EU audience.

For long-form, lead with the benefit, not the architecture:

> Mind Codespaces gives developers a modern Git workspace where project
> context and AI memory stay under user control.

---

## Core promise

**Your code, your context, your data.**

Modern collaboration UX (issues, pulls, AI), without the data lock-in of
a centralized platform.

---

## Positioning

### The category

User-owned developer collaboration platform.

### Statement

For developers and teams who want modern code collaboration without
giving up control of their data, Mind Codespaces is an AI-native Git
platform that combines Git with Solid Pods, so code, project context,
and AI memory stay user-owned, portable, and permissioned.

### Five product pillars

1. **User-owned data** — project metadata, identity, and AI memory live
   in the user's pod, not the platform's database.
2. **Git-native collaboration** — repos, branches, pulls, reviews behave
   the way developers expect.
3. **Solid-powered portability** — pods make project context portable
   between apps.
4. **AI with permissioned context** — agents work with data the user
   explicitly granted, not a platform's opaque memory.
5. **Open-web collaboration** — interoperable, user-controlled, built on
   open standards where they exist.

---

## Voice & tone

We sound like a thoughtful senior developer who cares about the open
web. Clear, confident, technical-but-understandable, idealistic-but-
practical.

### Do

- Lead with the benefit, then explain the mechanism.
- Use precise developer language ("WebID," "OIDC delegation," "pull,"
  "push").
- Be concrete: name the workflow, not the philosophy.
- Stay calm. The brand is protective, not paranoid.

### Don't

- Don't sound like a crypto project (no "sovereign web," no "Web3 Git,"
  no "decentralized" used as an end in itself).
- Don't attack GitHub directly. "Without the data lock-in" is the
  contrast; "GitHub killer" is not.
- Don't lead with "Built on Solid Pods" — lead with what that *enables*.
- Don't be cute. Shelly is friendly; the copy is not.

### Examples

| Don't say | Say |
|---|---|
| Revolutionizing decentralized AI-powered Git infrastructure for the sovereign web. | Mind Codespaces gives developers a modern Git workspace where project context and AI memory stay under user control. |
| Built on Solid Pods. | Your project context stays in your pod. Solid makes that portable. |
| We kill centralized platforms. | We believe collaboration shouldn't require data lock-in. |
| The GitHub killer. | Git collaboration without the data lock-in. |

---

## Audience

**Primary**

- Open-source developers, indie hackers, AI-native teams
- Privacy-conscious developers and small teams
- European startups with data-protection concerns
- Developers already interested in Solid, local-first, or user-owned
  software

**Secondary**

- Research labs, civic-tech, public-interest tech
- Teams exploring self-hosting or sovereign cloud

Not the audience: people who want maximum convenience above all else and
don't care where their data lives. The brand respects them; the product
isn't for them yet.

---

## Visual direction

### Color (recommended palette)

Midnight blue · shell green · warm off-white.

Serious enough for dev-tool/AI use, natural enough for the turtle
mascot, and distinct from GitHub's purple-grey and GitLab's orange.

The current three-theme system (light, dark, neo) is *compatible* with
this direction; when a final identity lands, the neutrals should align.
**Neo (matrix-green CRT) is a flavor for the developer-native audience,
not the brand's default** — don't use it for marketing screenshots.

### Buttons

Default to **outline** buttons (border + accent text, fill on hover).
This is the calm voice translated to UI. The masthead Sign-in button and
the modal's primary CTAs already follow this — landing-page CTAs should
match.

Avoid solid-filled brand-color slabs as the primary CTA. They read as
loud and undercut the "calm not paranoid" tone.

### Shape language

- Rounded shells and capsules
- Branching lines (Git, but subtle)
- Nested containers (data inside data inside data)
- Minimal, precise icons

### Symbols we can use

Turtle shell · data pod · Git branch · terminal prompt (`>` / `$`) ·
subtle AI spark · lock/key/permission badge.

### Mascot rules

**Shelly is calm, smart, protective, and quietly helpful — never goofy.**

- ✅ Empty states, onboarding, docs tips, error pages, release notes,
  community stickers, the AI assistant's identity.
- ❌ Security/pricing/enterprise pages. Anywhere the user needs to feel
  the product is serious before they trust it with something important.

We don't have a Shelly asset yet — until we do, use restraint and
favor symbols (pod, branch, terminal) over illustration.

---

## What "Mind Codespaces" means for this codebase

Concrete copy decisions to align with the brand:

- The headline metaphor "Your pod is your platform" stays. It's the
  cleanest phrasing of the brand's core promise for this product.
- The supporting copy should mention the **AI agent that runs against
  the user's pod with the user's permissions** — that's the brand
  promise made concrete, and it's the part that's actually novel.
- When introducing Solid, lead with the benefit ("your code stays in
  your pod") not the protocol ("we use Solid-OIDC delegation").
- Primary CTAs are outline-style, not solid-filled (see Buttons above).
- The `neo` theme is for developer hours, not marketing screenshots.

---

## Risks to manage

- **"Mind Codespaces" risks reading as a GitHub Codespaces knockoff.**
  Mitigate with copy that surfaces user-owned data first and the
  developer-environment angle second.
- **Solid Pods are unfamiliar to most developers.** Explain the
  benefit, then the technology. Never assume the reader knows what a
  pod is.
- **The product sounds abstract.** Show the workflow: file an issue,
  ask the agent to draft a PR, watch the diff, merge, the result lands
  in *your* pod. Concreteness defeats vagueness.
- **The future umbrella name change (MindShell) creates copy debt.**
  Don't pre-rename in docs or UI. Wait until the four siblings actually
  consolidate; until then everything is Mind Codespaces.

---

## Summary

Mind Codespaces is calm, intelligent, and trustworthy.
A turtle carries its home; developers should carry their project
context.

Name (today): **Mind Codespaces**
Mascot: **Shelly** the turtle
Tagline (EN): **Your code. Your context. Your pod.**
Tagline (DE): **Dein Code. Dein Kontext. Deine Kontrolle.**
Promise: **Your code, your context, your data.**
