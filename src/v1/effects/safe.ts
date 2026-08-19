/**
 * Call-site guard for effect invocations.
 *
 * The effect itself must THROW on any failure it cannot model as an on-chain
 * revert, because only a successful return is memoised — throwing keeps the
 * durable cache clean and lets the read retry on the next run. The substitution
 * happens here instead, per event and never persisted, so one flaky endpoint
 * cannot stop the indexer. Never catch inside an effect and return a default.
 */
import type { EvmOnEventContext } from "envio";

export async function effectOrDefault<T>(
  context: EvmOnEventContext,
  label: string,
  details: Record<string, string | number | bigint>,
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const where = Object.entries(details)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" ");
    context.log.error(
      `[effect-fallback] ${label} FAILED (${where}) — continuing with a default ` +
        `value; THIS ROW USES A SUBSTITUTED VALUE. ` +
        `Cause: ${String(error).split("\n")[0]}`,
    );
    return fallback;
  }
}
