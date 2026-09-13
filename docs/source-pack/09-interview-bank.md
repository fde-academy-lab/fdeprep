# Interview studio: 36 original questions

Twelve topics, each with Core, Applied and Deep dive questions. These are preparation questions designed around FDE capabilities, not verified transcripts of employer interviews. Use the practice links to connect explanation with implementation.

## Common review rubric

Score each answer 0–2 on correctness, explicit decision logic, concrete example, and awareness of limits. 0 = absent or materially wrong; 1 = partly supported; 2 = accurate and specific. Keep the dimensions visible; a critical technical misconception requires review regardless of total. This is a proposed instructional rubric requiring reviewer calibration.

Ask for a concise answer first, then use the follow-up to change one assumption. Do not score length, accent, confidence or buzzword use as technical quality.

## I001 · Prompt contracts · Core

**Question.** A support prompt must answer confidently and never invent facts. What happens when evidence is missing?

**A strong answer should show:** Identify the conflict, define abstention and enforce output structure outside the prompt.

**Follow-up.** The customer insists on a definite answer. What changes?

**Build evidence:** G009.

## I002 · Prompt contracts · Applied

**Question.** You removed the word always from a prompt. How do you prove the repair helped?

**A strong answer should show:** Separate an exact edit check from behavioral evaluation; test both supported and unsupported cases.

**Follow-up.** The new prompt refuses every question. Did the edit succeed?

**Build evidence:** G002.

## I003 · Prompt contracts · Deep dive

**Question.** A shorter prompt saves tokens but loses one rare safety constraint. Would you ship it?

**A strong answer should show:** Measure slice-level regression and retain mandatory constraints; cost is not the sole gate.

**Follow-up.** The rare case occurs once in ten thousand requests. Does that change the gate?

**Build evidence:** G010.

## I004 · Structured output · Core

**Question.** Why can valid JSON still be an invalid business response?

**A strong answer should show:** Distinguish syntax, schema, semantic validity and authorization with a concrete example.

**Follow-up.** The schema allows any string for status. What fails next?

**Build evidence:** G003.

## I005 · Structured output · Applied

**Question.** A model returns malformed output twice. How should the service respond?

**A strong answer should show:** Use bounded repair, an explicit failure state and a safe user experience without invented fields.

**Follow-up.** The first response already caused a side effect. Can you retry safely?

**Build evidence:** G011.

## I006 · Structured output · Deep dive

**Question.** How would you version an extraction contract without breaking a customer integration?

**A strong answer should show:** Use explicit versions, compatible evolution, contract tests and a migration path.

**Follow-up.** A numeric field changes from dollars to cents without being renamed.

**Build evidence:** F008.

## I007 · Evidence and RAG · Core

**Question.** A citation points to a real document but the claim is unsupported. Is the answer grounded?

**A strong answer should show:** Check claim-level support, not only existence of a source identifier.

**Follow-up.** The claim combines facts from two different source versions.

**Build evidence:** G013.

## I008 · Evidence and RAG · Applied

**Question.** The correct document was retrieved but the answer is wrong. What do you inspect next?

**A strong answer should show:** Inspect context assembly, truncation, conflict and the generation contract before changing retrieval.

**Follow-up.** The correct paragraph was removed to fit the budget.

**Build evidence:** G022.

## I009 · Evidence and RAG · Deep dive

**Question.** When would you choose retrieval instead of fine-tuning for a client?

**A strong answer should show:** Tie the choice to update frequency, factual knowledge, behavior adaptation and measured failure patterns.

**Follow-up.** The client needs daily policy updates and a consistent response style.

**Build evidence:** G026.

## I010 · Agent control · Core

**Question.** What is the minimum useful difference between an agent and a fixed workflow?

**A strong answer should show:** Explain who selects the next action and where deterministic limits still apply.

**Follow-up.** Every valid task follows the same three steps.

**Build evidence:** A052.

