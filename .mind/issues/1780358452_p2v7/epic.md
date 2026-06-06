---
id: mind-packages-hardening
title: "Mind Packages hardening"
status: active
created: 2026-06-02
---

# Goal

Harden the pod-backed package registry (npm/OCI/files) toward production: digest validation
on read, blob GC/refcount, bearer-token auth, streaming uploads. Security-sensitive; several
issues carry the `security` label and must be flagged on handoff.
