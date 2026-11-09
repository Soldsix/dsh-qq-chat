---
kind: upgrade-guide
description: Failed intent decisions suppress unaddressed group messages instead of using the basic follow-up trigger.
---
# Conservative group routing

## Change

When an installed turn policy throws or exceeds its deadline, unaddressed group messages are ignored with a diagnostic. They no longer fall through to the same-sender follow-up rule. Ordinary explicit mentions still bypass intent classification. Private messages are unchanged.

`ChatTurnPolicy.guard()` is an optional synchronous hook for operator-configured bot senders. Returning `block` suppresses even an explicit group mention before classification or generation. A guard exception emits a diagnostic and does not block ordinary explicit mentions. The hook runs only for fresh, durably admitted group sources; duplicates and expired messages never consume another reservation.

## Migration

1. Update the bundle in the intended DSH profile. No SQLite or Session migration is required; retained sources and memory are unchanged.
2. If maintaining a custom policy, observe its cancellation signal and return `reply`, `ignore`, or `default` for successful decisions. An intentional `default` still delegates to the basic trigger.
3. If adding a guard, identify bot senders from operator configuration and authenticated message metadata. Do not infer identities from member text. Leave ordinary explicit mentions allowed.
4. Verify an ordinary explicit mention, a classifier failure on an unaddressed source, and replay of a guarded source. Expect one ordinary reply and no generation for the latter two cases.
