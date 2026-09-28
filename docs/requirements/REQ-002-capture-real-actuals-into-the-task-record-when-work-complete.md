---
id: REQ-002
title: Capture real actuals into the task record when work completes
status: accepted
createdAt: 2026-09-23T07:16:32.688Z
updatedAt: 2026-09-23T07:16:32.688Z
citations: []
contentHash: 48ead53d4dfbea649a800ebc7613c1fdb54f8e661d2c682091e08783ad7ffb85
provenance: human
supersedes: []
---

Without this the estimator (T10) never improves. Every quote stays a one-way guess with no feedback loop. A task reaching done (T19's real, test-gated done), or failing partway through, should carry real consumption in its record: input tokens, output tokens, and cost. Source these from wherever that task's real work actually ran, the trajectory log or a captured budget receipt. Once captured, the corpus T10 draws its neighbours from should grow automatically. This needs no separate manual step to fold a finished task back into the calibration set. A task that fails partway through should still record what it consumed before failing.
