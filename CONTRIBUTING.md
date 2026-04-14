# Contributing to agent-passport-acp

Thanks for showing up here. This repo is the ACP (Agent Communication Protocol) transport adapter for the Agent Passport System — bridges Ed25519-signed Agora communication with the ACP REST standard. If you're integrating APS identity into an ACP-compliant agent runtime, this is the adapter.

## Quick start

**For a bug fix**, submit:
1. A failing test that reproduces the bug
2. The minimal fix
3. No scope expansion

**For a feature or transport change**, open an issue first. ACP compatibility is load-bearing — changes to transport semantics need direction alignment before code.

**For documentation or examples**, straight PR is fine.

**Submission mechanics:** fork the repo, create a feature branch from `main`, open a PR against `main`. Keep PRs focused.

---

## What makes a PR mergeable

1. **Tests pass.** The adapter has conformance tests against both APS envelope format and ACP REST standard. Both sets must stay green.
2. **ACP conformance preserved.** Changes that affect wire format must include updated conformance vectors. If a change breaks ACP interop, call it out explicitly in the PR description.
3. **No silent changes to APS envelope semantics.** The adapter translates; it doesn't redefine either side.
4. **Format consistency.** Match existing module layout, error handling, logging patterns.

## Stability expectations

The adapter follows semantic versioning. Transport-level changes that would affect downstream consumers require a major version bump with migration notes.

## Out of scope

- **Modifying the ACP REST standard itself.** The adapter conforms to ACP as published; changes to the standard go through ACP's upstream process.
- **Modifying APS envelope semantics.** APS envelope format is defined by `agent-passport-system`; this repo implements the translation, not the definition.
- **New transport protocols.** If you want to add a non-ACP transport, open an issue to discuss — it likely belongs in a sibling repo, not this one.

---

## How review works

Every PR is evaluated against five questions, applied to every contributor equally:

1. **Identity.** Is the contributor identifiable, with a real GitHub presence?
2. **Format.** Does the change match existing patterns?
3. **Substance.** Do tests actually exercise the claimed behavior?
4. **Scope.** Does the PR stay scoped to its stated purpose?
5. **Reversibility.** Can the change be reverted cleanly?

Substantive declines include the reason.

---

## Practical details

- **Maintainer:** [@aeoess](https://github.com/aeoess) (Tymofii Pidlisnyi)
- **Review timing:** maintainer-bandwidth dependent. If a PR has had no response after 5 business days, ping it.
- **CLA / DCO:** no CLA is required. Contributions accepted on the understanding that the submitter has the right to contribute under the Apache 2.0 license.
- **Security issues:** open a private security advisory via GitHub rather than a public issue.
- **Code of Conduct:** Contributor Covenant 2.1 — see [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

---

## Licensing

Apache License 2.0 (see [`LICENSE`](./LICENSE)). By contributing, you agree that your contributions will be licensed under the same license.
