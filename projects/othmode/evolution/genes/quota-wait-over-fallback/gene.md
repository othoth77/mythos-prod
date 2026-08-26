# Gene: quota-wait-over-fallback (routing-strategy v1.0)

**Rule.** A task whose provider has execution authority never falls back to a
different provider when quota is exhausted. It parks in `WAITING_FOR_QUOTA`
with the detected reset time (or conservative backoff) and the SAME session
resumes when the window reopens. Advisory tasks (research, review, analysis,
planning) may fall back between advisory providers.

**Why.** Fallback across the execution-authority line would silently hand
repository-modifying power to a provider that was never granted it. Waiting
is always correct; falling back is sometimes catastrophic.

**Where it lives.** `projects/mythos-ai-executor/config/router.json`
(`fallback.never_for_execution_authority`), enforced by the executor's
scheduler and proven by its test suite. This gene records the strategy as a
reusable evolution unit; changing the strategy means a new gene version, a
HIGH-tier review (it touches provider execution authority) and validation.

**بالعربية:** مهمة تملك «سلطة تنفيذ» لا تتحوّل أبداً إلى مزوّد آخر عند نفاد
الحصّة — تنتظر حتى تعود الحصّة ويُستأنف نفس العمل. الانتظار صحيح دائماً؛
التحويل قد يكون كارثياً لأنه يمنح سلطة تعديل المستودع لمزوّد لم يُمنحها.
