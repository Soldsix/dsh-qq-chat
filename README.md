---
description: "Add durable messaging conversations and a local text preview to a DSH profile."
kind: "package-bundle"
---
# dsh-qq-chat

English | [中文](README.zh.md)

## Summary

Keep messaging conversations across DSH restarts, process separate conversations concurrently, and inspect replies locally before connecting a messaging provider. This independently installed bundle adds native settings and a text preview. It retains admitted sources, records delivery intent before sending, and never automatically retries uncertain delivery. Automatic chat is disabled on installation. This candidate covers text orchestration; media perception, advanced turn-taking and the complete offline lab are separate capabilities.

## Table of Contents

- [Use this package](#use-this-package)
- [Persistence](#persistence)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### Install and configure

Use DSH **0.2.2-rc.1**, Cordis 4.1, Node **^22.19 or >=24**, and the independent **dsh-im-kit 0.2.0** library. The tested Host and profile dependencies belong to the same DSH installation. Mixed physical installations are not supported by this candidate: this DSH prerelease uses package-local identities for preset scopes. DSH owns model credentials, presets, agents and Session persistence; none are copied into this package.

The package is a local release candidate, not a registry release. Given its tarball and an existing profile with the prerequisites installed, the verified bundle operation is:

```text
dsh plugin --profile <profile> add <path-to-dsh-qq-chat-0.1.0.tgz>
```

Launch the profile through `dsh`. In the native Plugins page, open this bundle's configuration page, choose a preset and model or inherit the Host selection, then enable chat and save. The page reports saved and running revisions separately. Invalid edits retain the draft; restarting retains the journal and Session mappings. The controller remains available when automatic chat is disabled. No standalone application binary or separate settings server is provided.

### Try without QQ

Use **Local text preview** on the same page. It uses saved settings, native DSH agents and the normal journal/queue/output pipeline, captures outgoing public text locally, and never dispatches it through the messaging provider. Tools are always disabled in this preview. Its independent persistent conversation supports follow-ups; cancelling one preview does not cancel live conversations. The preview is a text check, not the full-chain media/tool laboratory.

Live messaging optionally consumes `ctx.im` from an independently installed provider such as `dsh-qq-onebot`. Basic group triggers accept transport-confirmed addressing or recent same-sender follow-ups, according to configuration. An optional `qqTurnPolicy` provider may route or ignore otherwise unaddressed group messages; explicit addressing and private messages remain admitted. The original source is unchanged, and provider errors emit diagnostics before falling back to the basic policy. Private and group scopes, accounts, presets, and preview/live traffic use separate mappings. Multi-person topic attribution and bot-loop control remain incomplete.

When a turn policy is installed, all group source events are admitted to the local receipt database before policy routing, including events the policy later ignores. Duplicate or expired sources never invoke the policy; unavailable or muted transport skips its decision step. Routing uses the configured queue wait limit and falls back to basic triggers on timeout; providers must stop their own work when the supplied signal aborts. The policy can observe fresh group sources without invoking its decision method, so implementations must bound retained context. This receipt database is not a replacement for a group archive or long-term memory.

### Tools and limits

The executable tool allowlist is empty by default. The adapter hides unlisted global tool definitions and guards every executed tool name, including preset-scoped tools. DSH 0.2.2-rc.1 can still advertise scoped definitions before the guard rejects their execution. Allowlisting a tool does not sandbox installed Host code or its internal effects. Only enable trusted presets and plugins.

The native page exposes every runtime configuration field, including queue/concurrency, input/output size, model/send/storage deadlines, storage paths and Session cache limits. Provider and model must be set together. Empty model/preset/thinking fields inherit the Host selection; output tokens `0` inherit its cap. Empty storage paths resolve inside the profile. Duplicate sources do not trigger a new model or send attempt; a changed body under the same source ID is a conflict.

-----

<a id="persistence"></a>
## Persistence

The default journal is `data/qq-chat/state.sqlite3` inside the current profile. SQLite runs in an owned worker so lock waits do not block the Host event loop. One live process owns the database. An application marker and monotonic schema version refuse foreign or future databases. Schema 1 migrates transactionally to schema 2, preserving source bytes and marking previously unrecorded model outcomes unknown; see the [migration guide](docs/upgrade-guide/v0.1.0/journal-v2/guide.md).

The journal retains admitted original sources, request outcomes, mapping metadata and sending intent. Restart marks pending work interrupted and never automatically replays old replies. Model outcome and delivery outcome remain independent: an accepted failure notice does not imply model success. Unknown delivery is not retried. Session logs remain owned by native DSH persistence and are not rewritten by this bundle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [bundle patch](cordis.patch.yml) adds a persistent owner-only controller and a disabled chat runtime. The runtime admits each source durably, schedules per-conversation FIFO queues fairly, reuses bounded native Session handles, flushes logged inputs and outputs, then persists intent before one final send. Shutdown cancels active computation and joins agents, journal work and workers. The native page uses the Host's Remote/config-editor services and optimistic configuration revisions; it never reads preset documents or stored message bodies for status.

</details>

-----

<a id="model-experience"></a>
## Model Experience

The selected preset loads through the native preset registry. A logged user message carries authenticated sender/conversation metadata, quoted member payload and previous-answer delivery state, separately from that preset. Attachment references alone provide no visual or audio evidence. The adapter observes one owned whole-agent interval and forwards only the last complete public text, excluding reasoning, tool-call blocks and interrupted output. Unexpected inbox input invalidates forwarding; native Session history remains available for ordinary follow-ups.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Controlled native-adapter tests and native Web tests cover installation, cancellation, scoped tool execution, reload and persistence. A real DeepSeek API smoke covers text, recall and arithmetic only. These are not comparative model-quality results or real QQ-client verification.
- Windows is the locally verified platform. Linux CI, real QQ delivery, media adapters, advanced turn-control and the complete offline lab are not verified by this candidate.
- DSH 0.2.2-rc.1 can blank its Web UI while hot-replacing core Session UI modules. A sibling pnpm installation can trigger replacement by changing only shared hard-link status times. Isolated tests use copied dependencies. Concurrent mutation of shared core artifacts remains a Host limitation; this bundle does not patch the Host.
- Common local-path, private-endpoint and credential-format detection is a limited output check; it does not prove prevention of every possible disclosure. Status does not expose chat or preset bodies.
- SQLite is an experimental Node module in the tested engines. A live database owner is never displaced; after an unclean worker failure, a Host restart may be required. Sources remain local and are not encrypted by this package; protect the profile directory.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