## I011 · Agent control · Applied

**Question.** An agent never emits a final answer. How do you stop it safely?

**A strong answer should show:** Use application-enforced step/time/cost limits and an explicit terminal state.

**Follow-up.** The last permitted action returned useful partial evidence.

**Build evidence:** A004.

## I012 · Agent control · Deep dive

**Question.** When would multiple agents make this workflow worse?

**A strong answer should show:** Discuss coordination cost, context duplication, failure coupling and evidence from a simpler baseline.

**Follow-up.** One specialized capability is isolated behind a tool already.

**Build evidence:** A062.

## I013 · Tool contracts · Core

**Question.** Why should tool arguments be validated after a model chooses the tool?

**A strong answer should show:** Model output is untrusted; validate structure, meaning and actor permissions before dispatch.

**Follow-up.** The field is an integer but the value is true.

**Build evidence:** A008.

## I014 · Tool contracts · Applied

**Question.** A tool times out after possibly creating a ticket. Should you retry?

**A strong answer should show:** Distinguish uncertain side effect from safe transient failure; use idempotency or reconciliation.

**Follow-up.** The provider does not support idempotency keys.

**Build evidence:** F017.

## I015 · Tool contracts · Deep dive

**Question.** Two tools can answer the same question but have different permissions. How do you route?

**A strong answer should show:** Filter by capability and authorization first, then evaluate quality/cost and fallback policy.

**Follow-up.** The lower-privilege tool fails with an authentication error.

**Build evidence:** A031.

## I016 · Memory · Core

**Question.** What belongs in durable memory rather than the active context window?

**A strong answer should show:** Use purpose, provenance, consent/retention and future utility; distinguish verified facts from generated summaries.

**Follow-up.** A user mentions another person's private information.

**Build evidence:** A013.

## I017 · Memory · Applied

**Question.** How do you evict stale state without abandoning active work?

**A strong answer should show:** Preserve explicit task dependencies while expiring eligible context; surface budget conflicts.

**Follow-up.** A deletion request applies to a pinned record.

**Build evidence:** A034.

## I018 · Memory · Deep dive

**Question.** How can a corrected fact remain wrong in a memory-enabled system?

**A strong answer should show:** Track derived summaries, caches and indexes and invalidate them by provenance.

**Follow-up.** An old episode is semantically relevant but factually obsolete.

**Build evidence:** F020.

## I019 · Safety and authority · Core

**Question.** The answer is correct but the agent used an unauthorized tool. Did it pass?

**A strong answer should show:** Separate output quality from mandatory authorization invariants; inspect authoritative tool events.

**Follow-up.** The learner's own trace says no tool was called.

**Build evidence:** A020.

## I020 · Safety and authority · Applied

**Question.** Approval was granted, then the action arguments changed. Can the agent proceed?

**A strong answer should show:** Bind approval to exact actor/action/version and revalidate immediately before execution.

**Follow-up.** Approval is still current but has been revoked.

**Build evidence:** A022.

## I021 · Safety and authority · Deep dive

**Question.** A document contains both useful evidence and an attack. Must you discard all of it?

**A strong answer should show:** Explain threat boundaries, source handling and downstream controls; avoid claiming keyword filtering is complete.

**Follow-up.** The attack is quoted in legitimate security training text.

**Build evidence:** G028.

## I022 · Evaluation · Core

**Question.** Why are deterministic tests useful in an AI application?

**A strong answer should show:** Use repeatable checks for explicit invariants and controlled model/tool boundaries.

**Follow-up.** The property is whether an answer is semantically helpful.

**Build evidence:** A019.

## I023 · Evaluation · Applied

**Question.** Prompt B improves average accuracy but hurts a critical slice. How do you decide?

**A strong answer should show:** Compare paired cases and critical thresholds; do not average away mandatory failures.

**Follow-up.** The critical slice has only five cases.

**Build evidence:** G024.

