# Bari 0.8.0 Preview 1

Bari 0.8.0 Preview 1 is the first release candidate presented end to end as an
AkashaCorporation product rather than an upstream-themed fork. It combines the
unpublished Campaign, Agent Team, provider, OAuth, accounting and terminal work
accumulated after the last public `main` update on 2026-10-05.

## Product identity

- The terminal opens with the Bari wordmark, an AkashaCorporation signature and
  an operator-console layout derived from the Bari blue-and-gold visual system.
- Welcome guidance now points to Campaigns, Agent Teams, provider routing,
  evidence and verification instead of generic fork-era tips.
- The composer, activity states, panels and responsive status line use Bari
  product language across full-width and compact terminals.

## Engineering and research workflow

- Security Campaigns freeze authorized target and scope identity, preserve
  evidence provenance, gate duplicate review and keep research verdicts
  separate from tool coverage.
- Agent Teams expose role, ownership, model policy, task state and delivery
  review through the standalone TUI.
- HexCore Jobs receipts are canonical Analysis Contract inputs; Hypotenuse Jobs
  remain explicitly experimental. Both are re-hashed before campaign ingestion.
- Request accounting distinguishes the owner, delegated agents and bounded
  learning work without double-counting auxiliary requests.

## Models and providers

- Eligible ChatGPT subscriptions can be connected through OAuth and used by
  parent and child sessions.
- `bari provider refresh --all --json` performs model-list discovery only. It
  refreshes editable providers and the ChatGPT OAuth catalog, preserves manual
  selections and reports expired credentials independently.
- Experimental Labs has a reusable PowerShell refresh wrapper for Windows.
- OpenCode Go uses the current Console inference endpoint and stable
  `x-opencode-session` identity; retired `/zen/go` configurations are
  canonicalized before a request.
- Provider error attribution now identifies the actual BYOK provider and
  upstream reason instead of blaming the currently displayed default model.

## Installation

Node.js 24 is recommended for this preview. Download
`akashacorporation-bari-0.8.0-preview.1.tgz` from the GitHub release, then run:

```powershell
node --version
npm install --global .\akashacorporation-bari-0.8.0-preview.1.tgz
bari --version
```

Keep the intended Node 24 installation first on `PATH` while npm runs native
dependency scripts. If a machine changes Node major versions after installation,
reinstall the package under the new supported runtime rather than reusing a
native SQLite binary built for another ABI.

The stable npm `latest` channel remains separate from this GitHub prerelease.

## Verification and limits

- Provider synchronization acceptance uses catalog endpoints only; it does not
  spend model credits or establish inference quality for every provider.
- External account access, regional rules, promotional quotas and model
  availability remain provider-controlled.
- Campaign and Analysis Jobs acceptance is local and synthetic; it does not
  validate a vulnerability or replace target-specific evidence.
- Cross-platform CI and the final GitHub release receipts belong to the exact
  published commit and are recorded separately from development-tree results.