## I024 · Evaluation · Deep dive

**Question.** How do you make an LLM judge defensible enough to support release decisions?

**A strong answer should show:** Calibrate against human labels, test bias/injection, repeat unstable cases and separate advisory scores from gates.

**Follow-up.** The judge prefers verbose incorrect answers.

**Build evidence:** G021.

## I025 · Operations and cost · Core

**Question.** What is the right denominator for model cost per successful task?

**A strong answer should show:** Include all retries and failures in spend, divided by useful completed outcomes.

**Follow-up.** One task uses three agents and five judge calls.

**Build evidence:** F005.

## I026 · Operations and cost · Applied

**Question.** A class of 200 learners presses Submit at once. What determines responsiveness?

**A strong answer should show:** Separate signed-in users from jobs; model arrival rate, service time, slots and provider quotas.

**Follow-up.** Each submission requires four provider API calls.

**Build evidence:** F013.

## I027 · Operations and cost · Deep dive

**Question.** Two agent branches share a budget. Why is a simple remaining-balance read unsafe?

**A strong answer should show:** Explain atomic reservation, race conditions, reconciliation and run-wide limits.

**Follow-up.** One branch times out before reporting actual usage.

**Build evidence:** A057.

## I028 · Customer discovery · Core

**Question.** How would you turn “we need an AI copilot” into a useful first problem?

**A strong answer should show:** Identify user workflow, pain, measurable outcome, constraints and smallest useful slice.

**Follow-up.** The requested metric is number of generated answers.

**Build evidence:** F001.

## I029 · Customer discovery · Applied

**Question.** A client demands 100% automation in four weeks. What do you do first?

**A strong answer should show:** Clarify risk and scope, validate baseline and select a bounded pilot with escalation.

**Follow-up.** The client treats human review as project failure.

**Build evidence:** F006.

## I030 · Customer discovery · Deep dive

**Question.** A pilot's accuracy rises but adoption stays low. How do you investigate?

**A strong answer should show:** Inspect workflow integration, latency, trust, correction effort and user behavior.

**Follow-up.** The evaluation dataset is easier than real work.

**Build evidence:** F019.

## I031 · Integration and delivery · Core

**Question.** What makes a prototype a useful vertical slice?

**A strong answer should show:** A working path through interface, service and data that solves one real task.

**Follow-up.** The interface is polished but its action uses a static response.

**Build evidence:** F003.

## I032 · Integration and delivery · Applied

**Question.** How do you turn a stateful notebook into a reliable service?

**A strong answer should show:** Define contract, isolate request state, handle errors, version dependencies and instrument behavior.

**Follow-up.** The second request depends on a variable created by the first.

**Build evidence:** F011.

## I033 · Integration and delivery · Deep dive

**Question.** You cannot rewrite a fragile customer service. How do you improve it safely?

**A strong answer should show:** Choose a scoped change, protect contracts, add targeted regression evidence and prepare rollback.

**Follow-up.** The main defect sits behind an undocumented integration.

**Build evidence:** F023.

## I034 · Technical defense · Core

**Question.** How would you explain one engineering trade-off to a client?

**A strong answer should show:** State the decision, relevant evidence, rejected alternative and consequence in plain language.

**Follow-up.** The client asks what they lose with your recommendation.

**Build evidence:** F010.

## I035 · Technical defense · Applied

**Question.** A production incident has missing traces. How do you explain the cause?

**A strong answer should show:** Separate observed facts, hypotheses, containment and next checks; avoid invented certainty.

**Follow-up.** An executive asks for a definite root cause immediately.

**Build evidence:** F021.

## I036 · Technical defense · Deep dive

**Question.** An interviewer removes the key assumption in your design. What do you demonstrate?

**A strong answer should show:** Re-evaluate constraints, state what breaks, adapt the smallest viable part and explain evidence needed.

**Follow-up.** The model service must now run without outbound internet.

**Build evidence:** F024.
